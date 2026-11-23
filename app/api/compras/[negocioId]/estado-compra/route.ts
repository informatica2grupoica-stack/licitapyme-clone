// app/api/compras/[negocioId]/estado-compra/route.ts
// Estado de la compra (Abierta → En proceso → Entregada → Pagada, o Cancelada con motivo). Ver compras-estado-core.ts.
// GET ?para=ENTREGADA|CERRADA|PAGADA → avisos de lo que aún falta (no bloquean). POST {estado, motivo?} → un solo paso a la vez.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { cambiarEstadoCompra, advertenciasDeEstado } from '@/app/lib/compras-estado';
import type { EstadoCompra } from '@/app/lib/compras-estado-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };
const VALIDOS = ['EN_PROCESO', 'ENTREGADA', 'CERRADA', 'PAGADA', 'CANCELADA'];

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  let nombre = req.headers.get('x-user-nombre');
  try { nombre = nombre ? decodeURIComponent(nombre) : null; } catch { /* queda como vino */ }
  return { id: id ? parseInt(id) : null, rol: req.headers.get('x-user-rol'), nombre };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  const para = request.nextUrl.searchParams.get('para') as EstadoCompra | null;
  if (!Number.isFinite(id) || !para || !VALIDOS.includes(para)) return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, advertencias: await advertenciasDeEstado(id, para) });
  } catch (error) {
    console.error('[compras/estado-compra][GET]', String(error));
    return NextResponse.json({ success: true, advertencias: [] });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Solo el encargado de esta licitación puede cambiar su estado.' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    if (!VALIDOS.includes(body.estado)) return NextResponse.json({ error: 'Estado inválido.' }, { status: 400 });
    const estado = await cambiarEstadoCompra(id, body.estado, { motivo: body.motivo ?? null, userId, nombre });
    return NextResponse.json({ success: true, estado });
  } catch (error) {
    console.error('[compras/estado-compra][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo cambiar el estado.') }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
