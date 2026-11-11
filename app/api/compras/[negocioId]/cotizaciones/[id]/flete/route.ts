// app/api/compras/[negocioId]/cotizaciones/[id]/flete/route.ts
// DELETE: «Quitar el flete» de una cotización en un clic (borra monto y condición). Ver quitarFleteDeCotizacion.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { quitarFleteDeCotizacion } from '@/app/lib/compras-auditor';
import { puedeOperarPreAprobacion } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; id: string }> };

async function __DELETE(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id } = await params;
  const negId = parseInt(negocioId);
  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const nombre = request.headers.get('x-user-nombre');
    await quitarFleteDeCotizacion(negId, parseInt(id), userId, nombre ? decodeURIComponent(nombre) : null);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[compras/cotizaciones/flete][DELETE]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo quitar el flete.') }, { status: 500 });
  }
}

export const DELETE = conBitacoraCompras(__DELETE, "DELETE");
