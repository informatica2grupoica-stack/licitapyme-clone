// app/api/compras/[negocioId]/incidencias/[id]/route.ts
// §9.5 — cierra el encargado de entrega del proyecto.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { cerrarIncidencia, listarIncidencias } from '@/app/lib/compras-incidencias';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id: incidenciaId } = await params;
  const negId = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    await cerrarIncidencia(parseInt(incidenciaId), body.resolucion || null, userId, nombre);
    const incidencias = await listarIncidencias(negId);
    return NextResponse.json({ success: true, incidencias });
  } catch (error: any) {
    console.error('[compras/incidencias/[id]][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo cerrar la incidencia.' }, { status: 400 });
  }
}
