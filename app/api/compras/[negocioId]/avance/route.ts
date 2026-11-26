// app/api/compras/[negocioId]/avance/route.ts
// AVANCE POR PRODUCTO de la licitación en Compras: por cada producto, cuántas cotizaciones tiene, qué proveedor se eligió, si está
// aprobado, si tiene SKU y OC, quién hizo cada cosa y qué falta. Solo lee la base (nada de Obuma ni de IA) y no recalcula escenarios.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { obtenerAsignacion, listarProductosCompra } from '@/app/lib/compras';
import { puedeVerCompras } from '@/app/api/compras/[negocioId]/route';
import { armarAvance, type DatosProductoAvance } from '@/app/lib/compras-avance-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

const SIN_AVANCE = new Set(['RENUNCIADO', 'NO_ADJUDICADA']);
const f = (v: unknown): string | null => (v == null ? null : String(v));

export async function GET(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'negocioId inválido' }, { status: 400 });

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA, asignacion.coencargados)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const vacio = [[]] as any;
    const [productos, cotRows, escRows, linRows, skuRows, ocRows, ocPropRows, aprRows] = await Promise.all([
      listarProductosCompra(id),
      pool.query(
        `SELECT i.producto_id, COUNT(DISTINCT c.id) AS n,
                SUBSTRING_INDEX(GROUP_CONCAT(c.registrado_por_nombre ORDER BY c.created_at DESC SEPARATOR '\\n'), '\\n', 1) AS por,
                DATE_FORMAT(MAX(c.created_at), '%Y-%m-%d %H:%i:%s') AS at
           FROM compras_cotizacion_item i JOIN compras_cotizacion c ON c.id = i.cotizacion_id
          WHERE c.negocio_id = ? GROUP BY i.producto_id`, [id]).catch(() => vacio) as Promise<any>,
      pool.query(`SELECT detalle_json, elegido_por_nombre, DATE_FORMAT(elegido_at, '%Y-%m-%d %H:%i:%s') AS at
                    FROM compras_escenario WHERE negocio_id = ? AND elegido = 1 ORDER BY generado_at DESC LIMIT 1`, [id]).catch(() => vacio) as Promise<any>,
      pool.query(`SELECT producto_id, estado, resuelto_por_nombre AS por, DATE_FORMAT(resuelto_at, '%Y-%m-%d %H:%i:%s') AS at
                    FROM compras_aprobacion_linea WHERE negocio_id = ?`, [id]).catch(() => vacio) as Promise<any>,
      pool.query(`SELECT producto_id, sku_propio, creado_por_nombre AS por, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS at
                    FROM compras_sku WHERE negocio_id = ?`, [id]).catch(() => vacio) as Promise<any>,
      pool.query(`SELECT items_json, obuma_folio, creado_por_nombre AS por, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS at
                    FROM compras_orden_compra_obuma WHERE negocio_id = ?`, [id]).catch(() => vacio) as Promise<any>,
      pool.query(`SELECT items_json, folio, DATE_FORMAT(fecha_oc, '%Y-%m-%d') AS at
                    FROM compras_oc_propia WHERE negocio_id = ? AND estado <> 'ANULADA'`, [id]).catch(() => vacio) as Promise<any>,
      pool.query(`SELECT tipo, estado, COALESCE(resuelto_por_nombre, propuesto_por_nombre) AS por,
                         DATE_FORMAT(COALESCE(resuelto_at, propuesto_at), '%Y-%m-%d %H:%i:%s') AS at
                    FROM compras_aprobacion WHERE negocio_id = ?`, [id]).catch(() => vacio) as Promise<any>,
    ]);

    const cot = new Map<number, { n: number; por: string | null; at: string | null }>();
    for (const r of cotRows[0] as any[]) cot.set(Number(r.producto_id), { n: Number(r.n), por: f(r.por), at: f(r.at) });

    // Proveedor elegido por producto: la compra elegida hoy guarda el detalle por producto (porProducto).
    const eleccion = new Map<number, { proveedor: string; por: string | null; at: string | null }>();
    const esc = (escRows[0] as any[])[0];
    if (esc) {
      try {
        const det = JSON.parse(esc.detalle_json);
        for (const x of (det?.porProducto ?? []) as any[]) if (x?.productoId != null && x.proveedor) eleccion.set(Number(x.productoId), { proveedor: String(x.proveedor), por: f(esc.elegido_por_nombre), at: f(esc.at) });
      } catch { /* detalle ilegible: se muestra como sin elegir */ }
    }

    const lin = new Map<number, { estado: 'APROBADA' | 'RECHAZADA'; por: string | null; at: string | null }>();
    for (const r of linRows[0] as any[]) lin.set(Number(r.producto_id), { estado: r.estado === 'RECHAZADA' ? 'RECHAZADA' : 'APROBADA', por: f(r.por), at: f(r.at) });
    const sku = new Map<number, { codigo: string; por: string | null; at: string | null }>();
    for (const r of skuRows[0] as any[]) sku.set(Number(r.producto_id), { codigo: String(r.sku_propio), por: f(r.por), at: f(r.at) });

    const oc = new Map<number, { numero: string | null; por: string | null; at: string | null }>();
    const leerOc = (json: string, numero: string | null, por: string | null, at: string | null) => {
      try { for (const it of JSON.parse(json || '[]') as any[]) if (it?.productoId != null && !oc.has(Number(it.productoId))) oc.set(Number(it.productoId), { numero, por, at }); }
      catch { /* items_json corrupto: no se adivina */ }
    };
    for (const r of ocRows[0] as any[]) leerOc(r.items_json, f(r.obuma_folio), f(r.por), f(r.at));
    for (const r of ocPropRows[0] as any[]) leerOc(r.items_json, f(r.folio), null, f(r.at));

    const apr = (tipo: string) => { const r = (aprRows[0] as any[]).find(x => x.tipo === tipo); return r ? { estado: String(r.estado), por: f(r.por), at: f(r.at) } : null; };

    const datos: DatosProductoAvance[] = productos.filter(p => !SIN_AVANCE.has(p.subestado)).map(p => ({
      id: p.id, correlativo: p.correlativo, descripcion: p.descripcion, subestado: p.subestado,
      cotizaciones: cot.get(p.id) ?? { n: 0, por: null, at: null },
      eleccion: eleccion.get(p.id) ?? null, linea: lin.get(p.id) ?? null, sku: sku.get(p.id) ?? null, oc: oc.get(p.id) ?? null,
    }));

    return NextResponse.json({ success: true, avance: armarAvance(datos, { compra: apr('COMPRA'), margen: apr('MARGEN') }) });
  } catch (error) {
    console.error('[compras/avance][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar el avance.' }, { status: 500 });
  }
}
