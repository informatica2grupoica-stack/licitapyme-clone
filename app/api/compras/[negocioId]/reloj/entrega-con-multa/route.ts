// app/api/compras/[negocioId]/reloj/entrega-con-multa/route.ts
// §15.5/§15.7 — excepción expresa, autorizada solo por jefe de ventas o CA.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { obtenerEstadoReloj, autorizarEntregaConMulta } from '@/app/lib/compras-reloj';
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
    const permisos = await permisosDeUsuario(userId, rol);
    if (rol !== 'admin' && !permisos.aprobar_comercial)
      return NextResponse.json({ error: 'Entregar con multa lo autoriza solo el jefe de ventas o CA (spec §15.7).' }, { status: 403 });

    const body = await request.json();
    await autorizarEntregaConMulta(id, body.motivo, userId, nombre);
    const reloj = await obtenerEstadoReloj(id);
    return NextResponse.json({ success: true, reloj });
  } catch (error: any) {
    console.error('[compras/reloj/entrega-con-multa][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo autorizar.' }, { status: 400 });
  }
}
