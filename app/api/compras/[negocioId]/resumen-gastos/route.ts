// app/api/compras/[negocioId]/resumen-gastos/route.ts
// Resumen final de gasto del negocio, DENTRO del módulo de Compras (pedido explícito del usuario,
// 22-sep-2026: antes este número solo se veía en la ficha de la licitación, no acá). Lee de BASE
// (compras_orden_compra_obuma + obuma_compras), no llama a Obuma en vivo — ver resumenGastosCompra
// en compras-oc-obuma.ts.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { resumenGastosCompra } from '@/app/lib/compras-oc-obuma';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const resumen = await resumenGastosCompra(id, asignacion.resumen?.montoCosteado ?? null);
    return NextResponse.json({ success: true, resumen, licitacionCodigo: asignacion.licitacionCodigo });
  } catch (error: any) {
    console.error('[compras/resumen-gastos][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo cargar el resumen de gastos.' }, { status: 500 });
  }
}
