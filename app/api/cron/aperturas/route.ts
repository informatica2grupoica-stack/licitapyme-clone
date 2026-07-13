// app/api/cron/aperturas/route.ts
// Poller de APERTURA de las POSTULADAS. Lee el portal de MP (IP chilena, como la descarga
// de documentos), detecta las que ya se aperturaron, lo persiste y avisa al perfil.
// Pensado para el scheduler del NOTEBOOK/VPS, NO para Vercel (el portal exige IP chilena).
//
// Protección (igual que los otros cron): x-vercel-cron:1 · Bearer <CRON_SECRET> · ?secret= · x-cron-secret.
// GET  → cuántas postuladas cerradas quedan por verificar.
// POST → verifica el siguiente lote. Body/query: { lote?: number }  (default 40)

import { NextRequest, NextResponse } from 'next/server';
import { detectarAperturas, contarPendientesApertura } from '@/app/lib/detectar-aperturas';

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
    return NextResponse.json({ pendientes: await contarPendientesApertura() });
  } catch (e: any) {
    return NextResponse.json({ pendientes: 0, error: e.message });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const lote = Math.min(Number(body.lote ?? req.nextUrl.searchParams.get('lote')) || 40, 100);

  const t0 = Date.now();
  try {
    const r = await detectarAperturas(lote);
    const pendientes = await contarPendientesApertura();
    if (r.aperturas > 0) console.log(`[cron/aperturas] ${r.aperturas} aperturas nuevas detectadas`);
    return NextResponse.json({ success: true, ...r, pendientes, completado: pendientes === 0, duracionMs: Date.now() - t0 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
