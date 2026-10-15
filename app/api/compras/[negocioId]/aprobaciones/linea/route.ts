// app/api/compras/[negocioId]/aprobaciones/linea/route.ts
// Aprobación por producto de la compra. GET: estado de cada producto (quien puede ver Compras). PATCH: aprobar / rechazar / quitar
// uno o varios productos (solo jefe de ventas, igual que las compuertas).
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { listarAprobacionesLinea, resolverLineas, marcarLineaCorregida } from '@/app/lib/compras-aprobacion-lineas';
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
    return NextResponse.json({ success: true, ...(await listarAprobacionesLinea(id)) });
  } catch (error) {
    console.error('[compras/aprobaciones/linea][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar la aprobación por producto.' }, { status: 500 });
  }
}

async function __PATCH(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const nombre = request.headers.get('x-user-nombre');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  try {
    const body = await request.json();
    // El encargado (no solo el jefe) puede avisar que ya corrigió un producto rechazado.
    if (body.decision === 'CORREGIDO') {
      const asignacion = await obtenerAsignacion(id);
      if (!asignacion || !(await puedeOperarCompras(userId, request.headers.get('x-user-rol'), asignacion.asignadoA, asignacion.coencargados)))
        return NextResponse.json({ error: 'Solo el encargado de Compras puede marcar un producto como corregido.' }, { status: 403 });
      const pid = Number(body.productoId);
      if (!Number.isInteger(pid) || pid <= 0) return NextResponse.json({ error: 'Producto inválido.' }, { status: 400 });
      await marcarLineaCorregida(id, pid, String(body.comentario || ''), userId, nombre);
      return NextResponse.json({ success: true, ...(await listarAprobacionesLinea(id)) });
    }
    const p = await permisosCrudosDeUsuario(userId);
    if (!(p.compras_todo || p.aprobar_comercial))
      return NextResponse.json({ error: 'Solo el jefe de ventas aprueba los productos.' }, { status: 403 });
    const ids: number[] = (Array.isArray(body.productoIds) ? body.productoIds : [body.productoId]).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
    if (!['APROBAR', 'RECHAZAR', 'QUITAR'].includes(body.decision) || ids.length === 0)
      return NextResponse.json({ error: 'Decisión o productos inválidos.' }, { status: 400 });
    await resolverLineas(id, ids, body.decision, body.comentario || null, userId, nombre);
    return NextResponse.json({ success: true, ...(await listarAprobacionesLinea(id)) });
  } catch (error: any) {
    console.error('[compras/aprobaciones/linea][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo guardar.' }, { status: 400 });
  }
}

export const PATCH = conBitacoraCompras(__PATCH, 'PATCH');
