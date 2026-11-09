// app/api/compras/[negocioId]/orden-compra-obuma/detalle/route.ts
// Vista propia de la(s) orden(es) de compra ya emitidas para este negocio (spec §11 — "rescatar el
// documento de Obuma para ver la OC"). Ver ordenesCompraParaVista en compras-oc-obuma.ts.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { ordenesCompraParaVista } from '@/app/lib/compras-oc-obuma';
import { puedeVerCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
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
    // Solo lectura: cualquiera que pueda ver Compras abre la OC.
    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const ordenes = await ordenesCompraParaVista(id);
    return NextResponse.json({ success: true, ordenes });
  } catch (error: any) {
    console.error('[compras/orden-compra-obuma/detalle][GET]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo cargar la orden de compra.') }, { status: 500 });
  }
}
