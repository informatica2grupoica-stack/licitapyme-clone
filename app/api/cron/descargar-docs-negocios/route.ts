// app/api/cron/descargar-docs-negocios/route.ts
// REINTENTO AUTOMÁTICO de descarga de documentos para las licitaciones ASIGNADAS
// (Negocios) que aún no tienen documentos. Pensado para el scheduler del NOTEBOOK
// (IP chilena), NO para Vercel: la descarga sale a Mercado Público y exige IP chilena.
//
// Reemplaza la necesidad de apretar el botón "Descargar docs de Negocios" del radar:
// el scheduler lo llama cada pocas horas y baja solas las que quedaron sin docs porque
// la descarga fire-and-forget al asignar falló (MP 503, notebook reiniciándose, timeout).
//
// Ámbito: TODAS las asignadas activas de TODOS los perfiles (super), SIN gate de prefiltro
// (son elecciones manuales). Resumible por lotes dentro del presupuesto de tiempo.
//
// Protección (igual que los otros cron): x-vercel-cron:1 · Bearer <CRON_SECRET> · ?secret= · x-cron-secret.
// GET  → cuántas asignadas quedan sin documentos.
// POST → baja el siguiente lote. Body/query: { lote?: number }  (default 6)

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { descargarDocumentosLicitacion } from '@/app/lib/mp-descarga-orquestador';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LOTE_DEFAULT   = 6;
const PRESUPUESTO_MS = 280_000; // margen bajo maxDuration=300

function autorizado(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const secret =
    req.nextUrl.searchParams.get('secret') ||
    req.headers.get('x-cron-secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

// Códigos de asignadas activas SIN documentos (cierre más próximo primero).
async function pendientes(limit?: number): Promise<string[]> {
  const sql =
    `SELECT DISTINCT n.licitacion_codigo
     FROM negocios n
     WHERE n.activo = TRUE
       AND NOT EXISTS (
         SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = n.licitacion_codigo
       )
     ORDER BY n.licitacion_cierre DESC`
    + (limit ? ` LIMIT ${Math.max(1, Math.min(limit, 60))}` : '');
  const [rows] = await pool.query(sql) as any[];
  return (rows as any[]).map(r => r.licitacion_codigo as string);
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const p = await pendientes();
    return NextResponse.json({ pendientes: p.length });
  } catch (e: any) {
    return NextResponse.json({ pendientes: 0, error: e.message });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const lote = Math.min(Number(body.lote ?? req.nextUrl.searchParams.get('lote')) || LOTE_DEFAULT, 30);

  const t0 = Date.now();
  const stats = { procesadas: 0, exitosas: 0, conDocs: 0, errores: 0 };
  const preOcr = process.env.PRE_OCR_AL_ASIGNAR !== 'false';

  try {
    // `intentados` evita reprocesar en bucle el mismo código caído dentro de esta corrida:
    // se reintenta en la SIGUIENTE pasada del scheduler, no en esta.
    const intentados = new Set<string>();
    while (Date.now() - t0 < PRESUPUESTO_MS) {
      const pend = await pendientes(lote * 3);
      const codigos = pend.filter(c => !intentados.has(c)).slice(0, lote);
      if (codigos.length === 0) break;
      for (const c of codigos) intentados.add(c);

      for (const codigo of codigos) {
        if (Date.now() - t0 >= PRESUPUESTO_MS) break;
        try {
          const res = await descargarDocumentosLicitacion(codigo);
          stats.procesadas++;
          if (res.exito) stats.exitosas++;
          if (res.exito && res.nuevos > 0) {
            stats.conDocs++;
            // Pre-OCR: calienta la caché de texto tras la descarga para que el posterior
            // "Analizar" MANUAL sea rápido. NO corre la viabilidad (eso es manual).
            if (preOcr) {
              try {
                const { calentarCacheDocumentos } = await import('@/app/lib/viabilidad-ia');
                await calentarCacheDocumentos(codigo);
              } catch (e) { console.warn(`[cron/docs-negocios] pre-OCR ${codigo}:`, String(e)); }
            }
          }
        } catch (e) {
          stats.procesadas++;
          stats.errores++;
          console.error(`[cron/docs-negocios] ${codigo} falló:`, String(e));
        }
      }
    }

    const restantes = (await pendientes()).length;
    return NextResponse.json({
      success: true,
      ...stats,
      pendientes: restantes,
      completado: restantes === 0,
      duracionMs: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message, ...stats }, { status: 500 });
  }
}
