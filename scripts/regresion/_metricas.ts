// Extractor de MÉTRICAS de un informe de viabilidad v3 (el mismo objeto que devuelve
// analizarViabilidadIAV3 y que se guarda en viabilidad_licitacion.informe_ejecutivo._informe_ia_v3).
// Sirve tanto para el modo dry (informe guardado) como para --run (informe recién calculado):
// ambos tienen la MISMA forma.

export interface Metricas {
  modalidad: string | null;        // suma_alzada | por_linea (eje "cómo se cotiza", ya con override)
  adjudicacion: string | null;     // GLOBAL | POR_LINEAS | POR_LOTES
  n_criterios: number | null;      // criterios de nivel superior emitidos
  suma_valida: boolean | null;     // criterios suman ~100%
  suma_real: number | null;        // suma de ponderaciones efectivas
  n_items: number | null;          // ítems del manifiesto (lo que alimenta el costeo)
  score: number | null;            // score_0_100 derivado
  veredicto: string | null;        // GANABLE | PUEDE_SER | NO_VAMOS
  revision_humana: boolean | null; // el modelo/código pidió confirmación humana
  excluido: boolean | null;        // gate de exclusión
}

const up = (x: any): string | null => (typeof x === 'string' && x.trim() ? x.trim().toUpperCase() : null);

export function extraerMetricas(r: any): Metricas {
  if (!r || typeof r !== 'object') {
    return { modalidad: null, adjudicacion: null, n_criterios: null, suma_valida: null, suma_real: null, n_items: null, score: null, veredicto: null, revision_humana: null, excluido: null };
  }
  const crit = r.criterios_evaluacion || {};
  const nItems = Array.isArray(r.manifiesto_productos) ? r.manifiesto_productos.length
    : Array.isArray(r.productos?.items) ? r.productos.items.length : null;
  const estadoV = up(r.veredicto?.estado_veredicto);
  const estadoA = up(r.adjudicacion?.estado);
  return {
    modalidad: (r.modalidad?.tipo ? String(r.modalidad.tipo).toLowerCase() : null),
    adjudicacion: up(r.adjudicacion?.como_se_adjudica),
    n_criterios: Array.isArray(crit.criterios) ? crit.criterios.length : null,
    suma_valida: typeof crit.suma_valida === 'boolean' ? crit.suma_valida : null,
    suma_real: Number.isFinite(Number(crit.suma_ponderaciones_real)) ? Number(crit.suma_ponderaciones_real) : null,
    n_items: nItems,
    score: Number.isFinite(Number(r.score_0_100)) ? Number(r.score_0_100) : null,
    veredicto: up(r.tarjeta_decision?.veredicto) || up(r.veredicto?.nivel),
    revision_humana: estadoV === 'REVISION_HUMANA' || estadoA === 'REVISION_HUMANA',
    excluido: typeof r.exclusion?.excluido === 'boolean' ? r.exclusion.excluido : null,
  };
}

// ── Comparación contra lo ESPERADO ────────────────────────────────────────────────
// El gold set solo declara las claves que importan en cada caso; las ausentes no se evalúan.
export interface Esperado {
  modalidad?: string;              // "suma_alzada" | "por_linea"
  adjudicacion?: string;           // "GLOBAL" | "POR_LINEAS" | "POR_LOTES"
  n_criterios?: number;            // exacto
  suma_valida?: boolean;
  n_items_min?: number;            // el manifiesto debe traer AL MENOS estos
  n_items_max?: number;            // y como mucho estos (opcional)
  veredicto?: string;              // "GANABLE" | "PUEDE_SER" | "NO_VAMOS"
  score_min?: number;
  score_max?: number;
  revision_humana?: boolean;
  excluido?: boolean;
}

export interface Chequeo { metrica: string; esperado: string; obtenido: string; ok: boolean }

export function comparar(m: Metricas, e: Esperado): Chequeo[] {
  const out: Chequeo[] = [];
  const push = (metrica: string, esperado: any, obtenido: any, ok: boolean) =>
    out.push({ metrica, esperado: String(esperado), obtenido: String(obtenido ?? '—'), ok });

  if (e.modalidad != null) push('modalidad', e.modalidad, m.modalidad, m.modalidad === e.modalidad.toLowerCase());
  if (e.adjudicacion != null) push('adjudicacion', e.adjudicacion, m.adjudicacion, m.adjudicacion === e.adjudicacion.toUpperCase());
  if (e.n_criterios != null) push('n_criterios', e.n_criterios, m.n_criterios, m.n_criterios === e.n_criterios);
  if (e.suma_valida != null) push('suma_valida', e.suma_valida, m.suma_valida, m.suma_valida === e.suma_valida);
  if (e.n_items_min != null) push('n_items≥', e.n_items_min, m.n_items, m.n_items != null && m.n_items >= e.n_items_min);
  if (e.n_items_max != null) push('n_items≤', e.n_items_max, m.n_items, m.n_items != null && m.n_items <= e.n_items_max);
  if (e.veredicto != null) push('veredicto', e.veredicto, m.veredicto, m.veredicto === e.veredicto.toUpperCase());
  if (e.score_min != null) push('score≥', e.score_min, m.score, m.score != null && m.score >= e.score_min);
  if (e.score_max != null) push('score≤', e.score_max, m.score, m.score != null && m.score <= e.score_max);
  if (e.revision_humana != null) push('revision_humana', e.revision_humana, m.revision_humana, m.revision_humana === e.revision_humana);
  if (e.excluido != null) push('excluido', e.excluido, m.excluido, m.excluido === e.excluido);
  return out;
}
