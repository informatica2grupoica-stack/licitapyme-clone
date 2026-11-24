// app/api/logistica/fleteros/[id]/route.ts
// PATCH edita un fletero. Acciones especiales por body.accion: 'pana' (§13.3.2) y 'evaluar' (§13.4).
import { NextRequest, NextResponse } from 'next/server';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { actualizarFletero, registrarPana, evaluarFletero, listarFleteros, fleteroEsDeCliente, eliminarFletero } from '@/app/lib/compras-logistica';
import { clienteDeHeader } from '@/app/lib/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

async function puedeVerLogistica(userId: number, rol: string | null): Promise<boolean> {
  if (rol === 'admin') return true;
  const p = await permisosDeUsuario(userId, rol);
  return !!(p.compras || p.aprobar_comercial);
}

// DELETE elimina el fletero del catálogo. Se niega (409) si ya se usó en un retiro; ver `eliminarFletero`.
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerLogistica(userId, rol))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
  const { id } = await params;
  const clienteId = clienteDeHeader(request) ?? 0;
  try {
    const eliminado = await eliminarFletero(parseInt(id), clienteId, userId, nombre);
    return NextResponse.json({ success: true, eliminado, fleteros: await listarFleteros({ clienteId }) });
  } catch (error: any) {
    const status = error?.status === 404 || error?.status === 409 ? error.status : 500;
    if (status === 500) console.error('[logistica/fleteros/[id]][DELETE]', String(error));
    return NextResponse.json({ error: status === 500 ? 'No se pudo eliminar el fletero.' : error.message }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerLogistica(userId, rol))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
  const { id } = await params;
  const fleteroId = parseInt(id);
  const clienteId = clienteDeHeader(request) ?? 0;
  if (!(await fleteroEsDeCliente(fleteroId, clienteId))) return NextResponse.json({ error: 'Fletero no encontrado.' }, { status: 404 });

  try {
    const body = await request.json();
    if (body.accion === 'pana') await registrarPana(fleteroId, userId, nombre);
    else if (body.accion === 'evaluar') await evaluarFletero(fleteroId, Number(body.nota), userId, nombre);
    else await actualizarFletero(fleteroId, body);

    const fleteros = await listarFleteros({ clienteId });
    return NextResponse.json({ success: true, fleteros });
  } catch (error: any) {
    console.error('[logistica/fleteros/[id]][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo actualizar el fletero.' }, { status: 400 });
  }
}
