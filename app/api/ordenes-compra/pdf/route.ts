// app/api/ordenes-compra/pdf/route.ts
// POST { codigoOC } → descarga el PDF de UNA orden de compra ya guardada (si no lo tenía) y
// devuelve la URL de R2. GET normalmente no hace falta: la lectura de /api/ordenes-compra ya
// trae pdfUrl cuando el cron diario lo dejó descargado. Este endpoint es para el botón
// "Descargar PDF" cuando el usuario lo pide antes de que corra el cron.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import { descargarPdfOrdenCompra } from '@/app/lib/ordenes-compra';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const codigoOC = String(body.codigoOC || '').trim();
  if (!codigoOC) return NextResponse.json({ success: false, error: 'Falta codigoOC' }, { status: 400 });

  const [rows] = await pool.query(
    `SELECT licitacion_codigo, es_nuestra, pdf_url FROM ordenes_compra WHERE codigo = ? LIMIT 1`,
    [codigoOC],
  ) as any[];
  const oc = (rows as any[])[0];
  if (!oc) return NextResponse.json({ success: false, error: 'Orden de compra no encontrada' }, { status: 404 });
  if (!oc.es_nuestra) return NextResponse.json({ success: false, error: 'No es una orden propia' }, { status: 403 });
  if (oc.licitacion_codigo && !(await puedeVerLicitacion(request, oc.licitacion_codigo))) {
    return NextResponse.json({ success: false, error: 'Sin acceso a esta licitación' }, { status: 403 });
  }

  if (oc.pdf_url) return NextResponse.json({ success: true, url: oc.pdf_url, yaEstaba: true });

  const r = await descargarPdfOrdenCompra(codigoOC, oc.licitacion_codigo || null);
  if (!r.ok) return NextResponse.json({ success: false, error: r.error || 'no se pudo descargar' }, { status: 502 });
  return NextResponse.json({ success: true, url: r.url });
}
