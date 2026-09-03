// app/api/negocios/[id]/comercial/costeo-editor/route.ts
// COSTEO EN EL SISTEMA — editor integrado (pestaña "Costeo", arriba del Auditor Técnico). Mismo
// Motor Comercial que el costeo subido como archivo (ver comercial/costeo/route.ts), pero editado
// como una planilla dentro del negocio: sin bajar el Excel, llenarlo aparte y volver a subirlo.
//
//   GET  → estado actual del editor: lo guardado si ya existe, o recién derivado del manifiesto
//          de viabilidad (global o por línea, según adaptarViabilidadACosteo) si todavía no hay
//          nada. ?recargar=1 trae los ítems nuevos que el manifiesto tenga y no estén ya en la
//          planilla, sin tocar lo que el usuario ya tipeó (ver fusionarConViabilidad).
//   PUT  → guarda lo editado y lo ingresa como una nueva versión de checklist_comercial_costeo
//          (origen='editor') — misma alerta, mismo auto-precarga del checklist que el Excel.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';
import { ahoraChileSQL } from '@/app/lib/tz';
import { adaptarViabilidadACosteo } from '@/app/lib/generar-costeo';
import {
  datosCosteoAEditor, fusionarConViabilidad, editorAFilasCosteo, MARGEN_VENTA_DEFECTO, type EstadoCosteoEditor,
} from '@/app/lib/costeo-editor';
import { IVA } from '@/app/lib/costeo-comparativo';
import { lineasDelInforme, lineasOfertablesDelInforme } from '@/app/lib/checklist-comercial';
import { leerDecisionLineas, guardarLineasOfertadas } from '@/app/lib/lineas-oferta';
import { presupuestoDeLineaEsUnitario } from '@/app/lib/motor-comercial';
import { cargarNegocio, leerInforme, nombreDe, sincronizar } from '../route';
import { ingresarVersionCosteo } from '../costeo/route';
import { yaCongelado } from '@/app/lib/congelamiento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// EL COSTEO DEL SISTEMA ES ADMIN-ONLY POR AHORA (03-sep-2026, decisión del usuario: "ese costeo
// solo debe estar habilitado para los admin de momento, después será habilitado para todos").
// La pestaña "Costeo" del negocio ya se pinta solo para admin (page.tsx, `hayComercial`), pero el
// gate vivía SOLO en el front: cualquiera con acceso al negocio podía leer y escribir el costeo
// llamando a esta ruta directo. Se cierra acá, que es donde de verdad manda.
//
// PARA ABRIRLO A TODOS: borrar esta función y sus 2 llamadas (GET y PUT), y sacar `isAdmin &&` de
// `hayComercial` en app/negocios/[id]/page.tsx. Son los dos únicos lugares.
function soloAdmin(rol: string | null) {
  return rol === 'admin'
    ? null
    : NextResponse.json({ error: 'El costeo del sistema está habilitado solo para administradores.' }, { status: 403 });
}

async function estadoGuardado(negocioId: number): Promise<EstadoCosteoEditor | null> {
  const [rows] = await pool.query(
    `SELECT modalidad, datos_json FROM negocio_costeo_editor WHERE negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  const row = (rows as any[])[0];
  if (!row) return null;
  try {
    const datos = typeof row.datos_json === 'string' ? JSON.parse(row.datos_json) : row.datos_json;
    // ofertamos: default true — costeos guardados antes de que este campo existiera no lo traen.
    const grupos = (datos?.grupos || []).map((g: any) => ({ ...g, ofertamos: g.ofertamos !== false }));
    return { modalidad: row.modalidad, margenVenta: Number(datos?.margenVenta) || MARGEN_VENTA_DEFECTO, grupos };
  } catch { return null; }
}

function estadoDesdeViabilidad(negocio: { id: number; licitacion_codigo: string }, informe: any): EstadoCosteoEditor | null {
  if (!informe) return null;
  const datos = adaptarViabilidadACosteo(negocio.licitacion_codigo, informe);
  if (!datos.grupos.some(g => g.items.length > 0)) return null;
  return datosCosteoAEditor(datos);
}

// ═══ GET ══════════════════════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const noAdmin = soloAdmin(rol);
  if (noAdmin) return noAdmin;
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    const params2 = new URL(request.url).searchParams;
    const recargar = params2.get('recargar') === '1';
    const informe = await leerInforme(negocio.licitacion_codigo);
    // Mismo presupuesto que usa el Motor Comercial para su alerta "Sobre presupuesto"
    // (comercial/costeo/route.ts) — así el cuadro comparativo y la alerta hablan del mismo número.
    // El presupuesto del informe se publica CON IVA (`bruto`) y el `neto` es su derivado ÷1,19 —
    // ver la normalización determinista en viabilidad-ia.ts. La comparación contra la oferta es
    // SIEMPRE en neto, así que si faltara el neto se deriva acá en vez de colar un bruto.
    const conIva = informe?.presupuesto?.con_iva !== false;
    const brutoGlobal = Number(informe?.presupuesto?.bruto) || null;
    const presupuestoPublicado: number | null =
      Number(informe?.presupuesto?.neto) || (brutoGlobal != null ? (conIva ? brutoGlobal / IVA : brutoGlobal) : null);
    // …pero el tope que de verdad importa es el DE CADA LÍNEA: en la mayoría de las licitaciones el
    // presupuesto se publica por línea y el global es solo la suma. Comparar una línea contra el
    // global da una distancia inventada (caso real 1271359-92-LE26: canasta 1 tope $17.839.600
    // c/IVA, canasta 2 $21.478.000, global $33.040.000 — con el global, la canasta 2 parecía tener
    // 40% de holgura cuando en realidad iba 8% SOBRE su tope).
    // Mismo guardarraíl que el Motor Comercial: si `presupuesto_linea` × cantidad reconstruye el
    // global, lo guardado es el precio máximo POR UNIDAD y no sirve de tope de la línea (2296-48-LE26).
    //
    // Y VA CON IVA: `presupuesto_linea` guarda el monto tal como lo publican las bases —"viene IVA
    // incluido en ambos formatos soportados", ver el backfill de presupuesto en viabilidad-ia.ts—
    // así que hay que pasarlo a neto para compararlo contra la oferta (que es neta). Verificado
    // contra el informe real de 1271359-92-LE26: línea 1 = $17.839.600 y línea 2 = $21.478.000,
    // los MISMOS montos que el comercial tipeó a mano en su Excel (celdas F10 y F15), y sus netos
    // ÷1,19 son los que la planilla usa como tope (K9 = $14.991.261, K14 = $18.048.739).
    // El guardarraíl del "unitario" se evalúa con el monto CRUDO: ya prueba contra el global neto
    // y contra el global × 1,19, así que no le importa en qué moneda venga.
    const presupuestosPorLinea: Record<number, number> = {};
    for (const l of lineasDelInforme(informe)) {
      if (l.presupuestoLinea == null || l.presupuestoLinea <= 0) continue;
      if (presupuestoDeLineaEsUnitario(l, presupuestoPublicado)) continue;
      presupuestosPorLinea[l.linea] = conIva ? l.presupuestoLinea / IVA : l.presupuestoLinea;
    }
    // Solo la propuesta fresca de viabilidad, SIN tocar lo guardado ni mezclar nada — el front la
    // usa para fusionar contra su estado LOCAL (que puede traer cambios sin guardar, como un
    // "Separar por línea" recién hecho) en vez de perderlos al pisarlos con lo que hay en la BD.
    if (params2.get('soloViabilidad') === '1') {
      const desde = estadoDesdeViabilidad(negocio, informe);
      return NextResponse.json({ success: true, estado: desde, sinViabilidad: !desde, presupuestoPublicado, presupuestosPorLinea });
    }

    const guardado = await estadoGuardado(negocio.id);
    const desdeViab = (!guardado || recargar) ? estadoDesdeViabilidad(negocio, informe) : null;

    let estado: EstadoCosteoEditor | null = null;
    let agregados = 0;
    let reclasificados = 0;
    let sinGuardar = false;
    if (guardado && recargar && desdeViab) {
      const r = fusionarConViabilidad(guardado, desdeViab);
      estado = r.estado; agregados = r.agregados; reclasificados = r.reclasificados;
    } else if (guardado) {
      estado = guardado;
    } else if (desdeViab) {
      estado = desdeViab; sinGuardar = true; // aún no se guardó ninguna versión — es solo la propuesta inicial
    }

    // ── UNA SOLA DECISIÓN DE LÍNEAS PARA TODA LA APP (03-sep-2026) ────────────────────────────
    // El interruptor "¿ofertamos esta hoja?" del editor y el selector de líneas a ofertar del
    // negocio eran dos memorias distintas de la MISMA decisión: se podía apagar la línea 1 arriba
    // y seguir viéndola encendida —y sumando al total— en el costeo. Manda la tabla del selector
    // (negocio_lineas_oferta, migración 78), que es la que ya consumen el Auditor Técnico y el
    // Motor Comercial; el editor la refleja y también la escribe (ver el PUT), así la decisión se
    // toma en cualquiera de los dos lados y el otro queda al día.
    if (estado) {
      const decision = new Map((await leerDecisionLineas(negocio.id)).map(d => [d.linea, d.ofertamos]));
      if (decision.size) {
        estado = { ...estado, grupos: estado.grupos.map(g =>
          g.linea != null && decision.has(g.linea) ? { ...g, ofertamos: decision.get(g.linea)! } : g) };
      }
    }

    return NextResponse.json({
      success: true, estado, sinGuardar, agregados, reclasificados, presupuestoPublicado, presupuestosPorLinea,
      sinViabilidad: !guardado && !desdeViab,
      congelado: await yaCongelado(negocio.id, rol),
    });
  } catch (error) {
    console.error('[comercial/costeo-editor][GET]', String(error));
    // Tabla puede no existir todavía (migración 85 pendiente) — no romper la pestaña por eso.
    return NextResponse.json({ success: true, estado: null, sinViabilidad: true, migracionPendiente: true });
  }
}

// ═══ PUT — guarda lo editado y lo ingresa como nueva versión del Motor Comercial ═══════════════
export async function PUT(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const noAdmin = soloAdmin(rol);
  if (noAdmin) return noAdmin;
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (await yaCongelado(negocio.id, rol))
      return NextResponse.json({ error: 'Este negocio ya se postuló: el Auditor Técnico quedó congelado, de solo lectura.' }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const margenVenta = Number(body.margenVenta);
    const estado: EstadoCosteoEditor = {
      modalidad: body.modalidad === 'por_linea' || body.modalidad === 'por_categoria' ? body.modalidad : 'suma_alzada',
      margenVenta: Number.isFinite(margenVenta) ? margenVenta : MARGEN_VENTA_DEFECTO,
      grupos: Array.isArray(body.grupos) ? body.grupos : [],
    };
    const filas = editorAFilasCosteo(estado);
    if (!filas.length) return NextResponse.json({ error: 'No hay ítems con datos para guardar' }, { status: 400 });

    const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || 'Usuario';
    const ahora = ahoraChileSQL();

    await pool.query(
      `INSERT INTO negocio_costeo_editor (negocio_id, modalidad, datos_json, actualizado_por, actualizado_por_nombre, actualizado_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE modalidad = VALUES(modalidad), datos_json = VALUES(datos_json),
         actualizado_por = VALUES(actualizado_por), actualizado_por_nombre = VALUES(actualizado_por_nombre),
         actualizado_at = VALUES(actualizado_at)`,
      [negocio.id, estado.modalidad, JSON.stringify(estado), userId, nombreActor, ahora],
    );

    // El interruptor de cada hoja ES la decisión de líneas del negocio (ver el GET): apagar la
    // línea 1 acá tiene que atenuarla también en el Auditor Técnico y sacarla de las alertas del
    // Motor Comercial, sin obligar a repetir la misma decisión en dos pantallas.
    await propagarDecisionDeLineas(negocio, estado, userId);

    const { version, alertas, totales } = await ingresarVersionCosteo(negocio, filas, {
      origen: 'editor', archivoUrl: null, archivoNombre: 'Costeo (editor interno)',
      userId, nombreActor,
    });

    return NextResponse.json({ success: true, version, alertas, totales });
  } catch (error) {
    console.error('[comercial/costeo-editor][PUT]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * Lleva los interruptores "¿ofertamos esta hoja?" del editor a la decisión de líneas del negocio.
 *
 * Se manda SIEMPRE la lista completa de líneas conocidas (no solo las que tienen hoja): guardar
 * únicamente las hojas presentes dejaría implícitamente fuera de la oferta a una línea que el
 * costeo todavía no llegó a cotizar, que nadie decidió descartar.
 *
 * Y solo se escribe cuando hay un CAMBIO real: si nadie tocó ningún interruptor, guardar una
 * decisión "ofertamos todas" apagaría el banner del selector sin que nadie lo haya contestado.
 */
async function propagarDecisionDeLineas(
  negocio: { id: number; licitacion_codigo: string },
  estado: EstadoCosteoEditor,
  userId: number,
): Promise<void> {
  try {
    const hojas = estado.grupos.filter(g => g.linea != null);
    if (!hojas.length) return; // costeo global o por categoría: no hay decisión de líneas que tomar

    const informe = await leerInforme(negocio.licitacion_codigo);
    const conocidas = new Map(informe ? lineasOfertablesDelInforme(informe).map(l => [l.linea, l.descripcion]) : []);
    if (!conocidas.size) return; // sin líneas en el informe no se puede validar contra qué se está decidiendo

    const previo = new Map((await leerDecisionLineas(negocio.id)).map(d => [d.linea, d.ofertamos]));
    const lineas = [...conocidas.keys()].sort((a, b) => a - b).map(n => {
      const hoja = hojas.find(g => g.linea === n);
      return {
        linea: n,
        nombre: conocidas.get(n) ?? null,
        ofertamos: hoja ? !!hoja.ofertamos : (previo.get(n) ?? true),
      };
    });
    if (!lineas.some(l => l.ofertamos)) return;                    // apagarlas todas no es una decisión válida
    if (!previo.size && lineas.every(l => l.ofertamos)) return;    // nada apagado y sin decisión previa: no hay nada que registrar
    if (previo.size && lineas.every(l => previo.get(l.linea) === l.ofertamos)) return; // sin cambios

    await guardarLineasOfertadas({
      negocioId: negocio.id, licitacionCodigo: negocio.licitacion_codigo, lineas, usuarioId: userId,
    });
    // Volver a incluir una línea tiene que CREAR su trabajo, no solo marcarla — mismo motivo que
    // en el PUT de /lineas-oferta.
    if (informe) await sincronizar(negocio.id, negocio.licitacion_codigo, informe);
  } catch (e) {
    // La decisión de líneas es un efecto lateral del guardado: si falla, el costeo igual se guarda.
    console.error('[comercial/costeo-editor] propagar decisión de líneas falló (no bloquea):', String(e).slice(0, 200));
  }
}
