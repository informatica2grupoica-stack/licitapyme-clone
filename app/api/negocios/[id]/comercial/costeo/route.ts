// app/api/negocios/[id]/comercial/costeo/route.ts
// MOTOR COMERCIAL (Auditor Técnico, Fase 4, spec §7) — ingesta del costeo real subido por el
// asistente. El archivo ya se subió a R2 vía /api/documentos/subir (mismo flujo que "Subir
// ficha técnica" en el Agente Técnico); acá solo se recibe la URL, se descarga, se parsea y se
// calculan las 4 alertas obligatorias (§7.4).
//
//   GET  → versión vigente + últimas versiones (historial, spec §7.6)
//   POST { url, nombre } → parsea, calcula alertas, guarda nueva versión (baja la anterior)
//
// Auto-precarga (spec §7.5, alcance acotado): si un ítem 'precio' del bloque COMERCIAL sigue en
// PENDIENTE (el asistente no cargó nada todavía), se rellena con el total del costeo. Si ya
// tiene un valor (CARGADO/APROBADO/OBSERVADO), NO se sobreescribe — la alerta de discordancia
// es la que avisa si el valor cargado a mano no calza con el costeo, en vez de pisarlo en
// silencio.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { publicarCambio } from '@/app/lib/sse-bus';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';
import { ahoraChileSQL } from '@/app/lib/tz';
import { esPorLinea, lineasDelInforme } from '@/app/lib/checklist-comercial';
import { parsearCosteo, calcularAlertasMotorComercial, totalesDeCosteo, type AlertaMotorComercial } from '@/app/lib/motor-comercial';
import { cargarNegocio, leerInforme, leerItems, nombreDe, asesores } from '../route';
import { yaCongelado } from '@/app/lib/congelamiento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

async function totalAnexoEconomico(negocioId: number): Promise<number | null> {
  const [rows] = await pool.query(
    `SELECT valor_numero FROM checklist_comercial
      WHERE negocio_id = ? AND bloque = 'COMERCIAL' AND tipo = 'precio' AND (ofertamos IS NULL OR ofertamos = 1)`,
    [negocioId],
  ) as any;
  const vals = (rows as any[]).map(r => r.valor_numero).filter((v: any) => v != null);
  if (!vals.length) return null;
  return vals.reduce((s: number, v: any) => s + Number(v), 0);
}

// ═══ GET ══════════════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    const [rows] = await pool.query(
      `SELECT id, version, vigente, archivo_url, archivo_nombre, total_costo_neto, total_precio_neto,
              presupuesto_publicado, total_anexo_economico, alertas, subido_por_nombre, subido_at
         FROM checklist_comercial_costeo WHERE negocio_id = ? ORDER BY version DESC LIMIT 15`,
      [negocio.id],
    ) as any;
    const historial = (rows as any[]).map(r => ({
      ...r, vigente: !!r.vigente,
      alertas: typeof r.alertas === 'string' ? JSON.parse(r.alertas) : (r.alertas || []),
    }));

    return NextResponse.json({ success: true, vigente: historial.find(h => h.vigente) || null, historial });
  } catch (error) {
    console.error('[comercial/costeo][GET]', String(error));
    // Tabla puede no existir todavía (migración 53 pendiente) — no romper la pestaña por eso.
    return NextResponse.json({ success: true, vigente: null, historial: [], migracionPendiente: true });
  }
}

// ═══ POST — ingesta de una nueva versión del costeo ══════════════════════════════════
export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (await yaCongelado(negocio.id))
      return NextResponse.json({ error: 'Este negocio ya se postuló: el Auditor Técnico quedó congelado, de solo lectura.' }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const url = String(body.url || '').trim();
    const nombreArchivo = String(body.nombre || 'costeo.xlsx').trim();
    if (!url) return NextResponse.json({ error: 'Falta la URL del archivo subido' }, { status: 400 });

    const res = await fetch(url);
    if (!res.ok) return NextResponse.json({ error: 'No se pudo descargar el archivo subido' }, { status: 400 });
    const buffer = Buffer.from(await res.arrayBuffer());

    let filas;
    try { filas = await parsearCosteo(buffer); }
    catch (e) { return NextResponse.json({ error: `No se pudo leer el Excel: ${String(e)}` }, { status: 400 }); }
    if (!filas.length) return NextResponse.json({ error: 'El archivo no trae ítems reconocibles (¿es la plantilla de costeo?)' }, { status: 400 });

    const informe = await leerInforme(negocio.licitacion_codigo);
    const presupuestoPublicado = informe?.presupuesto?.neto ?? informe?.presupuesto?.bruto ?? null;
    const lineasPublicadas = informe ? lineasDelInforme(informe) : [];
    const totalAnexo = await totalAnexoEconomico(negocio.id);
    const { totalCostoNeto, totalPrecioNeto } = totalesDeCosteo(filas);

    const alertas: AlertaMotorComercial[] = calcularAlertasMotorComercial({
      filas, totalAnexoEconomico: totalAnexo, presupuestoPublicado, lineasPublicadas,
    });

    const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || 'Usuario';
    const ahora = ahoraChileSQL();

    const [[{ maxVersion }]] = await pool.query(
      `SELECT COALESCE(MAX(version), 0) AS maxVersion FROM checklist_comercial_costeo WHERE negocio_id = ?`,
      [negocio.id],
    ) as any;
    const version = Number(maxVersion) + 1;

    await pool.query(`UPDATE checklist_comercial_costeo SET vigente = 0 WHERE negocio_id = ? AND vigente = 1`, [negocio.id]);
    await pool.query(
      `INSERT INTO checklist_comercial_costeo
         (negocio_id, version, vigente, archivo_url, archivo_nombre, total_costo_neto, total_precio_neto,
          presupuesto_publicado, total_anexo_economico, alertas, subido_por, subido_por_nombre, subido_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        negocio.id, version, url.slice(0, 600), nombreArchivo.slice(0, 300),
        totalCostoNeto, totalPrecioNeto, presupuestoPublicado, totalAnexo,
        JSON.stringify(alertas), userId, nombreActor, ahora,
      ],
    );

    // Auto-precarga SOLO de ítems 'precio' todavía en PENDIENTE (spec §7.5) — ver cabecera del
    // archivo para por qué no se toca nada que ya tenga un valor cargado.
    const items = await leerItems(negocio.id);
    const itemsPrecio = items.filter((i: any) => i.bloque === 'COMERCIAL' && i.tipo === 'precio' && i.estado === 'PENDIENTE');
    if (esPorLinea(informe)) {
      const porLinea = new Map(filas.filter(f => f.item != null).map(f => [f.item as number, f]));
      for (const it of itemsPrecio) {
        const f = it.linea_numero != null ? porLinea.get(it.linea_numero) : null;
        if (f?.precioTotalNeto == null) continue;
        await pool.query(
          `UPDATE checklist_comercial SET estado = 'CARGADO', valor_numero = ?, ofertamos = 1,
                  cargado_por = ?, cargado_por_nombre = ?, cargado_at = ? WHERE id = ?`,
          [f.precioTotalNeto, userId, nombreActor, ahora, it.id],
        );
      }
    } else {
      const totalItem = itemsPrecio.find((i: any) => i.linea_numero == null);
      if (totalItem && totalPrecioNeto > 0) {
        await pool.query(
          `UPDATE checklist_comercial SET estado = 'CARGADO', valor_numero = ?, ofertamos = 1,
                  cargado_por = ?, cargado_por_nombre = ?, cargado_at = ? WHERE id = ?`,
          [totalPrecioNeto, userId, nombreActor, ahora, totalItem.id],
        );
      }
    }

    // Aviso a los asesores solo si hay alertas — un costeo limpio no necesita interrumpir a nadie.
    if (alertas.length > 0) {
      for (const a of await asesores()) {
        if (Number(a.id) === Number(userId)) continue;
        await registrarEvento({
          tipo: 'COSTEO_CON_ALERTAS',
          licitacionCodigo: negocio.licitacion_codigo, licitacionNombre: negocio.licitacion_nombre,
          usuarioId: a.id, usuarioNombre: a.nombre, actorId: userId, actorNombre: nombreActor,
          mensaje: `${nombreActor} subió un costeo con ${alertas.length} alerta(s): ${alertas.map(x => x.descripcion).join(', ')}`,
          metadata: { negocioId: negocio.id, alertas: alertas.map(a2 => a2.codigo) },
        });
      }
    }
    publicarCambio('checklist_comercial');

    return NextResponse.json({
      success: true, version, alertas,
      totales: { totalCostoNeto, totalPrecioNeto, presupuestoPublicado, totalAnexoEconomico: totalAnexo },
    });
  } catch (error) {
    console.error('[comercial/costeo][POST]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
