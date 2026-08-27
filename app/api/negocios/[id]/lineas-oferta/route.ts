// app/api/negocios/[id]/lineas-oferta/route.ts
// SELECTOR DE LÍNEAS A OFERTAR — "¿a qué líneas vamos?" en una licitación por línea.
//
//   GET → { esPorLinea, decidido, lineas: [{ linea, nombre, cantidad, unidad, presupuesto,
//                                            caracteristicas, ofertamos }] }
//   PUT → { lineas: [{ linea, ofertamos }] } guarda la decisión y la proyecta al checklist
//
// POR QUÉ ES UN ENDPOINT PROPIO Y NO PARTE DE .../comercial: la decisión es del NEGOCIO, no del
// checklist. La contesta el banner del detalle del negocio (antes de entrar a ANEXOS, cuando el
// checklist todavía no existe) y la consumen después tres módulos distintos — Auditor Técnico,
// costeo y Motor Comercial. Colgarla del route del auditor la habría dejado inalcanzable justo
// en el momento en que hay que preguntarla.
//
// Ver app/lib/lineas-oferta.ts y docs/migration-78-lineas-a-ofertar.sql.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';
import { registrarEvento } from '@/app/lib/historial';
import { publicarCambio } from '@/app/lib/sse-bus';
import { cargarNegocio, leerInforme } from '@/app/api/negocios/[id]/comercial/route';
import { esPorLinea, lineasDelInforme } from '@/app/lib/checklist-comercial';
import { lineasTecnicasDelInforme } from '@/app/lib/auditor-tecnico-core';
import { leerDecisionLineas, guardarLineasOfertadas, lineasExcluidasDeNegocio } from '@/app/lib/lineas-oferta';
import { recalcularAlertasCosteo } from '@/app/lib/motor-comercial-recalculo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null, rol: req.headers.get('x-user-rol') };
}

/**
 * Las líneas ofertables, unificando las dos vistas del informe: el manifiesto comercial
 * (lineasDelInforme, el que trae cantidad/unidad/presupuesto) y el técnico
 * (lineasTecnicasDelInforme, el que fusiona los productos de una línea-paquete y cuenta sus
 * características). Los dos numeran igual desde el fix de numeroDeLinea; si aun así una vista
 * conoce una línea que la otra no, se muestra igual — preferimos ofrecer una línea de más que
 * esconder una a la que había que postular.
 */
function lineasOfertables(informe: any) {
  const comercial = lineasDelInforme(informe);
  const tecnicas = new Map(lineasTecnicasDelInforme(informe).map(l => [l.linea, l]));
  const numeros = Array.from(new Set([...comercial.map(l => l.linea), ...tecnicas.keys()])).sort((a, b) => a - b);
  return numeros.map(n => {
    const c = comercial.find(l => l.linea === n);
    const t = tecnicas.get(n);
    return {
      linea: n,
      nombre: c?.descripcion || t?.nombre || `Línea ${n}`,
      cantidad: c?.cantidad ?? null,
      unidad: c?.unidad ?? null,
      presupuesto: c?.presupuestoLinea ?? null,
      caracteristicas: t?.caracteristicas.length ?? 0,
      // De qué lado apareció, cuando aparece en UNO SOLO. Medido el 26-ago-2026: 10 de 136
      // informes por línea traen los dos arrays con líneas distintas, y NINGUNO de los dos es
      // confiable siempre (hay manifiestos con filas basura y hay informes donde la IA numera
      // un "LÍNEA n" por producto). No se elige un ganador a ciegas: se marca la discrepancia
      // para que la vea el humano que está decidiendo, en vez de resolverla mal en silencio.
      soloEn: c && !t ? ('comercial' as const) : (!c && t ? ('tecnico' as const) : null),
    };
  });
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;
  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    const informe = await leerInforme(negocio.licitacion_codigo);
    const porLinea = !!informe && esPorLinea(informe);
    const disponibles = porLinea ? lineasOfertables(informe) : [];
    const decision = await leerDecisionLineas(negocio.id);
    const guardadas = new Map(decision.map(d => [d.linea, d]));

    // ¿Hay filas del checklist numeradas con una escala que no es la del informe? (checklists
    // generados antes del fix de numeración de líneas). Ahí la decisión se guarda pero no se
    // proyecta sobre lo ya materializado — ver guardarLineasOfertadas.
    let checklistDesalineado: string[] = [];
    if (porLinea && disponibles.length) {
      try {
        const conocidas = new Set(disponibles.map(l => l.linea));
        const [filas] = await pool.query(
          `SELECT DISTINCT tipo, linea_numero FROM checklist_comercial
            WHERE negocio_id = ? AND linea_numero IS NOT NULL`,
          [negocio.id],
        ) as any;
        const porTipo = new Map<string, number[]>();
        for (const f of filas as Array<{ tipo: string; linea_numero: number }>) {
          if (!porTipo.has(f.tipo)) porTipo.set(f.tipo, []);
          porTipo.get(f.tipo)!.push(Number(f.linea_numero));
        }
        checklistDesalineado = [...porTipo.entries()]
          .filter(([, nums]) => !nums.every(n => conocidas.has(n)))
          .map(([tipo]) => tipo);
      } catch { /* si no se puede medir, no se avisa: nunca romper el selector por el aviso */ }
    }

    return NextResponse.json({
      success: true,
      esPorLinea: porLinea,
      checklistDesalineado,
      // "decidido" es lo que apaga el banner. Se mira la decisión guardada, NO si hay líneas
      // marcadas: un negocio sin filas es "todavía no se preguntó", y ahí el banner debe salir.
      decidido: decision.length > 0,
      lineas: disponibles.map(l => ({
        ...l,
        // Por defecto TODO viene marcado: lo habitual es ofertar a todas y desmarcar las que no.
        ofertamos: guardadas.get(l.linea)?.ofertamos ?? true,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;
  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const enviadas: Array<{ linea: number; ofertamos: boolean }> =
      Array.isArray(body?.lineas) ? body.lineas : [];
    if (!enviadas.length) return NextResponse.json({ error: 'Sin líneas' }, { status: 400 });
    if (!enviadas.some(l => l.ofertamos))
      return NextResponse.json({ error: 'Hay que ofertar al menos una línea' }, { status: 400 });

    // El nombre se toma del informe, no del cliente: es una foto para poder leer la decisión
    // después, y no queremos que dependa de lo que el navegador tuviera en pantalla.
    const informe = await leerInforme(negocio.licitacion_codigo);
    const nombres = new Map(informe ? lineasOfertables(informe).map(l => [l.linea, l.nombre]) : []);

    const { ofertadas, descartadas, sinProyectar } = await guardarLineasOfertadas({
      negocioId: negocio.id,
      licitacionCodigo: negocio.licitacion_codigo,
      lineas: enviadas.map(l => ({
        linea: Number(l.linea), nombre: nombres.get(Number(l.linea)) ?? null, ofertamos: !!l.ofertamos,
      })),
      usuarioId: userId,
    });

    // Tipo propio (no CAMBIO_ETAPA): la etapa del negocio no se movió, y el backfill de
    // migration-76 lee CAMBIO_ETAPA para deducir cuándo se postuló — ensuciarlo con otra cosa
    // sería sembrar un dato falso ahí. usuarioId es el DESTINATARIO (el asignado, que ve la
    // campana), actorId es quien decidió.
    // Las alertas del costeo vigente quedaron obsoletas: sacar una línea de la oferta cambia el
    // total ofertado y puede hacer desaparecer un "sobre presupuesto" que ya no corresponde.
    // Mismo problema que el bug de 3489-29-LP26 (alertas congeladas al momento de calcularlas):
    // si no se recalcula acá, la alerta sigue citando cifras de líneas que ya no se ofertan.
    try {
      const lineasPublicadas = informe ? lineasDelInforme(informe) : [];
      await recalcularAlertasCosteo({
        negocioId: negocio.id,
        lineasPublicadas,
        lineasExcluidas: await lineasExcluidasDeNegocio(negocio.id, lineasPublicadas.map(l => l.linea)),
      });
    } catch (e) {
      // Refrescar el diagnóstico es una mejora, no parte de guardar la decisión: si falla, la
      // selección igual quedó guardada y las alertas se refrescan en la próxima subida de costeo.
      console.warn('[lineas-oferta][PUT] no se pudieron recalcular las alertas del costeo:', String(e));
    }

    await registrarEvento({
      tipo: 'LINEAS_OFERTA',
      licitacionCodigo: negocio.licitacion_codigo,
      licitacionNombre: negocio.licitacion_nombre ?? null,
      usuarioId: negocio.asignado_a ?? null,
      actorId: userId,
      mensaje: `Líneas a ofertar: ${ofertadas.join(', ') || '—'}${descartadas.length ? ` · fuera: ${descartadas.join(', ')}` : ''}`,
      metadata: { ofertadas, descartadas },
    }).catch(() => { /* la bitácora no puede tumbar la decisión */ });
    publicarCambio('negocio');

    // `sinProyectar` lista los grupos del checklist cuya numeración de línea no calza con la del
    // informe (checklists generados antes del fix de numeración): ahí la decisión se GUARDA pero
    // no se aplica sobre las filas ya existentes, porque aplicarla marcaría las equivocadas.
    // Se devuelve para poder decirlo en pantalla en vez de que el usuario lo descubra solo.
    return NextResponse.json({ success: true, ofertadas, descartadas, sinProyectar });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
