// app/lib/compras-sku-obuma.ts
// LO QUE YA SE COMPRÓ EN OBUMA (se trabajó por fuera de Licitank) CONTRA EL PLAN DE COMPRA.
// Las órdenes de compra reales que Obuma ya tiene para la licitación (cruzadas por referencia, ver
// obuma-compras.ts) traen en cada línea el `producto_id` y el `codigo_comercial` del producto del
// catálogo. Con eso se reconoce qué producto del plan ya tiene SKU y a qué OC pertenece, sin crear
// nada en Obuma ni duplicar.
//
// Cómo se empareja una línea de OC con un producto del plan:
//   1) mismo proveedor (por RUT), misma cantidad y precio unitario parecido (±6 %: el plan puede
//      traer el precio sin ajustes que el proveedor sí aplicó);
//   2) lo que sobre, contra las líneas sobrantes de CUALQUIER otro proveedor: misma cantidad y
//      precio dentro de ±25 % — queda marcado `exacto: false` (se compró a otro proveedor que el
//      del plan). Esto NO se usa para enlazar SKU, solo para comparar.
// Cada línea de OC se usa una sola vez. Lo que no calza queda sin emparejar — nunca se adivina.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { comprasObumaDeLicitacion, type CompraObumaFila, type ItemCompraObuma } from '@/app/lib/obuma-compras';
import { rutNormalizado } from '@/app/lib/ordenes-compra';
import { proveedoresParaOrdenCompra, type ProveedorOrdenCompra, type ItemOrdenCompra } from '@/app/lib/compras-oc-obuma';

const TOLERANCIA_EXACTA = 0.06;
const TOLERANCIA_OTRO_PROVEEDOR = 0.25;
const ES_TRANSPORTE = /transporte|flete|despacho/i;

export interface ParPlanObuma {
  item: ItemOrdenCompra; grupo: ProveedorOrdenCompra;
  oc: CompraObumaFila; linea: ItemCompraObuma; exacto: boolean;
}
export interface EmparejamientoPlanObuma {
  pares: ParPlanObuma[];
  planSinOc: { item: ItemOrdenCompra; grupo: ProveedorOrdenCompra }[];
  lineasSinPlan: { oc: CompraObumaFila; linea: ItemCompraObuma }[];
  ocs: CompraObumaFila[];
}

async function codigoDeNegocio(negocioId: number): Promise<string | null> {
  const [lic] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (lic as any[])[0]?.licitacion_codigo ?? null;
}

export async function emparejarPlanConObuma(negocioId: number): Promise<EmparejamientoPlanObuma> {
  const codigo = await codigoDeNegocio(negocioId);
  const ocs = codigo ? (await comprasObumaDeLicitacion(codigo)).filter(c => !/anulad/i.test(c.estado || '')) : [];
  const grupos = await proveedoresParaOrdenCompra(negocioId);

  const lineas = ocs.flatMap(oc => oc.items.map(linea => ({ oc, linea })));
  const usada = new Set<number>();
  const pares: ParPlanObuma[] = [];
  const pendientes: { item: ItemOrdenCompra; grupo: ProveedorOrdenCompra }[] = [];

  const mejorLinea = (item: ItemOrdenCompra, candidatas: number[], tolerancia: number): number => {
    let mejor = -1; let mejorDif = Infinity;
    for (const i of candidatas) {
      const { linea } = lineas[i];
      if (usada.has(i) || linea.cantidad !== item.cantidad || linea.precio == null) continue;
      const dif = Math.abs(linea.precio - item.precioUnitario) / (item.precioUnitario || 1);
      if (dif <= tolerancia && dif < mejorDif) { mejor = i; mejorDif = dif; }
    }
    return mejor;
  };

  for (const grupo of grupos) {
    const rut = rutNormalizado(grupo.proveedorRut);
    const delProveedor = rut ? lineas.map((x, i) => (rutNormalizado(x.oc.proveedorRut) === rut ? i : -1)).filter(i => i >= 0) : [];
    for (const item of grupo.items) {
      const i = mejorLinea(item, delProveedor, TOLERANCIA_EXACTA);
      if (i < 0) { pendientes.push({ item, grupo }); continue; }
      usada.add(i);
      pares.push({ item, grupo, oc: lineas[i].oc, linea: lineas[i].linea, exacto: true });
    }
  }

  const sobrantes = lineas.map((x, i) => (!usada.has(i) && !ES_TRANSPORTE.test(x.linea.descripcion) ? i : -1)).filter(i => i >= 0);
  const planSinOc: EmparejamientoPlanObuma['planSinOc'] = [];
  for (const p of pendientes) {
    const i = mejorLinea(p.item, sobrantes, TOLERANCIA_OTRO_PROVEEDOR);
    if (i < 0) { planSinOc.push(p); continue; }
    usada.add(i);
    pares.push({ item: p.item, grupo: p.grupo, oc: lineas[i].oc, linea: lineas[i].linea, exacto: false });
  }

  return { pares, planSinOc, lineasSinPlan: lineas.filter((_, i) => !usada.has(i)), ocs };
}

export interface SkuObumaDetectado {
  productoId: number; descripcion: string; proveedorNombre: string;
  obumaProductoId: string; codigoComercial: string; nombreObuma: string;
  ocFolio: string; cantidad: number; precioPlan: number; precioObuma: number | null;
  yaEnlazado: boolean;
}

const limpiar = (s: string) => s.replace(/\s+/g, ' ').trim();

/** SKU que ya existen en Obuma para productos del plan (solo emparejamientos con el mismo proveedor). */
export async function detectarSkuExistentesEnObuma(negocioId: number): Promise<SkuObumaDetectado[]> {
  const { pares } = await emparejarPlanConObuma(negocioId);
  return pares.filter(p => p.exacto && p.linea.productoId && p.linea.codigoComercial).map(p => ({
    productoId: p.item.productoId, descripcion: p.item.descripcion, proveedorNombre: p.grupo.proveedorNombre,
    obumaProductoId: p.linea.productoId!, codigoComercial: p.linea.codigoComercial!, nombreObuma: limpiar(p.linea.descripcion),
    ocFolio: p.oc.folio || p.oc.compraOcId, cantidad: p.item.cantidad, precioPlan: p.item.precioUnitario, precioObuma: p.linea.precio,
    yaEnlazado: !!p.item.obumaProductoId,
  }));
}

/** Guarda el vínculo producto del plan ↔ producto de Obuma para los que todavía no lo tienen.
 *  Solo escribe en la base de Licitank (compras_sku); no toca Obuma. */
export async function enlazarSkuExistentesEnObuma(negocioId: number, actorId: number, actorNombre: string | null): Promise<{ enlazados: number }> {
  const nuevos = (await detectarSkuExistentesEnObuma(negocioId)).filter(d => !d.yaEnlazado);
  if (nuevos.length === 0) return { enlazados: 0 };
  const ahora = ahoraChileSQL();
  for (const d of nuevos) {
    await pool.query(
      `INSERT INTO compras_sku (negocio_id, producto_id, sku_propio, proveedor_nombre, obuma_producto_id, obuma_codigo_comercial, verificado_obuma, creado_por, creado_por_nombre, created_at)
       VALUES (?,?,?,?,?,?,1,?,?,?)
       ON DUPLICATE KEY UPDATE obuma_producto_id = VALUES(obuma_producto_id), obuma_codigo_comercial = VALUES(obuma_codigo_comercial), verificado_obuma = 1`,
      [negocioId, d.productoId, d.codigoComercial.slice(0, 80), d.proveedorNombre, d.obumaProductoId, d.codigoComercial, actorId, actorNombre, ahora],
    );
  }
  await registrarEvento({
    tipo: 'COMPRAS_SKU_CREADO', licitacionCodigo: await codigoDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se reconocieron ${nuevos.length} SKU que ya existían en Obuma (de las órdenes de compra del proyecto): ${nuevos.map(n => n.codigoComercial).join(', ')}.`,
    metadata: { negocio_id: negocioId, skus: nuevos.map(n => ({ producto_id: n.productoId, obuma_producto_id: n.obumaProductoId, codigo: n.codigoComercial })) },
  });
  return { enlazados: nuevos.length };
}
