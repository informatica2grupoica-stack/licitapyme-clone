// app/api/compras/obuma-productos-buscar/route.ts
// Búsqueda de posibles duplicados en Obuma por nombre (pedido explícito del usuario, 10-sep-2026:
// "si pongo pala debe de mostrar todas las palas que estan en obuma para no duplicarlas") — se usa
// en vivo mientras se escribe el nombre del producto en el formulario de SKU, antes de crear.
import { NextRequest, NextResponse } from 'next/server';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { buscarProductosObumaPorNombre } from '@/app/lib/obuma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (rol !== 'admin') {
    const p = await permisosDeUsuario(userId, rol);
    if (!p.compras && !p.aprobar_comercial) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
  }

  const q = request.nextUrl.searchParams.get('q')?.trim() || '';
  if (q.length < 3) return NextResponse.json({ success: true, productos: [] });

  try {
    const productos = await buscarProductosObumaPorNombre(q);
    return NextResponse.json({ success: true, productos });
  } catch (error: any) {
    console.error('[compras/obuma-productos-buscar][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar Obuma.' }, { status: 500 });
  }
}
