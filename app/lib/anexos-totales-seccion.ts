// app/lib/anexos-totales-seccion.ts
// Calcula, a partir de lo YA resuelto en las tablas de ítems de un anexo (cantidad × precio
// unitario por fila, el precio resuelto por el costeo — ver anexos-precios-ia.ts), el total de
// cada sección — y lo cruza contra una "tabla resumen" que pide exactamente ese total por
// sección (patrón real, 1738-18-LE26: "LÍNEA | MONTO TOTAL OFERTADO | PLAZO..."). General por
// diseño: no conoce la palabra "LÍNEA" — cruza por texto EXACTO entre el título que precede a
// cada tabla de ítems (ver tituloDeTabla) y la etiqueta de fila de la tabla resumen, sea cual
// sea el rótulo real que use la licitación ("LOTE N", "ÍTEM N", lo que sea).
//
// Nunca escribe un total PARCIAL: si algún ítem de la sección quedó sin precio resuelto, la
// sección completa se deja pendiente (ver TotalSeccion.completo) — un total que parece completo
// pero le falta un ítem es peor que uno visiblemente vacío.
import type { TablaCruda, CeldaTablaCruda } from '@/app/lib/anexos-detectar';
import type { Parrafo } from '@/app/lib/anexos-docx';
import { esCandidatoDePrecioUnitario } from '@/app/lib/anexos-precios-columnas';

export interface TituloCercano { texto: string; indice: number }

// Encabezados como "LÍNEA 1: LETRERO DE OBRAS" NUNCA llegan a `descartadosComoTitulo` (el
// clasificador de títulos de resolverCandidatosCelda): un párrafo corto seguido de uno vacío que
// precede directamente a una tabla se descarta ANTES, por `blancoPrecedeTabla` en
// anexos-detectar.ts (a propósito — evita ofrecerlo como si fuera un campo a rellenar). Por eso
// se buscan acá, directo sobre los párrafos del documento: cualquier párrafo con texto, corto,
// que NO es parte de ninguna tabla, y cuyo siguiente párrafo es vacío o ya el arranque de una
// tabla — la misma forma que un encabezado de sección real, sea cual sea su rótulo.
const LARGO_MAX_ENCABEZADO = 100;

export function encabezadosLibres(parrafos: Parrafo[], indicesEnTablas: Set<number>): TituloCercano[] {
  const out: TituloCercano[] = [];
  parrafos.forEach((p, i) => {
    if (p.vacio || !p.texto || p.texto.length > LARGO_MAX_ENCABEZADO || indicesEnTablas.has(p.indice)) return;
    const siguiente = parrafos[i + 1];
    if (siguiente && !siguiente.vacio && !indicesEnTablas.has(siguiente.indice)) return; // sigue texto normal, no es un heading
    out.push({ texto: p.texto, indice: p.indice });
  });
  return out;
}

// El título de una tabla de ítems ("LÍNEA 1: LETRERO DE OBRAS") es un párrafo SUELTO, fuera de la
// tabla — nunca su fila de encabezado. Es el heading más cercano HACIA ATRÁS, dentro de una
// distancia corta (visto en el documento real: 1-2 párrafos antes de la fila de encabezado, a
// veces con una línea en blanco entre medio) — más lejos que eso ya pertenece a otra sección.
const DISTANCIA_MAX_TITULO = 6;

export function tituloDeTabla(indicePrimero: number | null, titulos: TituloCercano[]): TituloCercano | null {
  if (indicePrimero == null) return null;
  let mejor: TituloCercano | null = null;
  for (const t of titulos) {
    if (t.indice >= indicePrimero || indicePrimero - t.indice > DISTANCIA_MAX_TITULO) continue;
    if (!mejor || t.indice > mejor.indice) mejor = t;
  }
  return mejor;
}

function indiceColumna(header: string[], patron: RegExp): number {
  return header.findIndex(h => patron.test(h.trim()));
}

function normalizar(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface TotalSeccion { titulo: string; total: number; completo: boolean }

// Solo mira tablas con columnas de CANTIDAD y PRECIO (unitario) — las de ítems, nunca cualquier
// tabla de 3+ columnas del documento (una tabla de especificaciones técnicas sin precio, por
// ejemplo, no aporta nada acá).
export function calcularTotalesPorSeccion(
  tablasCrudo: TablaCruda[], titulos: TituloCercano[], valorResuelto: (indiceGlobal: number) => number | null,
): TotalSeccion[] {
  const totales: TotalSeccion[] = [];
  for (const t of tablasCrudo) {
    if (t.filas.length < 2) continue;
    const header = t.filas[0].celdas.map(c => c.texto);
    const iCantidad = indiceColumna(header, /^cantidad$/i);
    const iPrecio = indiceColumna(header, /^precio(\s+unitario)?$/i);
    if (iCantidad < 0 || iPrecio < 0) continue;
    const titulo = tituloDeTabla(t.indicePrimero, titulos);
    if (!titulo) continue; // sin título asociado no hay con qué cruzar la tabla resumen

    let total = 0;
    let completo = true;
    let filasConDato = 0;
    for (const fila of t.filas.slice(1)) {
      const celdaCantidad = fila.celdas[iCantidad];
      const celdaPrecio = fila.celdas[iPrecio];
      if (!celdaCantidad || !celdaPrecio) continue;
      const cantidad = Number(String(celdaCantidad.texto).trim().replace(',', '.'));
      if (!Number.isFinite(cantidad) || cantidad <= 0) continue; // fila decorativa (subtítulo repetido dentro de la tabla)
      filasConDato++;
      const precio = celdaPrecio.indiceGlobal != null ? valorResuelto(celdaPrecio.indiceGlobal) : null;
      if (precio == null) { completo = false; continue; } // un ítem sin precio invalida el total de TODA la sección
      total += cantidad * precio;
    }
    if (filasConDato > 0) totales.push({ titulo: titulo.texto, total, completo });
  }
  return totales;
}

// ── Totales AL PIE de la misma tabla (TOTAL NETO / IVA 19% / TOTAL IVA INCLUIDO) ─────────────
// Patrón distinto al de arriba: acá no hay tabla resumen aparte ni columna de cantidad — las tres
// últimas filas de la MISMA tabla de productos piden el total de la columna de precios unitarios.
// Caso real 539119-76-LP26 (ANEXO N°3, oferta económica de panadería): con los 33 precios ya
// puestos desde el costeo, esas tres casillas quedaban vacías y había que sumar 33 números a mano
// — justo el error que este módulo existe para evitar. El costeo NO trae estos totales (confirmado
// con el usuario): la única fuente posible es la propia columna ya rellenada, que es también lo
// que el organismo va a sumar para evaluar.
//
// Reglas de seguridad, deliberadamente estrictas — es una oferta económica, un número mal escrito
// aquí es peor que una casilla vacía:
//   · Si UN solo ítem quedó sin precio, no se escribe NINGÚN total de esa tabla (mismo criterio
//     que calcularTotalesPorSeccion: nunca un total parcial que parezca completo). Excepción: si
//     TODOS los ítems del costeo ya encontraron su línea (`lineasSinPrecioNoOfertadas`), una línea
//     sin precio es una línea a la que no se postula — licitación adjudicada por línea.
//   · El IVA se calcula con el porcentaje que dice la propia tabla ("IVA 19%"); si ninguna fila lo
//     dice (rótulo "IVA" pelado, 1414396-26-LP26 ANEXO N°5), se usa el 19% de la ley chilena —
//     decisión del usuario, 26-oct-2026. Si el documento declara otro porcentaje, manda el documento.
//   · El total con IVA se calcula como neto + IVA, nunca por su cuenta.
//   · Si la tabla trae columna CANTIDAD, el total es Σ(cantidad × precio); si no (el caso de este
//     anexo: solo precios unitarios), es la suma de la columna.
// "Cantidad(A)" / "Cantidad (A)": la letra con que el organismo arma la fórmula "Total (A*B)"
// (1414396-26-LP26, ANEXO N°5) — sin aceptarla el total se calculaba sumando precios unitarios.
const RE_COLUMNA_CANTIDAD = /^cantidad(es)?\s*(\(\s*[a-z]\s*\))?$/i;
// Columna del total de CADA línea: "Total Neto(A*B)", "Subtotal", "Valor total".
const RE_COLUMNA_TOTAL_LINEA = /\b(sub\s*)?total(es)?\b|\b[a-z]\s*[*x×]\s*[a-z]\b/i;
// El orden importa: "TOTAL IVA INCLUIDO" tiene que caer en `bruto`, no en `neto` ni en `iva`.
const RE_PIE_BRUTO = /\b(iva\s*inclu|impuestos?\s*inclu|con\s*iva|total\s*bruto|total\s*final|total\s*general)/i;
const RE_PIE_IVA = /^\s*(i\.?v\.?a\.?|impuestos?)\b/i;
const RE_PIE_NETO = /\b(total(es)?|subtotal(es)?|sub\s*total|suma|sumatoria)\b/i;

// Un rótulo NO basta con que MENCIONE "total" para ser el pie de la tabla. Encontrado auditando
// los 300 anexos .docx ya descargados: "Total" es una MARCA de herramientas muy común en Chile, y
// filas de ítem perfectamente normales dicen "2 UNIDAD Se solicita SIERRA CALADORA, marca
// equivalente a: Total" (3825-20-LE26, 2322-27-LE26, 2735-55-LE26). Tratadas como pie, esas filas
// se habrían quedado FUERA de la suma y encima habrían recibido el total escrito sobre su celda de
// precio — un desastre en una oferta económica.
//
// El filtro es un vocabulario CERRADO: el rótulo completo, ya sin símbolos, tiene que estar hecho
// SOLO de palabras de la familia "total/IVA". Cualquier palabra ajena ("marca", "solicita",
// "sierra") lo descarta. Es seguro por diseño: lo que este vocabulario no conoce no se escribe.
const LARGO_MAX_ROTULO_PIE = 70;
const PALABRAS_DE_PIE = new RegExp(
  '^(' + [
    'total(es)?', 'subtotal(es)?', 'sub', 'suma', 'sumatoria', 'monto', 'valor(es)?', 'precio',
    'costo', 'net[oa]s?', 'brut[oa]s?', 'iva', 'i\\.?v\\.?a\\.?', 'impuestos?', 'inclu[iíday]+os?',
    'incluido', 'incluida', 'de', 'la', 'el', 'los', 'las', 'del', 'con', 'sin', 'mas', 'y', 'a',
    'en', 'por', 'oferta', 'ofertad[oa]', 'contratacion', 'servicio', 'item', 'items',
    'i', 'ii', 'iii', 'iv', 'v', 'pesos', 'clp', 'chilenos', '\\d+([.,]\\d+)?', '%', '\\$', '\\+',
    // Sacados de los rótulos reales del corpus: "IMPUESTO AL VALOR AGREGADO 19%", "TOTAL IVA
    // INC.", "Total a ofertar $", "TOTAL C/IVA $", "Total Valor Neto (*)", "VALOR TOTAL (**) $".
    'agregado', 'al', 'inc', 'ofertar', 'c', '\\*+',
  ].join('|') + ')(\\s+|$)',
  'i',
);

// El rótulo de una fila de pie: sin símbolos de relleno ($, guiones bajos, ".-", puntuación) y sin
// tildes, para poder compararlo contra el vocabulario de arriba.
function normalizarRotuloPie(rotulo: string): string {
  return rotulo.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[_.\-–—:;,()[\]/]+/g, ' ')
    // "$" y "%" van pegados al número en el papel ("IVA 19%", "TOTAL $"): se separan para que
    // cuenten como palabras propias del vocabulario y no rompan el token del número.
    .replace(/([%$+])/g, ' $1 ')
    .replace(/\s+/g, ' ')
    // "I.V.A" quedó como "i v a" al convertir los puntos en espacios: se vuelve a juntar para que
    // los patrones de IVA lo reconozcan (aparece así en anexos reales: "I.V.A (19%) $ ______").
    .replace(/\bi v a\b/gi, 'iva')
    .trim();
}

export // Un total pedido EN PALABRAS ("Valor Total de la Oferta IVA incluido (en Palabras):", visto en el
// corpus) NO se llena con el número: ahí va "ciento noventa y ocho mil…". Se deja al humano.
const RE_TOTAL_EN_PALABRAS = /\ben\s+(palabras|letras)\b/i;

export function pareceFilaDePie(celdas: CeldaTablaCruda[], rotulo: string): boolean {
  if (RE_TOTAL_EN_PALABRAS.test(rotulo)) return false;
  // Las filas de pie nunca van numeradas: un "1", "2", "33" en la primera celda es un ítem.
  const primera = celdas.find(c => c.texto.trim())?.texto.trim() ?? '';
  if (/^\d+$/.test(primera)) return false;
  const limpio = normalizarRotuloPie(rotulo);
  if (!limpio || limpio.length > LARGO_MAX_ROTULO_PIE) return false;
  // Todas las palabras tienen que pertenecer al vocabulario cerrado.
  let resto = limpio;
  while (resto) {
    const m = resto.match(PALABRAS_DE_PIE);
    if (!m) return false;
    resto = resto.slice(m[0].length);
  }
  // Y tiene que hablar de un total o del IVA — "valor neto" solo no es un pie.
  return RE_PIE_NETO.test(limpio) || RE_PIE_IVA.test(limpio) || RE_PIE_BRUTO.test(limpio);
}

// Fila de pie que dice solo «Neto» / «Valor neto» (2827-102-LE26: «Valor total / Neto / Con Iva»).
// pareceFilaDePie no la acepta sola —«valor neto» suelto no basta para saber que es un pie—, así que
// se acepta únicamente cuando la tabla ya tiene otra fila de pie (ver calcularTotalesAlPie).
const RE_FILA_SOLO_NETO = /^(?:(?:valor|monto|precio|total)\s+)?net[oa]s?(?:\s+\$)?$/;

// `anexar`: el monto se agrega al final del texto de la celda del propio rótulo (no hay casilla vacía a su derecha).
export interface RellenoPie { paraId: string; indiceGlobal: number; valor: string; etiqueta: string; anexar?: boolean; indiceParrafoReal?: number }

function textoDeFila(celdas: { texto: string }[]): string {
  return celdas.map(c => c.texto).filter(Boolean).join(' ').trim();
}

// La casilla donde va el monto: la celda vacía más a la DERECHA de la fila. En estas filas el
// rótulo va combinado (gridSpan) ocupando las columnas de la izquierda y el monto queda solo en la
// última — por eso no sirve el índice de columna del encabezado (con celdas combinadas la
// alineación por ancho no calza; ver alinearFilaConEncabezado).
function celdaDelMonto(celdas: CeldaTablaCruda[], iPrecio: number): CeldaTablaCruda | null {
  const rellenable = (c?: CeldaTablaCruda) => !!c && c.indiceGlobal != null && !!c.ultimoParaId && !c.texto.trim();
  // Primero, la celda que cae en la MISMA columna de los precios: es donde el lector espera el
  // total. Si esa no está disponible (el rótulo va combinado y corre la alineación), la última
  // vacía de la fila — en un pie el monto siempre va a la derecha del rótulo.
  if (rellenable(celdas[iPrecio])) return celdas[iPrecio];
  for (let i = celdas.length - 1; i >= 0; i--) if (rellenable(celdas[i])) return celdas[i];
  return null;
}

// Una fila que pide el neto Y el IVA en la misma línea ("Total Neto | IVA | Total con IVA", visto
// en el corpus) tiene varias casillas y ninguna forma de saber cuál es cuál: se deja al humano.
function rotuloAmbiguo(rotulo: string): boolean {
  const limpio = normalizarRotuloPie(rotulo).toLowerCase();
  return /\bnet[oa]s?\b/.test(limpio) && /\biva\b|\bimpuestos?\b/.test(limpio);
}

export function calcularTotalesAlPie(
  tablasCrudo: TablaCruda[], valorResuelto: (indiceGlobal: number) => number | null,
  { lineasSinPrecioNoOfertadas = false }: { lineasSinPrecioNoOfertadas?: boolean } = {},
): RellenoPie[] {
  const out: RellenoPie[] = [];
  for (const t of tablasCrudo) {
    if (t.filas.length < 3) continue; // encabezado + al menos un ítem + al menos una fila de pie
    const header = t.filas[0].celdas.map(c => c.texto);
    const iPrecio = header.findIndex(h => esCandidatoDePrecioUnitario(`x — ${h}`));
    if (iPrecio < 0) continue;
    const iCantidad = header.findIndex(h => RE_COLUMNA_CANTIDAD.test(h.trim()));
    const iTotalLinea = columnaTotalLinea(header, iPrecio);

    // Se separan las filas de PIE de las de ítem antes de sumar: una fila de pie no es un ítem
    // (no tiene precio propio que sumar) y un ítem sin resolver invalida el total.
    const filasPie: { celdas: CeldaTablaCruda[]; rotulo: string }[] = [];
    const netosSueltos: typeof filasPie = [];
    let total = 0;
    let itemsConDato = 0;
    let completo = true;
    for (const fila of t.filas.slice(1)) {
      const rotulo = textoDeFila(fila.celdas);
      if (pareceFilaDePie(fila.celdas, rotulo)) {
        filasPie.push({ celdas: fila.celdas, rotulo });
        continue;
      }
      if (RE_FILA_SOLO_NETO.test(normalizarRotuloPie(rotulo).toLowerCase())) {
        netosSueltos.push({ celdas: fila.celdas, rotulo });
        continue;
      }
      const celdaPrecio = fila.celdas[iPrecio];
      if (!celdaPrecio) continue;
      // Una fila puede traer el precio YA escrito en el Word (no todas se resuelven por costeo).
      const yaEscrito = Number(celdaPrecio.texto.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
      const precio = celdaPrecio.indiceGlobal != null
        ? valorResuelto(celdaPrecio.indiceGlobal)
        : (Number.isFinite(yaEscrito) && yaEscrito > 0 ? yaEscrito : null);
      if (precio == null) {
        // Una fila totalmente vacía (sin rótulo ni precio) es relleno visual, no un ítem sin resolver.
        if (rotulo && !lineasSinPrecioNoOfertadas) completo = false;
        continue;
      }
      itemsConDato++;
      if (iCantidad >= 0) {
        const cantidad = Number(String(fila.celdas[iCantidad]?.texto ?? '').trim().replace(',', '.'));
        total += Number.isFinite(cantidad) && cantidad > 0 ? cantidad * precio : precio;
      } else {
        total += precio;
      }
    }
    // «Neto» solo es pie cuando la tabla YA tiene otro pie; si no, la fila se cuenta como antes,
    // como un ítem sin precio.
    if (filasPie.length) filasPie.push(...netosSueltos);
    else if (netosSueltos.length && !lineasSinPrecioNoOfertadas) completo = false;
    if (!completo || itemsConDato === 0 || filasPie.length === 0) continue;

    // «Valor total» a secas encima de «Neto» y «Con IVA» (2827-102-LE26) es el rótulo del grupo, no
    // un tercer monto: con neto y bruto explícitos, un «total» que no dice cuál de los dos es se
    // deja vacío en vez de repetir el neto donde el lector puede esperar el total final.
    const rotuloPie = (f: { rotulo: string }) => normalizarRotuloPie(f.rotulo).toLowerCase();
    const hayNetoExplicito = filasPie.some(f => /\bnet[oa]s?\b|\bsin iva\b/.test(rotuloPie(f)));
    const hayBruto = filasPie.some(f => RE_PIE_BRUTO.test(f.rotulo));

    const neto = total;
    for (const fila of filasPie) {
      if (rotuloAmbiguo(fila.rotulo)) continue;
      const totalSinDecirCual = !RE_PIE_BRUTO.test(fila.rotulo) && !RE_PIE_IVA.test(fila.rotulo)
        && !/\bnet[oa]s?\b|\bsin iva\b/.test(rotuloPie(fila));
      if (totalSinDecirCual && hayNetoExplicito && hayBruto) continue;
      const celda = celdaDelMonto(fila.celdas, iTotalLinea >= 0 ? iTotalLinea : iPrecio);
      // El rótulo vive EN la columna de los valores y la única casilla vacía queda a su IZQUIERDA
      // (2827-102-LE26, Anexo 4: «Valor total / Neto / Con Iva» bajo la columna «Valor»): el monto no
      // va a la izquierda del rótulo, va en la misma celda, a continuación de él.
      const celdaRotulo = fila.celdas[iTotalLinea >= 0 ? iTotalLinea : iPrecio];
      const anexar = !!celdaRotulo && !!celdaRotulo.texto.trim() && !!celdaRotulo.ultimoParaId && celdaRotulo.indicesParrafos.length > 0
        && !!celda && fila.celdas.indexOf(celda) < fila.celdas.indexOf(celdaRotulo);
      if (!anexar && (!celda?.ultimoParaId || celda.indiceGlobal == null)) continue;
      let valor: number | null = null;
      if (RE_PIE_BRUTO.test(fila.rotulo)) {
        // neto + IVA YA REDONDEADO, no round(neto × 1,19): así el papel cuadra a la vista (las
        // dos líneas de arriba suman exactamente esta), que es lo primero que revisa quien evalúa.
        // Las dos formas pueden diferir en $1 por el redondeo, y esa diferencia se ve.
        const pct = porcentajeIva(fila.rotulo, filasPie);
        valor = pct == null ? null : Math.round(neto) + Math.round(neto * pct / 100);
      } else if (RE_PIE_IVA.test(fila.rotulo)) {
        const pct = porcentajeIva(fila.rotulo, filasPie);
        valor = pct == null ? null : Math.round(neto * pct / 100);
      } else {
        valor = Math.round(neto);
      }
      if (valor == null) continue; // sin porcentaje declarado no se adivina — la casilla queda pendiente
      const monto = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(valor);
      if (anexar) {
        out.push({ paraId: celdaRotulo.ultimoParaId!, indiceGlobal: -1, indiceParrafoReal: celdaRotulo.indicesParrafos[celdaRotulo.indicesParrafos.length - 1], anexar: true, etiqueta: fila.rotulo.slice(0, 80), valor: monto });
        continue;
      }
      out.push({
        paraId: celda!.ultimoParaId!, indiceGlobal: celda!.indiceGlobal!, etiqueta: fila.rotulo.slice(0, 80),
        valor: monto,
      });
    }
  }
  return out;
}

// El porcentaje sale del texto de la propia tabla ("IVA 19%"), nunca de una constante: si mañana
// cambia la tasa, o el anexo usa otra, el documento manda. La fila del total con IVA suele no
// repetirlo ("TOTAL IVA INCLUIDO"), así que se acepta el que declare cualquier fila de pie.
function porcentajeIva(rotulo: string, filasPie: { rotulo: string }[]): number | null {
  for (const texto of [rotulo, ...filasPie.map(f => f.rotulo)]) {
    const m = texto.match(/(\d{1,2}(?:[.,]\d+)?)\s*%/);
    if (m) return Number(m[1].replace(',', '.'));
  }
  return IVA_CHILE_POR_DEFECTO;
}
const IVA_CHILE_POR_DEFECTO = 19;

// La columna del total de cada línea, si la tabla la trae: un encabezado "total"/"A*B" a la
// DERECHA de la columna del precio unitario.
function columnaTotalLinea(header: string[], iPrecio: number): number {
  // "Total con IVA" por línea no es cantidad × precio neto: esa columna no se toca.
  return header.findIndex((h, i) => i > iPrecio && RE_COLUMNA_TOTAL_LINEA.test(h) && !/\biva\b|brut[oa]/i.test(h));
}

// ── Total de CADA línea (cantidad × precio unitario) ─────────────────────────────────────────
// "Línea | Producto | Cantidad(A) | Precio Unitario(B) | Total Neto(A*B)" (1414396-26-LP26, ANEXO
// N°5): el precio salía del costeo y la casilla de al lado quedaba vacía para multiplicar a mano.
// Solo cuando la fila trae cantidad numérica y precio resuelto — nunca se adivina ninguno de los dos.
export function calcularTotalesPorLinea(
  tablasCrudo: TablaCruda[], valorResuelto: (indiceGlobal: number) => number | null,
): RellenoPie[] {
  const out: RellenoPie[] = [];
  for (const t of tablasCrudo) {
    if (t.filas.length < 2) continue;
    const header = t.filas[0].celdas.map(c => c.texto);
    const iPrecio = header.findIndex(h => esCandidatoDePrecioUnitario(`x — ${h}`));
    if (iPrecio < 0) continue;
    const iCantidad = header.findIndex(h => RE_COLUMNA_CANTIDAD.test(h.trim()));
    const iTotal = columnaTotalLinea(header, iPrecio);
    if (iCantidad < 0 || iTotal < 0) continue;
    for (const fila of t.filas.slice(1)) {
      const celdaPrecio = fila.celdas[iPrecio];
      const celdaTotal = fila.celdas[iTotal];
      if (celdaPrecio?.indiceGlobal == null || celdaTotal?.indiceGlobal == null || !celdaTotal.ultimoParaId) continue;
      const cantidad = Number(String(fila.celdas[iCantidad]?.texto ?? '').trim().replace(',', '.'));
      const precio = valorResuelto(celdaPrecio.indiceGlobal);
      if (!Number.isFinite(cantidad) || cantidad <= 0 || precio == null) continue;
      out.push({
        paraId: celdaTotal.ultimoParaId, indiceGlobal: celdaTotal.indiceGlobal,
        etiqueta: `${textoDeFila(fila.celdas.slice(0, iCantidad)).slice(0, 60)} — ${header[iTotal]}`,
        valor: new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(cantidad * precio)),
      });
    }
  }
  return out;
}

// Las celdas vacías a la IZQUIERDA del rótulo en una fila de pie ("_ | _ | _ | Total Neto | $")
// son relleno del dibujo de la tabla, no casillas: mostradas como campos inflaban el contador de
// pendientes con tres casillas sin sentido por fila (1414396-26-LP26, ANEXO N°5).
export function celdasDeRellenoDelPie(tablasCrudo: TablaCruda[]): Set<number> {
  const out = new Set<number>();
  for (const t of tablasCrudo) {
    if (t.filas.length < 3) continue;
    const header = t.filas[0].celdas.map(c => c.texto);
    if (!header.some(h => esCandidatoDePrecioUnitario(`x — ${h}`))) continue;
    for (const fila of t.filas.slice(1)) {
      if (!pareceFilaDePie(fila.celdas, textoDeFila(fila.celdas))) continue;
      const iRotulo = fila.celdas.findIndex(c => c.texto.trim());
      for (const c of fila.celdas.slice(0, iRotulo)) if (c.indiceGlobal != null) out.add(c.indiceGlobal);
    }
  }
  return out;
}

export interface RellenoTotal {
  paraId: string; indiceGlobal: number | null; valor: string;
  // true: la celda no está técnicamente vacía (trae un prefijo fijo, ej. "$") — el valor se
  // AGREGA al final del mismo párrafo. false: celda realmente vacía, se llena como cualquier otra.
  anexar: boolean;
  // Título de la sección que este total resume (LÍNEA/LOTE/ÍTEM…, lo que sea que use la
  // licitación) — auditoría 12-ago-2026: sin esto, el caso `anexar` no tenía NINGÚN dato con el
  // que mostrarse o corregirse en el modal (el usuario solo lo veía ya escrito en el .docx final).
  etiqueta: string;
  // Índice de párrafo REAL de la celda del monto — a diferencia de `indiceGlobal` (null cuando
  // `anexar` es true, porque esa celda no cuenta como "vacía"), este SIEMPRE apunta al párrafo que
  // existe de verdad, tomado de `indicesParrafos` (el mismo mecanismo que ya usa `construirTablaUI`
  // para una celda "Etiqueta:" con texto propio — ver su comentario). Permite que el `anexar` se
  // registre en `resolucionPorIndice` igual que cualquier otro campo, y así aparezca en el modal
  // con lápiz de corrección, en vez de escribirse a ciegas solo al generar el documento final.
  indiceParrafoReal: number | null;
}

// Cruza los totales calculados contra una tabla resumen (columna MONTO/TOTAL + una fila cuya
// etiqueta calza EXACTO con el título de otra tabla) y arma dónde escribir cada uno.
export function resolverTablaResumen(tablasCrudo: TablaCruda[], totales: TotalSeccion[]): RellenoTotal[] {
  if (totales.length === 0) return [];
  const porTitulo = new Map(totales.map(t => [normalizar(t.titulo), t]));
  const out: RellenoTotal[] = [];
  for (const t of tablasCrudo) {
    if (t.filas.length < 2) continue;
    const header = t.filas[0].celdas.map(c => c.texto);
    const iMonto = indiceColumna(header, /monto|total/i);
    if (iMonto < 0) continue;
    for (const fila of t.filas.slice(1)) {
      const etiquetaFila = fila.celdas.find(c => porTitulo.has(normalizar(c.texto)));
      if (!etiquetaFila) continue;
      const info = porTitulo.get(normalizar(etiquetaFila.texto))!;
      if (!info.completo) continue; // total parcial: mejor dejarlo vacío que escribir un número engañoso
      const celdaMonto = fila.celdas[iMonto];
      if (!celdaMonto?.ultimoParaId) continue; // celda sin párrafo identificable — no hay dónde escribir
      out.push({
        paraId: celdaMonto.ultimoParaId,
        indiceGlobal: celdaMonto.indiceGlobal,
        valor: new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(info.total),
        anexar: celdaMonto.indiceGlobal == null,
        etiqueta: info.titulo,
        indiceParrafoReal: celdaMonto.indiceGlobal ?? celdaMonto.indicesParrafos.at(-1) ?? null,
      });
    }
  }
  return out;
}

// ── Monto total NETO y total CON IVA de cada línea, SIN columna de precio unitario ───────────
// "Cantidad | DESCRIPCIÓN | MONTO TOTAL NETO | MONTO TOTAL IVA INCLUIDO" (2483-265-LE26, ANEXO Nº 3):
// la tabla solo pide los totales de cada línea, no el unitario, así que ni el motor de precios
// unitarios ni calcularTotalesPorLinea (que parte del unitario) tenían dónde trabajar y las dos
// casillas quedaban vacías con el costeo cargado. Neto = cantidad × precio unitario del costeo; con
// IVA = neto × (1 + IVA%), el % del propio documento o 19. La fila se empareja con su ítem del
// costeo: una sola fila y un solo ítem es obvio; con varios, solo por parecido claro de descripción
// (nunca se adivina — la casilla queda pendiente).
const RE_TOTAL_NETO = /total.*neto|neto.*total/i;
const RE_TOTAL_CON_IVA = /total.*(iva\s*inclu|con\s*iva|bruto)|(iva\s*inclu|con\s*iva|bruto).*total/i;

function tokensDescripcion(s: string): Set<string> {
  return new Set(normalizar(s).split(/[^a-z0-9]+/).filter(t => t.length > 2));
}

export function calcularMontosTotalesPorLineaSinUnitario(
  tablasCrudo: TablaCruda[],
  items: { descripcion: string; precioUnitario: number; cantidad: number | null }[],
): RellenoPie[] {
  const out: RellenoPie[] = [];
  if (!items.length) return out;
  for (const t of tablasCrudo) {
    if (t.filas.length < 2) continue;
    const header = t.filas[0].celdas.map(c => c.texto);
    if (header.some(h => esCandidatoDePrecioUnitario(`x — ${h}`))) continue; // esa tabla ya tiene su camino
    const iNeto = header.findIndex(h => RE_TOTAL_NETO.test(h) && !RE_TOTAL_CON_IVA.test(h));
    const iBruto = header.findIndex(h => RE_TOTAL_CON_IVA.test(h));
    if (iNeto < 0) continue;
    const iCantidad = header.findIndex(h => RE_COLUMNA_CANTIDAD.test(h.trim()));
    const filas = t.filas.slice(1).filter(f => !pareceFilaDePie(f.celdas, textoDeFila(f.celdas)));
    const pct = porcentajeIva(header.join(' '), []) ?? IVA_CHILE_POR_DEFECTO;
    for (const fila of filas) {
      let item = filas.length === 1 && items.length === 1 ? items[0] : null;
      if (!item) {
        const tf = tokensDescripcion(textoDeFila(fila.celdas.filter((_, i) => i !== iCantidad && i !== iNeto && i !== iBruto)));
        const puntaje = items.map(it => {
          const ti = tokensDescripcion(it.descripcion);
          const comunes = [...tf].filter(x => ti.has(x)).length;
          return { it, s: comunes / Math.max(1, Math.min(tf.size, ti.size)) };
        }).sort((a, b) => b.s - a.s);
        if (puntaje[0] && puntaje[0].s >= 0.6 && (!puntaje[1] || puntaje[1].s < puntaje[0].s)) item = puntaje[0].it;
      }
      if (!item) continue;
      const cantFila = iCantidad >= 0 ? Number(String(fila.celdas[iCantidad]?.texto ?? '').trim().replace(',', '.')) : NaN;
      const cantidad = Number.isFinite(cantFila) && cantFila > 0 ? cantFila : item.cantidad;
      if (!cantidad || cantidad <= 0) continue;
      const neto = Math.round(cantidad * item.precioUnitario);
      const fmt = (n: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);
      const celdaNeto = fila.celdas[iNeto];
      if (celdaNeto?.indiceGlobal != null && celdaNeto.ultimoParaId) {
        out.push({ paraId: celdaNeto.ultimoParaId, indiceGlobal: celdaNeto.indiceGlobal, etiqueta: `${item.descripcion.slice(0, 50)} — ${header[iNeto]}`, valor: fmt(neto) });
      }
      const celdaBruto = iBruto >= 0 ? fila.celdas[iBruto] : undefined;
      if (celdaBruto?.indiceGlobal != null && celdaBruto.ultimoParaId) {
        out.push({ paraId: celdaBruto.ultimoParaId, indiceGlobal: celdaBruto.indiceGlobal, etiqueta: `${item.descripcion.slice(0, 50)} — ${header[iBruto]}`, valor: fmt(Math.round(neto * (1 + pct / 100))) });
      }
    }
  }
  return out;
}
