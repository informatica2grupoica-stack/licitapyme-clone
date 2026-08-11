// app/api/obuma-compras/factura/route.ts
// GET /api/obuma-compras/factura?codigo=<licitacion>&compraOcId=<id>&dteId=<id>
// Trae y parsea el XML real de una factura ya cruzada — nunca acepta una URL del cliente (sería
// un hueco de SSRF): busca el compraOcId DENTRO de la licitación indicada, y solo entonces usa el
// s3Link que YA quedó guardado en `obuma_compras.facturas_json` durante la sincronización.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import { parsearDte } from '@/app/lib/dte-parser';
import type { FacturaObuma } from '@/app/lib/obuma-compras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const codigo = request.nextUrl.searchParams.get('codigo');
  const compraOcId = request.nextUrl.searchParams.get('compraOcId');
  const dteId = request.nextUrl.searchParams.get('dteId');
  if (!codigo || !compraOcId || !dteId) {
    return NextResponse.json({ error: 'Faltan parámetros (codigo, compraOcId, dteId)' }, { status: 400 });
  }
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }

  try {
    const [rows] = await pool.query(
      `SELECT facturas_json FROM obuma_compras WHERE compra_oc_id = ? AND licitacion_codigo = ? LIMIT 1`,
      [compraOcId, codigo],
    ) as any[];
    const fila = (rows as any[])[0];
    if (!fila) return NextResponse.json({ error: 'Compra no encontrada en esta licitación' }, { status: 404 });

    const facturas: FacturaObuma[] = fila.facturas_json ? JSON.parse(fila.facturas_json) : [];
    const factura = facturas.find(f => f.dteId === dteId);
    if (!factura?.s3Link) return NextResponse.json({ error: 'Esta factura no tiene XML disponible' }, { status: 404 });

    const resXml = await fetch(factura.s3Link, { signal: AbortSignal.timeout(15_000) });
    if (!resXml.ok) return NextResponse.json({ error: `No se pudo bajar el XML (HTTP ${resXml.status})` }, { status: 502 });
    // El SII declara ISO-8859-1 en la cabecera del XML — decodificar como UTF-8 (lo que hace
    // .text() por defecto) corrompe cualquier tilde o ñ.
    const buffer = Buffer.from(await resXml.arrayBuffer());
    const xml = buffer.toString('latin1');

    const parsed = parsearDte(xml);
    if (!parsed) return NextResponse.json({ error: 'El XML no tiene el formato de DTE esperado' }, { status: 502 });

    return NextResponse.json({ success: true, factura: parsed, s3Link: factura.s3Link });
  } catch (error: any) {
    console.error('[api/obuma-compras/factura]', String(error?.message || error));
    return NextResponse.json({ error: 'No se pudo obtener la factura' }, { status: 500 });
  }
}
