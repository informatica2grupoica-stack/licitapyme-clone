// app/lib/compras-directas.ts
// COMPRAS DIRECTAS: todas las del MISMO proveedor (mismo RUT, o mismo nombre si no hay RUT) en un negocio van en UNA sola «cotización».
// La matriz de precios arma una columna por cotización: sin esto, dos compras directas a «ABC SA» salían como dos columnas
// («Cotización #76» y «#75») con el mismo nombre y el mismo RUT.
import pool from '@/app/lib/db';

const normRut = (v: unknown) => String(v ?? '').replace(/[^0-9kK]/g, '').toUpperCase();
const normNombre = (v: unknown) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** ¿Son el mismo proveedor? Mismo RUT; si alguno no trae RUT, mismo nombre. */
export function mismoProveedor(a: { nombre: string | null; rut: string | null }, b: { nombre: string | null; rut: string | null }): boolean {
  const ra = normRut(a.rut), rb = normRut(b.rut);
  if (ra.length >= 7 && rb.length >= 7) return ra === rb;
  const na = normNombre(a.nombre), nb = normNombre(b.nombre);
  return na.length >= 3 && na === nb;
}

/**
 * Junta las compras directas del mismo proveedor de un negocio en la más antigua: pasa sus productos (y los informes de precio) a esa
 * cotización y borra las repetidas. Devuelve {id repetido → id que quedó}.
 */
export async function fusionarDirectasDelNegocio(negocioId: number): Promise<Map<number, number>> {
  const mapa = new Map<number, number>();
  const [rows] = await pool.query(
    `SELECT id, proveedor_nombre, proveedor_rut FROM compras_cotizacion WHERE negocio_id = ? AND origen = 'directa' ORDER BY id`, [negocioId]) as any;
  const grupos: Array<Array<{ id: number; nombre: string; rut: string | null }>> = [];
  for (const r of rows as any[]) {
    const c = { id: Number(r.id), nombre: String(r.proveedor_nombre), rut: r.proveedor_rut as string | null };
    const g = grupos.find(x => mismoProveedor({ nombre: x[0].nombre, rut: x[0].rut }, { nombre: c.nombre, rut: c.rut }));
    if (g) g.push(c); else grupos.push([c]);
  }
  for (const g of grupos) {
    if (g.length < 2) continue;
    const quedan = g[0].id;
    for (const otra of g.slice(1)) {
      await pool.query(
        `INSERT INTO compras_cotizacion_item (cotizacion_id, producto_id, precio_unitario, precio_base, cumple, detalle_desviacion)
         SELECT ?, producto_id, precio_unitario, precio_base, cumple, detalle_desviacion FROM compras_cotizacion_item WHERE cotizacion_id = ?
         ON DUPLICATE KEY UPDATE precio_unitario = VALUES(precio_unitario), precio_base = VALUES(precio_base)`, [quedan, otra.id]);
      await pool.query(`UPDATE compras_cotizacion_adicional SET cotizacion_id = ? WHERE cotizacion_id = ?`, [quedan, otra.id]).catch(() => {});
      await pool.query(`UPDATE IGNORE compras_auditoria_cotizacion SET cotizacion_id = ? WHERE cotizacion_id = ?`, [quedan, otra.id]).catch(() => {});
      await pool.query(`DELETE FROM compras_auditoria_cotizacion WHERE cotizacion_id = ?`, [otra.id]).catch(() => {});
      await pool.query(`DELETE FROM compras_cotizacion_item WHERE cotizacion_id = ?`, [otra.id]);
      await pool.query(`DELETE FROM compras_cotizacion WHERE id = ? AND negocio_id = ?`, [otra.id, negocioId]);
      mapa.set(otra.id, quedan);
    }
    // Cabecera de la que quedó: con varios productos no hay «un precio unitario»; el total es la suma de lo que cuesta cada uno.
    await pool.query(
      `UPDATE compras_cotizacion c SET c.precio_unitario = NULL,
              c.precio_total = (SELECT COALESCE(SUM(i.precio_unitario * COALESCE(p.cantidad, 1)), 0) FROM compras_cotizacion_item i JOIN compras_producto p ON p.id = i.producto_id WHERE i.cotizacion_id = c.id)
        WHERE c.id = ?`, [quedan]);
  }
  return mapa;
}
