// app/api/cron/puente-cola/route.ts
// Retoma la descarga de documentos + viabilidad de lo empujado al puente (migration-136). Corre en
// el scheduler del VPS, así que sigue aunque se apague el PC o se cierre el navegador: reintenta
// lo que falló (con espera creciente, hasta 6 intentos) y lo que quedó a medias por un reinicio.
// Protección: mismo esquema que los demás cron. GET → cuántas hay por estado. POST → arranca la cola.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { AUTOMATIZACION_PAUSADA } from '@/app/lib/automatizacion';
import { reanudarPuenteCola } from '@/app/lib/viabilidad-al-asignar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function autorizado(req: NextRequest): boolean {
  if (process.env.VERCEL && req.headers.get('x-vercel-cron') === '1') return true;
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
      `SELECT estado, COUNT(*) AS n FROM puente_cola GROUP BY estado`) as any[];
    return NextResponse.json({ ok: true, porEstado: Object.fromEntries((rows as any[]).map(r => [r.estado, Number(r.n)])) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (AUTOMATIZACION_PAUSADA) return NextResponse.json({ success: true, pausada: true, completado: true });
  const r = await reanudarPuenteCola();
  // `completado` corta el loop del scheduler: el trabajo real sigue en segundo plano en el servidor.
  return NextResponse.json({ success: true, completado: true, ...r });
}
