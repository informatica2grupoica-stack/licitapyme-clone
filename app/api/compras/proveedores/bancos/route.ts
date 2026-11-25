// app/api/compras/proveedores/bancos/route.ts
// Catálogo de bancos de Obuma (pg-bancos.list.json) para el selector del formulario de proveedor. Solo lectura.
import { NextRequest, NextResponse } from 'next/server';
import { mapaBancosObuma } from '@/app/lib/obuma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!request.headers.get('x-user-id')) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    const mapa = await mapaBancosObuma();
    const bancos = [...mapa.entries()].map(([id, nombre]) => ({ id, nombre })).filter(b => b.nombre).sort((a, b) => Number(a.id) - Number(b.id));
    return NextResponse.json({ success: true, bancos });
  } catch (error) {
    console.error('[compras/proveedores/bancos][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo leer el catálogo de bancos de Obuma.' }, { status: 502 });
  }
}
