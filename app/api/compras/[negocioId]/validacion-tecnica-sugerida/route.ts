// app/api/compras/[negocioId]/validacion-tecnica-sugerida/route.ts
// Propuesta de formulario para la tarea "Validación técnica real", armada con lo que el Auditor
// Técnico ya comprobó (24-sep-2026). Solo LEE: no escribe nada — la persona revisa y guarda.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { cargarDatosSugerencia, sugerirValidacionTecnica } from '@/app/lib/compras-validacion-sugerida';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id') as string) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    return NextResponse.json({ success: true, ...sugerirValidacionTecnica(await cargarDatosSugerencia(id)) });
  } catch (error: any) {
    console.error('[compras/validacion-tecnica-sugerida][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo armar la sugerencia.' }, { status: 500 });
  }
}
