// app/api/cron/estados-asignadas/route.ts
// Capa 2 del estado de Mercado Público (ver app/lib/refrescar-estados.ts) para las ASIGNADAS
// que NO están en POSTULADA/ADJUDICADA/PERDIDA/DESCARTADA (ASIGNADO, EN_PROCESO, POSIBLE_ADJ,
// ANEXOS). Antes vivía como "Paso 9b" de /api/cron/alertas y solo corría cada 4h junto al
// intake — medido en producción (ago-2026), es la vía que MÁS "Adjudicada" detecta (más que
// procesar-postuladas.ts), así que quedaba como el cuello de botella real de latencia para
// ganada/perdida/apertura. Sacado a su propio cron horario (scheduler.mjs, minuto :20) para que
// el aviso no dependa del ciclo de 4h del intake.
//
// GET → healthcheck simple. POST → ejecuta una pasada.

import { NextRequest, NextResponse } from 'next/server';
import { refrescarEstadosAsignadas } from '@/app/lib/refrescar-estados';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const t0 = Date.now();
  try {
    const r = await refrescarEstadosAsignadas({ presupuestoMs: 50_000 });
    return NextResponse.json({ success: true, ...r, duracionMs: Date.now() - t0 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
