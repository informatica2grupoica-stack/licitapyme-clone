// app/lib/costo-real-consolidado.ts
// COSTO REAL CONSOLIDADO DEL NEGOCIO (24-sep-2026) — pura, sin base de datos, para poder probarla.
//
// El módulo de Compras tenía CUATRO cifras de "gasto real" que no se hablaban entre sí: el costo
// real del costeo, los gastos registrados (flete, horas extra), los costos de importación y lo que
// dice Obuma (OC y facturas). Acá se juntan en un solo comparativo:
//
//   costo real del negocio = costeo (ítems ofertados) + gastos extra del costeo
//                          + gastos registrados + importación (flete, aduana, logística local)
//
// Obuma NO se suma: es la otra mirada del mismo gasto (lo que efectivamente se compró/facturó), así
// que se usa como CONTRASTE — si el costeo dice una cosa y las OC otra, se avisa, no se duplica.
import {
  calcularComparativo, alertasDeDesvio, UMBRAL_DESVIO_PCT,
  type Comparativo, type EntradaComparativo, type AlertaDesvio,
} from '@/app/lib/costeo-comparativo';

export interface EntradaConsolidado {
  /** Entrada del costeo YA armada (entradaComparativoDeEstado), sin gastos externos. */
  costeo: EntradaComparativo;
  /** Gastos de la tarjeta "Gastos del negocio" (solo CLP). */
  gastosRegistrados: number;
  /** Flete internacional + aduana + logística local de Importación (solo CLP). */
  importacion: number;
  /** Lo que dice Obuma. null = no hay datos o no se consultó. */
  obuma: { ocCreadas: number; comprasCruzadas: number; facturas: number } | null;
}

export type CodigoAlertaConsolidado = AlertaDesvio['codigo'] | 'obuma_difiere';
export interface AlertaConsolidado { codigo: CodigoAlertaConsolidado; mensaje: string }

export interface CostoRealConsolidado {
  comparativo: Comparativo;
  lineas: {
    costeoOfertado: number;      // Σ costo real de las filas ofertadas
    costeoGastosExtra: number;   // ítems que agregó Compras
    gastosRegistrados: number;
    importacion: number;
    total: number;
  };
  obuma: {
    gastado: number;             // OC creadas, o si no hay, compras cruzadas
    facturas: number;
    /** (Obuma − costeo) / costeo, en %. Compara contra el costo de PRODUCTOS del costeo (ofertado +
     *  gastos extra): los gastos registrados y la importación no pasan por OC de productos. null si
     *  falta alguno de los dos lados. */
    diferenciaPct: number | null;
  } | null;
  alertas: AlertaConsolidado[];
}

const pct = (n: number, d: number): number | null => (d === 0 ? null : (n / d) * 100);

/** Cuánto se pueden separar el costeo y Obuma antes de avisar. Igual al umbral de desvío: si el costo
 *  se pasa de 10% sobre lo cotizado ya es un problema, y una diferencia parecida entre lo que dice
 *  el costeo y lo que compró Obuma también lo es. */
export const UMBRAL_DIFERENCIA_OBUMA_PCT = UMBRAL_DESVIO_PCT;

export function consolidarCostoReal(e: EntradaConsolidado): CostoRealConsolidado {
  const ofertado = e.costeo.costoNetoReal ?? 0;
  const extraCosteo = e.costeo.gastosAdicionales ?? 0;
  const gastosExternos = Math.max(0, e.gastosRegistrados) + Math.max(0, e.importacion);

  const comparativo = calcularComparativo({
    ...e.costeo,
    gastosAdicionales: extraCosteo + gastosExternos,
  });

  const total = ofertado + extraCosteo + gastosExternos;
  const alertas: AlertaConsolidado[] = [...alertasDeDesvio(comparativo)];

  let obuma: CostoRealConsolidado['obuma'] = null;
  if (e.obuma) {
    const gastado = e.obuma.ocCreadas || e.obuma.comprasCruzadas || 0;
    const productosCosteo = ofertado + extraCosteo;
    const diferenciaPct = gastado > 0 && productosCosteo > 0 ? pct(gastado - productosCosteo, productosCosteo) : null;
    obuma = { gastado, facturas: e.obuma.facturas, diferenciaPct };
    // Solo con el costeo COMPLETO: a medio cargar, "Obuma compró más" es lo esperado, no un desvío.
    if (diferenciaPct != null && comparativo.realCompleto && Math.abs(diferenciaPct) > UMBRAL_DIFERENCIA_OBUMA_PCT) {
      alertas.push({
        codigo: 'obuma_difiere',
        mensaje: `El costeo y Obuma no calzan: Obuma registra ${diferenciaPct > 0 ? '+' : ''}${diferenciaPct.toFixed(1).replace('.', ',')}% respecto al costo real del costeo (umbral ${UMBRAL_DIFERENCIA_OBUMA_PCT}%). Revisa cuál está mal.`,
      });
    }
  }

  return {
    comparativo,
    lineas: { costeoOfertado: ofertado, costeoGastosExtra: extraCosteo, gastosRegistrados: Math.max(0, e.gastosRegistrados), importacion: Math.max(0, e.importacion), total },
    obuma, alertas,
  };
}

// ── Cierre con resultado final ────────────────────────────────────────────────────────────────────
export type ValidacionCierre =
  | { ok: true; incompleto: boolean }
  | { ok: false; error: string };

/** Reglas para cerrar el resultado de un negocio:
 *  · sin NINGÚN costo real cargado no hay resultado que congelar → no se puede cerrar;
 *  · con el costeo a medio cargar se puede cerrar SOLO explicando por qué (motivo ≥ 10 caracteres):
 *    la utilidad de un costeo incompleto sale inflada y ese número no debe quedar como "final"
 *    sin que alguien lo haya dicho a propósito. */
export function validarCierre(c: Comparativo, motivoIncompleto: string | null | undefined): ValidacionCierre {
  if (c.costoNetoReal == null) {
    return { ok: false, error: 'Todavía no hay ningún costo real cargado: no hay resultado que cerrar.' };
  }
  if (c.realCompleto) return { ok: true, incompleto: false };
  const motivo = (motivoIncompleto || '').trim();
  if (motivo.length < 10) {
    return {
      ok: false,
      error: `Faltan ${c.filasTotales - c.filasConCostoReal} de ${c.filasTotales} ítems con costo real. Para cerrar igual, explica el motivo (mínimo 10 caracteres).`,
    };
  }
  return { ok: true, incompleto: true };
}

// ── Resumen para el dashboard ─────────────────────────────────────────────────────────────────────
export interface ResultadoNegocio {
  negocioId: number;
  licitacionCodigo: string | null;
  comparativo: Comparativo;
  alertas: AlertaConsolidado[];
  cerrado: boolean;
}

export interface ResumenResultados {
  negociosConCosteo: number;
  negociosConReal: number;        // con al menos un costo real cargado
  negociosRealCompleto: number;   // costo real 100% cargado — los únicos que entran a los márgenes
  cerrados: number;
  /** Ponderados por venta (Σ utilidad / Σ venta), solo sobre los negocios con real COMPLETO: un real
   *  a medio cargar infla la utilidad y contaminaría el promedio. */
  margenEstimadoPct: number | null;
  margenRealPct: number | null;
  utilidadRealTotal: number;
  conUtilidadNegativa: number;
  conDesvio: number;
  /** Los que más se pasaron del costo cotizado, peor primero. */
  peoresDesvios: Array<{
    negocioId: number; licitacionCodigo: string | null;
    variacionCostoPct: number; utilidadReal: number; alertas: string[];
  }>;
}

export function resumirResultados(lista: ResultadoNegocio[], topPeores = 5): ResumenResultados {
  const conReal = lista.filter(r => r.comparativo.costoNetoReal != null);
  const completos = conReal.filter(r => r.comparativo.realCompleto);
  const venta = completos.reduce((s, r) => s + r.comparativo.ventaNeta, 0);
  const utilEst = completos.reduce((s, r) => s + r.comparativo.utilidadEstimada, 0);
  const utilReal = completos.reduce((s, r) => s + (r.comparativo.utilidadReal ?? 0), 0);
  const conAlerta = completos.filter(r => r.alertas.length > 0);
  return {
    negociosConCosteo: lista.length,
    negociosConReal: conReal.length,
    negociosRealCompleto: completos.length,
    cerrados: lista.filter(r => r.cerrado).length,
    margenEstimadoPct: pct(utilEst, venta),
    margenRealPct: pct(utilReal, venta),
    utilidadRealTotal: utilReal,
    conUtilidadNegativa: completos.filter(r => (r.comparativo.utilidadReal ?? 0) < 0).length,
    conDesvio: conAlerta.length,
    peoresDesvios: conAlerta
      .filter(r => r.comparativo.variacionCosto != null)
      .sort((a, b) => (b.comparativo.variacionCosto as number) - (a.comparativo.variacionCosto as number))
      .slice(0, topPeores)
      .map(r => ({
        negocioId: r.negocioId, licitacionCodigo: r.licitacionCodigo,
        variacionCostoPct: r.comparativo.variacionCosto as number,
        utilidadReal: r.comparativo.utilidadReal ?? 0,
        alertas: r.alertas.map(a => a.mensaje),
      })),
  };
}
