// Aprobación POR PRODUCTO de la compra (migration-147): el jefe de ventas aprueba o rechaza cada producto de la tabla
// «Qué se va a aprobar»; con todos aprobados se aprueba la compra completa con un botón (la compuerta COMPRA no cambia).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { listarProductosCompra } from '@/app/lib/compras';
import { notificarEncargadosCompras, notificarJefesVentas, rutaCorregirProducto } from '@/app/lib/compras-avisos';

// CORREGIDA = el encargado dice que ya corrigió lo que se rechazó y el jefe de ventas debe volver a revisarlo (migration-148).
export type EstadoLinea = 'APROBADA' | 'RECHAZADA' | 'CORREGIDA';
export interface AprobacionLinea {
  productoId: number; estado: EstadoLinea; comentario: string | null; porNombre: string | null; at: string;
  corregidoPorNombre: string | null; corregidoAt: string | null; notaCorreccion: string | null;
}

const sinTabla = (e: any) => e?.code === 'ER_NO_SUCH_TABLE';

/** `tablaOk` false = falta aplicar migration-147 (la pantalla lo avisa en vez de fallar). */
export async function listarAprobacionesLinea(negocioId: number): Promise<{ tablaOk: boolean; lineas: AprobacionLinea[] }> {
  try {
    let rows: any[];
    try {
      [rows] = await pool.query(
        `SELECT producto_id, estado, comentario, resuelto_por_nombre, resuelto_at, corregido_por_nombre, corregido_at, nota_correccion FROM compras_aprobacion_linea WHERE negocio_id = ?`, [negocioId]) as any;
    } catch (e: any) {
      if (e?.code !== 'ER_BAD_FIELD_ERROR') throw e;   // migration-148 sin aplicar: se lee sin las columnas de corrección
      [rows] = await pool.query(
        `SELECT producto_id, estado, comentario, resuelto_por_nombre, resuelto_at FROM compras_aprobacion_linea WHERE negocio_id = ?`, [negocioId]) as any;
    }
    return { tablaOk: true, lineas: rows.map((r: any) => ({
      productoId: r.producto_id, estado: r.estado, comentario: r.comentario, porNombre: r.resuelto_por_nombre, at: String(r.resuelto_at),
      corregidoPorNombre: r.corregido_por_nombre ?? null, corregidoAt: r.corregido_at ? String(r.corregido_at) : null, notaCorreccion: r.nota_correccion ?? null,
    })) };
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
        { resultado: 'RECHAZADA', que: `${productoIds.length === 1 ? 'un producto' : 'productos'} de la compra (${nombres})`, comentario: comentario!.trim() },
        productoIds.length === 1 ? rutaCorregirProducto(negocioId, productoIds[0]) : undefined);
    }
  } catch (e: any) {
    if (sinTabla(e)) throw new Error('Falta aplicar la migración 147 (node scripts/aplicar-migration-147.mjs).');
    throw e;
  }
}

/** El encargado avisa que ya corrigió un producto rechazado: pasa a CORREGIDA (conserva el motivo del rechazo) y se avisa al jefe de ventas. */
export async function marcarLineaCorregida(
  negocioId: number, productoId: number, nota: string, userId: number, nombre: string | null,
): Promise<void> {
  if (!nota.trim()) throw new Error('Cuéntale al jefe de ventas qué corregiste (por ejemplo: «subí la ficha correcta del modelo X»).');
  try {
    const [[actual]]: any = await pool.query(`SELECT estado, comentario FROM compras_aprobacion_linea WHERE negocio_id = ? AND producto_id = ?`, [negocioId, productoId]);
    if (!actual || actual.estado !== 'RECHAZADA') throw new Error('Solo se puede marcar como corregido un producto que está rechazado.');
    await pool.query(
      `UPDATE compras_aprobacion_linea SET estado = 'CORREGIDA', corregido_por_nombre = ?, corregido_at = ?, nota_correccion = ? WHERE negocio_id = ? AND producto_id = ?`,
      [nombre, ahoraChileSQL(), nota.trim(), negocioId, productoId]);
  } catch (e: any) {
    if (sinTabla(e)) throw new Error('Falta aplicar la migración 147 (node scripts/aplicar-migration-147.mjs).');
    if (e?.code === 'ER_BAD_FIELD_ERROR') throw new Error('Falta aplicar la migración 148 (node scripts/aplicar-migration-148.mjs).');
    throw e;
  }
  const productos = await listarProductosCompra(negocioId).catch(() => []);
  const prod = productos.find(p => p.id === productoId)?.descripcion?.split(' - ')[0] || `producto #${productoId}`;
  await notificarJefesVentas(negocioId, 'COMPRAS_CORREGIDO_PRODUCTO',
    `${nombre || 'El encargado'} corrigió un producto que rechazaste: ${prod}. Lo que hizo: ${nota.trim()}. Vuelve a revisarlo.`, { id: userId, nombre },
    { resultado: 'CORREGIDA', que: `el producto «${prod}»`, comentario: nota.trim() }, `/compras/${negocioId}?fase=aprobacion&producto=${productoId}`);
}
