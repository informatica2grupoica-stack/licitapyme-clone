// app/api/compras/[negocioId]/cotizaciones/restaurar/route.ts
// «Deshacer» de Eliminar cotización: vuelve a crearla con sus productos asignados y extras (copia guardada al borrar).
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { restaurarCotizacionEliminada, listarCotizaciones } from '@/app/lib/compras-auditor';
import { puedeOperarPreAprobacion } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

async function __POST(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  const nombre = request.headers.get('x-user-nombre');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const negId = parseInt((await params).negocioId);

  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Tu perfil no puede restaurar cotizaciones de este negocio.' }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const deshacerId = Number(body?.deshacerId);
    if (!Number.isFinite(deshacerId) || deshacerId <= 0) return NextResponse.json({ error: 'Falta indicar qué cotización restaurar.' }, { status: 400 });

    const r = await restaurarCotizacionEliminada(negId, deshacerId, userId, nombre);
    return NextResponse.json({ success: true, proveedor: r.proveedor, cotizaciones: await listarCotizaciones(negId) });
  } catch (error: any) {
    console.error('[compras/cotizaciones/restaurar][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo restaurar la cotización.') }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
