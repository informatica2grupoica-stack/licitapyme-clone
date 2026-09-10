// app/api/compras/[negocioId]/reloj/prorroga/route.ts
// §15.4 — "la autoriza jefe de ventas o CA" (permiso aprobar_comercial, mismo criterio que el
// resto del módulo).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { obtenerEstadoReloj, registrarProrroga } from '@/app/lib/compras-reloj';
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
      return NextResponse.json({ error: 'La prórroga la autoriza el jefe de ventas o CA (spec §15.4).' }, { status: 403 });

    const body = await request.json();
    await registrarProrroga(id, body.nuevaFechaLimite, body.motivo, body.documentoUrl || null, userId, nombre);
    const reloj = await obtenerEstadoReloj(id);
    return NextResponse.json({ success: true, reloj });
  } catch (error: any) {
    console.error('[compras/reloj/prorroga][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo registrar la prórroga.' }, { status: 400 });
  }
}
