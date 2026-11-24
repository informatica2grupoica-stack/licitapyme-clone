// app/api/compras/[negocioId]/cotizaciones/[id]/items/route.ts
// Asignación MANUAL de una cotización a uno o varios productos (§8.7) — complemento de
// "homologar con IA": deja corregir lo que la IA decidió, o saltársela cuando el comprador ya sabe
// con certeza a qué producto(s) corresponde una cotización.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { TOPE_MONTO_CLP } from '@/app/lib/numeros';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { asignarItemsCotizacion, listarCotizaciones, type AsignacionItemManual, type CumpleItem } from '@/app/lib/compras-auditor';
import { puedeOperarPreAprobacion } from '@/app/api/compras/[negocioId]/route';

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

async function __PUT(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id: cotizacionId } = await params;
  const negId = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    const items: AsignacionItemManual[] = (Array.isArray(body.items) ? body.items : []).map((it: any) => ({
      productoId: Number(it.productoId),
      precioUnitario: it.precioUnitario === '' || it.precioUnitario == null ? null : Number(it.precioUnitario),
      cumple: CUMPLES.includes(it.cumple) ? it.cumple : 'CUMPLE',
      detalleDesviacion: it.detalleDesviacion || null,
      incluido: it.incluido === true,
    })).filter((it: AsignacionItemManual) => Number.isFinite(it.productoId));

    // QA 24-nov: aceptaba precios negativos y de 1e12. Vacío = sin precio (se permite).
    const malo = items.find(it => it.precioUnitario != null && (!Number.isFinite(it.precioUnitario) || it.precioUnitario < 0 || it.precioUnitario > TOPE_MONTO_CLP * 100));
    if (malo) return NextResponse.json({ error: `El precio del producto #${malo.productoId} no es válido (no puede ser negativo ni tener tantos ceros).` }, { status: 400 });

    await asignarItemsCotizacion(negId, parseInt(cotizacionId), items, userId, nombre);
    const cotizaciones = await listarCotizaciones(negId);
    return NextResponse.json({ success: true, cotizaciones });
  } catch (error: any) {
    console.error('[compras/cotizaciones/items][PUT]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo asignar la cotización.') }, { status: 400 });
  }
}

export const PUT = conBitacoraCompras(__PUT, 'PUT');
