// app/api/compras/[negocioId]/costeo-compra/route.ts
// La compra elegida pasa al costeo. GET = qué cargaría (sin tocar nada); POST = cargarlo.
// Compras solo toca «Costo unit. REAL» y Link 1 de filas existentes (regla de costeo-compras.ts).
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { planTrasladoCompraAlCosteo, trasladarCompraAlCosteo } from '@/app/lib/compras-compra-a-costeo';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

async function acceso(request: NextRequest, params: Params['params']) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id') as string) : null;
  const rol = request.headers.get('x-user-rol');
  const nombre = request.headers.get('x-user-nombre');
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt((await params).negocioId);
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados))) return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { id, userId, nombre };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, params);
    if ('error' in a) return a.error;
    return NextResponse.json({ success: true, ...(await planTrasladoCompraAlCosteo(a.id)) });
  } catch (error) {
    console.error('[compras/costeo-compra][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo preparar la carga al costeo.' }, { status: 500 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, params);
    if ('error' in a) return a.error;
    const r = await trasladarCompraAlCosteo(a.id, { id: a.userId, nombre: a.nombre });
    return NextResponse.json({ success: true, ...r, ...(await planTrasladoCompraAlCosteo(a.id)) });
  } catch (error: any) {
    console.error('[compras/costeo-compra][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo cargar al costeo.' }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
