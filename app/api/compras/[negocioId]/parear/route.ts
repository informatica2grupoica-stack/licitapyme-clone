// app/api/compras/[negocioId]/parear/route.ts
// Botón «Corregir pareo»: vuelve a repartir las líneas de TODAS las cotizaciones del negocio entre sus productos (pareo global).
// No toca lo que una persona ya asignó ni los productos que ya avanzaron.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { corregirPareo } from '@/app/lib/compras-pareo-global';
import { puedeOperarPreAprobacion } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Params = { params: Promise<{ negocioId: string }> };

async function __POST(request: NextRequest, { params }: Params) {
  const id = request.headers.get('x-user-id');
  const rol = request.headers.get('x-user-rol');
  const userId = id ? parseInt(id) : null;
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const negId = parseInt((await params).negocioId);
  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const resumen = await corregirPareo(negId, { id: userId, nombre: request.headers.get('x-user-nombre') });
    return NextResponse.json({ success: true, ...resumen });
  } catch (error: any) {
    console.error('[compras/parear][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo corregir el pareo.') }, { status: 500 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
