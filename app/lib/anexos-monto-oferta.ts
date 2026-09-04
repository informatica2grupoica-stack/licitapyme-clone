// app/lib/anexos-monto-oferta.ts
// EL ANEXO ECONÓMICO QUE PIDE UN SOLO MONTO, sin tabla de ítems.
//
// POR QUÉ (04-sep-2026, reportado por el usuario: "en esta 2585-87-LE26 no me está generando el
// anexo económico y en Excel sí"). El ANEXO Nº6 de la Municipalidad de Arica no tiene tabla de
// productos: su cuerpo entero es "NOMBRE DE LA PROPUESTA / NOMBRE DEL OFERENTE / OFERTA VALOR ___
// / Régimen de la oferta". Todo el motor de precios del Anexo Creator (anexos-precios-ia.ts) cruza
// ÍTEM ↔ PRECIO UNITARIO fila por fila, y el criterio de columna (anexos-precios-columnas.ts) exige
// una columna de precio unitario. Sin filas ni columna, ese motor se queda sin candidatos y la
// única casilla de plata del documento sale en blanco — con el costeo completo a un clic. En Excel
// el mismo negocio sí se llenaba porque ESE anexo (2446-249-LE26) sí traía tabla de ítems: nunca
// fue una diferencia entre motores, sino entre formas de anexo.
//
// La regla que impide autocompletar un TOTAL cruzando contra el costeo (ver anexos-precios-ia.ts)
// sigue intacta y es correcta: cuando hay tabla de ítems, la cantidad del Word no tiene por qué ser
// la del costeo, así que el total se calcula sumando la propia columna ya rellenada
// (calcularTotalesAlPie). ESTE módulo cubre el caso opuesto y solo ese: NO hay tabla de ítems, así
// que no hay columna que sumar y el único total posible es el del costeo. Por eso
// `hayTablaDeItems` es un guardarraíl duro: con tabla, este módulo no escribe nada.
//
// Módulo PURO (sin DB, sin red, sin IA): recibe etiquetas y un total, devuelve qué escribir.

import type { ItemCosteoPrecio } from '@/app/lib/motor-comercial';

/**
 * TOTAL NETO de la oferta según el costeo: Σ (cantidad × precio unitario de venta).
 *
 * Es la MISMA aritmética que `precioTotalNeto` de cada fila del costeo (cantidad × unitario ya
 * truncado, ver calcularFormulas en costeo-editor.ts) — se recalcula desde los ítems para que el
 * anexo y la planilla no puedan divergir por cuál de los dos campos se leyó.
 *
 * Devuelve null —nunca un número a medias— si CUALQUIER ítem no trae cantidad utilizable. Un total
 * de oferta al que le falta un ítem es peor que una casilla vacía (mismo criterio que
 * calcularTotalesPorSeccion), y suponer "cantidad 1" para el que falta sería inventar un dato:
 * exactamente el error que ya costó caro en el manifiesto.
 *
 * Vive acá y no en motor-comercial.ts (donde está el tipo) a propósito: ese módulo importa ExcelJS
 * y este se consume desde anexos-rellenar.ts, que no tiene por qué arrastrarlo. `import type` no
 * mete nada en runtime.
 */
export function totalNetoDeItemsCosteo(items: ItemCosteoPrecio[]): number | null {
  if (!items.length) return null;
  let total = 0;
  for (const it of items) {
    const cantidad = it.cantidad;
    if (cantidad == null || !Number.isFinite(cantidad) || cantidad <= 0) return null;
    total += cantidad * it.precioUnitario;
  }
  return Math.round(total);
}

/** Cómo se pide el monto: neto (sin IVA), bruto (IVA incluido), o el rótulo no lo dice. */
export type TipoMontoOferta = 'neto' | 'bruto' | 'neutro';

export interface MontoOfertaResuelto {
  etiqueta: string;
  /** Ya formateado como se escribe en el papel, con el peso DELANTE ("$43.475.890"). */
  valor: string;
  tipo: TipoMontoOferta;
}

// Un monto pedido EN PALABRAS ("Valor de la oferta en palabras") no se llena con el número — ahí va
// "cuarenta y tres millones…". Misma exclusión que ya aplica anexos-totales-seccion.ts en el pie.
const RE_EN_PALABRAS = /\ben\s+(palabras|letras)\b/i;

// Lo que descalifica una etiqueta aunque hable de plata. "unitario" es el más importante: este
// módulo escribe el TOTAL de la oferta, jamás el precio de un ítem (para eso está el motor de
// precios). El resto son casillas económicas que NO son el monto ofertado.
const RE_DESCALIFICA = /\b(unitari[oa]s?|unit|c\/u|cantidad(es)?|plazo|garantia|multa|presupuesto|disponible|referencial|estimad[oa]|maxim[oa]|descuento|anticipo|palabras|letras|uf|utm)\b/;

// Palabras de dinero y de "esto es LA oferta". Se exigen las dos familias: "VALOR" solo no basta
// (podría ser "valor agregado"), "OFERTA" sola tampoco (podría ser "fecha de la oferta").
const RE_DINERO = /\b(valor(es)?|mont[o]s?|precio|costo|suma|total(es)?)\b/;
const RE_ES_LA_OFERTA = /\b(oferta|ofertad[oa]s?|ofertar|propuesta|cotizacion|cotizad[oa]|total(es)?)\b/;

// Vocabulario CERRADO, mismo principio que PALABRAS_DE_PIE en anexos-totales-seccion.ts: la
// etiqueta entera tiene que estar hecha solo de estas palabras. Cualquier palabra ajena
// ("trabajadores", "garantía", el nombre de un producto) la descarta. Lo que este vocabulario no
// conoce, no se escribe — es la diferencia entre un detector general y uno que adivina.
const PALABRAS_ADMITIDAS = new RegExp(
  '^(' + [
    'valor(es)?', 'mont[o]s?', 'precio', 'costo', 'suma', 'total(es)?', 'subtotal(es)?',
    'oferta', 'ofertad[oa]s?', 'ofertar', 'propuesta', 'cotizacion', 'cotizad[oa]s?',
    'net[oa]s?', 'brut[oa]s?', 'iva', 'i\\.?v\\.?a\\.?', 'impuestos?', 'inclu[iíday]+os?',
    'incluido', 'incluida', 'exento', 'exenta', 'final', 'general', 'unico', 'unica', 'global',
    'de', 'la', 'el', 'los', 'las', 'del', 'con', 'sin', 'mas', 'y', 'a', 'en', 'por', 'al',
    'pesos', 'clp', 'chilenos', 'moneda', 'nacional', 'servicio', 'servicios', 'contratacion',
    'adquisicion', 'suministro', 'item', 'items', 'linea',
    '\\d+([.,]\\d+)?', '%', '\\$', '\\+', '#', 'n', 'no', 'nro', '\\*+',
  ].join('|') + ')(\\s+|$)',
  'i',
);

const LARGO_MAX_ROTULO = 70;

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[_.\-–—:;,()[\]/]+/g, ' ')
    .replace(/([%$+#])/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .replace(/\bi v a\b/gi, 'iva')
    .trim()
    .toLowerCase();
}

/**
 * El ROTULO de una etiqueta de casilla.
 *
 * Las etiquetas de celda llegan como "<fila> — <columna>" (patrón 1b de tablas, ver
 * anexos-detectar.ts). En una tabla de 2 columnas rótulo/valor, esa "columna" es basura heredada de
 * la fila de arriba — en el caso real, "OFERTA VALOR — “ADQ. DE VEHICULOS ACUATICOS…". El rótulo
 * que manda es SIEMPRE la primera parte; el resto se ignora a propósito (si se mirara la etiqueta
 * completa, el vocabulario cerrado la rechazaría por palabras que no son de la casilla).
 */
export function rotuloDeEtiqueta(etiqueta: string): string {
  return etiqueta.split(' — ')[0].trim();
}

/**
 * ¿Esta casilla pide EL MONTO TOTAL de la oferta? Devuelve además si lo pide neto o bruto.
 * null = no es una casilla de monto de oferta (la inmensa mayoría).
 */
export function tipoDeMontoDeOferta(etiqueta: string): TipoMontoOferta | null {
  const rotulo = rotuloDeEtiqueta(etiqueta);
  if (RE_EN_PALABRAS.test(rotulo)) return null;
  const limpio = normalizar(rotulo);
  if (!limpio || limpio.length > LARGO_MAX_ROTULO) return null;
  if (RE_DESCALIFICA.test(limpio)) return null;
  if (!RE_DINERO.test(limpio) || !RE_ES_LA_OFERTA.test(limpio)) return null;

  // Vocabulario cerrado: cada palabra del rótulo tiene que ser conocida.
  let resto = limpio;
  while (resto) {
    const m = resto.match(PALABRAS_ADMITIDAS);
    if (!m) return null;
    resto = resto.slice(m[0].length);
  }

  // Un rótulo que menciona el neto Y el IVA a la vez ("Total neto / IVA / Total") no dice qué va en
  // ESTA casilla: se deja al humano, igual que rotuloAmbiguo en anexos-totales-seccion.ts.
  const hablaDeNeto = /\bnet[oa]s?\b|\bsin\s+iva\b|\bexent[oa]\b/.test(limpio);
  const hablaDeBruto = /\bbrut[oa]s?\b|\bcon\s+iva\b|\biva\s+inclu/.test(limpio);
  if (hablaDeNeto && hablaDeBruto) return null;
  if (hablaDeBruto) return 'bruto';
  if (hablaDeNeto) return 'neto';
  return 'neutro';
}

/**
 * El porcentaje de IVA que DECLARA el propio documento ("IVA 19%").
 *
 * Nunca se asume 19% por defecto: si el papel no lo dice, no se escribe el monto bruto (misma regla
 * que porcentajeIva en anexos-totales-seccion.ts). Se ignoran los porcentajes que hablan de otra
 * cosa (garantías, criterios de evaluación "precio 60%") exigiendo que "iva"/"impuesto" esté cerca.
 */
export function porcentajeIvaDeclarado(textos: string[]): number | null {
  for (const t of textos) {
    const m = t.match(/\b(?:i\.?v\.?a\.?|impuestos?)\b[^%\d]{0,20}(\d{1,2}(?:[.,]\d+)?)\s*%/i)
      ?? t.match(/(\d{1,2}(?:[.,]\d+)?)\s*%[^%\d]{0,20}\b(?:i\.?v\.?a\.?|impuestos?)\b/i);
    if (m) {
      const pct = Number(m[1].replace(',', '.'));
      if (Number.isFinite(pct) && pct > 0 && pct < 100) return pct;
    }
  }
  return null;
}

// CON el signo peso adelante, pedido explícito del usuario mirando la pantalla (04-sep-2026): en el
// papel el monto de una oferta se escribe "$43.475.890", no el número pelado. Va acá y no en quien
// consume el valor para que el .docx, la vista previa y `totalesEscritos` muestren exactamente lo
// mismo. `montoDesdeTexto` (auditor-verificacion-total.ts) descarta el símbolo antes de comparar,
// así que el guardarraíl de total sigue leyendo el número igual que antes.
//
// Distinto de las casillas de precio UNITARIO y de los totales al pie, que se siguen escribiendo sin
// símbolo: ahí el rótulo de la columna ya dice la moneda y muchas plantillas traen su propio "$"
// impreso en la celda — anteponerlo duplicaría el signo. Acá la casilla viene desnuda (verificado en
// el .docx real de 2585-87-LE26: cero ocurrencias de "$" en todo el documento).
const fmtCL = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

/**
 * Resuelve la(s) casilla(s) de monto único de la oferta.
 *
 * Reglas, todas por el mismo motivo (es una oferta económica: un número de más es peor que una
 * casilla vacía):
 *   · Con tabla de ítems en el documento no se escribe NADA — ese caso lo maneja el motor de
 *     precios unitarios + calcularTotalesAlPie, y meter acá el total del costeo lo contradiría.
 *   · Sin total de costeo (o costeo incompleto, ver totalNetoDeItemsCosteo) tampoco se escribe.
 *   · Un rótulo BRUTO exige que el documento declare su porcentaje de IVA; si no lo declara, esa
 *     casilla queda pendiente en vez de asumir 19%.
 *   · Dos casillas del MISMO tipo = ambigüedad real (¿el total de qué línea?): no se escribe
 *     ninguna. Neto + bruto juntos sí es un par legítimo y se llenan los dos.
 *   · Un rótulo NEUTRO ("OFERTA VALOR") se llena con el NETO: es lo que entrega el costeo y el
 *     mismo criterio que ya usa el pie de tabla para un "TOTAL" a secas.
 */
export function resolverMontoUnicoOferta(
  etiquetas: string[],
  totalNetoCosteo: number | null,
  opciones: { hayTablaDeItems: boolean; porcentajeIva: number | null },
): MontoOfertaResuelto[] {
  if (opciones.hayTablaDeItems) return [];
  if (totalNetoCosteo == null || !Number.isFinite(totalNetoCosteo) || totalNetoCosteo <= 0) return [];

  const candidatos: { etiqueta: string; tipo: TipoMontoOferta }[] = [];
  for (const etiqueta of etiquetas) {
    const tipo = tipoDeMontoDeOferta(etiqueta);
    if (tipo) candidatos.push({ etiqueta, tipo });
  }
  if (!candidatos.length) return [];

  // "neutro" y "neto" piden el mismo número: si conviven, son dos casillas para el mismo dato y no
  // hay forma de saber cuál es cuál — se aplica la misma abstención que a dos del mismo tipo.
  const porTipo = new Map<TipoMontoOferta, { etiqueta: string; tipo: TipoMontoOferta }[]>();
  for (const c of candidatos) {
    const clave: TipoMontoOferta = c.tipo === 'neutro' ? 'neto' : c.tipo;
    porTipo.set(clave, [...(porTipo.get(clave) ?? []), c]);
  }

  const neto = Math.round(totalNetoCosteo);
  const out: MontoOfertaResuelto[] = [];
  for (const [clave, lista] of porTipo) {
    if (lista.length !== 1) continue; // ambiguo: dos casillas piden el mismo monto
    const c = lista[0];
    if (clave === 'bruto') {
      const pct = opciones.porcentajeIva;
      if (pct == null) continue; // el documento no declara la tasa: no se inventa
      // neto + IVA redondeado aparte, no round(neto × 1,19): así el papel cuadra a la vista si el
      // mismo formulario muestra las dos cifras. Mismo criterio que calcularTotalesAlPie.
      out.push({ etiqueta: c.etiqueta, valor: fmtCL(neto + Math.round(neto * pct / 100)), tipo: 'bruto' });
    } else {
      out.push({ etiqueta: c.etiqueta, valor: fmtCL(neto), tipo: c.tipo });
    }
  }
  return out;
}
