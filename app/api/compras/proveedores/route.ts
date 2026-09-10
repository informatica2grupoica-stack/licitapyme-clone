// app/api/compras/proveedores/route.ts
// Catálogo de proveedores — transversal, mismo círculo de acceso que el resto de Compras.
import { NextRequest, NextResponse } from 'next/server';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { listarProveedores, crearProveedor } from '@/app/lib/compras-proveedores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

async function puedeVerProveedores(userId: number, rol: string | null): Promise<boolean> {
  if (rol === 'admin') return true;
  const p = await permisosDeUsuario(userId, rol);
  return !!(p.compras || p.aprobar_comercial);
}

export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerProveedores(userId, rol))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  try {
    const q = request.nextUrl.searchParams.get('q') || undefined;
    const categoria = request.nextUrl.searchParams.get('categoria') || undefined;
    const proveedores = await listarProveedores({ q, categoria });
    return NextResponse.json({ success: true, proveedores });
  } catch (error) {
    console.error('[compras/proveedores][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar el catálogo de proveedores.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerProveedores(userId, rol))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  try {
    const body = await request.json();
    const id = await crearProveedor(body, userId, nombre);
    const proveedores = await listarProveedores();
    return NextResponse.json({ success: true, id, proveedores });
  } catch (error: any) {
    console.error('[compras/proveedores][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo crear el proveedor.' }, { status: 400 });
  }
}
