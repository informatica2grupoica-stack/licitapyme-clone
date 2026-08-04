// app/lib/anexos-documento-ui.ts
// Frente E.1 — RÉPLICA del documento para la pantalla de relleno.
//
// Pedido explícito del usuario (4-ago-2026), después de tres intentos que no daban en el clavo:
// el panel derecho NO debe ser una lista de campos ("etiqueta: valor" uno debajo del otro, ni
// fichas en grilla) sino una COPIA del documento que se va a presentar — el mismo texto, la misma
// estructura, lo centrado centrado, las listas numeradas numeradas — con los blancos rellenables
// EN SU LUGAR dentro del texto. Y tiene que salir igual para cualquier licitación, porque cada
// anexo es distinto: nada de plantillas por documento, todo se deriva del .docx real.
//
// Por eso esto no "detecta campos": recorre el cuerpo del documento en ORDEN (mismo recorrido
// que listarBloquesCrudos en anexos-dividir.ts, y misma numeración de párrafos que
// listarParrafos en anexos-docx.ts, que es la que usan los ids de los pendientes) y emite un
// bloque por cada <w:p> y cada <w:tbl>. Cada párrafo lleva su alineación, su sangría, su
// viñeta/número real (resuelto contra word/numbering.xml) y sus trozos de texto con negrita o
// subrayado — más los segmentos que son un dato ya resuelto o una casilla por llenar.
//
// Lo que este módulo NO hace, a propósito: decidir QUÉ va en cada blanco. Eso ya lo resolvieron
// el motor de IA (anexos-ia-motor.ts) y los patrones de detección (anexos-detectar.ts); acá solo
// se recibe el resultado ya resuelto y se ubica en el lugar del documento donde corresponde.
import type JSZip from 'jszip';

export type Alineacion = 'izquierda' | 'centro' | 'derecha' | 'justificado';

export type SegmentoUI =
  | { t: 'texto'; v: string; negrita?: boolean; subrayado?: boolean }
  | { t: 'auto'; v: string; via: 'ia' | 'costeo' }
  | { t: 'input'; id: string; largo?: number }
  | { t: 'salto' };

export interface BloqueParrafoUI {
  tipo: 'parrafo';
  indice: number;            // índice global de párrafo — el mismo que usan los ids `celda:N`
  alineacion: Alineacion;
  sangriaPx: number;
  marcador?: string;         // "1.", "a)", "•" … ya resuelto contra numbering.xml
  segmentos: SegmentoUI[];
}
export interface BloqueTablaUI<T> { tipo: 'tabla'; tabla: T }
export type BloqueUI<T> = BloqueParrafoUI | BloqueTablaUI<T>;

// Lo que el resto del pipeline ya resolvió para cada blanco, en las dos formas que existen:
// por PÁRRAFO (celda de tabla vacía, o "Etiqueta:" con el valor al final de la misma línea) y
// por BLANCO INLINE (una corrida de ____ dentro de una oración, que puede haber varias en el
// mismo párrafo). Las claves son exactamente las que ya usan los ids de los pendientes, para
// que lo que se escriba en pantalla vuelva al backend apuntando al mismo lugar.
export interface ResueltoAuto { tipo: 'auto'; valor: string; via: 'ia' | 'costeo' }
export interface ResueltoInput { tipo: 'pendiente'; id: string }
export type Resuelto = ResueltoAuto | ResueltoInput;

export interface EntradasDocumentoUI<T> {
  xml: string;
  porParrafo: Map<number, Resuelto>;
  /** clave: `${indiceRunGlobal}:${posEnTexto}` — misma que arma detectarBlancosInline */
  porBlancoInline: Map<string, Resuelto>;
  /** clave: índice del PRIMER párrafo de la tabla (TablaCruda.indicePrimero) */
  tablasPorIndice: Map<number, T>;
  numeracion?: MapaNumeracion;
}

// ── word/numbering.xml: para que una lista salga "a) b) c)" si el Word dice eso, y no "1. 2. 3." ──
// Sin esto habría que adivinar el formato, y adivinar es justamente lo que rompe la idea de
// "copia exacta": el mismo documento puede traer una lista con letras y otra con números.
export interface NivelNumeracion { formato: string; textoNivel: string; inicio: number }
export type MapaNumeracion = Map<string, NivelNumeracion>; // clave `${numId}:${ilvl}`

export async function leerNumeracion(zip: JSZip): Promise<MapaNumeracion> {
  const mapa: MapaNumeracion = new Map();
  const archivo = zip.file('word/numbering.xml');
  if (!archivo) return mapa;
  let xml: string;
  try { xml = await archivo.async('string'); } catch { return mapa; }

  // abstractNumId → { ilvl → nivel }
  const abstractos = new Map<string, Map<string, NivelNumeracion>>();
  for (const abs of xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const niveles = new Map<string, NivelNumeracion>();
    for (const lvl of abs[2].matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
      const cuerpo = lvl[2];
      niveles.set(lvl[1], {
        formato: cuerpo.match(/<w:numFmt\s+w:val="([^"]+)"/)?.[1] || 'decimal',
        textoNivel: cuerpo.match(/<w:lvlText\s+w:val="([^"]*)"/)?.[1] ?? '%1.',
        inicio: Number(cuerpo.match(/<w:start\s+w:val="(\d+)"/)?.[1] ?? 1),
      });
    }
    abstractos.set(abs[1], niveles);
  }
  // num (el que citan los párrafos) → abstractNum
  for (const num of xml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
    const abstractId = num[2].match(/<w:abstractNumId\s+w:val="(\d+)"/)?.[1];
    const niveles = abstractId != null ? abstractos.get(abstractId) : undefined;
    if (!niveles) continue;
    for (const [ilvl, nivel] of niveles) mapa.set(`${num[1]}:${ilvl}`, nivel);
  }
  return mapa;
}

const LETRAS = 'abcdefghijklmnopqrstuvwxyz';
const ROMANOS: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

function aRomano(n: number): string {
  let out = '';
  for (const [valor, letra] of ROMANOS) while (n >= valor) { out += letra; n -= valor; }
  return out;
}

function formatearContador(n: number, formato: string): string {
  switch (formato) {
    case 'lowerLetter': return LETRAS[(n - 1) % 26] ?? String(n);
    case 'upperLetter': return (LETRAS[(n - 1) % 26] ?? String(n)).toUpperCase();
    case 'lowerRoman': return aRomano(n);
    case 'upperRoman': return aRomano(n).toUpperCase();
    case 'bullet': return '•';
    default: return String(n);
  }
}

function marcadorDeNivel(nivel: NivelNumeracion, contador: number): string {
  if (nivel.formato === 'bullet') return '•';
  // lvlText trae marcadores tipo "%1." o "(%1)" — solo se resuelve el del propio nivel; los de
  // niveles superiores ("%1.%2") se dejan con el contador de este nivel, que es lo que se ve en
  // la inmensa mayoría de los anexos reales (listas de un solo nivel).
  const texto = nivel.textoNivel || '%1.';
  return texto.replace(/%\d/g, formatearContador(contador, nivel.formato)) || String(contador);
}

// ── Recorrido del cuerpo en orden ────────────────────────────────────────────────────────
// Mismo criterio que listarBloquesCrudos (anexos-dividir.ts): las tablas se emparejan con pila
// (pueden anidarse), los párrafos se cierran en su primer </w:p> — porque así los cuenta
// listarParrafos, y esa numeración es la que usan los ids de los campos. Cambiarla acá
// desalinearía todo lo que ya está resuelto.
const RE_INICIO_BLOQUE = /<w:p\b[^>]*?(\/?)>|<w:tbl\b[^>]*?(\/?)>/g;
const RE_TEXTO = /<w:t[^>]*>([^<]*)<\/w:t>/g;

function finDeTabla(xml: string, desde: number): number {
  const re = /<w:tbl\b[^>]*?(\/?)>|<\/w:tbl>/g;
  re.lastIndex = desde;
  let profundidad = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[0].startsWith('</')) { if (--profundidad === 0) return m.index + m[0].length; }
    else if (m[1] !== '/') profundidad++;
  }
  return -1;
}

function alineacionDe(pPr: string): Alineacion {
  const jc = pPr.match(/<w:jc\s+w:val="([^"]+)"/)?.[1];
  if (jc === 'center') return 'centro';
  if (jc === 'right' || jc === 'end') return 'derecha';
  if (jc === 'both' || jc === 'distribute') return 'justificado';
  return 'izquierda';
}

// twips (1/1440 de pulgada) → px de pantalla a 96dpi. Se acota: una sangría enorme en Word
// (hay anexos con w:left="2124") empujaría el texto fuera del panel, que es más angosto que
// una hoja carta.
const MAX_SANGRIA_PX = 64;
function sangriaDe(pPr: string): number {
  const izq = Number(pPr.match(/<w:ind\b[^>]*\sw:left="(-?\d+)"/)?.[1] ?? 0);
  if (!Number.isFinite(izq) || izq <= 0) return 0;
  return Math.min(MAX_SANGRIA_PX, Math.round((izq / 1440) * 96));
}

/**
 * Reconstruye el documento como una lista ordenada de bloques listos para dibujar en pantalla:
 * cada párrafo con su alineación/sangría/numeración y sus trozos de texto, y cada tabla en su
 * posición real. Los blancos ya resueltos entran como segmento `auto` (valor a la vista) o
 * `input` (casilla por llenar), en el lugar exacto del texto donde van.
 */
export function construirDocumentoUI<T>({
  xml, porParrafo, porBlancoInline, tablasPorIndice, numeracion,
}: EntradasDocumentoUI<T>): BloqueUI<T>[] {
  const bloques: BloqueUI<T>[] = [];
  const contadoresLista = new Map<string, number>();
  let indiceParrafo = 0;   // igual que listarParrafos
  let indiceRunGlobal = 0; // igual que detectarBlancosInline: cuenta <w:t>, en orden de documento
  let pos = 0;

  for (;;) {
    RE_INICIO_BLOQUE.lastIndex = pos;
    const m = RE_INICIO_BLOQUE.exec(xml);
    if (!m) break;
    const esTabla = m[0].startsWith('<w:tbl');
    const fin = esTabla
      ? (m[2] === '/' ? m.index + m[0].length : finDeTabla(xml, m.index))
      : (xml.indexOf('</w:p>', m.index) < 0 ? -1 : xml.indexOf('</w:p>', m.index) + '</w:p>'.length);
    if (fin < 0) break;
    const bloqueXml = xml.slice(m.index, fin);

    if (esTabla) {
      const tabla = tablasPorIndice.get(indiceParrafo);
      if (tabla !== undefined) bloques.push({ tipo: 'tabla', tabla });
      // Aunque la tabla se dibuje aparte, sus párrafos y sus <w:t> SÍ cuentan para la numeración
      // global — si no se avanzan los contadores, todo lo que viene después queda corrido y los
      // blancos se ubicarían en el párrafo equivocado.
      indiceParrafo += (bloqueXml.match(/<w:p\b[^>]*>/g) || []).length;
      indiceRunGlobal += (bloqueXml.match(RE_TEXTO) || []).length;
      pos = fin;
      continue;
    }

    const cuerpo = bloqueXml.replace(/^<w:p\b[^>]*>/, '').replace(/<\/w:p>$/, '');
    const pPr = cuerpo.match(/^\s*<w:pPr>([\s\S]*?)<\/w:pPr>/)?.[1] ?? '';

    let marcador: string | undefined;
    const numPr = pPr.match(/<w:numPr>([\s\S]*?)<\/w:numPr>/)?.[1];
    if (numPr) {
      const numId = numPr.match(/<w:numId\s+w:val="(\d+)"/)?.[1];
      const ilvl = numPr.match(/<w:ilvl\s+w:val="(\d+)"/)?.[1] ?? '0';
      if (numId) {
        const clave = `${numId}:${ilvl}`;
        const nivel = numeracion?.get(clave) ?? { formato: 'decimal', textoNivel: '%1.', inicio: 1 };
        const contador = (contadoresLista.get(clave) ?? nivel.inicio - 1) + 1;
        contadoresLista.set(clave, contador);
        marcador = marcadorDeNivel(nivel, contador);
      }
    }

    const segmentos: SegmentoUI[] = [];
    // Los runs se recorren en orden; de cada uno salen sus <w:t> (que son los que cuenta la
    // numeración global de blancos) y sus <w:br> (saltos de línea manuales, que en el Word se
    // ven como renglón nuevo dentro del MISMO párrafo).
    for (const trozo of cuerpo.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>|<w:(?:br|cr)\b[^>]*\/?>/g)) {
      if (trozo[1] === undefined) { segmentos.push({ t: 'salto' }); continue; }
      const run = trozo[1];
      const rPr = run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1] ?? '';
      const negrita = /<w:b\/>|<w:b\s+w:val="(?:1|true|on)"/.test(rPr);
      const subrayado = /<w:u\b/.test(rPr) && !/<w:u\s+w:val="none"/.test(rPr);

      for (const t of run.matchAll(RE_TEXTO)) {
        const texto = t[1];
        const iRun = indiceRunGlobal++;
        // Los blancos de ESTE run, en orden — el texto entre uno y otro se emite tal cual, así
        // la oración se lee igual que en el Word con la casilla intercalada donde va.
        let cursor = 0;
        for (const b of texto.matchAll(/_{4,}/g)) {
          const res = porBlancoInline.get(`${iRun}:${b.index}`);
          if (!res) continue;
          if (b.index! > cursor) segmentos.push({ t: 'texto', v: texto.slice(cursor, b.index), negrita, subrayado });
          segmentos.push(res.tipo === 'auto'
            ? { t: 'auto', v: res.valor, via: res.via }
            : { t: 'input', id: res.id, largo: b[0].length });
          cursor = b.index! + b[0].length;
        }
        if (cursor < texto.length) segmentos.push({ t: 'texto', v: texto.slice(cursor), negrita, subrayado });
      }
      for (const _br of run.matchAll(/<w:(?:br|cr)\b[^>]*\/?>/g)) segmentos.push({ t: 'salto' });
    }

    // Blanco a nivel de PÁRRAFO: una celda de tabla vacía (el párrafo entero es el hueco) o un
    // "Etiqueta:" cuyo valor va al final de la misma línea. En los dos casos el segmento va al
    // final: en el primero es lo único que hay, en el segundo queda después de la etiqueta —
    // exactamente donde lo escribe el generador (rellenarCeldaVacia / rellenarFinDeParrafo).
    const delParrafo = porParrafo.get(indiceParrafo);
    if (delParrafo) {
      segmentos.push(delParrafo.tipo === 'auto'
        ? { t: 'auto', v: delParrafo.valor, via: delParrafo.via }
        : { t: 'input', id: delParrafo.id });
    }

    bloques.push({
      tipo: 'parrafo',
      indice: indiceParrafo,
      alineacion: alineacionDe(pPr),
      sangriaPx: sangriaDe(pPr),
      marcador,
      segmentos,
    });
    indiceParrafo++;
    pos = fin;
  }

  return bloques;
}
