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

/** Costo real consolidado de varios negocios con UNA consulta por fuente (sirve al dashboard y a un
 *  solo negocio). `obumaPorNegocio` es opcional: solo se pasa cuando se mira un negocio suelto. */
export async function costoRealDeNegocios(
  ids: number[],
  obumaPorNegocio: Map<number, EntradaConsolidado['obuma']> = new Map(),
): Promise<Map<number, ResultadoCostoReal>> {
  const out = new Map<number, ResultadoCostoReal>();
  if (ids.length === 0) return out;
  const ph = placeholders(ids);

  const [negRows] = await pool.query(`SELECT id, licitacion_codigo FROM negocios WHERE id IN (${ph})`, ids) as any;
  const codigoDe = new Map((negRows as any[]).map(r => [Number(r.id), r.licitacion_codigo as string]));

  const [costeoRows] = await pool.query(
    `SELECT negocio_id, modalidad, datos_json FROM negocio_costeo_editor WHERE negocio_id IN (${ph})`, ids) as any;
  const costeoDe = new Map((costeoRows as any[]).map(r => [Number(r.negocio_id), estadoDeFila(r)]));

  const [gastoRows] = await pool.query(
    `SELECT negocio_id, moneda, SUM(monto) total FROM compras_gasto WHERE negocio_id IN (${ph}) GROUP BY negocio_id, moneda`, ids) as any;
  const gastosClp = new Map<number, number>();
  const gastosOtra = new Map<number, number>();
  for (const r of gastoRows as any[]) {
    const m = String(r.moneda || 'CLP').toUpperCase() === 'CLP' ? gastosClp : gastosOtra;
    m.set(Number(r.negocio_id), (m.get(Number(r.negocio_id)) || 0) + num(r.total));
  }

  const importacionDe = new Map<number, number>();
  try {
    const [embRows] = await pool.query(
      `SELECT negocio_id, flete_internacional, costos_aduana, costo_logistico_local, moneda
         FROM compras_embarque WHERE negocio_id IN (${ph})`, ids) as any;
    for (const r of embRows as any[]) {
      if (String(r.moneda || 'CLP').toUpperCase() !== 'CLP') continue;
      importacionDe.set(Number(r.negocio_id), num(r.flete_internacional) + num(r.costos_aduana) + num(r.costo_logistico_local));
    }
  } catch { /* migration-97 pendiente en un entorno viejo: sin importación, el resto sigue */ }

  for (const id of ids) {
    const estado = costeoDe.get(id) ?? null;
    const costeo = estado ? entradaComparativoDeEstado(estado) : {
      ventaNeta: 0, costoNetoEstimado: 0, costoNetoReal: null, filasConCostoReal: 0, filasTotales: 0, presupuestoNeto: null,
    };
    out.set(id, {
      ...consolidarCostoReal({
        costeo, gastosRegistrados: gastosClp.get(id) || 0, importacion: importacionDe.get(id) || 0,
        obuma: obumaPorNegocio.get(id) ?? null,
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
    if (r.ocCreadas.cantidad > 0 || r.comprasCruzadas.cantidad > 0) {
      obuma = { ocCreadas: r.ocCreadas.totalNeto, comprasCruzadas: r.comprasCruzadas.total, facturas: r.facturas.total };
    }
  } catch { /* Obuma sin datos: el consolidado se arma igual, solo sin contraste */ }
  const m = await costoRealDeNegocios([negocioId], new Map([[negocioId, obuma]]));
  return m.get(negocioId) as ResultadoCostoReal;
}

/** Lista para el dashboard: un ResultadoNegocio por cada negocio en Compras con costeo. */
export async function resultadosParaDashboard(): Promise<ResultadoNegocio[]> {
  const [asig] = await pool.query(`SELECT negocio_id FROM compras_asignacion`) as any;
  const ids = (asig as any[]).map(r => Number(r.negocio_id));
  const [cierres] = ids.length
    ? await pool.query(`SELECT negocio_id FROM compras_cierre_resultado WHERE negocio_id IN (${placeholders(ids)})`, ids).catch(() => [[]]) as any
    : [[]];
  const cerrados = new Set((cierres as any[]).map(r => Number(r.negocio_id)));
  const mapa = await costoRealDeNegocios(ids);
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
