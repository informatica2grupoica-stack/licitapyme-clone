// app/api/cron/ofertas-competencia/route.ts
// Frente F.2 — poller que LEE las aperturas ya detectadas: quién ofertó y a qué precio.
// Corre DESPUÉS de /api/cron/aperturas (ése marca "está aperturada", éste entra y lee la tabla).
// Pensado para el scheduler del VPS, NO para Vercel (el portal exige IP chilena).
//
// Protección igual que los demás cron: x-vercel-cron:1 · Bearer <CRON_SECRET> · ?secret= · x-cron-secret.
// GET  → cuántas aperturas quedan por leer.
// POST → lee el siguiente lote y baja los documentos detectados.
//        Body/query: { lote?: number, docs?: number }  (default 10 / 20)

import { NextRequest, NextResponse } from 'next/server';
import {
  procesarOfertasPendientes, contarPendientesOfertas, descargarDocumentosOferta,
} from '@/app/lib/ofertas-competencia';
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
    return NextResponse.json({ pendientes: await contarPendientesOfertas() });
  } catch (e: any) {
    return NextResponse.json({ pendientes: 0, error: e.message });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const lote = Math.min(Number(body.lote ?? req.nextUrl.searchParams.get('lote')) || 10, 50);
  const maxDocs = Math.min(Number(body.docs ?? req.nextUrl.searchParams.get('docs')) || 20, 100);

  const t0 = Date.now();
  try {
    const r = await procesarOfertasPendientes(lote);
    // Los binarios van después de la lectura: si el presupuesto se acaba, al menos el DATO
    // (quién ofertó y a cuánto) quedó guardado. El archivo se puede bajar en la próxima pasada.
    const docs = await descargarDocumentosOferta(maxDocs);
    const pendientes = await contarPendientesOfertas();
    if (r.ofertas > 0 || docs.descargados > 0) {
      console.log(`[cron/ofertas] ${r.ofertas} ofertas · ${docs.descargados} documentos`);
      publicarCambio('apertura'); // los tableros repintan el bloque de competencia al instante
    }
    return NextResponse.json({
      success: true, ...r, documentosDescargados: docs.descargados, documentosFallidos: docs.fallidos,
      pendientes, completado: pendientes === 0, duracionMs: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
