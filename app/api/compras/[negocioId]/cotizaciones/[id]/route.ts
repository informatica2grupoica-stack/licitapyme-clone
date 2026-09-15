// app/api/compras/[negocioId]/cotizaciones/[id]/route.ts
// Editar y eliminar una cotización ya registrada (pedido explícito del usuario, 14-sep-2026:
// "tampoco se pueden eliminar ni editar las cotizaciones y eso es básico").
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { actualizarCotizacion, eliminarCotizacion, listarCotizaciones, type DatosEdicionCotizacion } from '@/app/lib/compras-auditor';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { parsearMontoCL } from '@/app/lib/numeros';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

export async function PATCH(request: NextRequest, { params }: Params) {
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
    const datos: DatosEdicionCotizacion = {
      proveedorNombre: String(body.proveedorNombre || '').trim(),
      proveedorRut: body.proveedorRut || null,
      descripcionLibre: body.descripcionLibre || null,
      precioUnitario: parsearMontoCL(body.precioUnitario),
      precioTotal: parsearMontoCL(body.precioTotal),
      descuentoPct: parsearMontoCL(body.descuentoPct),
      moneda: body.moneda || 'CLP',
      plazoEntregaTexto: body.plazoEntregaTexto || null,
      incluyeFlete: body.incluyeFlete == null ? null : !!body.incluyeFlete,
      fleteMonto: parsearMontoCL(body.fleteMonto),
      vigenciaAt: body.vigenciaAt || null,
      notas: body.notas || null,
    };

    await actualizarCotizacion(negId, parseInt(cotizacionId), datos, userId, nombre);
    const cotizaciones = await listarCotizaciones(negId);
    return NextResponse.json({ success: true, cotizaciones });
  } catch (error: any) {
    console.error('[compras/cotizaciones/[id]][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo editar la cotización.' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id: cotizacionId } = await params;
  const negId = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    await eliminarCotizacion(negId, parseInt(cotizacionId), userId, nombre);
    const cotizaciones = await listarCotizaciones(negId);
    return NextResponse.json({ success: true, cotizaciones });
  } catch (error: any) {
    console.error('[compras/cotizaciones/[id]][DELETE]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo eliminar la cotización.' }, { status: 400 });
  }
}
