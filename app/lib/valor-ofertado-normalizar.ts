// app/lib/valor-ofertado-normalizar.ts
// Limpia el valor ofertado ANTES DE IMPRIMIRLO en un documento que se presenta al organismo.
//
// POR QUÉ (26-ago-2026, caso real 611669-17-LE26 "LUMINANCÍMETROS"): la comparación contra la
// ficha del proveedor guarda el valor tal como viene, y las fichas suelen ser traducciones del
// inglés. Lo que quedó en la base:
//
//   exigido  "Norma DIN 5032-Parte 7, Clase B"   ofertado  "DIN 5032-Clase 7 Obediente B"
//   exigido  "0,01 a 99.990 cd/m2"               ofertado  "0.001 to 999,900 cd/m2"
//
// Los veredictos estaban bien. El problema es que ESE texto es el que se imprime en nuestra ficha
// técnica y en el Formulario N°3 que evalúa el organismo: "Obediente B" (de "Class B compliant")
// se lee mal y confunde al evaluador, y "999,900" en formato inglés se lee como novecientos coma
// nueve en Chile — un orden de magnitud de diferencia en un número que se está evaluando.
//
// DÓNDE SE APLICA Y POR QUÉ: solo al RENDERIZAR documentos, nunca al guardar. El valor crudo queda
// intacto en `valor_ofertado_texto` como evidencia de lo que decía la ficha — si alguien discute
// un veredicto, el original está. Así no hace falta migración y no se pierde nada.
//
// REGLAS DELIBERADAMENTE CONSERVADORAS: solo se toca lo que es inequívoco (formato numérico
// anglosajón, un puñado de traducciones técnicas erradas de una sola lectura posible). Ante
// cualquier duda se deja el texto como está: un valor mal "corregido" en un documento que se
// presenta es peor que uno feo pero fiel.

/**
 * Traducciones automáticas que salen mal en fichas técnicas y tienen UNA sola lectura correcta.
 * La lista es corta a propósito: cada entrada hay que poder defenderla ante el organismo.
 */
const TRADUCCIONES_ERRADAS: Array<[RegExp, string]> = [
  // "Class B compliant" → la IA traduce "compliant" como "obediente" (caso real LS-150).
  [/\bobediente\b/gi, 'conforme'],
  // "compliant/compliance" sin traducir.
  [/\bcompliant\b/gi, 'conforme'],
  // Conectores de rango en inglés, entre números.
  [/(\d)\s+to\s+(\d)/gi, '$1 a $2'],
  // Unidades y palabras sueltas que quedan en inglés dentro de un texto en castellano.
  [/\bincluded\b/gi, 'incluido'],
  [/\bor\s+(?=[a-záéíóúñ])/gi, 'o '],
];

/**
 * ¿El número viene en formato anglosajón (coma para miles, punto para decimales)?
 *
 * Solo se afirma cuando hay evidencia CLARA, porque "1.234" es mil doscientos treinta y cuatro en
 * Chile y uno coma dos tres cuatro en inglés — sin más contexto es ambiguo y NO se toca:
 *   · coma seguida de exactamente 3 dígitos ("999,900") → separador de miles inglés, y
 *   · en castellano esa coma sería decimal, cosa que no se escribe con 3 decimales exactos.
 */
/**
 * UNA SOLA PASADA sobre cada número del texto.
 *
 * Antes eran dos reglas encadenadas (miles primero, decimales después) y **se pisaban**: la de
 * miles dejaba "999,900" → "999.900" y la de decimales lo devolvía a "999,900", así que el texto
 * salía igual que entró. Se ve obvio leyéndolo; no se ve corriéndolo, porque el resultado final
 * coincidía con la entrada. Lo agarró el test del caso real.
 *
 * Con una pasada, cada número se decide UNA vez y no hay forma de que una regla deshaga a la otra.
 */
const RE_NUMERO = /\d[\d.,]*\d|\d/g;

/** "999,900" → "999.900" · "1,234.56" → "1.234,56" */
export function normalizarNumeroIngles(n: string): string {
  const [entera, decimal] = n.split('.');
  const enteraCL = entera.replace(/,/g, '.');
  return decimal ? `${enteraCL},${decimal}` : enteraCL;
}

/** Separador de miles anglosajón: coma seguida de EXACTAMENTE 3 dígitos, una o más veces. */
const RE_ES_MILES_INGLES = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
/** Decimal anglosajón suelto y corto: "0.001". Parte entera de hasta 3 dígitos, sin comas. */
const RE_ES_DECIMAL_INGLES = /^\d{1,3}\.\d{1,6}$/;

/** Palabras donde un punto NO es un decimal (normas, versiones, modelos). */
const RE_CONTEXTO_TECNICO = /\b(din|iso|iec|nch|astm|usb|hdmi|rs|ip|v\.?\d|clase|class|parte|part|norma|modelo|model|serie)\b/i;

/**
 * Deja el valor ofertado listo para imprimir en un documento formal.
 *
 * @param texto el valor tal como quedó guardado tras comparar contra la ficha
 * @returns el texto limpio; si no hay nada que corregir, el mismo texto
 */
export function normalizarValorParaDocumento(texto: string | null | undefined): string {
  let t = String(texto ?? '').trim();
  if (!t) return '';

  for (const [re, reemplazo] of TRADUCCIONES_ERRADAS) t = t.replace(re, reemplazo);

  // El decimal suelto solo se toca si el texto NO habla de una norma/versión/modelo, donde el
  // punto es parte del nombre y cambiarlo sería alterar el dato ("DIN 5032-Parte 7", "USB 2.0").
  // El separador de miles sí se corrige siempre: "999,900" leído a la chilena es novecientos coma
  // nueve, un orden de magnitud de diferencia en un número que el organismo está evaluando.
  const esTecnico = RE_CONTEXTO_TECNICO.test(t);
  t = t.replace(RE_NUMERO, n => {
    if (RE_ES_MILES_INGLES.test(n)) return normalizarNumeroIngles(n);
    if (!esTecnico && RE_ES_DECIMAL_INGLES.test(n)) return n.replace('.', ',');
    return n;                                   // ante la duda, intacto
  });

  return t.replace(/\s+/g, ' ').trim();
}

/** ¿La normalización cambió algo? Sirve para mostrar el original al lado, si hace falta. */
export function huboCambios(original: string | null | undefined): boolean {
  const o = String(original ?? '').trim();
  return !!o && normalizarValorParaDocumento(o) !== o;
}
