// app/api/compras/[negocioId]/cotizaciones/[id]/iva/route.ts
// «Los precios de esta cotización incluyen IVA»: los pasa a neto (÷ 1,19). Ver convertirCotizacionANeto.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { convertirCotizacionANeto } from '@/app/lib/compras-auditor';
import { puedeOperarPreAprobacion } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; id: string }> };

async function __POST(request: NextRequest, { params }: Params) {
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
    const r = await convertirCotizacionANeto(negId, parseInt(id), userId, nombre ? decodeURIComponent(nombre) : null);
    return NextResponse.json({ success: true, ...r });
  } catch (error: any) {
    console.error('[compras/cotizaciones/iva][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo pasar la cotización a neto.') }, { status: 500 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
