// app/api/cron/obuma-proyectos/route.ts
// Cron diario: inicia sesión en la WEB de Obuma (v2.0 sigue bloqueada por API) y re-lee la tabla
// completa de Proyectos, guardando en obuma_proyectos_reales — ver app/lib/obuma-proyectos-scraper.ts
// y docs/BITACORA-MODULO-COMPRAS.md §17.3.7/§17.3.8. Reemplaza la extracción manual del 22-sep-2026.
//
// Protección igual que los demás cron: x-vercel-cron:1 · Bearer <CRON_SECRET> · ?secret= · x-cron-secret.
// GET  → estado (cuántos proyectos hay guardados y de cuándo es el último snapshot).
// POST → corre el scrape + guardado. Puede tardar (abre un Chrome real, hace login) — maxDuration alto.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { actualizarProyectosObuma } from '@/app/lib/obuma-proyectos-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function autorizado(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const secret =
    req.nextUrl.searchParams.get('secret') ||
    req.headers.get('x-cron-secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS total, MAX(capturado_at) AS ultima FROM obuma_proyectos_reales`,
    ) as any[];
    return NextResponse.json({ total: Number(rows[0]?.total || 0), ultima: rows[0]?.ultima || null });
  } catch (e: any) {
    return NextResponse.json({ total: 0, error: e.message });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const t0 = Date.now();
  try {
    const r = await actualizarProyectosObuma();
    console.log(`[cron/obuma-proyectos] ${r.guardados} proyecto(s) actualizados en ${Date.now() - t0}ms`);
    return NextResponse.json({ success: true, ...r, duracionMs: Date.now() - t0 });
  } catch (e: any) {
    console.error('[cron/obuma-proyectos] ERROR:', e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
