// COMPRA RÁPIDA por producto (migration-151): el encargado manda un producto a comprar en una tienda (sin cotización ni ficha) y el
// jefe de ventas lo aprueba ANTES de comprar. Aprobado, el producto pasa a COMPRADO y puede crear SKU / proveedor / OC sin esperar las
// compuertas 1 y 2 de toda la compra (solo ese producto). Rechazado, queda marcado en rojo con el motivo y el encargado puede reenviarlo.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { cambiarSubestadoProducto, listarProductosCompra } from '@/app/lib/compras';
import { notificarEncargadosCompras, notificarJefesVentas } from '@/app/lib/compras-avisos';

export type EstadoCompraRapida = 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';
export interface CompraRapida {
  productoId: number; estado: EstadoCompraRapida; proveedorNombre: string | null; proveedorRut: string | null; precioUnitario: number | null;
  link: string | null; motivo: string | null; yaComprada: boolean; comentario: string | null; solicitadoPorNombre: string | null; solicitadoAt: string;
  resueltoPorNombre: string | null; resueltoAt: string | null;
}
/** `yaComprada`: la compra ya se hizo en la tienda (el jefe de ventas la ratifica); si no, se aprueba ANTES de comprar. */
export interface DatosCompraRapida { proveedorNombre: string; proveedorRut: string; precioUnitario: number; link?: string | null; motivo?: string | null; yaComprada?: boolean }

const sinTabla = (e: any) => e?.code === 'ER_NO_SUCH_TABLE';
const MSG_MIGRACION = 'Falta aplicar la migración 151 (node scripts/aplicar-migration-151.mjs) para la compra rápida.';

/** Dígito verificador del RUT chileno (módulo 11). */
export function rutChilenoValido(rut: string | null | undefined): boolean {
  const t = (rut || '').replace(/[.\s]/g, '').toUpperCase();
  const m = t.match(/^(\d{7,8})-?([\dK])$/);
  if (!m) return false;
  let suma = 0, mult = 2;
  for (let i = m[1].length - 1; i >= 0; i--) { suma += Number(m[1][i]) * mult; mult = mult === 7 ? 2 : mult + 1; }
  const dv = 11 - (suma % 11);
  return m[2] === (dv === 11 ? '0' : dv === 10 ? 'K' : String(dv));
}

export async function listarComprasRapidas(negocioId: number): Promise<{ tablaOk: boolean; compras: CompraRapida[] }> {
  try {
    let rows: any[];
    try {
      [rows] = await pool.query(
        `SELECT producto_id, estado, proveedor_nombre, proveedor_rut, precio_unitario, link, motivo, ya_comprada, comentario, solicitado_por_nombre, solicitado_at,
                resuelto_por_nombre, resuelto_at FROM compras_compra_rapida WHERE negocio_id = ?`, [negocioId]) as any;
    } catch (e: any) {
      if (e?.code !== 'ER_BAD_FIELD_ERROR') throw e;   // migration-152 sin aplicar: se lee sin «ya comprada»
      [rows] = await pool.query(
        `SELECT producto_id, estado, proveedor_nombre, proveedor_rut, precio_unitario, link, motivo, comentario, solicitado_por_nombre, solicitado_at,
                resuelto_por_nombre, resuelto_at FROM compras_compra_rapida WHERE negocio_id = ?`, [negocioId]) as any;
    }
    return { tablaOk: true, compras: rows.map((r: any) => ({
      productoId: r.producto_id, estado: r.estado, proveedorNombre: r.proveedor_nombre, proveedorRut: r.proveedor_rut,
      precioUnitario: r.precio_unitario != null ? Number(r.precio_unitario) : null, link: r.link, motivo: r.motivo, yaComprada: !!r.ya_comprada, comentario: r.comentario,
      solicitadoPorNombre: r.solicitado_por_nombre, solicitadoAt: String(r.solicitado_at),
      resueltoPorNombre: r.resuelto_por_nombre, resueltoAt: r.resuelto_at ? String(r.resuelto_at) : null,
    })) };
  } catch (e: any) {
    if (sinTabla(e)) return { tablaOk: false, compras: [] };
    throw e;
  }
}

/** Productos con compra rápida APROBADA: se saltan las compuertas 1 y 2 (solo ellos) para crear el SKU y la OC. Sin tabla = ninguno. */
export async function productosConCompraRapidaAprobada(negocioId: number): Promise<Set<number>> {
  const { compras } = await listarComprasRapidas(negocioId).catch(() => ({ compras: [] as CompraRapida[] }));
  return new Set(compras.filter(c => c.estado === 'APROBADA').map(c => c.productoId));
}

/** Falla con un mensaje claro si la tabla no existe: la compra directa no debe registrarse sin poder pedir la aprobación. */
export async function exigirTablaCompraRapida(): Promise<void> {
  try { await pool.query(`SELECT 1 FROM compras_compra_rapida LIMIT 1`); }
  catch (e: any) { if (sinTabla(e)) throw new Error(MSG_MIGRACION); throw e; }
}

/** El encargado manda productos a compra rápida (o los reenvía tras un rechazo): quedan PENDIENTE y el jefe de ventas recibe la alerta. */
export async function solicitarCompraRapida(
  negocioId: number, productoIds: number[], datos: DatosCompraRapida, userId: number, nombre: string | null,
): Promise<void> {
  if (productoIds.length === 0) return;
  if (!datos.proveedorNombre?.trim()) throw new Error('Falta el nombre de la tienda o proveedor.');
  if (!rutChilenoValido(datos.proveedorRut)) throw new Error('La compra rápida necesita el RUT de la tienda, válido (ej. 76.123.456-7).');
  if (!(datos.precioUnitario > 0)) throw new Error('Falta el precio neto de la compra.');
  const ahora = ahoraChileSQL();
  try {
    for (const productoId of productoIds) {
      await pool.query(
        `INSERT INTO compras_compra_rapida (negocio_id, producto_id, estado, proveedor_nombre, proveedor_rut, precio_unitario, link, motivo, ya_comprada, solicitado_por, solicitado_por_nombre, solicitado_at)
         VALUES (?, ?, 'PENDIENTE', ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE estado = 'PENDIENTE', proveedor_nombre = VALUES(proveedor_nombre), proveedor_rut = VALUES(proveedor_rut), precio_unitario = VALUES(precio_unitario),
           link = VALUES(link), motivo = VALUES(motivo), ya_comprada = VALUES(ya_comprada), comentario = NULL, solicitado_por = VALUES(solicitado_por), solicitado_por_nombre = VALUES(solicitado_por_nombre),
           solicitado_at = VALUES(solicitado_at), resuelto_por = NULL, resuelto_por_nombre = NULL, resuelto_at = NULL`,
        [negocioId, productoId, datos.proveedorNombre.trim(), datos.proveedorRut.trim(), datos.precioUnitario, datos.link?.trim() || null, datos.motivo?.trim() || null, datos.yaComprada ? 1 : 0, userId, nombre, ahora]);
      // Ya comprada en la tienda: el producto está comprado (la plata ya salió); el jefe de ventas la ratifica con su aprobación.
      if (datos.yaComprada) await cambiarSubestadoProducto(productoId, 'COMPRADO').catch(e => console.warn('[compra-rapida] no se pudo marcar Comprado:', String(e).slice(0, 120)));
    }
  } catch (e: any) {
    if (sinTabla(e)) throw new Error(MSG_MIGRACION);
    throw e;
  }
  const productos = await listarProductosCompra(negocioId).catch(() => []);
  const nombres = productoIds.map(id => productos.find(p => p.id === id)?.descripcion?.split(' - ')[0] || `producto #${id}`).join(', ');
  await notificarJefesVentas(negocioId, 'COMPRAS_COMPRA_RAPIDA_POR_APROBAR',
    datos.yaComprada
      ? `${nombre || 'El encargado'} YA COMPRÓ en ${datos.proveedorNombre.trim()} (${datos.proveedorRut.trim()}) sin aprobación previa: ${nombres}. Revísala y ratifícala o recházala.`
      : `${nombre || 'El encargado'} pide aprobar una compra rápida en ${datos.proveedorNombre.trim()} (${datos.proveedorRut.trim()}): ${nombres}. Apruébala antes de comprar.`,
    { id: userId, nombre }, null, `/compras/${negocioId}?fase=costeo&pestana=productos&producto=${productoIds[0]}`);
}

/** El jefe de ventas aprueba o rechaza. Aprobar deja el producto COMPRADO; rechazar exige motivo y avisa al encargado. */
export async function resolverCompraRapida(
  negocioId: number, productoIds: number[], decision: 'APROBAR' | 'RECHAZAR', comentario: string | null, userId: number, nombre: string | null,
): Promise<void> {
  if (productoIds.length === 0) return;
  if (decision === 'RECHAZAR' && !comentario?.trim()) throw new Error('Para rechazar la compra rápida escribe el motivo.');
  const ahora = ahoraChileSQL();
  try {
    for (const productoId of productoIds) {
      const [[actual]]: any = await pool.query(`SELECT estado, proveedor_nombre FROM compras_compra_rapida WHERE negocio_id = ? AND producto_id = ?`, [negocioId, productoId]);
      if (!actual) throw new Error('Ese producto no tiene una compra rápida pedida.');
      // Deshacer una aprobación errónea = rechazarla de nuevo (con motivo). Si ya se emitió la OC a esa tienda, hay que anular primero la OC.
      if (decision === 'RECHAZAR' && actual.estado === 'APROBADA') {
        const [oc]: any = await pool.query(`SELECT 1 FROM compras_orden_compra_obuma WHERE negocio_id = ? AND proveedor_nombre = ? LIMIT 1`, [negocioId, actual.proveedor_nombre]).catch(() => [[]]);
        if (oc?.length) throw new Error(`Ya se emitió una orden de compra a ${actual.proveedor_nombre}: anúlala primero en Obuma antes de deshacer la aprobación.`);
      }
      await pool.query(
        `UPDATE compras_compra_rapida SET estado = ?, comentario = ?, resuelto_por = ?, resuelto_por_nombre = ?, resuelto_at = ? WHERE negocio_id = ? AND producto_id = ?`,
        [decision === 'APROBAR' ? 'APROBADA' : 'RECHAZADA', decision === 'RECHAZAR' ? comentario!.trim() : (comentario?.trim() || null), userId, nombre, ahora, negocioId, productoId]);
      if (decision === 'APROBAR') await cambiarSubestadoProducto(productoId, 'COMPRADO').catch(e => console.warn('[compra-rapida] no se pudo marcar Comprado:', String(e).slice(0, 120)));
      // Aprobación deshecha: el producto deja de estar «Comprado» (si ya se había comprado de verdad, el encargado lo ve en el motivo).
      else if (actual.estado === 'APROBADA') await pool.query(`UPDATE compras_producto SET subestado = 'COTIZANDO', updated_at = ? WHERE id = ? AND subestado = 'COMPRADO'`, [ahora, productoId]).catch(() => {});
    }
  } catch (e: any) {
    if (sinTabla(e)) throw new Error(MSG_MIGRACION);
    throw e;
  }
  const productos = await listarProductosCompra(negocioId).catch(() => []);
  const nombres = productoIds.map(id => productos.find(p => p.id === id)?.descripcion?.split(' - ')[0] || `producto #${id}`).join(', ');
  const ruta = `/compras/${negocioId}?fase=costeo&pestana=productos&producto=${productoIds[0]}`;
  if (decision === 'RECHAZAR') {
    await notificarEncargadosCompras(negocioId, 'COMPRAS_COMPRA_RAPIDA_RECHAZADA',
      `${nombre || 'El jefe de ventas'} rechazó la compra rápida de: ${nombres}. Motivo: ${comentario!.trim()}. NO la compres.`, { id: userId, nombre },
      { resultado: 'RECHAZADA', que: `la compra rápida de «${nombres}»`, comentario: comentario!.trim() }, ruta);
  } else {
    await notificarEncargadosCompras(negocioId, 'COMPRAS_COMPRA_RAPIDA_APROBADA',
      `${nombre || 'El jefe de ventas'} aprobó la compra rápida de: ${nombres}. Ya puedes crear el SKU, el proveedor y la OC.`, { id: userId, nombre },
      { resultado: 'APROBADA', que: `la compra rápida de «${nombres}»`, comentario: comentario?.trim() || null }, ruta);
  }
}
