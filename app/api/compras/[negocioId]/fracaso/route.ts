// app/api/compras/[negocioId]/fracaso/route.ts
// Estado de fracaso (spec §14.6). GET trae el estado. POST declara (encargado). PATCH dictamina
// (solo jefe de ventas — análisis independiente).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { obtenerFracaso, declararFracaso, dictaminarFracaso } from '@/app/lib/compras-fracaso';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { permisosDeUsuario } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const fracaso = await obtenerFracaso(id);
    return NextResponse.json({ success: true, fracaso });
  } catch (error) {
    console.error('[compras/fracaso][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    await declararFracaso(id, body.motivo, userId, nombre);
    const fracaso = await obtenerFracaso(id);
    return NextResponse.json({ success: true, fracaso });
  } catch (error: any) {
    console.error('[compras/fracaso][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo declarar el fracaso.' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const permisos = await permisosDeUsuario(userId, rol);
    if (rol !== 'admin' && !permisos.aprobar_comercial)
      return NextResponse.json({ error: 'El dictamen lo hace el jefe de ventas, con análisis independiente (spec §14.6).' }, { status: 403 });

    const body = await request.json();
    await dictaminarFracaso(id, body.dictamen, userId, nombre);
    const fracaso = await obtenerFracaso(id);
    return NextResponse.json({ success: true, fracaso });
  } catch (error: any) {
    console.error('[compras/fracaso][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo dictaminar.' }, { status: 400 });
  }
}
