// app/api/compras/[negocioId]/documentos-plantillas/route.ts
// EDITOR DE PLANTILLAS de Gestionar documentos: POST {id?, nombre, descripcion, porPersona, layout} = crea o actualiza una plantilla de la empresa
// del negocio; DELETE ?id = la quita de la lista. Solo se tocan las hechas en el editor (clave «custom-…»), nunca las base del sistema.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarReparto } from '@/app/api/compras/[negocioId]/reparto/route';
import { guardarPlantilla, eliminarPlantilla } from '@/app/lib/compras-documentos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

async function acceso(request: NextRequest, negocioId: string) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return { error: NextResponse.json({ error: 'negocioId inválido' }, { status: 400 }) };
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  if (!(await puedeOperarReparto(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
    return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { id };
}

async function __POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const b = await request.json();
    const id = await guardarPlantilla(a.id, { id: parseInt(b?.id) || undefined, nombre: b?.nombre, descripcion: b?.descripcion, porPersona: !!b?.porPersona, layout: b?.layout });
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    console.error('[compras/documentos-plantillas][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo guardar la plantilla.') }, { status: 400 });
  }
}

async function __DELETE(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const id = parseInt(request.nextUrl.searchParams.get('id') || '');
    if (!id) return NextResponse.json({ error: 'Falta la plantilla.' }, { status: 400 });
    await eliminarPlantilla(a.id, id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/documentos-plantillas][DELETE]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo quitar la plantilla.') }, { status: 400 });
  }
}
export const POST = conBitacoraCompras(__POST, 'POST');
export const DELETE = conBitacoraCompras(__DELETE, 'DELETE');
