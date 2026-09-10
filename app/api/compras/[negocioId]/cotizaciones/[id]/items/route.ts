// app/api/compras/[negocioId]/cotizaciones/[id]/items/route.ts
// Asignación MANUAL de una cotización a uno o varios productos (§8.7) — complemento de
// "homologar con IA": deja corregir lo que la IA decidió, o saltársela cuando el comprador ya sabe
// con certeza a qué producto(s) corresponde una cotización.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { asignarItemsCotizacion, listarCotizaciones, type AsignacionItemManual, type CumpleItem } from '@/app/lib/compras-auditor';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

const CUMPLES: CumpleItem[] = ['CUMPLE', 'MEJORA', 'INFERIOR_NEGOCIABLE', 'INFERIOR_INSALVABLE', 'NO_ES_EL_PRODUCTO'];

export async function PUT(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id: cotizacionId } = await params;
  const negId = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    const items: AsignacionItemManual[] = (Array.isArray(body.items) ? body.items : []).map((it: any) => ({
      productoId: Number(it.productoId),
      precioUnitario: it.precioUnitario === '' || it.precioUnitario == null ? null : Number(it.precioUnitario),
      cumple: CUMPLES.includes(it.cumple) ? it.cumple : 'CUMPLE',
      detalleDesviacion: it.detalleDesviacion || null,
    })).filter((it: AsignacionItemManual) => Number.isFinite(it.productoId));

    await asignarItemsCotizacion(negId, parseInt(cotizacionId), items, userId, nombre);
    const cotizaciones = await listarCotizaciones(negId);
    return NextResponse.json({ success: true, cotizaciones });
  } catch (error: any) {
    console.error('[compras/cotizaciones/items][PUT]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo asignar la cotización.' }, { status: 400 });
  }
}
