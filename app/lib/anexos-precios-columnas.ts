// app/lib/anexos-precios-columnas.ts
// Criterio PURO de "¿esta columna de tabla pide un precio unitario?" — sin dependencias.
//
// Vive aparte de anexos-precios-ia.ts a propósito: ese módulo importa gemini.ts, que es server-only
// (arrastra node:async_hooks y rompe el build si un módulo universal lo alcanza — mismo motivo por
// el que gemini-core.ts existe). anexos-totales-seccion.ts necesita este criterio y no tiene por
// qué heredar esa restricción, así que la regla vive en un archivo sin nada más.
//
// BUG REAL (539119-76-LP26, "los anexos donde hay que poner precio no los detecta"): el ANEXO N°3
// de oferta económica titula su columna "VALOR UNITARIO OFERTADO NETO", y la versión anterior de
// esta regla exigía que la columna fuera EXACTAMENTE "precio unitario" / "valor unitario" /
// "monto unitario". Con eso, matchearPreciosConIA se quedaba sin candidatos y los precios del
// anexo quedaban en blanco aunque el costeo con esos mismos productos estuviera cargado. Ningún
// organismo se limita a esas tres palabras: "PRECIO NETO", "VALOR UNITARIO OFERTADO NETO",
// "MONTO UNITARIO (SIN IVA)" son todas la misma columna.
//
// La regla es por PALABRAS, con la exclusión que importa intacta: nada que hable de TOTAL entra —
// un total no se autocompleta nunca, porque la cantidad que usa el Word para calcularlo no tiene
// por qué ser la del costeo. Sin la palabra "unitario" se exige además un encabezado corto y
// neutro ("Precio", "Valor neto"), para no tragarse una columna rara que solo mencione "valor".
// OJO con el cuantificador: `totales?` NO es "total con es opcional", es "totale" con "s"
// opcional — nunca calza con "total". Ese error dejó la exclusión entera muerta y "Precio Unitario
// Total (Neto)" pasó como precio unitario en la auditoría del corpus (el test no lo cazó porque
// "PRECIO TOTAL" caía igual por el otro camino, al no ser un encabezado neutro). El plural va en
// grupo: `total(es)?`.
const RE_MONEDA = /\b(precio|valor|monto|costo)s?\b/;
const RE_NO_ES_UNITARIO = /\b(total(es)?|subtotal(es)?|cantidad(es)?|iva|impuestos?|descuento|plazo)\b/;
const RE_UNITARIO = /\b(unitarios?|unit\.?|c\/u|por\s+unidad)\b/;
// "bruto" NO está entre los adornos de RE_ENCABEZADO_NEUTRO: el costeo entrega precios NETOS. Una
// columna que pide el unitario CON IVA («VALOR UNITARIO CON IVA», «Precio bruto») sí es candidata,
// pero solo a través de RE_PIDE_IVA: quien la llena tiene que preguntar esPrecioUnitarioConIva y
// escribir neto × (1 + IVA), nunca el neto pelado (4844-24-LE26, Anexo N°5, 2026-11-05).
const RE_PIDE_IVA = /\b(con\s+iva|c\/\s*iva|iva\s+inclu\w*|impuestos?\s+inclu\w*|brut[oa]s?)\b/;
const RE_ENCABEZADO_NEUTRO = /^(precio|valor|monto|costo)s?(\s+(neto|netos|ofertado|ofertados|oferta|final|\$|clp))*$/;

function normalizarColumna(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[()[\]:.,;]/g, ' ')
    // "Monto unitario (SIN IVA)" es una columna de precio unitario perfectamente normal: la
    // mención al IVA ahí solo aclara que el valor va neto, no que la columna SEA el IVA (que sí
    // se excluye, ver RE_NO_ES_UNITARIO). Se saca la frase antes de las exclusiones.
    .replace(/\b(sin|mas|\+|neto\s+de)\s+iva\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function columnaDe(etiqueta: string): string | null {
  const partes = etiqueta.split(' — ');
  if (partes.length < 2) return null; // siempre viene como "<ítem> — <columna>" (patrón 1b de tablas)
  return normalizarColumna(partes[partes.length - 1]);
}

export function esCandidatoDePrecioUnitario(etiqueta: string): boolean {
  const col = columnaDe(etiqueta);
  if (col == null) return false;
  // «Valor unitario con IVA» se evalúa como «valor unitario»; el IVA lo agrega quien escribe.
  const columna = col.replace(RE_PIDE_IVA, ' ').replace(/\s+/g, ' ').trim();
  if (!RE_MONEDA.test(columna) || RE_NO_ES_UNITARIO.test(columna)) return false;
  return RE_UNITARIO.test(columna) || RE_ENCABEZADO_NEUTRO.test(columna);
}

/** Columna de precio unitario que pide el valor CON IVA: ahí va neto × (1 + IVA), no el neto. */
export function esPrecioUnitarioConIva(etiqueta: string): boolean {
  const col = columnaDe(etiqueta);
  return col != null && RE_PIDE_IVA.test(col) && esCandidatoDePrecioUnitario(etiqueta);
}
