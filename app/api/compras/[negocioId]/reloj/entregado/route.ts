// app/api/compras/[negocioId]/reloj/entregado/route.ts
// Registra la fecha real de entrega. A diferencia de la prórroga/multa (excepciones que solo
// autoriza jefe de ventas o CA), dejar constancia de que ya se entregó es un hecho operativo —
// lo puede hacer cualquiera con acceso al negocio en Compras.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { obtenerEstadoReloj, registrarEntrega } from '@/app/lib/compras-reloj';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

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

    const body = await request.json();
    await registrarEntrega(id, body.fecha, body.nota || null, userId, nombre);
    const reloj = await obtenerEstadoReloj(id);
    return NextResponse.json({ success: true, reloj });
  } catch (error: any) {
    console.error('[compras/reloj/entregado][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo registrar la entrega.' }, { status: 400 });
  }
}
