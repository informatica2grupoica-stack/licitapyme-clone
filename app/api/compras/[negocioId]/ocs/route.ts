// app/api/compras/[negocioId]/ocs/route.ts
// Las órdenes de compra del negocio para verlas en miniatura en «Entrega y acta»:
//  - la OC del CLIENTE (el PDF oficial de Mercado Público que ya está en los documentos de la licitación), y
//  - las OC a PROVEEDORES creadas en Obuma (se abren con el visor «Ver OC»).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt((await params).negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });
  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const [cli] = await pool.query(
      `SELECT documento_nombre AS nombre, documento_url_local AS url FROM documentos_cache
        WHERE licitacion_codigo = ? AND documento_url_local IS NOT NULL AND documento_nombre REGEXP '^OC[_ -].*[.]pdf$'
        ORDER BY id DESC`, [asignacion.licitacionCodigo]).catch(() => [[]]) as any;
    const [prov] = await pool.query(
      `SELECT folio, proveedor_razon_social AS proveedor, estado FROM obuma_compras
        WHERE licitacion_codigo = ? ORDER BY folio`, [asignacion.licitacionCodigo]).catch(() => [[]]) as any;
    return NextResponse.json({
      success: true,
      cliente: (cli as any[]).map(r => ({ nombre: String(r.nombre), url: String(r.url) })),
      proveedores: (prov as any[]).map(r => ({ folio: String(r.folio), proveedor: r.proveedor ? String(r.proveedor) : null, estado: r.estado ? String(r.estado) : null })),
    });
  } catch (e) {
    console.error('[compras/ocs][GET]', String(e));
    return NextResponse.json({ error: 'No se pudieron cargar las órdenes de compra.' }, { status: 500 });
  }
}
