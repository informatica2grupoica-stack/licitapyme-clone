// app/api/compras/proveedores/[id]/route.ts
// PATCH edita un proveedor del catálogo (incluye activar/desactivar).
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { actualizarProveedor, listarProveedores } from '@/app/lib/compras-proveedores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// "Ser admin" ya no alcanza solo (pedido explícito, 10-sep-2026 — ver el comentario largo en
// app/api/compras/[negocioId]/route.ts): mismo círculo que el resto de Compras, leído con
// `permisosCrudosDeUsuario` para que ningún flag se auto-otorgue por ser admin.
async function puedeVerProveedores(userId: number): Promise<boolean> {
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.compras || p.aprobar_comercial);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerProveedores(userId))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
  const { id } = await params;

  try {
    const body = await request.json();
    await actualizarProveedor(parseInt(id), body);
    const proveedores = await listarProveedores();
    return NextResponse.json({ success: true, proveedores });
  } catch (error: any) {
    console.error('[compras/proveedores/[id]][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo actualizar el proveedor.' }, { status: 400 });
  }
}
