// app/api/compras/[negocioId]/cotizaciones/[id]/route.ts
// Editar y eliminar una cotización ya registrada (pedido explícito del usuario, 14-sep-2026:
// "tampoco se pueden eliminar ni editar las cotizaciones y eso es básico").
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { actualizarCotizacion, eliminarCotizacion, listarCotizaciones, type DatosEdicionCotizacion } from '@/app/lib/compras-auditor';
import { puedeOperarPreAprobacion } from '@/app/api/compras/[negocioId]/route';
import { parsearMontoCL } from '@/app/lib/numeros';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; id: string }> };

const MSG_SIN_ACCESO = 'Tu perfil no puede editar ni borrar cotizaciones de este negocio. Lo hacen el encargado, el coencargado o quien tenga permiso de Compras; si necesitas hacerlo, pídelo a ellos.';

/** Mensaje para la pantalla: el de la persona tal cual; si es un error técnico, el texto por defecto + un código corto (sin tablas ni rutas) para poder rastrearlo en el log. */
function mensajeConCodigo(e: unknown, porDefecto: string): string {
  const base = mensajeSeguro(e, porDefecto);
  const code = (e as { code?: unknown } | null)?.code;
  return base === porDefecto && typeof code === 'string' && /^[A-Z_]{3,40}$/.test(code) ? `${porDefecto} (código ${code}; avisa a soporte)` : base;
}

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

async function __PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id: cotizacionId } = await params;
  const negId = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: MSG_SIN_ACCESO }, { status: 403 });

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
      despachoModalidad: body.despachoModalidad || null,
      fleteCondicion: body.fleteCondicion || null,
      vigenciaAt: body.vigenciaAt || null,
      notas: body.notas || null,
    };

    await actualizarCotizacion(negId, parseInt(cotizacionId), datos, userId, nombre);
    const cotizaciones = await listarCotizaciones(negId);
    return NextResponse.json({ success: true, cotizaciones });
  } catch (error: any) {
    console.error('[compras/cotizaciones/[id]][PATCH]', String(error));
    return NextResponse.json({ error: mensajeConCodigo(error, 'No se pudo editar la cotización.') }, { status: 400 });
  }
}

async function __DELETE(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id: cotizacionId } = await params;
  const negId = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: MSG_SIN_ACCESO }, { status: 403 });

    const { deshacerId } = await eliminarCotizacion(negId, parseInt(cotizacionId), userId, nombre);
    const cotizaciones = await listarCotizaciones(negId);
    return NextResponse.json({ success: true, cotizaciones, deshacerId });
  } catch (error: any) {
    console.error('[compras/cotizaciones/[id]][DELETE]', String(error));
    return NextResponse.json({ error: mensajeConCodigo(error, 'No se pudo eliminar la cotización.') }, { status: 400 });
  }
}

export const PATCH = conBitacoraCompras(__PATCH, 'PATCH');
export const DELETE = conBitacoraCompras(__DELETE, 'DELETE');
