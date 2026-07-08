// app/api/buscar-productos/route.ts
// Buscador de precios de mercado — SOLO ADMIN. Búsqueda manual de un producto o
// cotización por lote (para el costeo / re-precio). Usa el motor portado desde la intranet
// (app/lib/buscador-precios.ts) con caché MySQL.
import { NextRequest, NextResponse } from 'next/server';
import { buscarPrecioProducto, cotizarItems, type ItemACotizar } from '@/app/lib/buscador-precios';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function esAdmin(req: NextRequest): boolean {
  return req.headers.get('x-user-rol') === 'admin';
}

// GET ?producto=...&region=...&contexto=...&minimo=5  → busca UN producto.
export async function GET(req: NextRequest) {
  if (!esAdmin(req)) return NextResponse.json({ error: 'Solo el admin puede usar el buscador de precios' }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const producto = (sp.get('producto') || '').trim();
  if (!producto) return NextResponse.json({ error: 'Falta el parámetro producto' }, { status: 400 });

  const res = await buscarPrecioProducto(producto, {
    region: sp.get('region') || '',
    contexto: sp.get('contexto') || '',
    conversion: sp.get('conversion') || 'unidad',
    minimo: Math.min(parseInt(sp.get('minimo') || '5', 10) || 5, 5),
  });
  return NextResponse.json(res);
}

// POST { items: [{clave, producto, conversion?}], region?, contexto?, concurrencia? }
//   → cotización por lote (mejor match + alternativas por ítem).
export async function POST(req: NextRequest) {
  if (!esAdmin(req)) return NextResponse.json({ error: 'Solo el admin puede usar el buscador de precios' }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }

  const items: ItemACotizar[] = Array.isArray(body?.items)
    ? body.items
        .filter((it: any) => it && typeof it.producto === 'string' && it.producto.trim())
        .map((it: any, i: number) => ({ clave: String(it.clave ?? i), producto: String(it.producto), conversion: it.conversion ? String(it.conversion) : undefined }))
    : [];
  if (items.length === 0) return NextResponse.json({ error: 'Falta items[]' }, { status: 400 });
  if (items.length > 200) return NextResponse.json({ error: 'Máximo 200 ítems por lote' }, { status: 400 });

  const cotizaciones = await cotizarItems(items, {
    region: body.region || '',
    contexto: body.contexto || '',
    concurrencia: Number(body.concurrencia) || 5,
    minimo: Math.min(Number(body.minimo) || 5, 5),
  });
  return NextResponse.json({ total: cotizaciones.length, cotizaciones });
}
