// app/api/compras/proveedores/buscar-producto/route.ts
// "Si pongo martillo, decime a quién le hemos comprado martillo" (pedido explícito del usuario,
// 14-sep-2026) — busca el producto en el catálogo de Obuma y agrupa por proveedor real.
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { buscarProveedoresPorProducto } from '@/app/lib/compras-proveedores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null };
}

async function puedeVerProveedores(userId: number): Promise<boolean> {
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.compras || p.aprobar_comercial || p.compras_ver);
}

export async function GET(request: NextRequest) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerProveedores(userId))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  const q = request.nextUrl.searchParams.get('q')?.trim() || '';
  if (q.length < 3) return NextResponse.json({ success: true, resultados: [] });

  try {
    const resultados = await buscarProveedoresPorProducto(q);
    return NextResponse.json({ success: true, resultados });
  } catch (error: any) {
    console.error('[compras/proveedores/buscar-producto][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo buscar por producto.' }, { status: 500 });
  }
}
