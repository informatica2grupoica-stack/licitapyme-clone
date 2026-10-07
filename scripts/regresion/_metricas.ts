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
  // ── v4.0/v4.1 (solo informes v4; null en los guardados con v3) ──
  nivel: string | null;            // EXCLUIDO | BAJO | MEDIO_BAJO | MEDIO | MEDIO_ALTO | ALTO | MUY_ALTO
  accion: string | null;           // SEGUIR | CONSULTAR_CA | SOLTAR | REVISAR_SALIDA | CONFIRMAR_DATO
  filtro: string | null;           // F1..F4 si quedó EXCLUIDO por filtro duro
  caracter_presupuesto: string | null; // EXCLUYENTE | REFERENCIAL | NO_DECLARADO
  plazo_previo_dias: number | null;
  plazo_previo_al_menos: boolean | null;
  firma: string | null;            // ESCANEADA_BASTA | MANO_Y_ESCANEO | ORIGINAL_NOTARIAL | FIRMA_ELECTRONICA_AVANZADA
  garantia_seriedad: string | null;       // EXISTE | NO_EXISTE | NO_INDICADO
  garantia_fiel: string | null;
  multa_unidad: string | null;     // PORCENTAJE | UF | UTM | PESOS
  multa_pesos_dia: number | null;
}

const up = (x: any): string | null => (typeof x === 'string' && x.trim() ? x.trim().toUpperCase() : null);

export function extraerMetricas(r: any): Metricas {
  if (!r || typeof r !== 'object') {
    return { modalidad: null, adjudicacion: null, n_criterios: null, suma_valida: null, suma_real: null, n_items: null, score: null, veredicto: null, revision_humana: null, excluido: null,
      nivel: null, accion: null, filtro: null, caracter_presupuesto: null, plazo_previo_dias: null, plazo_previo_al_menos: null, firma: null, garantia_seriedad: null, garantia_fiel: null, multa_unidad: null, multa_pesos_dia: null };
  }
  const crit = r.criterios_evaluacion || {};
  const nItems = Array.isArray(r.manifiesto_productos) ? r.manifiesto_productos.length
    : Array.isArray(r.productos?.items) ? r.productos.items.length : null;
  const estadoV = up(r.veredicto?.estado_veredicto);
  const estadoA = up(r.adjudicacion?.estado);
  return {
    modalidad: (r.modalidad?.tipo ? String(r.modalidad.tipo).toLowerCase() : null),
    adjudicacion: up(r.adjudicacion?.resultado) || up(r.adjudicacion?.como_se_adjudica),
    n_criterios: Array.isArray(crit.criterios) ? crit.criterios.length : null,
    suma_valida: typeof crit.suma_valida === 'boolean' ? crit.suma_valida : null,
    suma_real: Number.isFinite(Number(crit.suma_ponderaciones_real)) ? Number(crit.suma_ponderaciones_real) : null,
    n_items: nItems,
    score: Number.isFinite(Number(r.score_0_100)) ? Number(r.score_0_100) : null,
    veredicto: up(r.tarjeta_decision?.veredicto) || up(r.veredicto?.nivel),
    revision_humana: estadoV === 'REVISION_HUMANA' || estadoA === 'REVISION_HUMANA',
    excluido: typeof r.exclusion?.excluido === 'boolean' ? r.exclusion.excluido : null,
    nivel: up(r.score?.nivel),
    accion: up(r.score?.accion_asistente),
    filtro: up(r.score?.motivo_exclusion?.filtro),
    caracter_presupuesto: up(r.presupuesto?.caracter),
    plazo_previo_dias: Number.isFinite(Number(r.plazos?.plazo_previo?.total_dias_corridos)) ? Number(r.plazos.plazo_previo.total_dias_corridos) : null,
    plazo_previo_al_menos: typeof r.plazos?.plazo_previo?.al_menos === 'boolean' ? r.plazos.plazo_previo.al_menos : null,
    firma: up(r.requisitos_admisibilidad?.firma?.estado),
    garantia_seriedad: up(r.requisitos_admisibilidad?.garantias?.seriedad?.estado),
    garantia_fiel: up(r.requisitos_admisibilidad?.garantias?.fiel_cumplimiento?.estado),
    multa_unidad: up(r.multas?.atraso?.unidad),
    multa_pesos_dia: Number.isFinite(Number(r.multas?.atraso?.calculo?.pesos_dia_estimado)) ? Number(r.multas.atraso.calculo.pesos_dia_estimado) : null,
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
  // ── v4.0/v4.1 ──
  nivel?: string;
  accion?: string;
  filtro?: string;                 // "F1".."F4"
  caracter_presupuesto?: string;
  plazo_previo_min?: number;       // días corridos (rango, porque depende de feriados y fecha base)
  plazo_previo_max?: number;
  plazo_previo_al_menos?: boolean;
  firma?: string;
  garantia_seriedad?: string;
  garantia_fiel?: string;
  multa_unidad?: string;
  multa_pesos_dia_min?: number;
  multa_pesos_dia_max?: number;
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
  const igual = (a: string | null, b: string) => a != null && b.toUpperCase().split('|').includes(a);   // "ALTO|MUY_ALTO" = cualquiera de las dos
  if (e.nivel != null) push('nivel', e.nivel, m.nivel, igual(m.nivel, e.nivel));
  if (e.accion != null) push('accion', e.accion, m.accion, igual(m.accion, e.accion));
  if (e.filtro != null) push('filtro', e.filtro, m.filtro, igual(m.filtro, e.filtro));
  if (e.caracter_presupuesto != null) push('caracter_ppto', e.caracter_presupuesto, m.caracter_presupuesto, igual(m.caracter_presupuesto, e.caracter_presupuesto));
  if (e.plazo_previo_min != null) push('plazo_previo≥', e.plazo_previo_min, m.plazo_previo_dias, m.plazo_previo_dias != null && m.plazo_previo_dias >= e.plazo_previo_min);
  if (e.plazo_previo_max != null) push('plazo_previo≤', e.plazo_previo_max, m.plazo_previo_dias, m.plazo_previo_dias != null && m.plazo_previo_dias <= e.plazo_previo_max);
  if (e.plazo_previo_al_menos != null) push('plazo_al_menos', e.plazo_previo_al_menos, m.plazo_previo_al_menos, m.plazo_previo_al_menos === e.plazo_previo_al_menos);
  if (e.firma != null) push('firma', e.firma, m.firma, igual(m.firma, e.firma));
  if (e.garantia_seriedad != null) push('garantia_seriedad', e.garantia_seriedad, m.garantia_seriedad, igual(m.garantia_seriedad, e.garantia_seriedad));
  if (e.garantia_fiel != null) push('garantia_fiel', e.garantia_fiel, m.garantia_fiel, igual(m.garantia_fiel, e.garantia_fiel));
  if (e.multa_unidad != null) push('multa_unidad', e.multa_unidad, m.multa_unidad, igual(m.multa_unidad, e.multa_unidad));
  if (e.multa_pesos_dia_min != null) push('multa_$dia≥', e.multa_pesos_dia_min, m.multa_pesos_dia, m.multa_pesos_dia != null && m.multa_pesos_dia >= e.multa_pesos_dia_min);
  if (e.multa_pesos_dia_max != null) push('multa_$dia≤', e.multa_pesos_dia_max, m.multa_pesos_dia, m.multa_pesos_dia != null && m.multa_pesos_dia <= e.multa_pesos_dia_max);
  return out;
}
