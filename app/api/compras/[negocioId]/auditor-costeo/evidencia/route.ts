// app/api/compras/[negocioId]/auditor-costeo/evidencia/route.ts
// "El ojo": de dónde salió una conclusión del Auditor de Compras. Devuelve los respaldos de una línea (cotizaciones con
// su documento original y los links capturados) con el texto leído, marcando cuál contiene la cita literal.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeVerCompras } from '@/app/api/compras/[negocioId]/route';
import { obtenerEvidencia } from '@/app/lib/auditor-compras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const uid = request.headers.get('x-user-id');
  if (!uid) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const negId = parseInt((await params).negocioId);
  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeVerCompras(parseInt(uid), request.headers.get('x-user-rol'), asignacion.asignadoA))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const filaId = request.nextUrl.searchParams.get('filaId') || '';
    const cita = request.nextUrl.searchParams.get('cita');
    return NextResponse.json({ success: true, ...(await obtenerEvidencia(negId, filaId, cita)) });
  } catch (error: any) {
    console.error('[compras/auditor-costeo/evidencia][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo leer la evidencia.' }, { status: 500 });
  }
}
