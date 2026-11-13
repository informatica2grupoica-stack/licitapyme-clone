// app/lib/compras-costo-real.ts
// Lectura de base del COSTO REAL CONSOLIDADO y CIERRE CON RESULTADO FINAL (24-sep-2026).
// La aritmética vive en costo-real-consolidado.ts (pura, con pruebas); acá solo se juntan los datos:
// costeo guardado, gastos registrados, importación y —para un solo negocio— lo que dice Obuma.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { entradaComparativoDeEstado, MARGEN_VENTA_DEFECTO, type EstadoCosteoEditor } from '@/app/lib/costeo-editor';
import {
  consolidarCostoReal, validarCierre,
  type CostoRealConsolidado, type EntradaConsolidado, type ResultadoNegocio,
} from '@/app/lib/costo-real-consolidado';

export interface ResultadoCostoReal extends CostoRealConsolidado {
  negocioId: number;
  licitacionCodigo: string | null;
  /** false = el negocio todavía no tiene costeo guardado: no hay nada que consolidar. */
  tieneCosteo: boolean;
  /** Gastos registrados en moneda distinta de CLP: quedan fuera del total (no se inventa un tipo de cambio). */
  gastosOtraMoneda: number;
}

const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);

function estadoDeFila(row: any): EstadoCosteoEditor | null {
  try {
    const datos = typeof row.datos_json === 'string' ? JSON.parse(row.datos_json) : row.datos_json;
    const grupos = (datos?.grupos || []).map((g: any) => ({ ...g, ofertamos: g.ofertamos !== false }));
    return { modalidad: row.modalidad, margenVenta: Number(datos?.margenVenta) || MARGEN_VENTA_DEFECTO, grupos };
  } catch { return null; }
}

const placeholders = (ids: number[]) => ids.map(() => '?').join(',');

const SUBESTADOS_CON_COMPRA = new Set(['COMPRADO', 'EN_BODEGA', 'LISTO_ENTREGA', 'ENTREGADO']);

/** Costo de los SERVICIOS de cada negocio (transporte de toda la entrega, migration-177): lo que cuesta el proveedor elegido en el escenario de
 *  compra. No tienen fila en el costeo, así que entran al costo real como gasto (una sola vez). `enOc` = la parte ya comprada, que Obuma sí trae. */
async function costoServiciosPorNegocio(ids: number[]): Promise<Map<number, { total: number; enOc: number }>> {
  const out = new Map<number, { total: number; enOc: number }>();
  const { hayColumnaServicio } = await import('@/app/lib/compras');
  if (!(await hayColumnaServicio())) return out;
  const [rows] = await pool.query(
    `SELECT id, negocio_id, subestado, cantidad FROM compras_producto WHERE es_servicio = 1 AND negocio_id IN (${placeholders(ids)}) AND subestado NOT IN ('RENUNCIADO', 'NO_ADJUDICADA')`, ids) as any;
  const porNegocio = new Map<number, Array<{ id: number; subestado: string; cantidad: number }>>();
  for (const r of rows as any[]) porNegocio.set(Number(r.negocio_id), [...(porNegocio.get(Number(r.negocio_id)) || []), { id: Number(r.id), subestado: String(r.subestado), cantidad: num(r.cantidad) > 0 ? num(r.cantidad) : 1 }]);
  if (porNegocio.size === 0) return out;
  const [{ obtenerEscenarioElegido }, { listarComprasRapidas }] = await Promise.all([import('@/app/lib/compras-aprobaciones'), import('@/app/lib/compras-compra-rapida')]);
  await Promise.all([...porNegocio.entries()].map(async ([negocioId, servicios]) => {
    const [esc, { compras: rapidas }] = await Promise.all([
      obtenerEscenarioElegido(negocioId).catch(() => null),
      listarComprasRapidas(negocioId).catch(() => ({ compras: [] as Array<{ productoId: number; estado: string; precioUnitario: number | null }> })),
    ]);
    let detalle: any = null;
    try { detalle = esc ? (typeof esc.detalle_json === 'string' ? JSON.parse(esc.detalle_json) : esc.detalle_json) : null; } catch { /* escenario ilegible: sin costo de servicios */ }
    const subtotalDe = new Map<number, number>((detalle?.porProducto || []).map((x: any) => [Number(x.productoId), num(x.subtotal)]));
    // Flete o adicional agregado después de aprobar (Gastos extra, 05-nov-2026): no está en el escenario elegido; cuenta su compra rápida APROBADA.
    const rapidaAprobada = new Map(rapidas.filter(c => c.estado === 'APROBADA' && c.precioUnitario != null).map(c => [c.productoId, c.precioUnitario as number]));
    let total = 0, enOc = 0;
    for (const s of servicios) {
      const v = subtotalDe.get(s.id) ?? (rapidaAprobada.has(s.id) ? rapidaAprobada.get(s.id)! * s.cantidad : 0);
      total += v;
      if (SUBESTADOS_CON_COMPRA.has(s.subestado)) enOc += v;
    }
    if (total > 0) out.set(negocioId, { total, enOc });
  }));
  return out;
}

/** Costo real consolidado de varios negocios con UNA consulta por fuente (sirve al dashboard y a un
 *  solo negocio). `obumaPorNegocio` es opcional: solo se pasa cuando se mira un negocio suelto. */
export async function costoRealDeNegocios(
  ids: number[],
  obumaPorNegocio: Map<number, EntradaConsolidado['obuma']> = new Map(),
  ocCubreTodoPorNegocio: Map<number, boolean> = new Map(),
): Promise<Map<number, ResultadoCostoReal>> {
  const out = new Map<number, ResultadoCostoReal>();
  if (ids.length === 0) return out;
  const ph = placeholders(ids);

  // Las 4 lecturas son independientes: van a la vez (antes en serie, 22-oct-2026).
  const [[negRows], [costeoRows], [gastoRows], embRows, respaldoRows]: any = await Promise.all([
    pool.query(`SELECT id, licitacion_codigo FROM negocios WHERE id IN (${ph})`, ids),
    pool.query(`SELECT negocio_id, modalidad, datos_json FROM negocio_costeo_editor WHERE negocio_id IN (${ph})`, ids),
    // `en_oc` = parte del gasto que ya tiene su OC en Obuma (migration-176); sin la columna cae a la consulta de antes.
    (pool.query(`SELECT negocio_id, moneda, SUM(monto) total, SUM(IF(oc_obuma_folio IS NULL, 0, monto)) en_oc FROM compras_gasto WHERE negocio_id IN (${ph}) GROUP BY negocio_id, moneda`, ids) as Promise<any>)
      .catch(() => pool.query(`SELECT negocio_id, moneda, SUM(monto) total, 0 en_oc FROM compras_gasto WHERE negocio_id IN (${ph}) GROUP BY negocio_id, moneda`, ids)),
    // Desde migration-160 un negocio puede tener varios embarques: se suman todos (compras_embarque quedó sin uso).
    pool.query(
      `SELECT negocio_id, SUM(COALESCE(flete_internacional,0) + COALESCE(costos_aduana,0) + COALESCE(costo_logistico_local,0)) AS total
         FROM compras_importacion_embarque WHERE negocio_id IN (${ph}) AND UPPER(moneda) = 'CLP' GROUP BY negocio_id`, ids)
      .then(([r]) => r as any[])
      .catch(() => [] as any[]),   // migration-160 pendiente en un entorno viejo: sin importación, el resto sigue
    // Respaldo cuando el costeo digital está vacío (4152-22-LE26, 13-nov-2026: «venta $0» y utilidad negativa en el cierre):
    // la venta es el neto de la OC del cliente y el costo estimado, el de la compra aprobada por el jefe de ventas.
    pool.query(
      `SELECT ca.negocio_id, ca.oc_total_neto, ca.resumen_json, ap.detalle_json AS compra_aprobada
         FROM compras_asignacion ca
         LEFT JOIN compras_aprobacion ap ON ap.negocio_id = ca.negocio_id AND ap.tipo = 'COMPRA' AND ap.estado = 'APROBADA'
        WHERE ca.negocio_id IN (${ph})`, ids)
      .then(([r]) => r as any[])
      .catch(() => [] as any[]),
  ]);
  const respaldoDe = new Map<number, { venta: number; costo: number }>();
  for (const r of respaldoRows as any[]) {
    let montoNuestro = 0, costo = 0;
    try { montoNuestro = num(JSON.parse(r.resumen_json || '{}').montoNuestro); } catch { /* resumen ilegible */ }
    try { costo = num(JSON.parse(r.compra_aprobada || '{}').costoTotal); } catch { /* aprobación ilegible */ }
    respaldoDe.set(Number(r.negocio_id), { venta: num(r.oc_total_neto) || montoNuestro, costo });
  }
  const codigoDe = new Map((negRows as any[]).map(r => [Number(r.id), r.licitacion_codigo as string]));
  const costeoDe = new Map((costeoRows as any[]).map(r => [Number(r.negocio_id), estadoDeFila(r)]));

  const gastosClp = new Map<number, number>();
  const gastosOtra = new Map<number, number>();
  const gastosEnOcClp = new Map<number, number>();
  for (const r of gastoRows as any[]) {
    const esClp = String(r.moneda || 'CLP').toUpperCase() === 'CLP';
    const m = esClp ? gastosClp : gastosOtra;
    m.set(Number(r.negocio_id), (m.get(Number(r.negocio_id)) || 0) + num(r.total));
    if (esClp) gastosEnOcClp.set(Number(r.negocio_id), (gastosEnOcClp.get(Number(r.negocio_id)) || 0) + num(r.en_oc));
  }

  const importacionDe = new Map<number, number>();
  for (const r of embRows as any[]) importacionDe.set(Number(r.negocio_id), num(r.total));
  const serviciosDe = await costoServiciosPorNegocio(ids).catch(() => new Map<number, { total: number; enOc: number }>());   // sin migration-177 el resto sigue igual

  for (const id of ids) {
    const estado = costeoDe.get(id) ?? null;
    const costeo = estado ? entradaComparativoDeEstado(estado) : {
      ventaNeta: 0, costoNetoEstimado: 0, costoNetoReal: null, filasConCostoReal: 0, filasTotales: 0, presupuestoNeto: null,
    };
    const respaldo = respaldoDe.get(id);
    if (respaldo && !(costeo.ventaNeta > 0) && respaldo.venta > 0) costeo.ventaNeta = respaldo.venta;
    if (respaldo && !(costeo.costoNetoEstimado > 0) && respaldo.costo > 0) costeo.costoNetoEstimado = respaldo.costo;
    out.set(id, {
      ...consolidarCostoReal({
        costeo, gastosRegistrados: (gastosClp.get(id) || 0) + (serviciosDe.get(id)?.total || 0),
        gastosEnOc: (gastosEnOcClp.get(id) || 0) + (serviciosDe.get(id)?.enOc || 0), importacion: importacionDe.get(id) || 0,
        obuma: obumaPorNegocio.get(id) ?? null,
        ocCubreTodo: ocCubreTodoPorNegocio.get(id) ?? false,
      }),
      negocioId: id, licitacionCodigo: codigoDe.get(id) ?? null, tieneCosteo: !!estado,
      gastosOtraMoneda: gastosOtra.get(id) || 0,
    });
  }
  return out;
}

/** Un negocio, con el contraste de Obuma (lee de base, no llama a Obuma en vivo). */
export async function costoRealDeNegocio(negocioId: number): Promise<ResultadoCostoReal> {
  const { resumenGastosCompra } = await import('@/app/lib/compras-oc-obuma');
  let obuma: EntradaConsolidado['obuma'] = null;
  try {
    const r = await resumenGastosCompra(negocioId, null);
    if (r.ocCreadas.cantidad > 0 || r.comprasCruzadas.cantidad > 0 || r.ocsPropias.length > 0) {
      // gastadoNeto ya junta Obuma (o lo emitido por Licitank) + las OC propias de Comercial MP, sin anuladas.
      obuma = { ocCreadas: r.ocCreadas.totalNeto, comprasCruzadas: r.gastadoNeto ?? 0, facturas: r.facturas.total };
    }
  } catch { /* Obuma sin datos: el consolidado se arma igual, solo sin contraste */ }
  // ¿Todos los productos (no servicios) vigentes ya tienen OC? Entonces el costo real sale de las OC, no de la cotización.
  let ocCubreTodo = false;
  try {
    const [prods] = await pool.query(
      `SELECT subestado FROM compras_producto WHERE negocio_id = ? AND COALESCE(es_servicio, 0) = 0 AND subestado NOT IN ('RENUNCIADO', 'NO_ADJUDICADA')`, [negocioId]) as any;
    ocCubreTodo = (prods as any[]).length > 0 && (prods as any[]).every(p => SUBESTADOS_CON_COMPRA.has(String(p.subestado)));
  } catch { /* sin datos: se queda con el costeo */ }
  const m = await costoRealDeNegocios([negocioId], new Map([[negocioId, obuma]]), new Map([[negocioId, ocCubreTodo]]));
  return m.get(negocioId) as ResultadoCostoReal;
}

/** Lista para el dashboard: un ResultadoNegocio por cada negocio en Compras con costeo. */
export async function resultadosParaDashboard(): Promise<ResultadoNegocio[]> {
  const [asig] = await pool.query(`SELECT negocio_id FROM compras_asignacion`) as any;
  const ids = (asig as any[]).map(r => Number(r.negocio_id));
  const [[cierres], mapa] = await Promise.all([   // a la par (antes en serie)
    ids.length
      ? pool.query(`SELECT negocio_id FROM compras_cierre_resultado WHERE negocio_id IN (${placeholders(ids)})`, ids).catch(() => [[]]) as any
      : [[]],
    costoRealDeNegocios(ids),
  ]);
  const cerrados = new Set((cierres as any[]).map((r: any) => Number(r.negocio_id)));
  return [...mapa.values()].filter(r => r.tieneCosteo).map(r => ({
    negocioId: r.negocioId, licitacionCodigo: r.licitacionCodigo, comparativo: r.comparativo,
    alertas: r.alertas, cerrado: cerrados.has(r.negocioId),
  }));
}

// ── Cierre con resultado final ────────────────────────────────────────────────────────────────────
export interface CierreResultado {
  negocioId: number; ventaNeta: number; costoEstimado: number; costoReal: number; gastosAdicionales: number;
  utilidadReal: number; margenRealPct: number | null; variacionCostoPct: number | null;
  filasConReal: number; filasTotales: number; incompleto: boolean; motivoIncompleto: string | null;
  cerradoPorNombre: string | null; cerradoAt: string;
}

export async function obtenerCierre(negocioId: number): Promise<CierreResultado | null> {
  try {
    const [rows] = await pool.query(
      `SELECT *, DATE_FORMAT(cerrado_at, '%Y-%m-%d %H:%i:%s') AS cerrado_at_txt FROM compras_cierre_resultado WHERE negocio_id = ? LIMIT 1`,
      [negocioId]) as any;
    const r = (rows as any[])[0];
    if (!r) return null;
    return {
      negocioId, ventaNeta: num(r.venta_neta), costoEstimado: num(r.costo_estimado), costoReal: num(r.costo_real),
      gastosAdicionales: num(r.gastos_adicionales), utilidadReal: num(r.utilidad_real),
      margenRealPct: r.margen_real_pct == null ? null : Number(r.margen_real_pct),
      variacionCostoPct: r.variacion_costo_pct == null ? null : Number(r.variacion_costo_pct),
      filasConReal: Number(r.filas_con_real), filasTotales: Number(r.filas_totales),
      incompleto: !!r.incompleto, motivoIncompleto: r.motivo_incompleto,
      cerradoPorNombre: r.cerrado_por_nombre, cerradoAt: r.cerrado_at_txt,
    };
  } catch { return null; } // migration-126 sin aplicar: la pantalla funciona, sin cierre
}

export type ResultadoCerrar = { ok: true; cierre: CierreResultado } | { ok: false; error: string };

export async function cerrarResultado(
  negocioId: number, motivoIncompleto: string | null, actorId: number, actorNombre: string | null,
): Promise<ResultadoCerrar> {
  const cr = await costoRealDeNegocio(negocioId);
  if (!cr.tieneCosteo) return { ok: false, error: 'Este negocio no tiene costeo guardado: no hay resultado que cerrar.' };
  const v = validarCierre(cr.comparativo, motivoIncompleto);
  if (!v.ok) return { ok: false, error: v.error };

  const c = cr.comparativo;
  const ahora = ahoraChileSQL();
  const motivo = v.incompleto ? (motivoIncompleto || '').trim().slice(0, 1000) : null;
  await pool.query(
    `INSERT INTO compras_cierre_resultado
       (negocio_id, venta_neta, costo_estimado, costo_real, gastos_adicionales, utilidad_real, margen_real_pct,
        variacion_costo_pct, filas_con_real, filas_totales, incompleto, motivo_incompleto, snapshot_json,
        cerrado_por, cerrado_por_nombre, cerrado_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE venta_neta=VALUES(venta_neta), costo_estimado=VALUES(costo_estimado),
       costo_real=VALUES(costo_real), gastos_adicionales=VALUES(gastos_adicionales), utilidad_real=VALUES(utilidad_real),
       margen_real_pct=VALUES(margen_real_pct), variacion_costo_pct=VALUES(variacion_costo_pct),
       filas_con_real=VALUES(filas_con_real), filas_totales=VALUES(filas_totales), incompleto=VALUES(incompleto),
       motivo_incompleto=VALUES(motivo_incompleto), snapshot_json=VALUES(snapshot_json),
       cerrado_por=VALUES(cerrado_por), cerrado_por_nombre=VALUES(cerrado_por_nombre), cerrado_at=VALUES(cerrado_at)`,
    [
      negocioId, c.ventaNeta, c.costoNetoEstimado, c.costoNetoReal ?? 0, c.gastosAdicionales, c.utilidadReal ?? 0,
      c.margenReal, c.variacionCosto, c.filasConCostoReal, c.filasTotales, v.incompleto ? 1 : 0, motivo,
      JSON.stringify(cr), actorId, actorNombre, ahora,
    ],
  );

  const fmt = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
  await registrarEvento({
    tipo: 'COMPRAS_RESULTADO_CERRADO', licitacionCodigo: cr.licitacionCodigo, actorId, actorNombre,
    mensaje: `Compras cerró el resultado del negocio: costo real ${fmt(c.costoNetoReal ?? 0)}, utilidad real ${fmt(c.utilidadReal ?? 0)}` +
      `${c.margenReal != null ? ` (${c.margenReal.toFixed(1).replace('.', ',')}% de margen)` : ''}${v.incompleto ? ' — cerrado con ítems sin costo real' : ''}.`,
    metadata: { negocio_id: negocioId, incompleto: v.incompleto, motivo },
  });
  const cierre = await obtenerCierre(negocioId);
  return { ok: true, cierre: cierre as CierreResultado };
}
