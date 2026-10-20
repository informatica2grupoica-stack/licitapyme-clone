// app/api/compras/[negocioId]/compra-rapida/route.ts
// Compra rápida por producto. GET: estado de cada una (quien puede ver Compras). POST: el encargado reenvía una rechazada.
// PATCH: aprobar / rechazar (solo jefe de ventas). La solicitud inicial nace al registrar una compra directa (cotizaciones/route.ts).
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { listarComprasRapidas, resolverCompraRapida, solicitarCompraRapida } from '@/app/lib/compras-compra-rapida';
import { puedeVerCompras, puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    return NextResponse.json({ success: true, ...(await listarComprasRapidas(id)) });
  } catch (error) {
    console.error('[compras/compra-rapida][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar la compra rápida.' }, { status: 500 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const nombre = request.headers.get('x-user-nombre');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion || !(await puedeOperarCompras(userId, request.headers.get('x-user-rol'), asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Solo el encargado de Compras puede pedir una compra rápida.' }, { status: 403 });
    const body = await request.json();
    const pid = Number(body.productoId);
    if (!Number.isInteger(pid) || pid <= 0) return NextResponse.json({ error: 'Producto inválido.' }, { status: 400 });
    // Reenviar: solo una compra rápida RECHAZADA, con los mismos datos que ya tenía (para cambiarlos se registra una compra directa nueva).
    const { compras } = await listarComprasRapidas(id);
    const actual = compras.find(c => c.productoId === pid);
    if (!actual || actual.estado !== 'RECHAZADA') return NextResponse.json({ error: 'Solo se puede reenviar una compra rápida rechazada.' }, { status: 400 });
    await solicitarCompraRapida(id, [pid], {
      proveedorNombre: actual.proveedorNombre || '', proveedorRut: actual.proveedorRut || '', precioUnitario: actual.precioUnitario || 0,
      link: actual.link, yaComprada: actual.yaComprada, motivo: [actual.motivo, String(body.comentario || '').trim() && `Corregido: ${String(body.comentario).trim()}`].filter(Boolean).join(' · ') || null,
    }, userId, nombre);
    return NextResponse.json({ success: true, ...(await listarComprasRapidas(id)) });
  } catch (error: any) {
    console.error('[compras/compra-rapida][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo reenviar.' }, { status: 400 });
  }
}

async function __PATCH(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const nombre = request.headers.get('x-user-nombre');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  try {
    const p = await permisosCrudosDeUsuario(userId);
    if (!(request.headers.get('x-user-rol') === 'admin' || p.aprobar_comercial))
      return NextResponse.json({ error: 'Solo el jefe de ventas aprueba la compra rápida.' }, { status: 403 });
    const body = await request.json();
    const ids: number[] = (Array.isArray(body.productoIds) ? body.productoIds : [body.productoId]).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
    if (!['APROBAR', 'RECHAZAR'].includes(body.decision) || ids.length === 0)
      return NextResponse.json({ error: 'Decisión o productos inválidos.' }, { status: 400 });
    await resolverCompraRapida(id, ids, body.decision, body.comentario || null, userId, nombre);
    return NextResponse.json({ success: true, ...(await listarComprasRapidas(id)) });
  } catch (error: any) {
    console.error('[compras/compra-rapida][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo guardar.' }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
export const PATCH = conBitacoraCompras(__PATCH, 'PATCH');
