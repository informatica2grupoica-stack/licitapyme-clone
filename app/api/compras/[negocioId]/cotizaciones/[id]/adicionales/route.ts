// app/api/compras/[negocioId]/cotizaciones/[id]/adicionales/route.ts
// ADICIONALES de un producto en una cotización (quemador, bandejas, puesta en marcha…): la cotización cotiza el
// producto "pelado" y lo demás aparte, y el precio que se compara contra el costeo es producto + adicionales.
//   PUT { productoId, precioBase?, adicionales: [{ concepto, cantidad, precioUnitario }] }  → reemplaza la lista de ese producto.
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { listarCotizaciones } from '@/app/lib/compras-auditor';
import { guardarAdicionales } from '@/app/lib/compras-adicionales';
import { auditarCotizacion } from '@/app/lib/compras-auditoria-cotizacion';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; id: string }> };

async function __PUT(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol'); const nombre = request.headers.get('x-user-nombre');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id } = await params;
  const negId = parseInt(negocioId); const cotizacionId = parseInt(id);

  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    const productoId = Number(body.productoId);
    if (!Number.isFinite(productoId)) return NextResponse.json({ error: 'Falta el producto.' }, { status: 400 });
    const precioBase = body.precioBase === '' || body.precioBase == null ? undefined : Number(body.precioBase);
    const adicionales = (Array.isArray(body.adicionales) ? body.adicionales : []).map((a: any) => ({
      concepto: String(a?.concepto ?? ''), cantidad: Number(a?.cantidad), precioUnitario: Number(a?.precioUnitario),
    }));

    await guardarAdicionales(negId, cotizacionId, productoId, { precioBase, adicionales }, { id: userId, nombre });
    // La comparación de precio es aritmética (sin IA): se recalcula al instante para que la pantalla ya la muestre.
    await auditarCotizacion(negId, cotizacionId, { productoId, actor: { id: userId, nombre } });
    return NextResponse.json({ success: true, cotizaciones: await listarCotizaciones(negId) });
  } catch (error: any) {
    console.error('[compras/cotizaciones/adicionales][PUT]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudieron guardar los adicionales.' }, { status: 400 });
  }
}

export const PUT = conBitacoraCompras(__PUT, 'PUT');
