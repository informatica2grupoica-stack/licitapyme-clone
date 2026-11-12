// app/lib/compras-adicionales.ts
// ADICIONALES POR COTIZACIÓN (migration-140). Una cotización cotiza el producto "pelado" y lo demás aparte
// (caso real 1173418-1-LE26: horno ROMCO sin quemador, carro sin bandejas). Cada producto de una cotización
// puede llevar adicionales (concepto, cantidad por unidad del producto, precio neto unitario).
//
// INVARIANTE: compras_cotizacion_item.precio_unitario = precio EFECTIVO (producto + adicionales): es lo que leen
// el cuadro, los escenarios, las aprobaciones y la comparación contra el costeo. precio_base = el producto solo.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { invalidarAprobacionesCompras } from '@/app/lib/compras';
import { precioEfectivo, type AdicionalCotizacion } from '@/app/lib/compras-precio-vs-costeo';

export interface AdicionalFila extends AdicionalCotizacion { id: number }
export interface AdicionalEntrada { concepto: string; cantidad: number; precioUnitario: number }

const MAX_ADICIONALES = 20;

/** Adicionales de varias cotizaciones, por "cotizacionId:productoId". */
export async function adicionalesDeCotizaciones(cotizacionIds: number[]): Promise<Map<string, AdicionalFila[]>> {
  const out = new Map<string, AdicionalFila[]>();
  if (cotizacionIds.length === 0) return out;
  const [rows] = await pool.query(
    `SELECT id, cotizacion_id, producto_id, concepto, cantidad, precio_unitario FROM compras_cotizacion_adicional
      WHERE cotizacion_id IN (${cotizacionIds.map(() => '?').join(',')}) ORDER BY id`, cotizacionIds,
  ).catch(() => [[]] as any) as any;   // sin la migración 140 la pantalla sigue igual, sin adicionales
  for (const r of rows as any[]) {
    const k = `${r.cotizacion_id}:${r.producto_id}`;
    const arr = out.get(k) || []; arr.push({ id: r.id, concepto: r.concepto, cantidad: Number(r.cantidad), precioUnitario: Number(r.precio_unitario) }); out.set(k, arr);
  }
  return out;
}

/** Deja precio_unitario = base + adicionales para UN producto de una cotización. Devuelve el precio efectivo. */
export async function recalcularPrecioItem(cotizacionId: number, productoId: number): Promise<number | null> {
  const [items] = await pool.query(`SELECT precio_unitario, precio_base FROM compras_cotizacion_item WHERE cotizacion_id = ? AND producto_id = ?`, [cotizacionId, productoId]) as any;
  const it = (items as any[])[0];
  if (!it) return null;
  const base = it.precio_base != null ? Number(it.precio_base) : (it.precio_unitario != null ? Number(it.precio_unitario) : null);
  if (base == null) return null;
  const mapa = await adicionalesDeCotizaciones([cotizacionId]);
  const efectivo = precioEfectivo(base, mapa.get(`${cotizacionId}:${productoId}`) || []);
  await pool.query(`UPDATE compras_cotizacion_item SET precio_base = ?, precio_unitario = ? WHERE cotizacion_id = ? AND producto_id = ?`, [base, efectivo, cotizacionId, productoId]);
  return efectivo;
}

/** Para cuando una asignación o una homologación reescribe los precios base: se vuelven a sumar los adicionales. */
export async function recalcularPreciosDeCotizacion(cotizacionId: number): Promise<void> {
  const [items] = await pool.query(`SELECT producto_id FROM compras_cotizacion_item WHERE cotizacion_id = ?`, [cotizacionId]) as any;
  for (const it of items as any[]) await recalcularPrecioItem(cotizacionId, it.producto_id);
}

/** Reemplaza TODOS los adicionales de un producto en una cotización (y opcionalmente fija su precio base). */
export async function guardarAdicionales(
  negocioId: number, cotizacionId: number, productoId: number,
  datos: { precioBase?: number | null; adicionales: AdicionalEntrada[] },
  actor: { id: number; nombre: string | null },
): Promise<{ precioEfectivo: number | null }> {
  const [it] = await pool.query(
    `SELECT i.precio_unitario, i.precio_base FROM compras_cotizacion_item i JOIN compras_cotizacion c ON c.id = i.cotizacion_id
      WHERE i.cotizacion_id = ? AND i.producto_id = ? AND c.negocio_id = ?`, [cotizacionId, productoId, negocioId]) as any;
  const item = (it as any[])[0];
  if (!item) throw new Error('Esa cotización todavía no está asignada a ese producto: usa «Asignar productos» primero.');

  const limpios: AdicionalEntrada[] = [];
  for (const a of datos.adicionales || []) {
    const concepto = String(a?.concepto || '').trim().slice(0, 160);
    const cantidad = Number(a?.cantidad); const precio = Number(a?.precioUnitario);
    if (!concepto) throw new Error('Cada adicional necesita un nombre (por ejemplo «Quemador a gas»).');
    if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 10_000) throw new Error(`«${concepto}»: la cantidad debe ser mayor que 0.`);
    if (!Number.isFinite(precio) || precio < 0) throw new Error(`«${concepto}»: el precio neto no es válido.`);
    limpios.push({ concepto, cantidad, precioUnitario: Math.round(precio) });
  }
  if (limpios.length > MAX_ADICIONALES) throw new Error(`Máximo ${MAX_ADICIONALES} adicionales por producto.`);

  const antes = item.precio_unitario != null ? Number(item.precio_unitario) : null;
  if (datos.precioBase != null) {
    if (!Number.isFinite(datos.precioBase) || datos.precioBase < 0) throw new Error('El precio base no es válido.');
    await pool.query(`UPDATE compras_cotizacion_item SET precio_base = ? WHERE cotizacion_id = ? AND producto_id = ?`, [Math.round(datos.precioBase), cotizacionId, productoId]);
  }
  await pool.query(`DELETE FROM compras_cotizacion_adicional WHERE cotizacion_id = ? AND producto_id = ?`, [cotizacionId, productoId]);
  const ahora = ahoraChileSQL();
  for (const a of limpios) {
    await pool.query(
      `INSERT INTO compras_cotizacion_adicional (negocio_id, cotizacion_id, producto_id, concepto, cantidad, precio_unitario, creado_por, creado_por_nombre, creado_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      [negocioId, cotizacionId, productoId, a.concepto, a.cantidad, a.precioUnitario, actor.id, actor.nombre, ahora]);
  }
  const efectivo = await recalcularPrecioItem(cotizacionId, productoId);

  // Todo cambio de precio posterior a una aprobación la invalida (spec §10.5).
  if (efectivo !== antes) await invalidarAprobacionesCompras(negocioId, 'Cambió el precio de una cotización (adicionales).').catch(() => {});
  const [lic] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  await registrarEvento({
    tipo: 'COMPRAS_COTIZACION_ADICIONALES', licitacionCodigo: (lic as any[])[0]?.licitacion_codigo ?? null, actorId: actor.id, actorNombre: actor.nombre,
    mensaje: `${actor.nombre || 'Un usuario'} dejó ${limpios.length} adicional(es) en una cotización${limpios.length ? `: ${limpios.map(a => `${a.concepto} (${a.cantidad} × $${a.precioUnitario.toLocaleString('es-CL')})`).join('; ')}` : ''}.`,
    metadata: { negocio_id: negocioId, cotizacion_id: cotizacionId, producto_id: productoId, adicionales: limpios, precio_efectivo: efectivo },
  }).catch(() => {});
  return { precioEfectivo: efectivo };
}

// ── Flete de la cotización cargado a los productos (pedido del dueño, 12-nov-2026) ─────────────────────────────────────────────
// Caso real 387-55-LE26: Industria de Camas cotizó 40 sillas × $18.400 + «DESPACHO» $21.008. El despacho quedó guardado aparte
// (flete_monto), no se veía en «Compara y elige» ni en la aprobación, y la OC salió $21.008 más cara que lo cotizado.
// Ahora el flete de la cotización se reparte entre SUS productos como un adicional visible, «Despacho del proveedor», en proporción al
// subtotal de cada uno (en una cotización de un solo producto va entero a ese producto). La cotización queda «incluye flete» para que
// el motor de escenarios no lo vuelva a sumar como viaje aparte. Es idempotente: se rehace cada vez desde flete_monto.
export const CONCEPTO_DESPACHO = 'Despacho del proveedor';

export async function cargarFleteAProductos(cotizacionId: number): Promise<{ repartido: number; productos: number }> {
  const [cRows] = await pool.query(`SELECT negocio_id, flete_monto FROM compras_cotizacion WHERE id = ?`, [cotizacionId]) as any;
  const cot = (cRows as any[])[0];
  const flete = cot?.flete_monto != null ? Number(cot.flete_monto) : 0;
  if (!cot || !(flete > 0)) return { repartido: 0, productos: 0 };
  const [items] = await pool.query(
    `SELECT i.producto_id, COALESCE(i.precio_base, i.precio_unitario) AS base, p.cantidad, COALESCE(p.es_servicio, 0) AS es_servicio
       FROM compras_cotizacion_item i JOIN compras_producto p ON p.id = i.producto_id
      WHERE i.cotizacion_id = ? AND COALESCE(i.precio_base, i.precio_unitario) > 0`, [cotizacionId]) as any;
  const lineas = (items as any[]).filter(r => !Number(r.es_servicio)).map(r => {
    const cant = Number(r.cantidad) > 0 ? Number(r.cantidad) : 1;
    return { productoId: Number(r.producto_id), cant, subtotal: Number(r.base) * cant };
  });
  const suma = lineas.reduce((s, l) => s + l.subtotal, 0);
  if (!lineas.length || !(suma > 0)) return { repartido: 0, productos: 0 };
  await pool.query(`DELETE FROM compras_cotizacion_adicional WHERE cotizacion_id = ? AND concepto = ?`, [cotizacionId, CONCEPTO_DESPACHO]);
  const ahora = ahoraChileSQL();
  let asignado = 0;
  for (const [i, l] of lineas.entries()) {
    // La última línea se lleva el resto, para que la suma cuadre al peso con el flete del documento.
    const parte = i === lineas.length - 1 ? flete - asignado : Math.round((flete * l.subtotal) / suma);
    asignado += parte;
    const porUnidad = Math.round((parte / l.cant) * 100) / 100;
    await pool.query(
      `INSERT INTO compras_cotizacion_adicional (negocio_id, cotizacion_id, producto_id, concepto, cantidad, precio_unitario, creado_por, creado_por_nombre, creado_at)
       VALUES (?,?,?,?,?,?,NULL,'Flete de la cotización',?)`,
      [cot.negocio_id, cotizacionId, l.productoId, CONCEPTO_DESPACHO, 1, porUnidad, ahora]);
  }
  await pool.query(`UPDATE compras_cotizacion SET incluye_flete = 1 WHERE id = ?`, [cotizacionId]);
  await recalcularPreciosDeCotizacion(cotizacionId);
  return { repartido: flete, productos: lineas.length };
}
