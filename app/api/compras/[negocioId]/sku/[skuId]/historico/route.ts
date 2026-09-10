// app/api/compras/[negocioId]/sku/[skuId]/historico/route.ts
// §19.3 — sugerencia de proveedor histórico, a partir del SKU ya homologado con OBUMA.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { obtenerAsignacion } from '@/app/lib/compras';
import { sugerenciaProveedorHistorico } from '@/app/lib/compras-aprendizaje';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; skuId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, skuId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const [rows] = await pool.query(`SELECT obuma_producto_id FROM compras_sku WHERE id = ? AND negocio_id = ?`, [skuId, id]) as any;
    const obumaProductoId = (rows as any[])[0]?.obuma_producto_id;
    if (!obumaProductoId) {
      return NextResponse.json({ error: 'Este SKU no está homologado con un producto de OBUMA todavía — sin eso no se puede buscar histórico (spec §19.3).' }, { status: 400 });
    }

    const sugerencias = await sugerenciaProveedorHistorico(obumaProductoId);
    return NextResponse.json({ success: true, sugerencias });
  } catch (error: any) {
    console.error('[compras/sku/historico][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar el histórico.' }, { status: 500 });
  }
}
