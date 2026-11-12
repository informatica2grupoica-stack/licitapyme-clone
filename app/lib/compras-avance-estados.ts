// app/lib/compras-avance-estados.ts
// Avance AUTOMÁTICO del estado de cada producto en Compras (pedido del dueño, 12-nov-2026, caso 387-55-LE26:
// los 21 productos seguían en «Comprado» con las guías ya firmadas y el acta no se podía generar).
// Cada estado lo mueve un hecho que el sistema ya registra:
//   Cotizando        ← hay una cotización que cubre el producto
//   Comprado         ← OC al proveedor emitida (ya lo hace compras-oc-obuma.ts)
//   En bodega        ← «Recibido en bodega» del proveedor en Retiro por proveedor, o verificación en bodega conforme
//   Listo p/ entrega ← se registra el N° de guía de despacho (entrega total)
//   Entregado        ← guía de despacho firmada por el cliente (entrega total)
// Reglas: nunca retrocede (salvo la OC anulada, que maneja compras-oc-obuma.ts); salta estados si el hecho llega
// antes (guía firmada con el producto en «Comprado» → «Entregado»); los pasos logísticos solo mueven productos
// que ya tienen compra (Comprado o más): un producto sin comprar no se da por entregado. El selector manual sigue.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';

const ORDEN = ['PENDIENTE', 'COTIZANDO', 'COMPRADO', 'EN_BODEGA', 'LISTO_ENTREGA', 'ENTREGADO'] as const;
export type EstadoAvance = typeof ORDEN[number];

const ETIQUETA: Record<EstadoAvance, string> = {
  PENDIENTE: 'Pendiente', COTIZANDO: 'Cotizando', COMPRADO: 'Comprado', EN_BODEGA: 'En bodega',
  LISTO_ENTREGA: 'Listo para entrega', ENTREGADO: 'Entregado',
};

/** Sube al estado `hasta` los productos del negocio que estén más atrás (y desde `desdeMinimo` en adelante).
 *  Devuelve cuántos cambió. Nunca falla hacia afuera: un avance automático no debe tumbar la acción que lo dispara. */
export async function avanzarSubestados(negocioId: number, hasta: EstadoAvance, opts: {
  motivo: string; desdeMinimo?: EstadoAvance; productoIds?: number[]; actorId?: number | null; actorNombre?: string | null;
}): Promise<number> {
  try {
    const iHasta = ORDEN.indexOf(hasta);
    const iDesde = ORDEN.indexOf(opts.desdeMinimo ?? 'PENDIENTE');
    const previos = ORDEN.slice(iDesde, iHasta);
    if (!previos.length) return 0;
    if (opts.productoIds && !opts.productoIds.length) return 0;
    // Los servicios (flete, armado) no se reciben ni se entregan: los pasos logísticos no los tocan.
    const soloBienes = iHasta >= ORDEN.indexOf('EN_BODEGA');
    const [r] = await pool.query(
      `UPDATE compras_producto SET subestado = ?, updated_at = ?
        WHERE negocio_id = ? AND subestado IN (?)${soloBienes ? ' AND COALESCE(es_servicio, 0) = 0' : ''}${opts.productoIds ? ' AND id IN (?)' : ''}`,
      [hasta, ahoraChileSQL(), negocioId, previos, ...(opts.productoIds ? [opts.productoIds] : [])],
    ) as any;
    const n = Number(r?.affectedRows || 0);
    if (n > 0) {
      const [neg] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
      await registrarEvento({
        tipo: 'COMPRAS_SUBESTADO_AUTO', licitacionCodigo: (neg as any[])[0]?.licitacion_codigo ?? null,
        actorId: opts.actorId ?? null, actorNombre: opts.actorNombre ?? null,
        mensaje: `${n} producto(s) pasaron solos a «${ETIQUETA[hasta]}»: ${opts.motivo}.`,
        metadata: { negocio_id: negocioId, hasta, productos: opts.productoIds ?? null },
      });
    }
    return n;
  } catch (e) {
    console.error('[compras] avance automático de estado falló:', String(e).slice(0, 200));
    return 0;
  }
}

/** Pendiente → Cotizando para los productos que ya tienen al menos una cotización cargada. Idempotente. */
export async function marcarCotizandoSiHayCotizacion(negocioId: number): Promise<number> {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT p.id FROM compras_producto p
         JOIN compras_cotizacion_item i ON i.producto_id = p.id
         JOIN compras_cotizacion c ON c.id = i.cotizacion_id AND c.negocio_id = p.negocio_id
        WHERE p.negocio_id = ? AND p.subestado = 'PENDIENTE'`,
      [negocioId],
    ) as any;
    const ids = (rows as any[]).map(r => Number(r.id));
    return ids.length ? await avanzarSubestados(negocioId, 'COTIZANDO', { productoIds: ids, motivo: 'ya tienen una cotización cargada' }) : 0;
  } catch (e) {
    console.error('[compras] marcarCotizando falló:', String(e).slice(0, 200));
    return 0;
  }
}

/** Productos del negocio en un estado dado o más adelante (para mostrar «Recibido en bodega ✓» por proveedor). */
export async function subestadosDeNegocio(negocioId: number): Promise<Record<number, string>> {
  const [rows] = await pool.query(`SELECT id, subestado FROM compras_producto WHERE negocio_id = ?`, [negocioId]) as any;
  return Object.fromEntries((rows as any[]).map(r => [Number(r.id), String(r.subestado)]));
}
