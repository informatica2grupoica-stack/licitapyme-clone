// app/api/compras/[negocioId]/aprobaciones/tabla/route.ts
// Tabla línea por línea de lo que se aprueba (solo lectura). Mismo acceso que el GET de aprobaciones.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { tablaAprobacion } from '@/app/lib/compras-aprobacion-tabla';
import { puedeVerCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ negocioId: string }> }) {
  const userId = request.headers.get('x-user-id');
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeVerCompras(parseInt(userId), rol, asignacion.asignadoA))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    return NextResponse.json({ success: true, tabla: await tablaAprobacion(id) });
  } catch (error) {
    console.error('[compras/aprobaciones/tabla][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo armar la tabla de aprobación.' }, { status: 500 });
  }
}
