// app/lib/validador-viabilidad.ts
// VALIDADOR POST-FASE 2 (Frente A.2 del plan estratégico) — revisor automático por código,
// SIN IA, SIN costo por uso. Corre sobre el informe v3 YA ensamblado (después de los overrides
// deterministas de viabilidad-ia.ts) y detecta inconsistencias que un experto reconoce a ojo.
//
// Cada regla nace de un error real ya visto en producción (ver el comentario de cada V-XX).
// Un FAIL no bloquea el guardado: se registra en el informe (bloque `_validador`) para que la UI
// lo muestre y quede trazado qué parte del prompt/código afinar. Es configuración viva: cada
// error nuevo se vuelve una regla más, igual que el diccionario de palabras negativas.
//
// NO reemplaza al golden set (que mide precisión contra casos conocidos): el validador detecta
// INCONSISTENCIAS INTERNAS del informe, sin necesitar saber la respuesta correcta.

export interface HallazgoValidador {
  regla: string;       // "V-01"
  severidad: 'error' | 'aviso'; // error = dato incoherente que puede llevar a mal ofertar; aviso = revisar
  mensaje: string;
}

export interface ResultadoValidador {
  ok: boolean;              // sin hallazgos de severidad 'error'
  hallazgos: HallazgoValidador[];
  fecha: string;
}

const _num = (x: any): number | null => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

// V-01 — Suma de ponderaciones de criterios debe rondar 100%. Caso real: criterios mal
// extraídos (subfactores duplicados o un criterio faltante) suman 85% o 130% sin que nadie lo note.
function v01_sumaPonderaciones(inf: any, push: (h: HallazgoValidador) => void): void {
  const crit = inf?.criterios_evaluacion;
  if (!crit || !Array.isArray(crit.criterios) || crit.criterios.length === 0) return;
  const suma = _num(crit.suma_ponderaciones_real);
  if (suma == null) return;
  if (Math.abs(suma - 100) > 3) {
    push({ regla: 'V-01', severidad: 'error', mensaje: `Suma de ponderaciones de criterios = ${suma}% (debe rondar 100%). Revisar extracción de criterios/subfactores.` });
  } else if (crit.suma_valida === false) {
    push({ regla: 'V-01', severidad: 'aviso', mensaje: `El modelo marcó suma_valida=false con suma=${suma}%.` });
  }
}

// V-02 — Coherencia score↔veredicto: score_global 0-100 debe corresponder al nivel/veredicto
// emitido (70-100 MUY_VIABLE/GANABLE · 50-69 VIABLE/PUEDE_SER... ). El código ya sincroniza esto
// en derivarV3, pero el validador re-chequea el resultado FINAL por si algo lo pisó después.
function v02_coherenciaScoreVeredicto(inf: any, score: number, push: (h: HallazgoValidador) => void): void {
  const veredictoTarjeta = String(inf?.tarjeta_decision?.veredicto || '').toUpperCase();
  if (!veredictoTarjeta) return;
  const esperado = score >= 50 ? 'GANABLE' : score >= 35 ? 'PUEDE_SER' : 'NO_VAMOS';
  if (veredictoTarjeta !== esperado) {
    push({ regla: 'V-02', severidad: 'error', mensaje: `Tarjeta de decisión = ${veredictoTarjeta} pero score=${score} implica ${esperado}.` });
  }
}

// V-03 — Colchón administrativo no debe quedar contaminado: si hay cadena LARGA (exige fiel
// cumplimiento o contrato previo a la ejecución), el colchón informado no puede ser 0 o negativo
// sin alerta. Caso real: colchón subestimado por no sumar el trámite de garantía/contrato.
function v03_colchonSinContaminar(inf: any, push: (h: HallazgoValidador) => void): void {
  const plazos = inf?.plazos;
  if (!plazos) return;
  const cadena = String(plazos.cadena || '').toLowerCase();
  const colchon = _num(plazos.colchon_dias_corridos);
  if (cadena === 'larga' && colchon != null && colchon <= 0) {
    const tieneAlerta = Array.isArray(plazos.alertas) && plazos.alertas.length > 0;
    if (!tieneAlerta) {
      push({ regla: 'V-03', severidad: 'error', mensaje: `Cadena LARGA (fiel cumplimiento/contrato) con colchón=${colchon} días y sin alerta. El colchón puede estar subestimado.` });
    }
  }
}

// V-04 — Criterio clasificado POR_TRAMOS cuya forma_aplicacion en realidad describe una FÓRMULA
// CONTINUA (proporción/división tipo "menor precio ofertado / precio evaluado × 7") en vez de una
// TABLA de tramos discretos ("X pts si..., Y pts si..."): esa es la firma de LEY_DEL_MINIMO/MAXIMO
// mal clasificada como POR_TRAMOS, no al revés.
//
// Versión anterior de esta regla exigía que rango_admisibilidad viniera con min/max — se retiró:
// medido en producción, ese campo queda vacío en el ~100% de los POR_TRAMOS aunque estén BIEN
// clasificados (criterios categóricos como "cumplimiento formal" o "procedencia del oferente" no
// tienen un rango numérico que rellenar ahí). La regla vieja disparaba en casi todos los informes
// sin señalar nada real — "gritaba lobo" y le restaba crédito al validador. Casos reales
// 2295-74-LE26 / 2446-167-LP26: "Cumplimiento requisitos formales" y "Procedencia del Oferente"
// marcados como aviso siendo tablas discretas correctas.
function v04_tramosSinExtremos(inf: any, push: (h: HallazgoValidador) => void): void {
  const criterios = inf?.criterios_evaluacion?.criterios;
  if (!Array.isArray(criterios)) return;
  const reFormula = /÷|\/\s*(?:precio|monto|valor|oferta)|precio\s+ofertad\w*\s*\/|men(?:or|os)\s+ofertad\w*\s*\/|\bfórmula\b|\bproporci[oó]n\b|\bregla\s+de\s+tres\b|×\s*\d|\*\s*\d+\s*$/i;
  for (const c of criterios) {
    if (String(c?.clase).toUpperCase() !== 'POR_TRAMOS') continue;
    const forma = String(c?.forma_aplicacion || '');
    if (reFormula.test(forma)) {
      push({ regla: 'V-04', severidad: 'aviso', mensaje: `Criterio "${c?.nombre || '(sin nombre)'}" clasificado POR_TRAMOS pero su forma_aplicacion describe una fórmula continua ("${forma.slice(0, 100)}") — probablemente sea LEY_DEL_MINIMO/MAXIMO mal clasificado.` });
    }
  }
}

// V-05 — Cadena larga si hay fiel cumplimiento: si requisitos_admisibilidad.fiel_cumplimiento.exige
// es true, plazos.cadena debe ser "larga". Inconsistencia clásica entre dos bloques del mismo informe.
function v05_cadenaLargaSiFielCumplimiento(inf: any, push: (h: HallazgoValidador) => void): void {
  const exigeFC = !!inf?.requisitos_admisibilidad?.fiel_cumplimiento?.exige;
  const cadena = String(inf?.plazos?.cadena || '').toLowerCase();
  if (exigeFC && cadena && cadena !== 'larga') {
    push({ regla: 'V-05', severidad: 'error', mensaje: `Exige garantía de fiel cumplimiento pero plazos.cadena="${cadena}" (debería ser "larga").` });
  }
}

// V-06 — Gate duro (excluido / NO_CALIFICA / DESCARTE) nunca puede convivir con veredicto
// GANABLE. El score ya se capa a 19 en el código, pero si algo lo pisa después esto lo atrapa.
function v06_gateDuroSinGanable(inf: any, push: (h: HallazgoValidador) => void): void {
  const excluido = !!inf?.exclusion?.excluido;
  const gate = String(inf?.presupuesto?.gate || '').toUpperCase();
  const gateDuro = excluido || gate === 'NO_CALIFICA';
  const veredicto = String(inf?.tarjeta_decision?.veredicto || '').toUpperCase();
  if (gateDuro && veredicto === 'GANABLE') {
    push({ regla: 'V-06', severidad: 'error', mensaje: `Gate duro activo (excluido=${excluido}, presupuesto.gate=${gate}) pero tarjeta_decision.veredicto=GANABLE.` });
  }
}

// V-07 — Presupuesto neto derivado del bruto: si ambos existen, neto debe ≈ bruto/1.19 (o
// bruto si es exento). El código ya recalcula esto (viabilidad-ia.ts), este check es la red de
// seguridad final. Caso real 2674-33-LE26: neto 10x menor por error aritmético del modelo.
function v07_presupuestoNetoCoherente(inf: any, push: (h: HallazgoValidador) => void): void {
  const pres = inf?.presupuesto;
  if (!pres) return;
  const bruto = _num(pres.bruto);
  const neto = _num(pres.neto);
  if (bruto == null || neto == null || bruto <= 0 || neto <= 0) return;
  const exento = !!pres.presupuesto_exento || !!pres.regimen_fora || pres.con_iva === false;
  const netoEsperado = exento ? bruto : bruto / 1.19;
  if (Math.abs(neto - netoEsperado) / netoEsperado > 0.05) {
    push({ regla: 'V-07', severidad: 'error', mensaje: `presupuesto.neto=${neto} no coincide con bruto/1.19 (${Math.round(netoEsperado)}, exento=${exento}). Posible error aritmético.` });
  }
}

// V-08 — Modalidad POR_LINEAS exige evidencia positiva (doctrina del proyecto). Si
// adjudicacion.como_se_adjudica=POR_LINEAS pero adjudicacion.estado no quedó DETERMINADA (es
// decir, ni el override determinista ni el corroborador de manifiesto la respaldaron), es
// sospechoso: revisar antes de costear por línea.
function v08_porLineasConEvidencia(inf: any, push: (h: HallazgoValidador) => void): void {
  const adj = inf?.adjudicacion;
  if (!adj) return;
  const como = String(adj.como_se_adjudica || '').toUpperCase();
  if (como === 'POR_LINEAS' && String(adj.estado || '').toUpperCase() !== 'DETERMINADA') {
    push({ regla: 'V-08', severidad: 'aviso', mensaje: `Adjudicación POR_LINEAS sin estado DETERMINADA — falta evidencia positiva (doctrina "por_linea exige evidencia").` });
  }
}

// V-09 — El manifiesto de productos no puede estar vacío si el informe no está excluido: sin
// ítems no hay costeo posible (rompe el Frente D). Señal de que la extracción falló.
function v09_manifiestoNoVacio(inf: any, push: (h: HallazgoValidador) => void): void {
  if (inf?.exclusion?.excluido) return;
  const items = Array.isArray(inf?.productos?.items) ? inf.productos.items
    : Array.isArray(inf?.costeo?.items) ? inf.costeo.items : [];
  if (items.length === 0) {
    push({ regla: 'V-09', severidad: 'error', mensaje: `Manifiesto de productos vacío sin exclusión — no hay base para el costeo (Frente D).` });
  }
}

// V-10 — Cada criterio de nivel superior debe traer fuente (trazabilidad, admisibilidad-crítico:
// sin fuente el usuario no puede corroborar el dato en el PDF, regla de cita del prompt).
function v10_criteriosConFuente(inf: any, push: (h: HallazgoValidador) => void): void {
  const criterios = inf?.criterios_evaluacion?.criterios;
  if (!Array.isArray(criterios) || criterios.length === 0) return;
  const sinFuente = criterios.filter((c: any) => !String(c?.fuente || '').trim()).length;
  if (sinFuente > 0) {
    push({ regla: 'V-10', severidad: 'aviso', mensaje: `${sinFuente}/${criterios.length} criterios sin fuente citada — no corroborables en el PDF.` });
  }
}

// V-11 — Estrategia POR_LINEAS (atacar unas líneas, soltar otras) contradice una adjudicación
// GLOBAL: si un solo oferente se lleva TODO el paquete, no se puede "soltar" una línea sin perder
// la oferta completa (salvo que cotizar_100_obligatorio sea explícitamente false Y quede claro que
// las bases permiten ofertar parcial bajo adjudicación global, algo raro). Caso real 1057499-37-LE26:
// adjudicacion.como_se_adjudica="GLOBAL" (default incierto, estado=REVISION_HUMANA) pero
// lineas_a_atacar.modo="POR_LINEAS" con L4 en "soltar" — dos módulos del mismo informe asumiendo
// modalidades distintas sin que nada lo señale.
function v11_estrategiaCoherenteConAdjudicacion(inf: any, push: (h: HallazgoValidador) => void): void {
  const como = String(inf?.adjudicacion?.como_se_adjudica || '').toUpperCase();
  const lin = inf?.lineas_a_atacar;
  if (como !== 'GLOBAL' || !lin || String(lin.modo || '').toUpperCase() !== 'POR_LINEAS') return;
  const lineas = Array.isArray(lin.lineas) ? lin.lineas : [];
  const hayDrop = lineas.some((l: any) => String(l?.decision || '').toLowerCase() === 'soltar');
  if (!hayDrop) return;
  const cotizar100 = !!inf?.adjudicacion?.cotizar_100_obligatorio;
  if (cotizar100) {
    push({ regla: 'V-11', severidad: 'error', mensaje: `Adjudicación GLOBAL con cotizar_100_obligatorio=true, pero la estrategia propone "soltar" líneas — bajo GLOBAL+100% eso deja la oferta inadmisible, no una jugada válida.` });
  } else {
    push({ regla: 'V-11', severidad: 'aviso', mensaje: `Adjudicación GLOBAL (un solo ganador para todo el paquete) con estrategia "atacar/soltar" por línea — verificar si las bases realmente permiten ofertar parcial bajo modalidad global antes de seguir esa estrategia.` });
  }
}

// V-12 — Manifiesto COLAPSADO en licitaciones POR_LINEAS: si la adjudicación es POR_LINEAS/POR_LOTES
// y el manifiesto trae ~1 ítem por línea (nItems/nLineas < 1.5), es la señal casi segura de que el
// modelo resumió cada línea a UN ítem (el nombre de la categoría) en vez de listar los productos
// reales de esa línea. Caso real 2295-74-LE26: Excel "Anexo N°6" con 4 hojas (líneas) y ~90
// productos reales entre todas, pero el manifiesto guardado traía solo 4 ítems (1 por línea, la
// categoría completa como "descripción" y cantidad=0) — el costeo salía vacío/inútil. La causa de
// fondo (extraerSeccionesLineaProducto no reconocía el encabezado sin numeral de artículo) ya se
// corrigió en planilla-costeo-parser.ts; esta regla es la RED DE SEGURIDAD para detectar el mismo
// patrón si vuelve a aparecer en otro formato de documento no contemplado.
function v12_manifiestoNoColapsadoPorLinea(inf: any, push: (h: HallazgoValidador) => void): void {
  const como = String(inf?.adjudicacion?.como_se_adjudica || '').toUpperCase();
  if (!como.includes('LINEA') && !como.includes('LOTE')) return;
  const items: any[] = Array.isArray(inf?.productos?.items) ? inf.productos.items
    : Array.isArray(inf?.costeo?.items) ? inf.costeo.items : [];
  if (items.length < 3) return; // muy pocos ítems para que la ratio sea significativa
  const lineas = new Set(items.map(it => it?.linea)).size || 1;
  const ratio = items.length / lineas;
  const cantidadesEnCero = items.filter(it => !Number(it?.cantidad)).length;
  if (ratio < 1.5 && cantidadesEnCero >= items.length * 0.7) {
    push({ regla: 'V-12', severidad: 'error', mensaje: `Adjudicación ${como} con ${items.length} ítems para ${lineas} línea(s) (~${ratio.toFixed(1)} ítem/línea) y ${cantidadesEnCero} sin cantidad — el manifiesto probablemente colapsó cada línea a una categoría en vez de listar los productos reales. Revisar el documento fuente del anexo económico.` });
  }
}

// V-13 — El propio informe cita "Múltiple (Por líneas/lotes)" como fuente de la adjudicación, pero
// el veredicto final quedó GLOBAL: contradicción directa entre lo que el modelo LEYÓ (adj.fuente /
// adj.evidencia) y lo que CONCLUYÓ (adj.como_se_adjudica). Caso real 2446-167-LP26: la IA citó
// textualmente "TIPO DE ADJUDICACIÓN Múltiple (Por lineas)" pág. 21 como fuente, y aun así
// como_se_adjudica terminó en GLOBAL — el override determinista lo revirtió por falta de señales
// (ya corregido con detectarFormulariosEconomicosPorArchivo/detectarTipoAdjudicacionMultiple en
// planilla-costeo-parser.ts). Esta regla es la red de seguridad si el patrón reaparece en otro
// documento con una redacción distinta que las nuevas señales tampoco reconozcan.
function v13_adjudicacionCitaMultipleNoGlobal(inf: any, push: (h: HallazgoValidador) => void): void {
  const adj = inf?.adjudicacion;
  if (!adj) return;
  const como = String(adj.como_se_adjudica || '').toUpperCase();
  if (como !== 'GLOBAL') return;
  const texto = `${adj.fuente || ''} ${adj.evidencia || ''}`;
  if (/m[uú]ltiple[\s\S]{0,30}?\bpor\s+(l.neas?|lotes?)\b/i.test(texto)) {
    push({ regla: 'V-13', severidad: 'error', mensaje: `La propia cita de adjudicación menciona "Múltiple (Por líneas/lotes)" pero como_se_adjudica quedó en GLOBAL — contradicción entre lo leído y lo concluido. Revisar el documento fuente.` });
  }
}

// Set completo de reglas V-01..V-13. Se agrega una nueva simplemente empujando una función más
// (misma firma) a este array — no requiere tocar el resto del pipeline.
type ReglaFn = (inf: any, push: (h: HallazgoValidador) => void, score: number) => void;
const REGLAS: ReglaFn[] = [
  v01_sumaPonderaciones,
  (inf, push, score) => v02_coherenciaScoreVeredicto(inf, score, push),
  v03_colchonSinContaminar,
  v04_tramosSinExtremos,
  v05_cadenaLargaSiFielCumplimiento,
  v06_gateDuroSinGanable,
  v07_presupuestoNetoCoherente,
  v08_porLineasConEvidencia,
  v09_manifiestoNoVacio,
  v10_criteriosConFuente,
  v11_estrategiaCoherenteConAdjudicacion,
  v12_manifiestoNoColapsadoPorLinea,
  v13_adjudicacionCitaMultipleNoGlobal,
];

// Corre TODAS las reglas sobre un informe v3 ya ensamblado (post-overrides deterministas).
// `score` debe ser el score_0_100 YA derivado (derivarV3) para que V-02/V-06 chequeen el
// resultado final, no el score crudo del modelo.
export function validarInformeViabilidad(inf: any, score: number): ResultadoValidador {
  const hallazgos: HallazgoValidador[] = [];
  const push = (h: HallazgoValidador) => hallazgos.push(h);
  for (const regla of REGLAS) {
    try { regla(inf, push, score); }
    catch (e) { push({ regla: 'V-??', severidad: 'aviso', mensaje: `Regla falló al ejecutar: ${String(e).slice(0, 120)}` }); }
  }
  return {
    ok: !hallazgos.some(h => h.severidad === 'error'),
    hallazgos,
    fecha: new Date().toISOString(),
  };
}
