// app/api/compras/[negocioId]/importacion/route.ts
// Ruta de importación y costeo aterrizado (spec §12). GET trae origen + productos + embarques (cada
// uno con su seguimiento y costos, migration-160) + costo aterrizado calculado. PATCH aplica una acción:
// 'origen' | 'producto' | 'productoEmbarque' | 'fichaProducto' | 'embarqueCrear' | 'embarqueGuardar' | 'embarqueEliminar' | 'embarqueEtapa'.
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import {
  obtenerOrigenCompra, definirOrigenCompra, calcularCostoAterrizado, listarProductosImportables, marcarProductoImportado,
  listarEmbarques, listarFichasImportacion, guardarFichaImportacion, crearEmbarque, guardarEmbarque, eliminarEmbarque, asignarProductoEmbarque, marcarEtapaEmbarque,
  type OrigenCompra, type EtapaImportacion,
} from '@/app/lib/compras-importacion';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

async function estadoCompleto(id: number) {
  const [origen, embarques, costoAterrizado, productos, fichas] = await Promise.all([
    obtenerOrigenCompra(id), listarEmbarques(id), calcularCostoAterrizado(id), listarProductosImportables(id), listarFichasImportacion(id),
  ]);
  return { success: true, origen, embarques, costoAterrizado, productos, fichas };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    return NextResponse.json(await estadoCompleto(id));
  } catch (error) {
    console.error('[compras/importacion][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar la importación.' }, { status: 500 });
  }
}

async function __PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    const embarqueId = Number(body.embarqueId);
    if (body.accion === 'origen') await definirOrigenCompra(id, body.origen as OrigenCompra, userId, nombre);
    else if (body.accion === 'producto') await marcarProductoImportado(id, Number(body.productoId), !!body.importado, userId, nombre);
    else if (body.accion === 'productoEmbarque') await asignarProductoEmbarque(id, Number(body.productoId), body.embarqueId == null ? null : embarqueId);
    else if (body.accion === 'fichaProducto') await guardarFichaImportacion(id, Number(body.productoId), body.datos || {}, userId, nombre);
    else if (body.accion === 'embarqueCrear') await crearEmbarque(id, userId, nombre);
    else if (body.accion === 'embarqueGuardar') await guardarEmbarque(id, embarqueId, body.datos || {}, userId, nombre);
    else if (body.accion === 'embarqueEliminar') await eliminarEmbarque(id, embarqueId, userId, nombre);
    else if (body.accion === 'embarqueEtapa') await marcarEtapaEmbarque(id, embarqueId, body.estado as EtapaImportacion, String(body.fecha || ''), userId, nombre);
    else return NextResponse.json({ error: 'Acción inválida.' }, { status: 400 });

    return NextResponse.json(await estadoCompleto(id));
  } catch (error: any) {
    console.error('[compras/importacion][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo actualizar.' }, { status: 400 });
  }
}

export const PATCH = conBitacoraCompras(__PATCH, 'PATCH');
