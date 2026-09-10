// app/api/compras/obuma-subcategorias/route.ts
// Subcategorías reales de Obuma bajo "Mercado Publico" (§7, escritura real, 10-sep-2026) — para
// el selector del formulario de creación de SKU. Transversal (no depende de un negocio puntual),
// mismo criterio que /api/compras/proveedores.
import { NextRequest, NextResponse } from 'next/server';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { listarSubcategoriasProductos, OBUMA_CATEGORIA_MERCADO_PUBLICO } from '@/app/lib/obuma';

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

  try {
    const r = await listarSubcategoriasProductos();
    const subcategorias = (r.data || [])
      .filter(s => String(s.rel_producto_categoria_id) === OBUMA_CATEGORIA_MERCADO_PUBLICO)
      .map(s => ({ id: String(s.producto_subcategoria_id), nombre: s.producto_subcategoria_nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    return NextResponse.json({ success: true, subcategorias });
  } catch (error: any) {
    console.error('[compras/obuma-subcategorias][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar Obuma.' }, { status: 500 });
  }
}
