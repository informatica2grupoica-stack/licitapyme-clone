// app/api/cron/procesar-radar/route.ts
// AUTOMATIZACIÓN Fase 0→descarga: encadena en UNA sola corrida, resumible y acotada:
//   PASO 1 — Prefiltro (PROMPT 0): decide PASA / EXCLUIDO / REVISION_HUMANA sobre las
//            alertas del radar que aún NO tienen decisión. No descarga nada (barato).
//   PASO 2 — Descarga automática: SOLO para las que pasaron el gate (PASA / REVISION_HUMANA)
//            y no tienen documentos → descarga docs + dispara el pipeline IA
//            (clasificar → análisis → viabilidad). Las EXCLUIDO nunca bajan (ahorro).
//
// ⚠️ CORRE EN EL NOTEBOOK (IP chilena), NO en Vercel: el PASO 2 descarga del portal de
// Mercado Público, que exige IP chilena. Un scheduler local (cron/loop) golpea este
// endpoint cada pocos minutos; cada corrida avanza un lote acotado y el progreso se
// acumula (idempotente: salta lo ya prefiltrado / ya descargado).
//
// Protección: Authorization: Bearer <CRON_SECRET>  o  ?secret=<CRON_SECRET>  o  x-cron-secret.
// NO acepta x-vercel-cron (no debe correr en Vercel).
//
// GET  → estado: cuántas quedan por prefiltrar y cuántas PASA/REVISION sin docs.
// POST → procesa un lote. Body/query: { lotePrefiltro?, loteDescarga?, soloPrefiltro?, soloDescarga? }

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { prefiltrarYGuardar } from '@/app/lib/prefiltro';
import { descargarDocumentosLicitacion } from '@/app/lib/mp-descarga-orquestador';
import { procesarLicitacionCompleta } from '@/app/lib/pipeline-licitacion';
import { tomarLock, liberarLock } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LOTE_PREFILTRO_DEFAULT = 30;   // códigos a prefiltrar por corrida (DeepSeek en lotes de 15)
const LOTE_DESCARGA_DEFAULT  = 3;    // descargas por corrida (cada una ~1-2 min → poco tope)
const PRESUPUESTO_MS         = 270_000; // margen bajo maxDuration=300

function autorizado(req: NextRequest): boolean {
  const secret =
    req.nextUrl.searchParams.get('secret') ||
    req.headers.get('x-cron-secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

// Gate de prefiltro para la descarga: solo PASA / REVISION_HUMANA.
const GATE_DECISIONES = "('PASA','REVISION_HUMANA')";

// Radar sin decisión de prefiltro (más recientes primero).
async function radarSinPrefiltro(limit: number): Promise<string[]> {
  const [rows] = await pool.query(
    `SELECT DISTINCT al.licitacion_codigo
     FROM alertas_licitaciones al
     WHERE NOT EXISTS (SELECT 1 FROM prefiltro_licitacion pf WHERE pf.licitacion_codigo = al.licitacion_codigo)
     ORDER BY COALESCE(al.licitacion_fecha_publicacion, al.licitacion_cierre, al.created_at) DESC
     LIMIT ?`,
    [limit],
  ) as any[];
  return (rows as any[]).map(r => r.licitacion_codigo as string);
}

// Radar con gate PASA/REVISION y SIN documentos aún (cierre más próximo primero).
async function radarPasaSinDocs(limit: number, excluir: string[] = []): Promise<string[]> {
  const ex = excluir.slice(0, 1000);
  const exClause = ex.length ? `AND al.licitacion_codigo NOT IN (${ex.map(() => '?').join(',')})` : '';
  const [rows] = await pool.query(
    `SELECT DISTINCT al.licitacion_codigo
     FROM alertas_licitaciones al
     JOIN prefiltro_licitacion pf
       ON pf.licitacion_codigo = al.licitacion_codigo AND pf.decision IN ${GATE_DECISIONES}
     WHERE NOT EXISTS (SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = al.licitacion_codigo)
       ${exClause}
     ORDER BY al.licitacion_cierre DESC
     LIMIT ?`,
    [...ex, limit],
  ) as any[];
  return (rows as any[]).map(r => r.licitacion_codigo as string);
}

async function contarPendientes(): Promise<{ prefiltro: number; descarga: number }> {
  const [[{ prefiltro }]] = await pool.query(
    `SELECT COUNT(DISTINCT al.licitacion_codigo) AS prefiltro
     FROM alertas_licitaciones al
     WHERE NOT EXISTS (SELECT 1 FROM prefiltro_licitacion pf WHERE pf.licitacion_codigo = al.licitacion_codigo)`,
  ) as any[];
  const [[{ descarga }]] = await pool.query(
    `SELECT COUNT(DISTINCT al.licitacion_codigo) AS descarga
     FROM alertas_licitaciones al
     JOIN prefiltro_licitacion pf
       ON pf.licitacion_codigo = al.licitacion_codigo AND pf.decision IN ${GATE_DECISIONES}
     WHERE NOT EXISTS (SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = al.licitacion_codigo)`,
  ) as any[];
  return { prefiltro: Number(prefiltro), descarga: Number(descarga) };
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const pend = await contarPendientes();
    return NextResponse.json({ pendientes: pend });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const qs = req.nextUrl.searchParams;
  const lotePrefiltro = Math.min(Number(body.lotePrefiltro ?? qs.get('lotePrefiltro')) || LOTE_PREFILTRO_DEFAULT, 90);
  const loteDescarga  = Math.min(Number(body.loteDescarga  ?? qs.get('loteDescarga'))  || LOTE_DESCARGA_DEFAULT, 10);
  const soloPrefiltro = body.soloPrefiltro === true || qs.get('soloPrefiltro') === 'true';
  const soloDescarga  = body.soloDescarga  === true || qs.get('soloDescarga')  === 'true';

  // Lock best-effort: evita que dos corridas del scheduler se pisen (si no hay Redis, no bloquea;
  // igual es idempotente — se salta lo ya prefiltrado / ya descargado).
  const lock = await tomarLock('cron:procesar-radar', 290);
  if (!lock) {
    return NextResponse.json({ success: false, error: 'Ya hay una corrida en progreso (lock).', enProgreso: true }, { status: 409 });
  }

  const t0 = Date.now();
  const elapsed = () => Date.now() - t0;
  const stats = {
    prefiltro:  { procesadas: 0, pasa: 0, revision: 0, excluido: 0, errores: 0 },
    descarga:   { intentadas: 0, exito: 0, fallidas: 0, docsNuevos: 0 },
    procesadosDescarga: [] as Array<{ codigo: string; exito: boolean; nuevos: number; error?: string }>,
    agotoTiempo: false,
    duracionMs: 0,
  };

  try {
    // ── PASO 1: Prefiltro de lo pendiente ─────────────────────────────────────
    if (!soloDescarga) {
      const pendientes = await radarSinPrefiltro(lotePrefiltro);
      if (pendientes.length > 0) {
        try {
          // enriquecer:true → rellena descripción/ítems faltantes antes de decidir
          // (automático, best-effort). maxDuration 300 da margen para el enriquecido.
          const results = await prefiltrarYGuardar(pendientes, { enriquecer: true, maxEnriquecerMs: 120_000 });
          stats.prefiltro.procesadas = results.length;
          for (const r of results) {
            if (r.decision === 'PASA') stats.prefiltro.pasa++;
            else if (r.decision === 'REVISION_HUMANA') stats.prefiltro.revision++;
            else if (r.decision === 'EXCLUIDO') stats.prefiltro.excluido++;
          }
        } catch (e) {
          stats.prefiltro.errores++;
          console.error('[cron/procesar-radar] prefiltro falló:', String(e));
        }
      }
    }

    // ── PASO 2: Descarga automática de las que pasaron el gate, sin docs ───────
    if (!soloPrefiltro) {
      const fallidos: string[] = [];
      while (stats.descarga.intentadas < loteDescarga && elapsed() < PRESUPUESTO_MS) {
        const [codigo] = await radarPasaSinDocs(1, fallidos);
        if (!codigo) break;

        stats.descarga.intentadas++;
        try {
          const res = await descargarDocumentosLicitacion(codigo);
          if (res.exito) {
            stats.descarga.exito++;
            stats.descarga.docsNuevos += res.nuevos || 0;
            // Pipeline IA best-effort: la descarga ya quedó guardada aunque esto falle.
            if (process.env.GEMINI_API_KEY) {
              try { await procesarLicitacionCompleta(codigo); }
              catch (e: any) { console.warn(`[cron/procesar-radar] pipeline ${codigo}:`, e?.message); }
            }
          } else {
            stats.descarga.fallidas++;
            fallidos.push(codigo); // evita reintentar la misma en bucle esta corrida
          }
          stats.procesadosDescarga.push({ codigo, exito: !!res.exito, nuevos: res.nuevos || 0, error: res.error });
        } catch (e: any) {
          stats.descarga.fallidas++;
          fallidos.push(codigo);
          stats.procesadosDescarga.push({ codigo, exito: false, nuevos: 0, error: String(e?.message ?? e).slice(0, 200) });
        }
      }
      if (elapsed() >= PRESUPUESTO_MS) stats.agotoTiempo = true;
    }

    const pendientes = await contarPendientes();
    stats.duracionMs = elapsed();
    return NextResponse.json({
      success: true,
      ...stats,
      pendientes,
      completado: pendientes.prefiltro === 0 && pendientes.descarga === 0,
    });
  } catch (e: any) {
    stats.duracionMs = elapsed();
    return NextResponse.json({ success: false, error: String(e?.message ?? e), ...stats }, { status: 500 });
  } finally {
    await liberarLock('cron:procesar-radar');
  }
}
