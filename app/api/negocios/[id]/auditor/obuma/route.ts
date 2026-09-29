// app/api/negocios/[id]/auditor/obuma/route.ts
// AUDITOR → OBUMA: datos de proveedor y producto de las opciones YA firmadas o aprobadas, en las columnas del
// formato de carga OBUMA (spec §12). El AUDITOR no crea nada en OBUMA: lo hace el encargado de compras con
// este archivo. Comuna, región, forma de pago y banco salen vacíos (OBUMA pide IDs de catálogo; ver
// app/lib/auditor-proveedor.ts) y el texto extraído viaja en el JSON como `pendientes_catalogo`.
//   GET ?tipo=proveedores|productos&formato=csv|json&incluir=firmadas|aprobadas (defecto: aprobadas)
import { NextRequest, NextResponse } from 'next/server';
import { contextoAuditor } from '@/app/lib/auditor-acceso';
import { armarPanelAuditor } from '@/app/lib/auditor-opciones';
import { proveedorOBUMA, productoOBUMA, aCSV } from '@/app/lib/auditor-proveedor';
import { ahoraChileSQL } from '@/app/lib/tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const c = await contextoAuditor(request, params);
  if (c instanceof NextResponse) return c;
  const q = request.nextUrl.searchParams;
  const tipo = q.get('tipo') === 'productos' ? 'productos' : 'proveedores';
  const estados = q.get('incluir') === 'firmadas' ? ['definitiva', 'en_aprobacion', 'aprobada'] : ['aprobada'];
  try {
    const panel = await armarPanelAuditor(c.negocio.id, c.negocio.licitacion_codigo);
    const hoy = ahoraChileSQL().slice(0, 10);
    const filas = panel.lineas.flatMap(l => l.opciones.filter(o => estados.includes(o.estado)).map(o => ({ o, l })));

    // Un proveedor se exporta una sola vez aunque tenga varias opciones.
    const vistos = new Set<string>();
    const items = tipo === 'proveedores'
      ? filas.filter(({ o }) => { const k = (o.proveedorRut || o.proveedorRazonSocial || `o${o.id}`).toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; })
          .map(({ o }) => proveedorOBUMA(o, c.negocio.licitacion_codigo, hoy))
      : filas.map(({ o, l }) => productoOBUMA(o, l));

    if (q.get('formato') === 'json') return NextResponse.json({ success: true, tipo, cantidad: items.length, filas: items });
    const csv = '﻿' + aCSV(items.map(i => i.columnas));
    return new NextResponse(csv, { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="obuma_${tipo}_${c.negocio.licitacion_codigo}.csv"`,
    } });
  } catch (e) {
    console.error('[auditor/obuma][GET]', String(e));
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
