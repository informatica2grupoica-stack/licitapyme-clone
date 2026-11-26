// app/api/compras/[negocioId]/por-decidir/route.ts
// «Por decidir»: GET = casos (línea de cotización de otro modelo/marca que podría servir para un producto); POST {clave, decision} = Sí sirve / Solo aquí / No sirve.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarPreAprobacion } from '@/app/api/compras/[negocioId]/route';
import { listarPorDecidir, decidirCaso } from '@/app/lib/compras-por-decidir';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

async function acceso(request: NextRequest, negocioId: string) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol'); const nombre = request.headers.get('x-user-nombre');
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return { error: NextResponse.json({ error: 'negocioId inválido' }, { status: 400 }) };
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  if (!(await puedeOperarPreAprobacion(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
    return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { id, userId, nombre };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    return NextResponse.json({ success: true, casos: await listarPorDecidir(a.id) });
  } catch (error: any) {
    console.error('[compras/por-decidir][GET]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo cargar la lista por decidir.') }, { status: 400 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const body = await request.json().catch(() => ({}));
    const r = await decidirCaso(a.id, String(body?.clave || ''), body?.decision, { id: a.userId, nombre: a.nombre });
    return NextResponse.json({ success: true, ...r, casos: await listarPorDecidir(a.id) });
  } catch (error: any) {
    console.error('[compras/por-decidir][POST]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo guardar la decisión.') }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
