// app/api/cron/obuma-compras/route.ts
// Cron diario: busca en Obuma las compras que mencionan una licitación que ya ofertamos y las
// guarda. Toda la lógica vive en app/lib/obuma-compras.ts — acá solo va la autorización.
//
// POR QUÉ DIARIO Y CORTO (5 páginas = últimas ~500 compras): comprasOc.list.json entrega más
// reciente primero, así que una compra nueva siempre aparece en las primeras páginas. No hace
// falta barrer las ~3900 compras del historial todos los días — eso lo hace el backfill inicial
// una sola vez (POST con `paginas` grande).
//
// Protección igual que los demás cron: x-vercel-cron:1 · Bearer <CRON_SECRET> · ?secret= · x-cron-secret.
// GET  → estado (cuántas compras hay guardadas y de cuándo es la última).
// POST → corre la sincronización. Body/query: { paginas?: number } (default 5, máximo 50 — el
//        backfill inicial se corrió a mano con 39, que cubre el historial completo a ago-2026).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { sincronizarComprasObuma } from '@/app/lib/obuma-compras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
      `SELECT COUNT(*) AS total, MAX(updated_at) AS ultima FROM obuma_compras`,
    ) as any[];
    return NextResponse.json({ total: Number(rows[0]?.total || 0), ultima: rows[0]?.ultima || null });
  } catch (e: any) {
    return NextResponse.json({ total: 0, error: e.message });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const paginas = Math.min(Math.max(Number(body.paginas ?? req.nextUrl.searchParams.get('paginas')) || 5, 1), 50);

  const t0 = Date.now();
  try {
    const r = await sincronizarComprasObuma({ paginas });
    if (r.nuevasOActualizadas > 0) {
      console.log(`[cron/obuma-compras] ${r.nuevasOActualizadas} compra(s) nueva(s)/actualizada(s) de ${r.candidatas} candidata(s), ${r.vistas} vistas en ${r.paginasBarridas} página(s)`);
    }
    return NextResponse.json({ success: true, ...r, duracionMs: Date.now() - t0 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
