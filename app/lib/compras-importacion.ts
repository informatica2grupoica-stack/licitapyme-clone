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


// ── EMBARQUES (migration-160, pedido del dueño 21-oct-2026) ─────────────────────────────────────
// Un negocio puede importar en VARIOS embarques (ej. bancas en barco desde China, sillas por courier
// desde EE.UU.). Cada embarque tiene sus productos (compras_producto.embarque_id), su seguimiento
// (etapa con la fecha de cada una + datos para ubicarlo) y sus costos, que se reparten SOLO entre sus
// unidades. Reemplaza a compras_embarque (una fila por negocio), que nunca llegó a tener datos.
export const ETAPAS_IMPORTACION = ['PEDIDO', 'PRODUCCION', 'EMBARCADO', 'EN_ADUANA', 'LIBERADO', 'EN_BODEGA'] as const;
export type EtapaImportacion = typeof ETAPAS_IMPORTACION[number];
export type MedioEmbarque = 'MARITIMO' | 'AEREO' | 'TERRESTRE' | 'COURIER';

export interface DatosEmbarque {
  nombre: string;
  proveedorExtranjero: string | null; paisOrigen: string | null; medio: MedioEmbarque | null; incoterm: string | null;
  numeroSeguimiento: string | null; transportista: string | null; agenteAduana: string | null; puertoLlegada: string | null;
  fechaSalida: string | null; fechaLlegadaEstimada: string | null; numeroDin: string | null;
  fleteInternacional: number | null; costosAduana: number | null; costoLogisticoLocal: number | null;
}
export interface EmbarqueImportacion extends DatosEmbarque {
  id: number; estado: EtapaImportacion | null; fechas: Partial<Record<EtapaImportacion, string>>; productoIds: number[];
}

const num = (v: any) => v == null ? null : Number(v);

export async function listarEmbarques(negocioId: number): Promise<EmbarqueImportacion[]> {
  const [rows] = await pool.query(
    `SELECT id, nombre, estado, estado_fechas, proveedor_extranjero, pais_origen, medio, incoterm, numero_seguimiento, transportista,
            agente_aduana, puerto_llegada, DATE_FORMAT(fecha_salida, '%Y-%m-%d') AS fecha_salida,
            DATE_FORMAT(fecha_llegada_estimada, '%Y-%m-%d') AS fecha_llegada_estimada, numero_din,
            flete_internacional, costos_aduana, costo_logistico_local
       FROM compras_importacion_embarque WHERE negocio_id = ? ORDER BY id`,
    [negocioId],
  ) as any;
  const [prodRows] = await pool.query(
    `SELECT id, embarque_id FROM compras_producto
      WHERE negocio_id = ? AND importado = 1 AND embarque_id IS NOT NULL AND subestado NOT IN ('RENUNCIADO', 'NO_ADJUDICADA')`, [negocioId],
  ) as any;
  return (rows as any[]).map(r => {
    let fechas: EmbarqueImportacion['fechas'] = {};
    try { fechas = r.estado_fechas ? JSON.parse(r.estado_fechas) : {}; } catch { /* fechas ilegibles: se muestran vacías */ }
    return {
      id: r.id, nombre: r.nombre, estado: r.estado, fechas,
      proveedorExtranjero: r.proveedor_extranjero, paisOrigen: r.pais_origen, medio: r.medio, incoterm: r.incoterm,
      numeroSeguimiento: r.numero_seguimiento, transportista: r.transportista, agenteAduana: r.agente_aduana, puertoLlegada: r.puerto_llegada,
      fechaSalida: r.fecha_salida, fechaLlegadaEstimada: r.fecha_llegada_estimada, numeroDin: r.numero_din,
      fleteInternacional: num(r.flete_internacional), costosAduana: num(r.costos_aduana), costoLogisticoLocal: num(r.costo_logistico_local),
      productoIds: (prodRows as any[]).filter(p => p.embarque_id === r.id).map(p => p.id),
    };
  });
}

async function embarqueDelNegocio(negocioId: number, embarqueId: number): Promise<{ id: number; nombre: string }> {
  const [rows] = await pool.query(`SELECT id, nombre FROM compras_importacion_embarque WHERE id = ? AND negocio_id = ?`, [embarqueId, negocioId]) as any;
  const r = (rows as any[])[0];
  if (!r) throw new Error('Ese embarque no existe en este negocio.');
  return r;
}

/** Crea «Embarque N». El primero se lleva todos los productos importados que no tienen embarque. */
export async function crearEmbarque(negocioId: number, actorId: number, actorNombre: string | null): Promise<number> {
  const [[c]] = await pool.query(`SELECT COUNT(*) n FROM compras_importacion_embarque WHERE negocio_id = ?`, [negocioId]) as any;
  const ahora = ahoraChileSQL();
  const nombre = `Embarque ${Number(c.n) + 1}`;
  const [r] = await pool.query(
    `INSERT INTO compras_importacion_embarque (negocio_id, nombre, actualizado_por, actualizado_por_nombre, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    [negocioId, nombre, actorId, actorNombre, ahora, ahora],
  ) as any;
  const id = r.insertId as number;
  if (Number(c.n) === 0) {
    await pool.query(`UPDATE compras_producto SET embarque_id = ? WHERE negocio_id = ? AND importado = 1 AND embarque_id IS NULL`, [id, negocioId]);
  }
  await registrarEvento({
    tipo: 'COMPRAS_IMPORTACION_EMBARQUE', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se agregó el ${nombre.toLowerCase()} de la importación.`, metadata: { negocio_id: negocioId, embarque_id: id },
  });
  return id;
}

const fechaValida = (f: string | null | undefined) => f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null;
const montoValido = (v: number | null | undefined) => v == null || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v);

/** Datos del envío y costos de UN embarque (no tocan la etapa). */
export async function guardarEmbarque(negocioId: number, embarqueId: number, d: DatosEmbarque, actorId: number, actorNombre: string | null): Promise<void> {
  await embarqueDelNegocio(negocioId, embarqueId);
  if (!d.nombre?.trim()) throw new Error('El embarque necesita un nombre.');
  if (d.medio && !['MARITIMO', 'AEREO', 'TERRESTRE', 'COURIER'].includes(d.medio)) throw new Error('Medio de transporte inválido.');
  const t = (v: string | null | undefined, max: number) => v?.trim() ? v.trim().slice(0, max) : null;
  await pool.query(
    `UPDATE compras_importacion_embarque SET nombre = ?, proveedor_extranjero = ?, pais_origen = ?, medio = ?, incoterm = ?, numero_seguimiento = ?,
            transportista = ?, agente_aduana = ?, puerto_llegada = ?, fecha_salida = ?, fecha_llegada_estimada = ?, numero_din = ?,
            flete_internacional = ?, costos_aduana = ?, costo_logistico_local = ?, actualizado_por = ?, actualizado_por_nombre = ?, updated_at = ?
      WHERE id = ? AND negocio_id = ?`,
    [d.nombre.trim().slice(0, 120), t(d.proveedorExtranjero, 300), t(d.paisOrigen, 80), d.medio || null, t(d.incoterm, 10)?.toUpperCase() ?? null,
      t(d.numeroSeguimiento, 120), t(d.transportista, 200), t(d.agenteAduana, 200), t(d.puertoLlegada, 120),
      fechaValida(d.fechaSalida), fechaValida(d.fechaLlegadaEstimada), t(d.numeroDin, 60),
      montoValido(d.fleteInternacional), montoValido(d.costosAduana), montoValido(d.costoLogisticoLocal),
      actorId, actorNombre, ahoraChileSQL(), embarqueId, negocioId],
  );
  await registrarEvento({
    tipo: 'COMPRAS_IMPORTACION_EMBARQUE', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se actualizaron los datos del ${d.nombre.trim()}${d.numeroSeguimiento ? ` (seguimiento ${d.numeroSeguimiento})` : ''}.`,
    metadata: { negocio_id: negocioId, embarque_id: embarqueId },
  });
}

/** Borra un embarque creado por error; sus productos quedan sin embarque (siguen marcados como importados). */
export async function eliminarEmbarque(negocioId: number, embarqueId: number, actorId: number, actorNombre: string | null): Promise<void> {
  const e = await embarqueDelNegocio(negocioId, embarqueId);
  await pool.query(`UPDATE compras_producto SET embarque_id = NULL WHERE negocio_id = ? AND embarque_id = ?`, [negocioId, embarqueId]);
  await pool.query(`DELETE FROM compras_importacion_embarque WHERE id = ? AND negocio_id = ?`, [embarqueId, negocioId]);
  await registrarEvento({
    tipo: 'COMPRAS_IMPORTACION_EMBARQUE', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se quitó el ${e.nombre}; sus productos quedaron sin embarque.`, metadata: { negocio_id: negocioId, embarque_id: embarqueId },
  });
}

/** Cambia el embarque de un producto importado (null = sin embarque). */
export async function asignarProductoEmbarque(negocioId: number, productoId: number, embarqueId: number | null): Promise<void> {
  if (embarqueId != null) await embarqueDelNegocio(negocioId, embarqueId);
  const [r] = await pool.query(
    `UPDATE compras_producto SET embarque_id = ? WHERE id = ? AND negocio_id = ? AND importado = 1`, [embarqueId, productoId, negocioId],
  ) as any;
  if (!r?.affectedRows) throw new Error('Primero marca el producto como «del extranjero».');
}

const NOMBRE_ETAPA: Record<EtapaImportacion, string> = {
  PEDIDO: 'pedido al proveedor', PRODUCCION: 'en producción', EMBARCADO: 'embarcado', EN_ADUANA: 'en aduana', LIBERADO: 'liberado de aduana', EN_BODEGA: 'en bodega',
};

/** Deja el embarque en `estado` con la fecha en que llegó ahí. Si se vuelve a una etapa anterior
 *  (corrección), se borran las fechas de las etapas posteriores: no se guarda algo que no pasó. */
export async function marcarEtapaEmbarque(
  negocioId: number, embarqueId: number, estado: EtapaImportacion, fecha: string, actorId: number, actorNombre: string | null,
): Promise<void> {
  const idx = ETAPAS_IMPORTACION.indexOf(estado);
  if (idx < 0) throw new Error('Etapa desconocida.');
  if (!fechaValida(fecha)) throw new Error('Falta la fecha de la etapa.');
  const e = await embarqueDelNegocio(negocioId, embarqueId);
  const actual = (await listarEmbarques(negocioId)).find(x => x.id === embarqueId);
  const fechas: EmbarqueImportacion['fechas'] = {};
  for (const et of ETAPAS_IMPORTACION.slice(0, idx)) if (actual?.fechas[et]) fechas[et] = actual.fechas[et];
  fechas[estado] = fecha;
  await pool.query(
    `UPDATE compras_importacion_embarque SET estado = ?, estado_fechas = ?, actualizado_por = ?, actualizado_por_nombre = ?, updated_at = ? WHERE id = ?`,
    [estado, JSON.stringify(fechas), actorId, actorNombre, ahoraChileSQL(), embarqueId],
  );
  await registrarEvento({
    tipo: 'COMPRAS_IMPORTACION_ETAPA', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `${e.nombre}: quedó ${NOMBRE_ETAPA[estado]} (${fecha.split('-').reverse().join('-')}).`,
    metadata: { negocio_id: negocioId, embarque_id: embarqueId, estado, fecha },
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

export interface ProductoImportable { productoId: number; descripcion: string; cantidad: number | null; proveedor: string | null; importado: boolean; embarqueId: number | null }

/** Productos de la compra que se pueden marcar como "vienen del extranjero" (sin los renunciados ni los no adjudicados). */
export async function listarProductosImportables(negocioId: number): Promise<ProductoImportable[]> {
  const [rows] = await pool.query(
    `SELECT id, descripcion, cantidad, importado, embarque_id FROM compras_producto
      WHERE negocio_id = ? AND subestado NOT IN ('RENUNCIADO', 'NO_ADJUDICADA') ORDER BY correlativo IS NULL, correlativo, id`,
    [negocioId],
  ) as any;
  const fob = await itemsFobDelEscenarioElegido(negocioId);
  const provDe = new Map((fob || []).map(i => [i.productoId, i.proveedor]));
  return (rows as any[]).map(r => ({
    productoId: r.id, descripcion: r.descripcion, cantidad: r.cantidad == null ? null : Number(r.cantidad),
    proveedor: provDe.get(r.id) ?? null, importado: !!r.importado, embarqueId: r.importado ? r.embarque_id ?? null : null,
  }));
}

/** Marca o desmarca un producto como importado. Si se marca alguno, el negocio queda como IMPORTACION.
 *  Al marcarlo, si el negocio tiene un solo embarque, entra a ese; al desmarcarlo sale de su embarque. */
export async function marcarProductoImportado(negocioId: number, productoId: number, importado: boolean, actorId: number, actorNombre: string | null): Promise<void> {
  let embarqueId: number | null = null;
  if (importado) {
    const [emb] = await pool.query(`SELECT id FROM compras_importacion_embarque WHERE negocio_id = ?`, [negocioId]) as any;
    if ((emb as any[]).length === 1) embarqueId = (emb as any[])[0].id;
  }
  const [r] = await pool.query(`UPDATE compras_producto SET importado = ?, embarque_id = ? WHERE id = ? AND negocio_id = ?`, [importado ? 1 : 0, embarqueId, productoId, negocioId]) as any;
  if (!r?.affectedRows) throw new Error('Producto no encontrado.');
  if (importado && (await obtenerOrigenCompra(negocioId)).origen !== 'IMPORTACION') await definirOrigenCompra(negocioId, 'IMPORTACION', actorId, actorNombre);
}

export interface CostoAterrizadoItem {
  productoId: number; descripcion: string; proveedor: string | null; cantidad: number | null; embarqueId: number | null;
  precioUnitarioFob: number | null; importado: boolean; extraPorUnidad: number; costoUnitarioAterrizado: number | null; subtotalAterrizado: number | null;
}
export interface CostoAterrizado {
  items: CostoAterrizadoItem[]; totalAterrizado: number; totalFob: number;
  // Costos de embarques que no tienen productos con unidades: no se pueden repartir por producto,
  // pero sí se suman al total para que el margen no quede más alto de lo real.
  costoSinRepartir: number;
}

const costoDe = (e: Pick<DatosEmbarque, 'fleteInternacional' | 'costosAduana' | 'costoLogisticoLocal'>) =>
  (e.fleteInternacional || 0) + (e.costosAduana || 0) + (e.costoLogisticoLocal || 0);

/** §12.3/§12.4 — "método: cálculo efectivo, sin número estimado". Los costos de CADA embarque
 *  (flete + aduana + traslado) se prorratean POR UNIDAD solo entre los productos de ese embarque.
 *  Devuelve null si falta el escenario elegido o ningún embarque tiene costos — nunca estima con un
 *  número inventado (regla general del proyecto: no inventar datos). */
export async function calcularCostoAterrizado(negocioId: number): Promise<CostoAterrizado | null> {
  const [items, embarques, productos] = await Promise.all([
    itemsFobDelEscenarioElegido(negocioId), listarEmbarques(negocioId), listarProductosImportables(negocioId),
  ]);
  if (!items || items.length === 0) return null;
  if (!embarques.some(e => costoDe(e) > 0)) return null;

  const prodDe = new Map(productos.map(p => [p.productoId, p]));
  const extraPorUnidadDe = new Map<number, number>();
  let costoSinRepartir = 0;
  for (const e of embarques) {
    const unidades = items.filter(it => prodDe.get(it.productoId)?.embarqueId === e.id).reduce((s, it) => s + (it.cantidad || 0), 0);
    if (unidades > 0) extraPorUnidadDe.set(e.id, costoDe(e) / unidades);
    else costoSinRepartir += costoDe(e);
  }

  let totalAterrizado = 0; let totalFob = 0;
  const itemsCalculados: CostoAterrizadoItem[] = items.map(it => {
    const p = prodDe.get(it.productoId);
    const embarqueId = p?.embarqueId ?? null;
    const extra = embarqueId != null ? extraPorUnidadDe.get(embarqueId) ?? 0 : 0;
    const costoUnitarioAterrizado = it.precioUnitarioFob != null ? it.precioUnitarioFob + extra : null;
    const subtotalAterrizado = costoUnitarioAterrizado != null && it.cantidad != null ? costoUnitarioAterrizado * it.cantidad : null;
    if (subtotalAterrizado != null) totalAterrizado += subtotalAterrizado;
    if (it.precioUnitarioFob != null && it.cantidad != null) totalFob += it.precioUnitarioFob * it.cantidad;
    return {
      productoId: it.productoId, descripcion: p?.descripcion || it.descripcion, proveedor: it.proveedor, cantidad: it.cantidad, embarqueId,
      precioUnitarioFob: it.precioUnitarioFob, importado: !!p?.importado, extraPorUnidad: extra, costoUnitarioAterrizado, subtotalAterrizado,
    };
  });

  return { items: itemsCalculados, totalAterrizado: totalAterrizado + costoSinRepartir, totalFob, costoSinRepartir };
}
