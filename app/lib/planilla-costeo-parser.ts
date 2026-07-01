// app/lib/planilla-costeo-parser.ts
// Parser DETERMINISTA de la planilla de cotización / oferta económica (Anexo Económico,
// ETT, FORMATO N°n). Extrae en código el listado COMPLETO de ítems con su descripción
// EXACTA, unidad, cantidad, y —cuando existe— el número de LÍNEA/LOTE y la CATEGORÍA.
//
// Por qué: pedirle a la IA que enumere N filas es frágil (selecciona ítems "notables" en
// vez de listarlos todos). Aquí las sacamos exactas, gratis en tokens. Es la SEMILLA del
// Excel de costeo: si hay ≥2 líneas → "costeo en línea" (1 hoja por línea); si no →
// "costeo" (suma alzada, 1 hoja).
//
// Fuentes que entiende (el texto ya viene extraído por document-extraction):
//   - Excel (metodo 'excel'): CSV de XLSX.utils.sheet_to_csv; hojas marcadas con
//     "--- Hoja: <nombre> ---" (p.ej. "--- Hoja: Línea 1 ---").
//   - PDF/Word: tablas markdown "| n | desc | un | cant |" y/o líneas planas.
// Agrupaciones que detecta: LÍNEAS/LOTES ("LÍNEA 1: ...", "--- Hoja: Línea N ---") y
// CATEGORÍAS/rubros ("A FERRETERIA", "B PINTURA").

export interface ItemPlanilla {
  linea: number;              // número de LÍNEA/LOTE (1 si el listado no está en líneas)
  categoria: string | null;   // nombre de la categoría/rubro (FERRETERIA…) o null
  numero: number | null;      // correlativo del ítem dentro de su grupo (referencia)
  descripcion: string;
  unidad: string;
  cantidad: number | null;
}

// Patrón del correlativo de ítems — el discriminador determinista suma_alzada vs por_linea:
//  - 'continua'   : 1,2,3,…,N de corrido (único, creciente, sin reinicios) → SUMA ALZADA
//                   (una planilla integrada, aunque venga partida en hojas/secciones "Línea N").
//  - 'reinicia'   : el correlativo se reinicia (1,2,3|1,2,3) o se repite agrupando ítems
//                   (1,1,2,2,3) → POR LÍNEA/LOTE.
//  - 'indefinida' : no hay suficientes correlativos para juzgar (se respetan los títulos).
export type PatronNumeracion = 'continua' | 'reinicia' | 'indefinida';

export interface PlanillaParseResult {
  estructura: 'por_linea' | 'por_categoria' | 'plana';
  lineas: number[];           // números de línea detectados (en orden)
  categorias: string[];       // nombres de categoría en orden de aparición
  items: ItemPlanilla[];
  numeracion: PatronNumeracion;
  fuenteDoc: string;
}

interface DocTexto { nombre: string; categoria?: string | null; texto: string; metodo?: string | null }

const normalizar = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const limpiarCelda = (s: string) =>
  s.replace(/\*\*/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

// Divide una línea CSV respetando comillas dobles ("" = comilla escapada).
function csvSplit(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(limpiarCelda);
}

// Convierte una línea del texto en celdas, o null si no parece tabular.
function celdasDe(line: string): string[] | null {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith('|')) {
    if (/^\|[\s:|-]+\|?$/.test(t)) return null; // separador markdown
    const partes = t.split('|').map(limpiarCelda);
    if (partes.length && partes[0] === '') partes.shift();
    if (partes.length && partes[partes.length - 1] === '') partes.pop();
    return partes.length ? partes : null;
  }
  if ((line.match(/,/g) || []).length >= 3) return csvSplit(line);
  return null;
}

interface ColMap { num: number; desc: number; unidad: number; cant: number }

function detectarHeader(celdas: string[]): ColMap | null {
  const n = celdas.map(normalizar);
  const buscar = (claves: string[]) => n.findIndex(h => h && claves.some(k => h.includes(k)));
  const desc = buscar(['detalle', 'descrip', 'producto', 'material', 'articulo', 'glosa', 'insumo', 'item a', 'nombre']);
  const cant = buscar(['cantidad', 'cant', 'cdad']);
  if (desc < 0 || cant < 0) return null;
  const num = n.findIndex(h => /^(item|itemn|n|no|numero)\.?$/.test(h) || h === 'n°' || h === 'nº');
  const unidad = buscar(['unidad', 'medida']);
  return { num, desc, unidad, cant };
}

// Detecta un encabezado de LÍNEA/LOTE y devuelve su número. Cubre:
//  - marcador de hoja Excel: "--- Hoja: Línea 3 ---"
//  - encabezado en el texto: "LÍNEA 3:", "LINEA N° 3", "LOTE 2", "ITEM 2:" (como grupo)
function detectarLinea(lineaCruda: string): number | null {
  const t = limpiarCelda(lineaCruda);
  let m = t.match(/^-{0,3}\s*hoja:\s*l[ií]nea\s*n?\s*[°º]?\s*(\d{1,3})/i);
  if (m) return parseInt(m[1], 10);
  m = t.match(/^\s*l[ií]nea\s*n?\s*[°º]?\s*(\d{1,3})\s*[:\-.)]/i);
  if (m) return parseInt(m[1], 10);
  m = t.match(/^\s*lote\s*n?\s*[°º]?\s*(\d{1,3})\s*[:\-.)]/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

// ¿Fila de categoría? Ej: ["", "A", "FERRETERIA", ""] o ["F", "HERRAMIENTAS"].
function detectarCategoria(celdas: string[]): string | null {
  for (let i = 0; i < celdas.length - 1; i++) {
    const c = limpiarCelda(celdas[i]);
    if (!/^[A-Z]$/.test(c)) continue;
    for (let j = i + 1; j < celdas.length; j++) {
      const nombre = limpiarCelda(celdas[j]);
      if (!nombre) continue;
      if (nombre.length >= 3 && /[a-záéíóúñ]/i.test(nombre) && !/^\d/.test(nombre)) {
        return nombre.toUpperCase();
      }
      break;
    }
  }
  return null;
}

const esEntero = (s: string) => /^\d{1,4}$/.test(limpiarCelda(s));
const aNumero = (s: string): number | null => {
  const t = limpiarCelda(s).replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) && t !== '' ? n : null;
};

function extraerItem(celdas: string[], col: ColMap | null): Omit<ItemPlanilla, 'categoria' | 'linea'> | null {
  if (col) {
    const desc = limpiarCelda(celdas[col.desc] || '');
    if (desc.length < 2) return null;
    const numRaw = col.num >= 0 ? celdas[col.num] : '';
    if (col.num >= 0 && !esEntero(numRaw)) return null;
    const numero = esEntero(numRaw) ? Number(limpiarCelda(numRaw)) : null;
    const unidad = col.unidad >= 0 ? limpiarCelda(celdas[col.unidad] || '') : '';
    const cantidad = col.cant >= 0 ? aNumero(celdas[col.cant] || '') : null;
    return { numero, descripcion: desc, unidad, cantidad };
  }
  const idxNum = celdas.findIndex(esEntero);
  if (idxNum < 0) return null;
  const desc = limpiarCelda(celdas[idxNum + 1] || '');
  if (desc.length < 2 || !/[a-záéíóúñ]/i.test(desc)) return null;
  return {
    numero: Number(limpiarCelda(celdas[idxNum])),
    descripcion: desc,
    unidad: limpiarCelda(celdas[idxNum + 2] || ''),
    cantidad: aNumero(celdas[idxNum + 3] || ''),
  };
}

const PALABRAS_NO_ITEM = /^(total|subtotal|valor|monto|observ|nota|precio|rut|item|detalle|descrip|n°|nº|#)\b/i;

// Analiza el patrón del correlativo de los ítems (heurística del experto):
//   de corrido 1,2,3,…,N (único, creciente, sin reinicios) → suma alzada;
//   reinicia 1,2,3|1,2,3 o repite agrupando 1,1,2,2,3 → por línea/lote.
function analizarNumeracion(items: { numero: number | null }[]): PatronNumeracion {
  const seq = items.map(i => i.numero).filter((n): n is number => n != null && n > 0);
  // Necesitamos correlativos en la mayoría de los ítems para juzgar con confianza.
  if (seq.length < 6 || seq.length < items.length * 0.5) return 'indefinida';

  let bajadas = 0;        // seq[i] < seq[i-1]   → el correlativo reinicia
  let repeticiones = 0;   // seq[i] === seq[i-1] → un mismo número agrupa varios ítems
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] < seq[i - 1]) bajadas++;
    else if (seq[i] === seq[i - 1]) repeticiones++;
  }
  const maxNum = Math.max(...seq);
  const cicla = maxNum <= seq.length * 0.7; // el máximo es mucho menor que la cantidad → el nº cicla

  // Reinicia si el correlativo baja varias veces (varios lotes) o se repite agrupando ítems.
  if ((bajadas >= 2 && cicla) || repeticiones >= Math.max(2, seq.length * 0.2)) return 'reinicia';
  // De corrido: estrictamente creciente (sin bajadas) → suma alzada.
  if (bajadas === 0) return 'continua';
  // Una bajada aislada en una lista larga y creciente es ruido de parseo → suma alzada.
  if (bajadas <= 1 && maxNum >= seq.length * 0.7) return 'continua';
  return 'indefinida';
}

// Cuando la numeración indica líneas pero NO hubo títulos "LÍNEA N", reasigna item.linea.
function segmentarLineasPorNumeracion(items: ItemPlanilla[]): void {
  const nums = items.map(i => i.numero);
  const hayRepes = nums.some((n, i) => i > 0 && n != null && n === nums[i - 1]);
  if (hayRepes) {
    // 1,1,2,2,3 → el número ES la línea (agrupa varios ítems bajo el mismo nº).
    let ultima = 1;
    for (const it of items) { if (it.numero != null) ultima = it.numero; it.linea = ultima; }
    return;
  }
  // 1,2,3|1,2,3 → nueva línea en cada reinicio del correlativo.
  let linea = 1, prev = 0;
  for (const it of items) {
    if (it.numero != null) { if (it.numero <= prev) linea++; prev = it.numero; }
    it.linea = linea;
  }
}

function parsearDoc(doc: DocTexto): PlanillaParseResult | null {
  const lineas = doc.texto.split(/\r?\n/);
  const items: ItemPlanilla[] = [];
  const lineasOrden: number[] = [];
  const catsOrden: string[] = [];
  let col: ColMap | null = null;
  let categoriaActual: string | null = null;
  let lineaActual = 1;
  let vistoHeader = false;
  let vioLineaExplicita = false;

  for (const cruda of lineas) {
    // LÍNEA/LOTE (mirar la línea cruda antes de tabular).
    const nLinea = detectarLinea(cruda);
    if (nLinea != null) {
      lineaActual = nLinea;
      vioLineaExplicita = true;
      if (!lineasOrden.includes(nLinea)) lineasOrden.push(nLinea);
      continue;
    }

    const celdas = celdasDe(cruda);
    if (!celdas) continue;

    const header = detectarHeader(celdas);
    if (header) { col = header; vistoHeader = true; continue; }

    const cat = detectarCategoria(celdas);
    if (cat) {
      categoriaActual = cat;
      if (!catsOrden.includes(cat)) catsOrden.push(cat);
      continue;
    }

    const it = extraerItem(celdas, col);
    if (!it) continue;
    if (PALABRAS_NO_ITEM.test(it.descripcion)) continue;
    if (vioLineaExplicita && !lineasOrden.includes(lineaActual)) lineasOrden.push(lineaActual);
    items.push({ linea: vioLineaExplicita ? lineaActual : 1, categoria: categoriaActual, ...it });
  }

  if (items.length < 8) return null;
  if (!vistoHeader && catsOrden.length === 0 && !vioLineaExplicita) return null;

  // PATRÓN DE NUMERACIÓN — el discriminador clave suma_alzada vs por_linea. Manda por
  // sobre los títulos "LÍNEA N": una planilla numerada de corrido 1..N es suma alzada
  // aunque venga partida en hojas/secciones tituladas "Línea N".
  const numeracion = analizarNumeracion(items);
  let lineasFinal = lineasOrden;
  let estructura: PlanillaParseResult['estructura'];

  if (numeracion === 'reinicia' && vioLineaExplicita) {
    // Lotes EXPLÍCITOS ("LÍNEA N"/"Hoja: Línea N") + correlativo que reinicia = por línea real.
    lineasFinal = lineasOrden;
    estructura = lineasFinal.length >= 2 ? 'por_linea' : (catsOrden.length >= 2 ? 'por_categoria' : 'plana');
  } else if (numeracion === 'reinicia' && catsOrden.length >= 2) {
    // El correlativo reinicia por CATEGORÍA/rubro (FERRETERIA 1..n, PINTURA 1..n), NO por lote
    // de adjudicación → por_categoria (suma alzada, costeo desglosado por rubro). Línea 1 para todos.
    for (const it of items) it.linea = 1;
    lineasFinal = [1];
    estructura = 'por_categoria';
  } else if (numeracion === 'reinicia') {
    // Reinicia/repite SIN títulos ni categorías → líneas inferidas de la propia numeración.
    segmentarLineasPorNumeracion(items);
    lineasFinal = [...new Set(items.map(it => it.linea))].sort((a, b) => a - b);
    estructura = lineasFinal.length >= 2 ? 'por_linea' : 'plana';
  } else if (numeracion === 'continua') {
    // De corrido = suma alzada. Los títulos "LÍNEA N" son secciones de una MISMA planilla
    // integrada, NO lotes de adjudicación → todos los ítems quedan en la línea 1.
    for (const it of items) it.linea = 1;
    lineasFinal = [1];
    estructura = catsOrden.length >= 2 ? 'por_categoria' : 'plana';
  } else {
    // 'indefinida' → respeta los títulos explícitos (comportamiento previo).
    lineasFinal = lineasOrden;
    estructura = lineasOrden.length >= 2 ? 'por_linea' : (catsOrden.length >= 2 ? 'por_categoria' : 'plana');
  }

  return {
    estructura,
    lineas: lineasFinal.length ? lineasFinal : [1],
    categorias: catsOrden,
    items,
    numeracion,
    fuenteDoc: doc.nombre,
  };
}

function esCandidato(doc: DocTexto): boolean {
  const n = normalizar(doc.nombre);
  if (/anexo.?o|anexo.?econom|economic|cotiza|itemiz|presupuesto|listado|formato.?\d|oferta.?econ/.test(n)) return true;
  if (/ett|tecnic|especif|bases/.test(n)) return true;
  if ((doc.metodo || '') === 'excel') return true;
  return /detalle|descrip/i.test(doc.texto) && /\bcant/i.test(doc.texto);
}

// Recorre los documentos candidatos y devuelve el MEJOR resultado (más ítems; a igualdad,
// el que detecte líneas y luego categorías). Si ninguno califica → null.
export function parsearPlanillaCosteo(docs: DocTexto[]): PlanillaParseResult | null {
  let mejor: PlanillaParseResult | null = null;
  for (const doc of docs) {
    if (!doc.texto || doc.texto.length < 40) continue;
    if (!esCandidato(doc)) continue;
    const r = parsearDoc(doc);
    if (!r) continue;
    const mejorScore = (m: PlanillaParseResult) => m.items.length * 100 + m.lineas.length * 10 + m.categorias.length;
    if (!mejor || mejorScore(r) > mejorScore(mejor)) mejor = r;
  }
  return mejor;
}
