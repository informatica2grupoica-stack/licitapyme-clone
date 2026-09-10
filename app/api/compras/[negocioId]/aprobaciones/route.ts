// app/api/compras/[negocioId]/aprobaciones/route.ts
// Compuertas de aprobación (spec §10): Compuerta 1 (compra) y Compuerta 2 (margen), separadas e
// independientes. GET lee el estado de ambas + el margen calculado en vivo. POST propone una
// (encargado). PATCH resuelve una (solo jefe de ventas — §10.2/§10.3: "la aprueba el jefe de ventas").
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import {
  obtenerAprobaciones, calcularMargenPrevisto, proponerAprobacionCompra, proponerAprobacionMargen,
  resolverAprobacion, type TipoAprobacion, type DecisionAprobacion,
} from '@/app/lib/compras-aprobaciones';
import { puedeOperarCompras, puedeVerCompras } from '@/app/api/compras/[negocioId]/route';
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

async function esJefeDeVentas(userId: number, rol: string | null): Promise<boolean> {
  if (rol === 'admin') return true;
  const p = await permisosDeUsuario(userId, rol);
  return !!p.aprobar_comercial;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    // GET amplio: RepartoAdminCard (administración) necesita saber si la Compuerta 1 ya se aprobó
    // para decidir si se muestra — proponer/resolver una compuerta sigue siendo del encargado.
    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const [aprobaciones, margen] = await Promise.all([obtenerAprobaciones(id), calcularMargenPrevisto(id)]);
    return NextResponse.json({ success: true, ...aprobaciones, margenActual: margen, esJefeDeVentas: await esJefeDeVentas(userId, rol) });
  } catch (error) {
    console.error('[compras/aprobaciones][GET]', String(error));
    return NextResponse.json({ error: 'No se pudieron cargar las aprobaciones.' }, { status: 500 });
  }
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
    const tipo = body.tipo as TipoAprobacion;
    if (tipo === 'COMPRA') await proponerAprobacionCompra(id, userId, nombre);
    else if (tipo === 'MARGEN') await proponerAprobacionMargen(id, body.motivo || null, userId, nombre);
    else return NextResponse.json({ error: 'Tipo de compuerta inválido.' }, { status: 400 });

    const aprobaciones = await obtenerAprobaciones(id);
    return NextResponse.json({ success: true, ...aprobaciones });
  } catch (error: any) {
    console.error('[compras/aprobaciones][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo proponer la aprobación.' }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    if (!(await esJefeDeVentas(userId, rol)))
      return NextResponse.json({ error: 'Solo el jefe de ventas resuelve las compuertas de aprobación (spec §10.2/§10.3).' }, { status: 403 });

    const body = await request.json();
    await resolverAprobacion(id, body.tipo as TipoAprobacion, body.decision as DecisionAprobacion, body.comentario || null, userId, nombre);

    const aprobaciones = await obtenerAprobaciones(id);
    return NextResponse.json({ success: true, ...aprobaciones });
  } catch (error: any) {
    console.error('[compras/aprobaciones][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo resolver la compuerta.' }, { status: 400 });
  }
}
