// app/api/cron/preguntas/route.ts
// Poller del foro de Preguntas y Respuestas. Lee el portal de MP (navegador real, como la
// descarga de documentos y las aperturas) y lo persiste en preguntas_respuestas_cache, para que
// /licitacion/[codigo] y /negocios/[id] lo muestren instantáneo sin que el usuario tenga que
// apretar "Actualizar". Pensado para el scheduler del NOTEBOOK/VPS (abre Chromium real).
//
// Protección (igual que los otros cron): x-vercel-cron:1 · Bearer <CRON_SECRET> · ?secret= · x-cron-secret.
// GET  → cuántos negocios quedan por revisar.
// POST → revisa el siguiente lote. Body/query: { lote?: number }  (default 20)

import { NextRequest, NextResponse } from 'next/server';
import { procesarPreguntasPendientes, contarPendientesPreguntas } from '@/app/lib/preguntas-respuestas';
import { publicarCambio } from '@/app/lib/sse-bus';

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
    return NextResponse.json({ pendientes: await contarPendientesPreguntas() });
  } catch (e: any) {
    return NextResponse.json({ pendientes: 0, error: e.message });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const lote = Math.min(Number(body.lote ?? req.nextUrl.searchParams.get('lote')) || 20, 60);

  const t0 = Date.now();
  try {
    const r = await procesarPreguntasPendientes(lote);
    const pendientes = await contarPendientesPreguntas();
    if (r.conContenido > 0) {
      console.log(`[cron/preguntas] ${r.conContenido} foro(s) con preguntas nuevas`);
      publicarCambio('preguntas'); // los tableros repintan si están mostrando la sección abierta
    }
    return NextResponse.json({ success: true, ...r, pendientes, completado: pendientes === 0, duracionMs: Date.now() - t0 });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
