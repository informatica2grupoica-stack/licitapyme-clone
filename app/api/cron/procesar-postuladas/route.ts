// app/api/cron/procesar-postuladas/route.ts
// Refresca el RESULTADO de las POSTULADAS cerradas: consulta MP (API oficial, no exige IP
// chilena), refresca adjudicacion_cache y auto-promueve a ADJUDICADA/PERDIDA avisando al perfil.
// Es lo que hace que el apartado Postuladas (que ahora lee SOLO cache) esté al día sin que el
// usuario espere nada al entrar.
//
// Pensado para el scheduler (cada 2h). Protección igual que los otros cron.
// GET  → healthcheck simple. POST → ejecuta una pasada.

import { NextRequest, NextResponse } from 'next/server';
import { procesarPostuladas } from '@/app/lib/procesar-postuladas';

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
    // promover:false → las adjudicadas SE QUEDAN en Postuladas (decisión del usuario).
    // soloCerradas:false → también refresca las Publicadas para el filtro por estado.
    const r = await procesarPostuladas({ promover: false, soloCerradas: false });
    // Es una pasada acotada por presupuesto interno; no expone cola → completado siempre true.
    return NextResponse.json({ success: true, ...r, completado: true, pendientes: 0, duracionMs: Date.now() - t0 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
