// app/api/compras/[negocioId]/resumen-gastos/route.ts
// Resumen final de gasto del negocio, DENTRO del módulo de Compras (pedido explícito del usuario,
// 22-sep-2026: antes este número solo se veía en la ficha de la licitación, no acá). Lee de BASE
// (compras_orden_compra_obuma + obuma_compras), no llama a Obuma en vivo — ver resumenGastosCompra
// en compras-oc-obuma.ts.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { resumenGastosCompra } from '@/app/lib/compras-oc-obuma';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import pool from '@/app/lib/db';

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
    // Cobertura de la compra: productos vigentes, cuántos ya tienen precio de un proveedor (cotizado o compra directa).
    let cobertura = { total: 0, cubiertos: 0, directos: 0, sinCubrir: [] as string[] };
    try {
      const [prods]: any = await pool.query(
        `SELECT p.id, p.descripcion,
                EXISTS (SELECT 1 FROM compras_cotizacion_item ci JOIN compras_cotizacion c ON c.id = ci.cotizacion_id
                         WHERE c.negocio_id = p.negocio_id AND ci.producto_id = p.id AND ci.cumple <> 'NO_ES_EL_PRODUCTO') AS cubierto,
                EXISTS (SELECT 1 FROM compras_cotizacion_item ci JOIN compras_cotizacion c ON c.id = ci.cotizacion_id
                         WHERE c.negocio_id = p.negocio_id AND ci.producto_id = p.id AND c.origen = 'directa') AS directo
           FROM compras_producto p WHERE p.negocio_id = ? AND p.subestado NOT IN ('RENUNCIADO','NO_ADJUDICADA')`, [id]);
      const lista = prods as Array<{ descripcion: string; cubierto: number; directo: number }>;
      cobertura = { total: lista.length, cubiertos: lista.filter(x => x.cubierto).length, directos: lista.filter(x => x.directo).length, sinCubrir: lista.filter(x => !x.cubierto).map(x => x.descripcion) };
    } catch { /* sin tabla de productos: el resumen sigue sin cobertura */ }
    const oc = asignacion.ordenCompra;
    const ocCliente = oc?.numero || oc?.aceptadaAt || oc?.emitidaAt ? { numero: oc.numero ?? null, aceptadaAt: oc.aceptadaAt ?? null, emitidaAt: oc.emitidaAt ?? null, monto: oc.monto ?? null } : null;
    return NextResponse.json({ success: true, resumen, licitacionCodigo: asignacion.licitacionCodigo, cobertura, ocCliente });
  } catch (error: any) {
    console.error('[compras/resumen-gastos][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo cargar el resumen de gastos.' }, { status: 500 });
  }
}
