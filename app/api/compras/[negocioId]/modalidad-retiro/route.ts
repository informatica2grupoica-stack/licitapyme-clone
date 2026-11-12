// app/api/compras/[negocioId]/modalidad-retiro/route.ts
// §13.2 — modalidad de retiro (interna/externa/mixta): se define en el primer instante, la define
// el humano, el sistema no la calcula ni la propone acá.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { obtenerModalidadRetiro, definirModalidadRetiro, obtenerRetiroPorProveedor, definirRetiroProveedor, obtenerTransportesRetiro, guardarTransporteRetiro, type ModalidadRetiro } from '@/app/lib/compras-logistica';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { avanzarSubestados, subestadosDeNegocio } from '@/app/lib/compras-avance-estados';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const info = await obtenerModalidadRetiro(id);
    return NextResponse.json({ success: true, ...info, porProveedor: await obtenerRetiroPorProveedor(id), transportes: await obtenerTransportesRetiro(id), subestados: await subestadosDeNegocio(id) });
  } catch (error) {
    console.error('[compras/modalidad-retiro][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar la modalidad de retiro.' }, { status: 500 });
  }
}

async function __PUT(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    // Datos del transporte de un proveedor (migration-158): nombre, RUT, precio, desde/hasta, fecha.
    // «Recibido en bodega» de un proveedor: sus productos comprados pasan a En bodega (avance automático, 12-nov-2026).
    if (typeof body.proveedor === 'string' && body.recibido === true && Array.isArray(body.productoIds)) {
      const ids = body.productoIds.map(Number).filter((n: number) => Number.isFinite(n));
      await avanzarSubestados(id, 'EN_BODEGA', { desdeMinimo: 'COMPRADO', productoIds: ids, motivo: `recibido en bodega lo de ${body.proveedor}`, actorId: userId, actorNombre: nombre });
    } else if (typeof body.proveedor === 'string' && body.transporte) await guardarTransporteRetiro(id, body.proveedor, body.transporte, userId, nombre);
    else if (typeof body.proveedor === 'string') await definirRetiroProveedor(id, body.proveedor, body.modalidad, userId, nombre);
    else await definirModalidadRetiro(id, body.modalidad as ModalidadRetiro, userId, nombre);
    const info = await obtenerModalidadRetiro(id);
    return NextResponse.json({ success: true, ...info, porProveedor: await obtenerRetiroPorProveedor(id), transportes: await obtenerTransportesRetiro(id), subestados: await subestadosDeNegocio(id) });
  } catch (error: any) {
    console.error('[compras/modalidad-retiro][PUT]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo definir la modalidad.') }, { status: 400 });
  }
}

export const PUT = conBitacoraCompras(__PUT, 'PUT');
