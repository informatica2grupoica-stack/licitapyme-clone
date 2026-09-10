// app/lib/compras-importacion.ts
// RUTA DE IMPORTACIÓN Y COSTEO ATERRIZADO (spec §12). "La cotización FOB no es el costo del
// producto" (§12.3) — este archivo convierte el precio FOB de cada producto (ya elegido en el
// escenario del Auditor de Compras, Tanda 2) en su costo ATERRIZADO real, prorrateando flete
// internacional + aduana + logística local POR UNIDAD (tabla de reglas de cálculo de la spec:
// "método: cálculo efectivo, sin número estimado — no se arrastra la fórmula gruesa de Fase 3").
//
// §12.5: "determinar si el margen es el permitido. Conecta directamente con la Compuerta 2 y el
// piso del 20%" — por eso `calcularCostoAterrizado` está pensado para que `calcularMargenPrevisto`
// (compras-aprobaciones.ts) lo use como fuente de costo cuando el negocio es de origen IMPORTACION,
// en vez del costo FOB crudo del escenario elegido.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { listarProductosCompra } from '@/app/lib/compras';

export type OrigenCompra = 'LOCAL' | 'IMPORTACION';

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

export interface OrigenCompraInfo { origen: OrigenCompra | null; definidoPorNombre: string | null; definidoAt: string | null }

export async function obtenerOrigenCompra(negocioId: number): Promise<OrigenCompraInfo> {
  const [rows] = await pool.query(
    `SELECT origen_compra, origen_compra_por_nombre, DATE_FORMAT(origen_compra_at, '%Y-%m-%d %H:%i:%s') AS origen_compra_at
       FROM compras_asignacion WHERE negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  const r = (rows as any[])[0];
  if (!r) return { origen: null, definidoPorNombre: null, definidoAt: null };
  return { origen: r.origen_compra, definidoPorNombre: r.origen_compra_por_nombre, definidoAt: r.origen_compra_at };
}

/** §12.1 — "el proyecto se clasifica DESDE EL INICIO como importación o compra local. Es una
 *  bifurcación dentro del mismo flujo, no dos módulos." */
export async function definirOrigenCompra(negocioId: number, origen: OrigenCompra, actorId: number, actorNombre: string | null): Promise<void> {
  if (!['LOCAL', 'IMPORTACION'].includes(origen)) throw new Error('Origen inválido.');
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_asignacion SET origen_compra = ?, origen_compra_por = ?, origen_compra_por_nombre = ?, origen_compra_at = ? WHERE negocio_id = ?`,
    [origen, actorId, actorNombre, ahora, negocioId],
  ) as any;
  if (!r?.affectedRows) throw new Error('Compras no está abierto para este negocio.');
  await registrarEvento({
    tipo: 'COMPRAS_ORIGEN_DEFINIDO', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se clasificó el proyecto como ${origen === 'IMPORTACION' ? 'importación' : 'compra local'}.`,
    metadata: { negocio_id: negocioId, origen },
  });
}

export interface DatosEmbarque { fleteInternacional: number | null; costosAduana: number | null; costoLogisticoLocal: number | null; moneda?: string; notas?: string | null }

export async function obtenerEmbarque(negocioId: number): Promise<DatosEmbarque | null> {
  const [rows] = await pool.query(
    `SELECT flete_internacional, costos_aduana, costo_logistico_local, moneda, notas FROM compras_embarque WHERE negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  const r = (rows as any[])[0];
  if (!r) return null;
  return {
    fleteInternacional: r.flete_internacional == null ? null : Number(r.flete_internacional),
    costosAduana: r.costos_aduana == null ? null : Number(r.costos_aduana),
    costoLogisticoLocal: r.costo_logistico_local == null ? null : Number(r.costo_logistico_local),
    moneda: r.moneda, notas: r.notas,
  };
}

/** §12.3 — componentes del costo aterrizado: flete internacional (global, ingreso manual),
 *  costos de aduana (ingreso manual), costo logístico local (ingreso manual). "Moneda y tipo de
 *  cambio los maneja OBUMA" — se guarda como dato informativo, no se recalcula acá. */
export async function registrarEmbarque(negocioId: number, datos: DatosEmbarque, actorId: number, actorNombre: string | null): Promise<void> {
  const ahora = ahoraChileSQL();
  await pool.query(
    `INSERT INTO compras_embarque (negocio_id, flete_internacional, costos_aduana, costo_logistico_local, moneda, notas, registrado_por, registrado_por_nombre, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE flete_internacional=VALUES(flete_internacional), costos_aduana=VALUES(costos_aduana),
       costo_logistico_local=VALUES(costo_logistico_local), moneda=VALUES(moneda), notas=VALUES(notas),
       registrado_por=VALUES(registrado_por), registrado_por_nombre=VALUES(registrado_por_nombre), updated_at=VALUES(updated_at)`,
    [negocioId, datos.fleteInternacional ?? null, datos.costosAduana ?? null, datos.costoLogisticoLocal ?? null,
     datos.moneda || 'CLP', datos.notas || null, actorId, actorNombre, ahora, ahora],
  );
  await registrarEvento({
    tipo: 'COMPRAS_EMBARQUE_REGISTRADO', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se registraron los datos del embarque (flete internacional, aduana, logística local).`,
    metadata: { negocio_id: negocioId },
  });
}

interface ItemFob { productoId: number; descripcion: string; proveedor: string | null; precioUnitarioFob: number | null; cantidad: number | null }

/** El costo FOB por producto es el que ya quedó fijado en el escenario ELEGIDO del Auditor de
 *  Compras (Tanda 2/4) — no se vuelve a preguntar por el precio, se reusa esa decisión. */
async function itemsFobDelEscenarioElegido(negocioId: number): Promise<ItemFob[] | null> {
  const [rows] = await pool.query(
    `SELECT detalle_json FROM compras_escenario WHERE negocio_id = ? AND elegido = 1 ORDER BY generado_at DESC LIMIT 1`,
    [negocioId],
  ) as any;
  const detalleRaw = (rows as any[])[0]?.detalle_json;
  if (!detalleRaw) return null;
  try {
    const detalle = JSON.parse(detalleRaw);
    const porProducto = Array.isArray(detalle?.porProducto) ? detalle.porProducto : [];
    return porProducto.map((p: any) => ({
      productoId: p.productoId, descripcion: p.descripcion, proveedor: p.proveedor ?? null,
      precioUnitarioFob: p.precioUnitario ?? null, cantidad: p.cantidad ?? null,
    }));
  } catch { return null; }
}

export interface CostoAterrizadoItem {
  productoId: number; descripcion: string; proveedor: string | null; cantidad: number | null;
  precioUnitarioFob: number | null; extraPorUnidad: number; costoUnitarioAterrizado: number | null; subtotalAterrizado: number | null;
}
export interface CostoAterrizado { items: CostoAterrizadoItem[]; totalUnidades: number; extraPorUnidad: number; totalAterrizado: number; totalFob: number }

/** §12.3/§12.4 — "método: cálculo efectivo, sin número estimado" — prorratea flete + aduana +
 *  logística local POR UNIDAD entre todos los productos del escenario elegido (tabla de reglas de
 *  cálculo: "prorrateo del flete internacional | por unidad"). Devuelve null si falta el escenario
 *  elegido o los datos del embarque — nunca estima con un número inventado (§1.3.5 no aplica acá
 *  directamente, pero la regla general del proyecto es la misma: no inventar datos). */
export async function calcularCostoAterrizado(negocioId: number): Promise<CostoAterrizado | null> {
  const [items, embarque, productos] = await Promise.all([
    itemsFobDelEscenarioElegido(negocioId), obtenerEmbarque(negocioId), listarProductosCompra(negocioId),
  ]);
  if (!items || items.length === 0) return null;
  if (!embarque || (embarque.fleteInternacional == null && embarque.costosAduana == null && embarque.costoLogisticoLocal == null)) return null;

  const totalUnidades = items.reduce((s, it) => s + (it.cantidad || 0), 0);
  if (totalUnidades <= 0) return null;
  const extraTotal = (embarque.fleteInternacional || 0) + (embarque.costosAduana || 0) + (embarque.costoLogisticoLocal || 0);
  const extraPorUnidad = extraTotal / totalUnidades;

  const descPorProducto = new Map(productos.map(p => [p.id, p.descripcion]));
  let totalAterrizado = 0; let totalFob = 0;
  const itemsCalculados: CostoAterrizadoItem[] = items.map(it => {
    const costoUnitarioAterrizado = it.precioUnitarioFob != null ? it.precioUnitarioFob + extraPorUnidad : null;
    const subtotalAterrizado = costoUnitarioAterrizado != null && it.cantidad != null ? costoUnitarioAterrizado * it.cantidad : null;
    if (subtotalAterrizado != null) totalAterrizado += subtotalAterrizado;
    if (it.precioUnitarioFob != null && it.cantidad != null) totalFob += it.precioUnitarioFob * it.cantidad;
    return {
      productoId: it.productoId, descripcion: descPorProducto.get(it.productoId) || it.descripcion, proveedor: it.proveedor,
      cantidad: it.cantidad, precioUnitarioFob: it.precioUnitarioFob, extraPorUnidad, costoUnitarioAterrizado, subtotalAterrizado,
    };
  });

  return { items: itemsCalculados, totalUnidades, extraPorUnidad, totalAterrizado, totalFob };
}
