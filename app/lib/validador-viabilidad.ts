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

import { esFilaNoProducto } from '@/app/lib/fila-no-producto';

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
  if (items.length === 0) return;

  // SEÑAL DIRECTA (no depende de ratio/cantidad): "unidad_medida" = "línea"/"lote" NUNCA es una
  // unidad de medida real (las bases piden metros, unidades, cajas, kg…) — es la huella de que el
  // modelo puso el NOMBRE DE LA LÍNEA como si fuera el producto, en vez de listar lo que hay debajo.
  // Caso real 2920-30-LE26 (6 líneas, ferretería): el manifiesto colapsado traía exactamente 1 ítem
  // por línea con unidad_medida="Línea" y cantidad=1 (no 0) — la ratio de abajo SÍ lo cazaba, pero
  // el filtro de "cantidad en cero" no, porque cantidad=1 es un valor "normal" para este patrón.
  const conUnidadLinea = items.filter(it => /^l[ií]neas?$|^lotes?$/i.test(String(it?.unidad_medida || '').trim()));
  if (conUnidadLinea.length >= Math.max(2, items.length * 0.5)) {
    push({ regla: 'V-12', severidad: 'error', mensaje: `${conUnidadLinea.length}/${items.length} ítems traen unidad_medida="${conUnidadLinea[0]?.unidad_medida}" — eso es el NOMBRE de la línea/lote usado como si fuera el producto (unidad de medida inválida). El manifiesto colapsó cada línea a una sola categoría en vez de listar los productos reales de debajo. El costeo saldrá con 1 fila por línea, inútil. Re-analizar (idealmente con el modelo principal, sin caer a respaldo) o revisar el documento fuente del anexo económico.` });
    return; // ya diagnosticado por la señal directa; no hace falta la heurística de ratio abajo
  }

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

// V-14 — tarjeta_decision.veredicto y veredicto.nivel deben ser EXACTAMENTE uno de los valores del
// enum del esquema (GANABLE|PUEDE_SER|NO_VAMOS y MUY_VIABLE|VIABLE|POCO_VIABLE|DESCARTE). Un valor
// mal formado (ej. "PUEDE SER" con espacio en vez de guion bajo) pasa desapercibido en la pantalla
// porque el front hace fallback silencioso (VER_TARJETA[veredicto] || VER_TARJETA.PUEDE_SER) — se ve
// bien mostrando el default, pero el dato guardado quedó corrupto para cualquier otro consumidor
// (filtros, reportes, el propio golden set). Caso real: 4116-13-LP26 / 3890-114-L126 con
// "PUEDE SER"/"NO VAMOS" (espacio) en vez de "PUEDE_SER"/"NO_VAMOS" (guion bajo).
const VEREDICTOS_VALIDOS = new Set(['GANABLE', 'PUEDE_SER', 'NO_VAMOS']);
const NIVELES_VALIDOS = new Set(['MUY_VIABLE', 'VIABLE', 'POCO_VIABLE', 'DESCARTE']);
function v14_enumsBienFormados(inf: any, push: (h: HallazgoValidador) => void): void {
  const ver = inf?.tarjeta_decision?.veredicto;
  if (ver != null && String(ver).trim() && !VEREDICTOS_VALIDOS.has(String(ver))) {
    push({ regla: 'V-14', severidad: 'error', mensaje: `tarjeta_decision.veredicto="${ver}" no es un valor válido del enum (GANABLE|PUEDE_SER|NO_VAMOS) — probablemente mal formado (espacio en vez de guion bajo).` });
  }
  const nivel = inf?.veredicto?.nivel;
  if (nivel != null && String(nivel).trim() && !NIVELES_VALIDOS.has(String(nivel))) {
    push({ regla: 'V-14', severidad: 'error', mensaje: `veredicto.nivel="${nivel}" no es un valor válido del enum (MUY_VIABLE|VIABLE|POCO_VIABLE|DESCARTE) — probablemente mal formado.` });
  }
}

// V-15 — LAS FUENTES SE CONTRADICEN sobre qué productos se cotizan. Se leen TODOS los documentos
// de la licitación y cada uno que traiga una tabla de productos queda registrado en
// `_fuentes_manifiesto`. Si dos documentos no coinciden en cuántos ítems hay, NO se elige uno en
// silencio: se avisa. Es la regla anti-invento — el sistema prefiere decir "estas fuentes no
// calzan, revísalo" antes que mostrar una lista que parece correcta y no lo es.
//
// Caso real 1414396-21-LP26 (24-ago-2026, reporte del usuario "por qué me das 34 productos si son
// 29"): el Anexo_Económico.xlsx traía los 29 reales y la Resolución Exenta 34 (5 filas coladas de
// la tabla de DISTRIBUCIÓN DE ENTREGA, que repite productos por establecimiento). El parser ahora
// elige por autoridad del documento y acierta los 29, pero la discrepancia igual se levanta: que
// dos documentos de la misma licitación no calcen es en sí mismo un dato que amerita una mirada.
function v15_fuentesManifiestoConcuerdan(inf: any, push: (h: HallazgoValidador) => void): void {
  const fuentes = inf?._fuentes_manifiesto;
  if (!fuentes || !Array.isArray(fuentes.discrepancias) || fuentes.discrepancias.length === 0) return;
  const n = Array.isArray(fuentes.candidatos) ? fuentes.candidatos.length : 0;
  push({
    regla: 'V-15',
    severidad: 'aviso',
    mensaje: `Los documentos no coinciden en el listado de productos (${n} fuentes leídas). `
      + `Se tomó "${fuentes.elegida}" por ser la más autoritativa. Diferencias: `
      + `${fuentes.discrepancias.slice(0, 4).join(' · ')}. `
      + `Contrastar con el anexo económico antes de cotizar.`,
  });
}

// V-16 — EL MANIFIESTO DE PRODUCTOS SOLO PUEDE CONTENER PRODUCTOS.
// (25-ago-2026.) Esta regla existe porque el mismo error volvió tres veces con tres disfraces
// distintos, y cada vez se arregló SOLO en el parser que lo había producido:
//   · 2345-128-LP26 — 20 de 30 "productos" eran la tabla de criterios de evaluación.
//   · 2981-225-LE26 — 16 de 16 eran los campos en blanco de los anexos ("Nombre:", "FIRMA:").
//   · 2296-45-LE26  — 4 criterios con su sigla pegada ("OFERTA ECONÓMICA(OE)"), y las
//                     "cantidades" 1,2,3,4 eran el correlativo de la tabla de criterios.
//   · 2409-49-LP26  — el renglón "PLAZO DE INSTALACION ……… DÍAS HABILES", repetido por lote.
// Arreglar cada parser por separado no impide el cuarto disfraz. Esta regla se pone DESPUÉS, en
// la salida: no le importa de qué parser vino ni qué documento lo trajo — mira el manifiesto ya
// armado y exige que cada fila sea un bien o servicio. Es el punto único por donde pasan TODAS
// las rutas que escriben un manifiesto, hoy y las que se agreguen mañana.
//
// Detecta DOS familias:
//  (a) filas que no son productos → error, y `autocorregirHallazgos` las saca solo.
//  (b) manifiesto DEGENERADO: la misma descripción repetida en la mayoría de las filas. Caso real
//      1057536-107-LE26: 58 filas, todas "S Y 14HRS" (un pedazo de frase que el OCR cortó y el
//      parser replicó). No se autocorrige —no hay dato bueno que rescatar— sino que escala a
//      revisión humana: el listado hay que sacarlo de nuevo del documento.
function v16_manifiestoSoloProductos(inf: any, push: (h: HallazgoValidador) => void): void {
  const man: any[] = Array.isArray(inf?.manifiesto_productos) ? inf.manifiesto_productos : [];
  if (!man.length) return; // el manifiesto vacío ya lo cubre V-09

  // (a) filas que no son productos
  const basura = man.filter(p => esFilaNoProducto(String(p?.descripcion || '')));
  if (basura.length) {
    push({
      regla: 'V-16',
      severidad: 'error',
      mensaje: `${basura.length}/${man.length} fila(s) del manifiesto NO son productos a cotizar `
        + `(rótulos de formulario, tramos de criterio o filas de la tabla de evaluación): `
        + `${basura.slice(0, 5).map(b => `"${String(b.descripcion).slice(0, 45)}"`).join(', ')}`
        + `${basura.length > 5 ? ` y ${basura.length - 5} más` : ''}. `
        + `Se excluyen del costeo automáticamente; si quedan pocas o ninguna fila real, revisar el documento fuente.`,
    });
  }

  // (b) manifiesto degenerado — una MISMA FILA ocupa la mayoría del manifiesto.
  // La clave incluye descripción + cantidad + línea, y eso no es un detalle: repetir la misma
  // DESCRIPCIÓN es perfectamente legítimo cuando el mismo producto se pide en varios lotes con
  // cantidades distintas. Caso real 1422051-24-LE26: "Válvulas de solenoide" en 7 de 10 líneas,
  // con 50/200/80/100/100/40/40 unidades — un listado por lote correcto, que la primera versión de
  // esta regla (que solo miraba la descripción) marcaba como degenerado. Lo que delata un error de
  // extracción es la fila IDÉNTICA en todo: misma descripción, misma cantidad, misma línea —
  // como las 58 filas "S Y 14HRS" c=3 u=HR L1 de 1057536-107-LE26.
  if (man.length >= 5) {
    const porDesc = new Map<string, number>();
    for (const p of man) {
      const desc = String(p?.descripcion || '').toLowerCase().normalize('NFD')
        .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      const k = `${desc}|${p?.cantidad ?? ''}|${p?.linea ?? ''}`;
      if (desc) porDesc.set(k, (porDesc.get(k) || 0) + 1);
    }
    let peorDesc = ''; let peorN = 0;
    for (const [k, n] of porDesc) if (n > peorN) { peorN = n; peorDesc = k; }
    if (peorN >= man.length * 0.6 && peorN >= 5) {
      push({
        regla: 'V-16',
        severidad: 'error',
        mensaje: `Manifiesto DEGENERADO: la fila "${peorDesc.split('|')[0].slice(0, 50)}" (misma cantidad y línea) se repite en `
          + `${peorN} de ${man.length} filas (${Math.round(peorN / man.length * 100)}%). `
          + `Eso no es un listado de productos sino una fila replicada por un error de extracción `
          + `— el costeo saldría con ${man.length} veces el mismo ítem. Re-extraer el listado del documento fuente.`,
      });
    }
  }
}

// ─── V-17: ¿se leyó el expediente completo? ───────────────────────────────────────────────
// (26-ago-2026, auditoría.) La regla más básica y la que faltaba: un informe construido sin las
// bases no es un informe. Se midieron 375 licitaciones cuyo análisis se hizo sobre un expediente
// incompleto —240 sin sus bases administrativas— y que igual entregaron veredicto con la misma
// cara de confianza que uno completo. Ninguna regla miraba eso porque el dato no se guardaba.
//
// Ahora `_cobertura_lectura` viaja siempre en el informe (ver lectura-documentos.ts) y esta regla
// lo convierte en una decisión visible. Es ERROR, no aviso: no hay grado de confianza posible
// sobre un documento que nadie leyó.
function v17_expedienteCompleto(inf: any, push: (h: HallazgoValidador) => void): void {
  const c = inf?._cobertura_lectura;
  if (!c || typeof c !== 'object') return;           // informes viejos: sin dato, no se opina
  const criticos: string[] = Array.isArray(c.criticosFaltantes) ? c.criticosFaltantes : [];
  if (criticos.length === 0) return;
  const pct = Math.round((Number(c.cobertura) || 0) * 100);
  push({
    regla: 'V-17',
    severidad: 'error',
    mensaje: `El análisis se hizo con el expediente INCOMPLETO: ${c.leidos}/${c.legibles} documentos legibles leídos (${pct}%). `
      + `No se pudo leer ${criticos.length} documento(s) que deciden el resultado: ${criticos.slice(0, 4).join(', ')}`
      + `${criticos.length > 4 ? ` y ${criticos.length - 4} más` : ''}. `
      + `El veredicto no puede considerarse definitivo hasta leerlos.`,
  });
}

// Set completo de reglas V-01..V-17. Se agrega una nueva simplemente empujando una función más
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
  v14_enumsBienFormados,
  v15_fuentesManifiestoConcuerdan,
  v16_manifiestoSoloProductos,
  v17_expedienteCompleto,
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

// ─── FRENTE A.2 (28-jul-2026): "un FAIL re-corre en el modelo grande o manda a revisión humana
// citando la regla violada" — hasta hoy SOLO V-12 hacía algo (re-análisis, en viabilidad-ia.ts);
// las otras 13 reglas solo se guardaban en _validador para la pantalla, sin ninguna acción. Se
// clasificaron en 3 categorías, cada una con su propio mecanismo:
//
//   (a) AUTO-CORRECCIÓN (esta función) — el dato correcto YA EXISTE en otra parte del mismo
//       informe (una fórmula fija, o evidencia que el propio informe ya citó). Se corrige el campo
//       directo, sin re-analizar ni marcar para revisión — instantáneo, sin costo de tokens.
//   (b) RE-ANÁLISIS (V-09, en viabilidad-ia.ts, mismo mecanismo que V-12 desde el 21-jul) — el dato
//       falta por completo (manifiesto vacío) y bloquea el Frente D; vale la pena el costo de un
//       segundo intento.
//   (c) REVISIÓN HUMANA (escalarARevisionHumana, abajo) — no hay forma honesta de que el código
//       adivine el dato correcto (falta una fuente, es juicio de negocio, o es genuinamente
//       incierto); se marca el informe y se cita la regla violada.

export interface CorreccionAplicada { regla: string; detalle: string }

// (a) AUTO-CORRECCIÓN. Recibe los hallazgos de la corrida ANTERIOR de validarInformeViabilidad y
// MUTA `inf` in-place para las reglas que tienen arreglo directo. El caller debe volver a correr
// validarInformeViabilidad después de esto para obtener el `_validador` final y consistente.
export function autocorregirHallazgos(inf: any, hallazgos: HallazgoValidador[], score: number): CorreccionAplicada[] {
  const aplicadas: CorreccionAplicada[] = [];
  const tiene = (regla: string) => hallazgos.some(h => h.regla === regla);

  // V-02 — veredicto no coincide con el score: se recalcula con la MISMA fórmula que usa la regla
  // para detectar el error (ya existe en derivarV3; esto es la red de seguridad final).
  if (tiene('V-02') && inf?.tarjeta_decision && typeof inf.tarjeta_decision === 'object') {
    const esperado = score >= 50 ? 'GANABLE' : score >= 35 ? 'PUEDE_SER' : 'NO_VAMOS';
    if (inf.tarjeta_decision.veredicto !== esperado) {
      inf.tarjeta_decision.veredicto = esperado;
      aplicadas.push({ regla: 'V-02', detalle: `tarjeta_decision.veredicto corregido a ${esperado} (score=${score})` });
    }
  }

  // V-16 — filas que no son productos en el manifiesto: se SACAN. El dato correcto ya se conoce
  // (las que sobreviven al filtro), así que califica para autocorrección y no para revisión humana.
  // Ojo: si el manifiesto queda VACÍO no se toca — prefiero dejarlo sucio y que V-09 lo cace, antes
  // que borrar la única lista que hay y que el costeo salga en blanco sin explicación. El adaptador
  // del Excel filtra igual al generar, y ahí sí cae a productos.items.
  if (tiene('V-16') && Array.isArray(inf?.manifiesto_productos)) {
    const antes = inf.manifiesto_productos.length;
    const limpio = inf.manifiesto_productos.filter((p: any) => !esFilaNoProducto(String(p?.descripcion || '')));
    if (limpio.length && limpio.length < antes) {
      inf.manifiesto_productos = limpio;
      aplicadas.push({ regla: 'V-16', detalle: `${antes - limpio.length} fila(s) que no eran productos removidas del manifiesto (quedan ${limpio.length})` });
    }
  }

  // V-05 — exige fiel cumplimiento pero plazos.cadena no es "larga": el dato correcto ya se sabe
  // (la propia regla lo determina), solo faltó propagarlo.
  if (tiene('V-05') && inf?.plazos && typeof inf.plazos === 'object') {
    inf.plazos.cadena = 'larga';
    aplicadas.push({ regla: 'V-05', detalle: 'plazos.cadena corregido a "larga" (exige fiel cumplimiento)' });
  }

  // V-06 — gate duro (excluido/NO_CALIFICA) con veredicto GANABLE: se fuerza a NO_VAMOS/DESCARTE.
  // El score ya se capa a 19 en otra parte del pipeline (por eso NO_VAMOS/DESCARTE es coherente);
  // esta regla es la red de seguridad final por si algo lo pisó después de esa captura.
  if (tiene('V-06') && inf?.tarjeta_decision && typeof inf.tarjeta_decision === 'object') {
    inf.tarjeta_decision.veredicto = 'NO_VAMOS';
    if (inf.veredicto && typeof inf.veredicto === 'object') inf.veredicto.nivel = 'DESCARTE';
    aplicadas.push({ regla: 'V-06', detalle: 'veredicto forzado a NO_VAMOS/DESCARTE (gate duro activo)' });
  }

  // V-07 — presupuesto.neto no coincide con bruto/1.19: se recalcula con la fórmula fija.
  if (tiene('V-07') && inf?.presupuesto && typeof inf.presupuesto === 'object') {
    const pres = inf.presupuesto;
    const bruto = _num(pres.bruto);
    if (bruto != null && bruto > 0) {
      const exento = !!pres.presupuesto_exento || !!pres.regimen_fora || pres.con_iva === false;
      const netoCorregido = Math.round(exento ? bruto : bruto / 1.19);
      pres.neto = netoCorregido;
      aplicadas.push({ regla: 'V-07', detalle: `presupuesto.neto corregido a ${netoCorregido} (bruto=${bruto}, exento=${exento})` });
    }
  }

  // V-13 — el propio informe cita "Múltiple (Por líneas/lotes)" en su evidencia de adjudicación,
  // pero como_se_adjudica quedó GLOBAL: se corrige usando la MISMA evidencia que el informe ya
  // trae citada — no hace falta releer nada, la lectura del modelo ya estaba bien, solo la
  // conclusión final se había revertido de más por el override determinista.
  if (tiene('V-13') && inf?.adjudicacion && typeof inf.adjudicacion === 'object') {
    inf.adjudicacion.como_se_adjudica = 'POR_LINEAS';
    inf.adjudicacion.estado = 'DETERMINADA';
    aplicadas.push({ regla: 'V-13', detalle: 'adjudicacion.como_se_adjudica corregido a POR_LINEAS (evidencia ya citada en el propio informe)' });
  }

  // V-14 — enum mal formado (espacio en vez de guion bajo, ej. "PUEDE SER"): se normaliza el
  // texto. Si la normalización NO cae en un valor válido del enum, se deja tal cual (no es un
  // simple typo, algo más raro pasó) — ese caso seguiría apareciendo como hallazgo sin corregir.
  if (tiene('V-14')) {
    const normalizar = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '_');
    if (inf?.tarjeta_decision && typeof inf.tarjeta_decision === 'object' && inf.tarjeta_decision.veredicto != null) {
      const norm = normalizar(String(inf.tarjeta_decision.veredicto));
      if (VEREDICTOS_VALIDOS.has(norm) && norm !== inf.tarjeta_decision.veredicto) {
        inf.tarjeta_decision.veredicto = norm;
        aplicadas.push({ regla: 'V-14', detalle: `tarjeta_decision.veredicto normalizado a "${norm}"` });
      }
    }
    if (inf?.veredicto && typeof inf.veredicto === 'object' && inf.veredicto.nivel != null) {
      const norm = normalizar(String(inf.veredicto.nivel));
      if (NIVELES_VALIDOS.has(norm) && norm !== inf.veredicto.nivel) {
        inf.veredicto.nivel = norm;
        aplicadas.push({ regla: 'V-14', detalle: `veredicto.nivel normalizado a "${norm}"` });
      }
    }
  }

  return aplicadas;
}

// (c) REVISIÓN HUMANA. Estas 5 reglas no tienen arreglo honesto por código (falta una fuente, es
// juicio de negocio, o la incertidumbre ES la respuesta correcta) — cuando disparan (cualquier
// severidad: varias de estas son 'aviso' por diseño, nunca 'error', y aun así ameritan revisión),
// se marca el informe y se cita la regla en veredicto.motivos_revision (mismo campo/convención que
// ya usa el reintento de V-12/V-09 en viabilidad-ia.ts). Devuelve las reglas que dispararon.
// V-15 entra acá (y no en auto-corrección) a propósito: cuando dos documentos de la licitación se
// contradicen sobre qué se cotiza, NO hay arreglo honesto por código — hay que abrir los papeles.
// V-16 escala a revisión humana PESE a tener autocorrección: la autocorrección solo resuelve la
// familia (a) (sacar filas que no son productos). La familia (b) —manifiesto degenerado, una misma
// fila replicada por un error de extracción— no tiene arreglo automático posible: no hay dato bueno
// que rescatar, hay que volver al documento. Y aun en el caso (a), que el manifiesto viniera
// contaminado significa que el listado se leyó de un documento equivocado: vale que alguien mire.
const REGLAS_A_REVISION_HUMANA = new Set(['V-01', 'V-03', 'V-08', 'V-10', 'V-11', 'V-15', 'V-16', 'V-17']);

export function escalarARevisionHumana(inf: any, hallazgos: HallazgoValidador[]): string[] {
  const disparadas = hallazgos.filter(h => REGLAS_A_REVISION_HUMANA.has(h.regla));
  if (disparadas.length === 0) return [];
  if (inf?.veredicto && typeof inf.veredicto === 'object') {
    inf.veredicto.estado_veredicto = 'REVISION_HUMANA';
    if (!Array.isArray(inf.veredicto.motivos_revision)) inf.veredicto.motivos_revision = [];
    for (const h of disparadas) {
      inf.veredicto.motivos_revision.push(`${h.regla}: ${h.mensaje}`);
    }
  }
  return [...new Set(disparadas.map(h => h.regla))];
}
