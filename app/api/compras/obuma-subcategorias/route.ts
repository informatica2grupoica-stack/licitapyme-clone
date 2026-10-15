// app/api/compras/obuma-subcategorias/route.ts
// Subcategorías reales de Obuma bajo "Mercado Publico" (§7, escritura real, 10-sep-2026) — para
// el selector del formulario de creación de SKU. Transversal (no depende de un negocio puntual),
// mismo criterio que /api/compras/proveedores.
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { listarSubcategoriasProductos, listarCategoriasProductos } from '@/app/lib/obuma';

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
  // permisosCrudosDeUsuario (no permisosDeUsuario): "ser admin" ya no alcanza solo (10-sep-2026,
  // mismo criterio del resto del módulo).
  {
    const p = await permisosCrudosDeUsuario(userId);
    if (!p.compras_todo && !p.compras && !p.aprobar_comercial) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
  }

  try {
    // Categorías y subcategorías de Obuma (14-oct-2026: ya no solo «Mercado Publico»; el usuario elige la categoría).
    // Las categorías «eliminada …» son restos de Obuma y no se ofrecen.
    const [rc, rs] = await Promise.all([listarCategoriasProductos(), listarSubcategoriasProductos()]);
    const categorias = (rc.data || [])
      .map(c => ({ id: String(c.producto_categoria_id), nombre: String(c.producto_categoria_nombre) }))
      .filter(c => !/^eliminad/i.test(c.nombre))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const ids = new Set(categorias.map(c => c.id));
    const subcategorias = (rs.data || [])
      .filter(s => ids.has(String(s.rel_producto_categoria_id)))
      .map(s => ({ id: String(s.producto_subcategoria_id), nombre: s.producto_subcategoria_nombre, categoriaId: String(s.rel_producto_categoria_id) }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    return NextResponse.json({ success: true, categorias, subcategorias });
  } catch (error: any) {
    console.error('[compras/obuma-subcategorias][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar Obuma.' }, { status: 500 });
  }
}
