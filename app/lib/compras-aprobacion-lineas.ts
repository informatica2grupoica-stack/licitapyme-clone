// Aprobación POR PRODUCTO de la compra (migration-147): el jefe de ventas aprueba o rechaza cada producto de la tabla
// «Qué se va a aprobar»; con todos aprobados se aprueba la compra completa con un botón (la compuerta COMPRA no cambia).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { listarProductosCompra } from '@/app/lib/compras';
import { notificarEncargadosCompras } from '@/app/lib/compras-avisos';

export type EstadoLinea = 'APROBADA' | 'RECHAZADA';
export interface AprobacionLinea { productoId: number; estado: EstadoLinea; comentario: string | null; porNombre: string | null; at: string }

const sinTabla = (e: any) => e?.code === 'ER_NO_SUCH_TABLE';

/** `tablaOk` false = falta aplicar migration-147 (la pantalla lo avisa en vez de fallar). */
export async function listarAprobacionesLinea(negocioId: number): Promise<{ tablaOk: boolean; lineas: AprobacionLinea[] }> {
  try {
    const [rows]: any = await pool.query(
      `SELECT producto_id, estado, comentario, resuelto_por_nombre, resuelto_at FROM compras_aprobacion_linea WHERE negocio_id = ?`, [negocioId]);
    return { tablaOk: true, lineas: rows.map((r: any) => ({ productoId: r.producto_id, estado: r.estado, comentario: r.comentario, porNombre: r.resuelto_por_nombre, at: String(r.resuelto_at) })) };
  } catch (e: any) {
    if (sinTabla(e)) return { tablaOk: false, lineas: [] };
    throw e;
  }
}

export async function resolverLineas(
  negocioId: number, productoIds: number[], decision: 'APROBAR' | 'RECHAZAR' | 'QUITAR', comentario: string | null, userId: number, nombre: string | null,
): Promise<void> {
  if (productoIds.length === 0) return;
  if (decision === 'RECHAZAR' && !comentario?.trim()) throw new Error('Para rechazar un producto escribe el motivo.');
  try {
    if (decision === 'QUITAR') {
      await pool.query(`DELETE FROM compras_aprobacion_linea WHERE negocio_id = ? AND producto_id IN (?)`, [negocioId, productoIds]);
      return;
    }
    const ahora = ahoraChileSQL();
    const estado: EstadoLinea = decision === 'APROBAR' ? 'APROBADA' : 'RECHAZADA';
    for (const productoId of productoIds) {
      await pool.query(
        `INSERT INTO compras_aprobacion_linea (negocio_id, producto_id, estado, comentario, resuelto_por, resuelto_por_nombre, resuelto_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE estado = VALUES(estado), comentario = VALUES(comentario), resuelto_por = VALUES(resuelto_por),
           resuelto_por_nombre = VALUES(resuelto_por_nombre), resuelto_at = VALUES(resuelto_at)`,
        [negocioId, productoId, estado, decision === 'RECHAZAR' ? comentario!.trim() : (comentario?.trim() || null), userId, nombre, ahora]);
    }
    if (decision === 'RECHAZAR') {
      const productos = await listarProductosCompra(negocioId).catch(() => []);
      const nombres = productoIds.map(id => productos.find(p => p.id === id)?.descripcion?.split(' - ')[0] || `producto #${id}`).join(', ');
      await notificarEncargadosCompras(negocioId, 'COMPRAS_APROB_PRODUCTO_RECHAZADO',
        `${nombre || 'El jefe de ventas'} rechazó ${productoIds.length === 1 ? 'un producto' : 'productos'} de la compra: ${nombres}. Motivo: ${comentario!.trim()}`, { id: userId, nombre },
        { resultado: 'RECHAZADA', que: `${productoIds.length === 1 ? 'un producto' : 'productos'} de la compra (${nombres})`, comentario: comentario!.trim() });
    }
  } catch (e: any) {
    if (sinTabla(e)) throw new Error('Falta aplicar la migración 147 (node scripts/aplicar-migration-147.mjs).');
    throw e;
  }
}
