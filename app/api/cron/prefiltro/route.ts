// app/api/cron/prefiltro/route.ts
// PREFILTRO AUTOMÁTICO (Fase 0) — pensado para dispararse por cron (cron-job.org o Vercel
// Cron) cada pocas horas, junto al intake de keywords. Toma las licitaciones del radar que
// aún NO tienen decisión de prefiltro y las resuelve (PASA / EXCLUIDO / REVISION_HUMANA) en
// un lote acotado, dentro del presupuesto de tiempo. Resumible: lo que no alcance queda para
// la próxima corrida. NO descarga documentos (eso exige IP chilena → notebook).
//
// Corre en Vercel sin problema (el prefiltro usa DeepSeek, no necesita IP chilena). Usa el
// caché de metadata que ya dejó el intake (prefiltro.ts lee leerCache internamente).
//
// Protección: x-vercel-cron:1  ·  Authorization: Bearer <CRON_SECRET>  ·  ?secret=  ·  x-cron-secret.
//
// GET  → cuántas quedan por prefiltrar.
// POST → procesa el siguiente lote. Body/query: { lote?: number }  (default 45)

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { prefiltrarYGuardar } from '@/app/lib/prefiltro';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LOTE_DEFAULT   = 45;      // códigos por corrida (DeepSeek en tandas de 15 → ~3 llamadas)
const PRESUPUESTO_MS = 52_000;  // margen bajo maxDuration=60

function autorizado(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const secret =
    req.nextUrl.searchParams.get('secret') ||
    req.headers.get('x-cron-secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

// Códigos del radar SIN decisión de prefiltro (más recientes primero).
async function pendientes(limit?: number): Promise<string[]> {
  const sql =
    `SELECT DISTINCT al.licitacion_codigo
     FROM alertas_licitaciones al
     WHERE NOT EXISTS (SELECT 1 FROM prefiltro_licitacion pf WHERE pf.licitacion_codigo = al.licitacion_codigo)
     ORDER BY COALESCE(al.licitacion_fecha_publicacion, al.licitacion_cierre, al.created_at) DESC`
    + (limit ? ` LIMIT ${Math.max(1, Math.min(limit, 90))}` : '');
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
  const lote = Math.min(Number(body.lote ?? req.nextUrl.searchParams.get('lote')) || LOTE_DEFAULT, 90);

  const t0 = Date.now();
  const stats = { procesadas: 0, pasa: 0, revision: 0, excluido: 0, fallback: 0, errores: 0, tandas: 0 };

  try {
    // Los fallback (IA no decidió) ya NO se persisten → `pendientes` los devolvería otra vez.
    // `intentados` evita re-procesar en bucle los mismos códigos DENTRO de esta corrida:
    // se reintentan en la SIGUIENTE corrida del cron, no en esta.
    const intentados = new Set<string>();
    while (Date.now() - t0 < PRESUPUESTO_MS) {
      const pend = await pendientes(lote * 3);
      const codigos = pend.filter(c => !intentados.has(c)).slice(0, lote);
      if (codigos.length === 0) break;
      for (const c of codigos) intentados.add(c);
      try {
        // enriquecer:true → metadata completa antes de decidir. Time-box corto por el
        // límite de 60s de Vercel; lo que no alcance a enriquecerse queda para la próxima.
        const results = await prefiltrarYGuardar(codigos, { enriquecer: true, maxEnriquecerMs: 20_000 });
        stats.tandas++;
        for (const r of results) {
          stats.procesadas++;
          if (r._fallback) stats.fallback++;
          else if (r.decision === 'PASA') stats.pasa++;
          else if (r.decision === 'REVISION_HUMANA') stats.revision++;
          else if (r.decision === 'EXCLUIDO') stats.excluido++;
        }
      } catch (e) {
        stats.errores++;
        console.error('[cron/prefiltro] tanda falló:', String(e));
        break; // evita bucle de error
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
