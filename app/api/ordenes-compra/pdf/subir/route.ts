// app/api/ordenes-compra/pdf/subir/route.ts
// POST multipart { codigoOC, archivo } → guarda el PDF OFICIAL de la OC que una persona descargó de
// Mercado Público (el botón PDF de la ficha lleva reCAPTCHA: solo baja con un clic humano). Reemplaza
// al PDF de la ficha impresa y lo enlaza a Documentos de la licitación.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import { guardarPdfOrdenCompra } from '@/app/lib/ordenes-compra';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const codigoOC = String(form?.get('codigoOC') || '').trim();
  const archivo = form?.get('archivo');
  if (!codigoOC || !(archivo instanceof File)) {
    return NextResponse.json({ success: false, error: 'Falta el código de la OC o el archivo' }, { status: 400 });
  }

  const [rows] = await pool.query(
    `SELECT licitacion_codigo, es_nuestra FROM ordenes_compra WHERE codigo = ? LIMIT 1`, [codigoOC],
  ) as any[];
  const oc = (rows as any[])[0];
  if (!oc) return NextResponse.json({ success: false, error: 'Orden de compra no encontrada' }, { status: 404 });
  if (!oc.es_nuestra) return NextResponse.json({ success: false, error: 'No es una orden propia' }, { status: 403 });
  if (oc.licitacion_codigo && !(await puedeVerLicitacion(request, oc.licitacion_codigo))) {
    return NextResponse.json({ success: false, error: 'Sin acceso a esta licitación' }, { status: 403 });
  }

  if (archivo.size > MAX_BYTES) return NextResponse.json({ success: false, error: 'El archivo supera los 15 MB' }, { status: 413 });
  const buffer = Buffer.from(await archivo.arrayBuffer());
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return NextResponse.json({ success: false, error: 'El archivo no es un PDF válido' }, { status: 400 });
  }
  // Si el nombre trae el código de otra OC, se rechaza: evita adjuntar a la orden equivocada.
  const otro = archivo.name.match(/\d{1,8}-\d{1,6}-[A-Z]{2}\d{2}/i)?.[0];
  if (otro && otro.toUpperCase() !== codigoOC.toUpperCase()) {
    return NextResponse.json({ success: false, error: `El archivo parece de la OC ${otro}, no de ${codigoOC}` }, { status: 400 });
  }

  try {
    const url = await guardarPdfOrdenCompra(codigoOC, oc.licitacion_codigo || null, buffer);
    return NextResponse.json({ success: true, url });
  } catch (e: any) {
    console.error('[ordenes-compra/pdf/subir]', String(e).slice(0, 200));
    return NextResponse.json({ success: false, error: 'No se pudo guardar el PDF' }, { status: 500 });
  }
}
