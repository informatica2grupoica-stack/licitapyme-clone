// app/lib/criterios-en-anexo.ts
// "LOS CRITERIOS NO TIENEN DOMICILIO FIJO" — el equivalente, para los criterios de evaluación, de
// lo que el prompt ya dice de los ítems. Detecta, SIN IA, el caso en que el cuerpo de las bases no
// trae la tabla de criterios sino que REMITE a un anexo, y ese anexo no está en el texto que
// alcanzamos a leer.
//
// CASO REAL QUE LO ORIGINA (2981-214-LE26, 19-ago-2026): las bases de la PDI dicen dos veces
//   "LA EVALUACIÓN SE EFECTUARÁ CONFORME A LOS CRITERIOS Y PONDERACIONES SEÑALADOS EN EL ANEXO
//    «TABLA DE PONDERACIÓN Y CRITERIOS DE EVALUACIÓN DE OFERTAS» DE ESTAS BASES"
// y la tabla real (60/20/10/5/5) vive en las páginas 47-48 de un PDF de 68. El OCR se cortó en la
// 40, así que el texto NUNCA tuvo la tabla — y el modelo, en vez de decir "no la encontré", emitió
// tres criterios inventados (30/30/40) con citas a artículos que existen pero hablan de otra cosa.
//
// POR QUÉ EN CÓDIGO Y NO EN EL PROMPT: el prompt YA lo prohíbe con todas las letras ("Si tras
// barrer las bases NO logras reconstruir la tabla real con certeza → fuente_datos='incompleto' …
// NUNCA inventes una distribución plausible"). El modelo lo incumplió igual, y como los pesos
// inventados sumaban 100, pasó limpio por el validador V-01. Una regla que el modelo puede
// desobedecer no es un guardarraíl; esto sí.
//
// CONSERVADOR POR DISEÑO: solo concluye "la tabla NO está" cuando el texto remite a un anexo Y no
// aparece por ningún lado una distribución de criterios reconocible. Ante la duda, calla — es
// preferible dejar pasar un informe dudoso que borrar criterios bien extraídos.

export interface RemisionCriterios {
  /** El texto manda a buscar los criterios en un anexo/documento aparte. */
  remite: boolean;
  /** La frase exacta que lo dice — es la evidencia que se le muestra al humano. */
  frase: string | null;
  /** En el texto SÍ hay una distribución de criterios reconocible (con sus porcentajes). */
  tablaPresente: boolean;
  /** El OCR dejó constancia de que el documento quedó cortado (ver tesseract-ocr.ts). */
  textoTruncado: boolean;
  /** Páginas que faltan, tal como las declaró la nota de corte. */
  notaCorte: string | null;
}

// "conforme a los criterios y ponderaciones señalados en el ANEXO …", "de acuerdo al Anexo «Tabla
// de Ponderación»", "contenida en los anexos". Se exige que la frase hable de criterios/
// ponderación Y de un anexo/documento aparte: una mención suelta a "anexo" no basta.
const RE_REMISION = new RegExp(
  '[^.;\\n]{0,160}?'
  + '(?:criterios?\\s+(?:y\\s+ponderaciones\\s+)?de\\s+evaluaci[oó]n|ponderaci(?:ón|on)(?:es)?|tabla\\s+de\\s+ponderaci(?:ón|on))'
  + '[^.;\\n]{0,120}?'
  + '(?:se[ñn]alad[oa]s?|indicad[oa]s?|contenid[oa]s?|establecid[oa]s?|definid[oa]s?|de\\s+acuerdo|conforme)'
  + '[^.;\\n]{0,60}?'
  + '\\b(?:en\\s+(?:el|los|la|las)\\s+)?anexos?\\b'
  + '[^.;\\n]{0,120}',
  'i',
);

// La forma inversa, igual de común: primero el anexo, después los criterios ("de acuerdo al Anexo
// «Tabla de Ponderación y Criterios de Evaluación de Ofertas»").
const RE_REMISION_INVERSA = new RegExp(
  '[^.;\\n]{0,120}?\\b(?:seg[uú]n|de\\s+acuerdo\\s+a[l]?|conforme\\s+a[l]?|indicad[oa]\\s+en\\s+e[ll]?)\\s+'
  + '(?:el\\s+)?anexo\\b[^.;\\n]{0,80}?'
  + '(?:tabla\\s+de\\s+ponderaci(?:ón|on)|criterios?\\s+de\\s+evaluaci(?:ón|on))'
  + '[^.;\\n]{0,80}',
  'i',
);

// ¿Hay en el texto una DISTRIBUCIÓN de criterios reconocible? Dos formas de reconocerla, y basta
// una:
//   (a) la tabla clásica: 3+ líneas que emparejan un nombre de criterio con un porcentaje;
//   (b) las fórmulas de puntaje ponderado ("*0.60", "* 0,20"), que es como la escribe media PDI —
//       en el caso real el OCR leyó bien las fórmulas aunque destrozó la columna de porcentajes.
// La ventana ATRAVIESA saltos de línea a propósito ([\s\S], no [^\n]). Al convertir un PDF a
// texto, las columnas de una tabla caen en líneas distintas: "Plazo de entrega" queda en una y su
// "35%" tres líneas más abajo. Con la ventana acotada a una sola línea, este detector no veía NADA
// —ni siquiera en licitaciones cuyos criterios estaban perfectamente extraídos (falso positivo
// real: 813-71-LR26, con siete criterios citados por cláusula)— y habría borrado datos buenos.
// El sesgo correcto es el contrario: ante la duda, dar la tabla por presente y no tocar nada.
const RE_LINEA_CRITERIO_PCT = new RegExp(
  '(?:precio|econ[oó]mic|plazo|entrega|garant[ií]a|experiencia|t[eé]cnic|calidad|inclusi[oó]n|'
  + 'g[eé]nero|integridad|compliance|sustentab|formal|administrativ)[\\s\\S]{0,140}?(\\d{1,3})\\s*%',
  'gi',
);
// Sin exigir el paréntesis de cierre: la misma tabla mezcla las dos formas — "…*100)*0.60)" para
// los criterios con fórmula de proporción, y "Total criterio = Puntaje*0.05" para los de puntaje
// directo. Pidiendo el paréntesis se perdían justo los dos criterios de 5% y la suma daba 90.
const RE_FORMULA_PONDERADA = /\*\s*0[.,](\d{2})\b/g;

const MIN_CRITERIOS_PARA_TABLA = 3;

/** Suma de un conjunto de porcentajes, tolerando el redondeo típico de una tabla real. */
function sumaRondaCien(valores: number[]): boolean {
  if (valores.length < MIN_CRITERIOS_PARA_TABLA) return false;
  const suma = valores.reduce((a, b) => a + b, 0);
  return Math.abs(suma - 100) <= 5;
}

export function hayTablaDeCriterios(texto: string): boolean {
  const porNombre = [...texto.matchAll(RE_LINEA_CRITERIO_PCT)].map(m => Number(m[1])).filter(n => n > 0 && n <= 100);
  if (porNombre.length >= MIN_CRITERIOS_PARA_TABLA && sumaRondaCien(porNombre)) return true;
  // Las fórmulas "*0.60)" son ponderaciones escritas como factor: 0.60 → 60%.
  const porFormula = [...texto.matchAll(RE_FORMULA_PONDERADA)].map(m => Number(m[1])).filter(n => n > 0);
  if (porFormula.length >= MIN_CRITERIOS_PARA_TABLA && sumaRondaCien(porFormula)) return true;
  // Sin suma que cuadre, pero con MUCHOS pares nombre+% distintos, igual hay tabla: puede que el
  // OCR haya perdido una fila (y de eso se encarga V-01, que es justo quien mide la suma).
  return porNombre.length >= 5;
}

// Dos formas de "acá falta texto", según de dónde venga: el HUECO reponible que dejan todos los
// motores de OCR (`OCR_NO_DISPONIBLE`, ver tesseract-ocr.ts y zai-ocr.ts) y la nota antigua de
// corte, que sigue viva en los textos ya guardados en `documentos_cache` de antes del cambio.
const RE_NOTA_CORTE = /\[OCR_NO_DISPONIBLE[^\]]*\]|\[NOTA:[^\]]*?(?:FALTA EL TEXTO DE LAS PÁGINAS|OCR (?:local )?aplicado)[^\]]*\]/i;

export function analizarRemisionACriterios(textoBases: string): RemisionCriterios {
  const texto = textoBases || '';
  const m = texto.match(RE_REMISION) || texto.match(RE_REMISION_INVERSA);
  const nota = texto.match(RE_NOTA_CORTE);
  return {
    remite: !!m,
    frase: m ? m[0].replace(/\s+/g, ' ').trim().slice(0, 220) : null,
    tablaPresente: hayTablaDeCriterios(texto),
    textoTruncado: !!nota,
    notaCorte: nota ? nota[0].slice(0, 200) : null,
  };
}

/**
 * ¿Hay que desconfiar de los criterios que emitió el modelo?
 *
 * Sí cuando el texto manda a un anexo y ese anexo no está — con o sin nota de corte del OCR: el
 * anexo puede faltar porque el OCR se cortó, porque el organismo lo publicó como archivo aparte que
 * no descargamos, o porque llegó como imagen. Los tres terminan igual: el modelo no tenía la tabla
 * delante y cualquier distribución que haya emitido la construyó él.
 */
export function criteriosNoConfiables(r: RemisionCriterios): boolean {
  return r.remite && !r.tablaPresente;
}

/** Mensaje para el informe y para la pantalla. Dice qué pasó y qué hacer, sin jerga. */
export function motivoCriteriosNoConfiables(r: RemisionCriterios): string {
  const base = 'Las bases no traen la tabla de criterios en su cuerpo: remiten a un anexo'
    + (r.frase ? ` («${r.frase}»)` : '')
    + ', y ese anexo no está en el texto que se pudo leer.';
  const corte = r.textoTruncado
    ? ' El OCR además dejó el documento incompleto, así que la tabla puede estar en las páginas que faltan.'
    : '';
  return `${base}${corte} Hay que abrir el anexo y cargar los criterios a mano antes de decidir.`;
}
