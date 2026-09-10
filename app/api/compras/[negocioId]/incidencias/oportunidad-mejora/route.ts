// app/api/compras/[negocioId]/incidencias/oportunidad-mejora/route.ts
// §9.4 — Oportunidad de Mejora. POST la crea (paso 1: la detecta el encargado). PATCH avanza el
// circuito: 'aprobar_jefe_ventas' (paso 2, solo jefe de ventas), 'plantear_cliente' (paso 3),
// 'respuesta_cliente' (registra qué contestó, con constancia mínima).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import {
  crearOportunidadMejora, aprobarOportunidadJefeVentas, plantearOportunidadACliente, registrarRespuestaCliente,
  listarIncidencias, type DatosOportunidadMejora,
} from '@/app/lib/compras-incidencias';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { permisosDeUsuario } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    const datos: DatosOportunidadMejora = {
      productoId: Number(body.productoId), productoAlternativo: String(body.productoAlternativo || ''),
      ahorroEstimado: body.ahorroEstimado ? Number(body.ahorroEstimado) : null,
      descripcion: String(body.descripcion || body.productoAlternativo || ''),
    };
    const incidenciaId = await crearOportunidadMejora(id, datos, userId, nombre);
    const incidencias = await listarIncidencias(id);
    return NextResponse.json({ success: true, id: incidenciaId, incidencias });
  } catch (error: any) {
    console.error('[compras/incidencias/oportunidad-mejora][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo registrar la Oportunidad de Mejora.' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const body = await request.json();
    const incidenciaId = Number(body.incidenciaId);

    if (body.accion === 'aprobar_jefe_ventas') {
      const permisos = await permisosDeUsuario(userId, rol);
      if (rol !== 'admin' && !permisos.aprobar_comercial)
        return NextResponse.json({ error: 'Solo el jefe de ventas aprueba una Oportunidad de Mejora (spec §9.4).' }, { status: 403 });
      await aprobarOportunidadJefeVentas(incidenciaId, userId, nombre);
    } else if (body.accion === 'plantear_cliente') {
      await plantearOportunidadACliente(incidenciaId, userId, nombre);
    } else if (body.accion === 'respuesta_cliente') {
      await registrarRespuestaCliente(incidenciaId, !!body.aprobada, String(body.constancia || ''), userId, nombre);
    } else {
      return NextResponse.json({ error: 'Acción inválida.' }, { status: 400 });
    }

    const incidencias = await listarIncidencias(id);
    return NextResponse.json({ success: true, incidencias });
  } catch (error: any) {
    console.error('[compras/incidencias/oportunidad-mejora][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo actualizar la Oportunidad de Mejora.' }, { status: 400 });
  }
}
