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

// ¿Header de una tabla de CUMPLIMIENTO/especificaciones técnicas? (Formulario ETT:
// "Ítem | Características técnicas | Cumple Si/No | N° página | Observaciones").
// Sus filas son REQUISITOS (certificaciones, garantías, postventa…), NO productos a
// cotizar: si entrara al manifiesto, el costeo se llena de basura.
function esHeaderEspecificaciones(celdas: string[]): boolean {
  const n = celdas.map(normalizar).join(' | ');
  if (/cumple/.test(n) && /si\s*\/?\s*no/.test(n)) return true;
  if (/caracteristicas?\s+tecnicas?/.test(n) && !/cantidad/.test(n)) return true;
  if (/criterios?\s+de\s+evaluacion/.test(n)) return true;
  return false;
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
  // "FORMULARIO Línea N°1: analizador de…" / "FORMATO LÍNEA 2 - …" (una ficha por producto)
  m = t.match(/^\s*(?:formulario|formato)\s+l[ií]nea\s*n?\s*[°º]?\s*(\d{1,3})/i);
  if (m) return parseInt(m[1], 10);
  m = t.match(/^\s*lote\s*n?\s*[°º]?\s*(\d{1,3})\s*[:\-.)]/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

// Escaneo liviano sobre TODOS los documentos: números de línea mencionados en títulos
// "FORMULARIO Línea N°X" / "Línea N°X:". Sirve como señal de modalidad por_linea aunque
// el parser no logre extraer una planilla de cotización (p.ej. bases escaneadas donde
// solo hay fichas técnicas por línea, sin tabla de precios).
export function detectarLineasFormulario(docs: { texto: string }[]): number[] {
  const set = new Set<number>();
  // SOLO títulos de ficha ("FORMULARIO Línea N°X", "FICHA LÍNEA 2"): un listado de
  // productos "LINEA 1 BUTACA…" NO cuenta — eso es un correlativo de ítems, no fichas.
  const re = /(?:formulario|formato|ficha)\s+l[ií]nea\s*n?\s*[°º]?\s*(\d{1,3})/gi;
  for (const d of docs) {
    if (!d.texto) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(d.texto)) !== null) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 200) set.add(n);
    }
    re.lastIndex = 0;
  }
  return [...set].sort((a, b) => a - b);
}

// ¿El formulario de OFERTA ECONÓMICA exige un ÚNICO total consolidado? (regla del
// experto: el formato de la oferta económica MANDA sobre cómo se adjudica — un solo
// "Monto total neto/IVA incluido" al pie de la planilla = SUMA ALZADA, aunque las bases
// hablen de "adjudicación por línea"). Busca el título del formulario económico y un
// "monto/precio total" global en su vecindad.
//
// OJO (falso positivo real): en una planilla POR ÍTEM (una fila por producto con su
// "VALOR UNITARIO" y su "TOTAL IVA INCLUIDO") el "total" es un ENCABEZADO DE COLUMNA, NO
// un gran total al pie. Por eso, cada aparición de "total" se descarta si está pegada a
// "valor/precio unitario" (fila de encabezados de una tabla por-ítem = por_linea).
export function detectarOfertaTotalUnico(docs: { texto: string }[]): boolean {
  const reTitulo = /formulario\s+e\s*-?\s*1|oferta\s+econ[oó]mica|anexo\s+econ[oó]mico/gi;
  const reTotal = /monto\s+total\s+(neto|iva|general)|precio\s+total\s+(neto\s+)?(final|general)|total\s+(general|neto)\s+(de\s+la\s+)?oferta|costo\s+total\s+(de\s+la\s+)?oferta|valor\s+total\s+ofertad|total\s+iva\s+incluido/gi;
  for (const d of docs) {
    if (!d.texto) continue;
    let m: RegExpExecArray | null;
    reTitulo.lastIndex = 0;
    while ((m = reTitulo.exec(d.texto)) !== null) {
      const ventana = d.texto.slice(m.index, m.index + 6000);
      // Si la misma ventana pide un total POR LÍNEA/LOTE, no es total único.
      if (/total\s+(por\s+)?l[ií]nea|total\s+(por\s+)?lote/i.test(ventana)) continue;
      // BLOQUE DE CIERRE "Subtotal … IVA … Total": trío de consolidación al pie de la
      // planilla (suma de todos los ítems) = SUMA ALZADA, aunque la tabla tenga columna
      // "Precio Unitario" por ítem y aunque las bases digan "adjudica por línea o ítem".
      // Es distinto de una columna "TOTAL IVA INCLUIDO" por fila (por_linea): ahí NO hay
      // "Subtotal". Cubre el formato hiper-común "Ítem|Precio Unitario| … Subtotal/IVA/Total".
      if (/\bsub\s*total\b[\s\S]{0,60}\biva\b[\s\S]{0,60}\btotal\b/i.test(ventana)) return true;
      let t: RegExpExecArray | null;
      reTotal.lastIndex = 0;
      while ((t = reTotal.exec(ventana)) !== null) {
        // Vecindad del "total" (antes y después): si viene junto a un contexto de CÁLCULO
        // POR ÍTEM — "VALOR/PRECIO UNITARIO", "cálculo del…", "debe aplicar", "cantidad ×" —
        // es la columna "total" de una planilla por-ítem o la nota de cómo calcularla (cada
        // fila su propio total), NO un gran total consolidado al pie → no cuenta como total
        // único (es indicio de por_linea).
        const sub = ventana.slice(Math.max(0, t.index - 200), t.index + 160);
        if (/valor\s+unitario|precio\s+unitario|p\.?\s*unit|c[aá]lculo\s+del|debe\s+aplicar|cantidad\s*[x×*]/i.test(sub)) continue;
        // GUARD DE CONTEXTO NEGATIVO: "monto/precio total" también aparece en textos que NO
        // son el pie del formulario económico y NO prueban suma alzada: cláusula de GARANTÍA
        // ("5% del monto total neto del contrato"), FÓRMULA de evaluación ("O.E. = Monto Total
        // Neto Menor Ofertado"), ACTA de adjudicación ("MONTO TOTAL NETO ADJUDICADO"), notas de
        // corrección/consistencia. Si la vecindad trae ese contexto, no cuenta como total único.
        const ctx = ventana.slice(Math.max(0, t.index - 150), t.index + 150);
        if (/garant|boleta|fiel\s+cumpl|seriedad|f[oó]rmula|menor\s+ofertad|puntaj|ponderaci|adjudicad|\bacta\b|correcci[oó]n|\bmulta|contrato/i.test(ctx)) continue;
        return true;
      }
    }
  }
  return false;
}

// LENGUAJE EXPLÍCITO de modalidad por-línea en las bases (la declaración más directa del
// "cómo se cotiza": se oferta y evalúa CADA línea/producto por separado). Es la señal más
// confiable y no dependía de nadie determinista hasta ahora. Devuelve la frase textual
// hallada (para citarla como evidencia) o null.
// NO incluye "adjudicación por línea/ítem" a secas: eso es "a quién se adjudica"
// (adjudicación múltiple), no "cómo se cotiza" — por doctrina no gatilla por_linea.
export function detectarLenguajePorLinea(docs: { texto: string }[]): string | null {
  const re = /ofertar\s+(?:por\s+)?(?:la\s+)?l[ií]nea\s+de\s+producto|se\s+evaluar[aá]\s+cada\s+l[ií]nea(?:\s+de\s+manera\s+individual)?|cada\s+l[ií]nea\s+(?:se\s+evaluar[aá]|ser[aá]\s+evaluada)\s+de\s+manera\s+individual|podr[aá]n?\s+ofertar\s+(?:una\s+o\s+m[aá]s|por)\s+l[ií]neas?|se\s+evaluar[aá]n?\s+(?:[uú]nicamente\s+)?las\s+l[ií]neas\s+que|omitir\s+l[ií]neas\s+de\s+producto|completar\s+seg[uú]n\s+la\s+l[ií]nea|l[ií]nea\s+a\s+la\s+cual\s+postula|s[oó]lo\s+deber[aá]\s+completar\s+los\s+campos\s+en\s+aquellas\s+l[ií]neas|(?:campos\s+de\s+)?las\s+dem[aá]s\s+l[ií]neas\s+(?:deber[aá]\s+)?mantener|mantener\w*\s+en\s+blanco\s+(?:los\s+campos\s+de\s+)?las\s+dem[aá]s\s+l[ií]neas/i;
  for (const d of docs) {
    if (!d.texto) continue;
    const m = d.texto.match(re);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
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
// Numeración compuesta "1.1" / "2.13" / "3.1.2": la parte entera es la LÍNEA/grupo y la
// fracción el correlativo del ítem dentro de ella (patrón típico de planillas por línea).
const esCompuesto = (s: string) => /^\d{1,3}\.\d{1,3}(\.\d{1,3})?$/.test(limpiarCelda(s));
const parteLinea = (s: string) => parseInt(limpiarCelda(s).split('.')[0], 10);
const parteItem  = (s: string) => parseInt(limpiarCelda(s).split('.')[1], 10);
const aNumero = (s: string): number | null => {
  const t = limpiarCelda(s).replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) && t !== '' ? n : null;
};

type ItemExtraido = Omit<ItemPlanilla, 'categoria' | 'linea'> & { lineaCompuesta?: number };

function extraerItem(celdas: string[], col: ColMap | null): ItemExtraido | null {
  if (col) {
    const desc = limpiarCelda(celdas[col.desc] || '');
    if (desc.length < 2) return null;
    const numRaw = col.num >= 0 ? celdas[col.num] : '';
    if (col.num >= 0 && !esEntero(numRaw) && !esCompuesto(numRaw)) return null;
    const unidad = col.unidad >= 0 ? limpiarCelda(celdas[col.unidad] || '') : '';
    const cantidad = col.cant >= 0 ? aNumero(celdas[col.cant] || '') : null;
    if (esCompuesto(numRaw)) {
      return { numero: parteItem(numRaw), lineaCompuesta: parteLinea(numRaw), descripcion: desc, unidad, cantidad };
    }
    const numero = esEntero(numRaw) ? Number(limpiarCelda(numRaw)) : null;
    return { numero, descripcion: desc, unidad, cantidad };
  }
  const idxNum = celdas.findIndex(c => esEntero(c) || esCompuesto(c));
  if (idxNum < 0) return null;
  const numRaw = celdas[idxNum];
  const desc = limpiarCelda(celdas[idxNum + 1] || '');
  if (desc.length < 2 || !/[a-záéíóúñ]/i.test(desc)) return null;
  const base = {
    descripcion: desc,
    unidad: limpiarCelda(celdas[idxNum + 2] || ''),
    cantidad: aNumero(celdas[idxNum + 3] || ''),
  };
  if (esCompuesto(numRaw)) {
    return { numero: parteItem(numRaw), lineaCompuesta: parteLinea(numRaw), ...base };
  }
  return { numero: Number(limpiarCelda(numRaw)), ...base };
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
  let vioCompuesta = false;
  let vioFilaPlana = false;
  // Dentro de una tabla de cumplimiento/ETT ("Cumple Si/No"): sus filas NO son productos.
  let enTablaEspec = false;

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
    if (!celdas) {
      // Fila PLANA de listado (Anexo N°2 estilo texto): "1 3 BUTACA 4 CUERPOS $ 360.000.-"
      // → correlativo, cantidad, descripción y precio referencial, sin pipes ni comas.
      // Es la forma en que pdf-text aplana las tablas de varios organismos.
      if (!enTablaEspec) {
        const mp = cruda.match(/^\s*(\d{1,3})\s+(\d{1,4})\s+([A-ZÁÉÍÓÚÑ(][^$|]{2,90}?)\s+\$\s*([\d.,]+)/);
        if (mp) {
          const desc = limpiarCelda(mp[3]);
          if (desc.length >= 3 && /[a-záéíóúñ]/i.test(desc) && !PALABRAS_NO_ITEM.test(desc)) {
            vioFilaPlana = true;
            items.push({
              linea: vioLineaExplicita ? lineaActual : 1,
              categoria: categoriaActual,
              numero: parseInt(mp[1], 10),
              descripcion: desc,
              unidad: '',
              cantidad: parseInt(mp[2], 10),
            });
          }
        }
      }
      continue;
    }

    if (esHeaderEspecificaciones(celdas)) { enTablaEspec = true; col = null; continue; }

    const header = detectarHeader(celdas);
    if (header) { col = header; vistoHeader = true; enTablaEspec = false; continue; }

    if (enTablaEspec) continue; // requisitos de cumplimiento, no ítems a cotizar

    const cat = detectarCategoria(celdas);
    if (cat) {
      categoriaActual = cat;
      if (!catsOrden.includes(cat)) catsOrden.push(cat);
      continue;
    }

    const it = extraerItem(celdas, col);
    if (!it) continue;
    if (PALABRAS_NO_ITEM.test(it.descripcion)) continue;
    const { lineaCompuesta, ...resto } = it;
    // Numeración compuesta "L.i": la parte entera manda como línea del ítem.
    const lineaItem = lineaCompuesta ?? (vioLineaExplicita ? lineaActual : 1);
    if (lineaCompuesta != null) {
      vioCompuesta = true;
      if (!lineasOrden.includes(lineaCompuesta)) lineasOrden.push(lineaCompuesta);
    } else if (vioLineaExplicita && !lineasOrden.includes(lineaActual)) {
      lineasOrden.push(lineaActual);
    }
    items.push({ linea: lineaItem, categoria: categoriaActual, ...resto });
  }

  // Con numeración compuesta, las filas de número ENTERO intercaladas son títulos de
  // grupo/sección ("1 | Características generales"), no productos → fuera del manifiesto.
  if (vioCompuesta) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const esTituloGrupo = it.cantidad == null && !it.unidad &&
        items.some(o => o !== it && o.linea === it.numero && o.cantidad != null);
      if (esTituloGrupo && !vioLineaExplicita) items.splice(i, 1);
    }
  }

  if (items.length < 8) return null;
  if (!vistoHeader && catsOrden.length === 0 && !vioLineaExplicita && !vioCompuesta && !vioFilaPlana) return null;

  // GATE DE COTIZACIÓN: una planilla de oferta económica real trae CANTIDADES. Si casi
  // ninguna fila tiene cantidad, esto es un checklist/formulario (ETT, criterios, socios…)
  // y NO debe alimentar el manifiesto ni el Excel de costeo.
  const conCantidad = items.filter(i => i.cantidad != null && i.cantidad > 0).length;
  if (conCantidad < Math.max(3, Math.ceil(items.length * 0.25))) return null;

  // PATRÓN DE NUMERACIÓN — el discriminador clave suma_alzada vs por_linea. Manda por
  // sobre los títulos "LÍNEA N": una planilla numerada de corrido 1..N es suma alzada
  // aunque venga partida en hojas/secciones tituladas "Línea N".
  let numeracion = analizarNumeracion(items);
  let lineasFinal = lineasOrden;
  let estructura: PlanillaParseResult['estructura'];

  if (vioCompuesta) {
    // Numeración compuesta "L.i" (1.1, 1.2 … 2.1, 2.2): la parte entera ES la línea/lote.
    // Es el patrón más explícito de todos → manda sobre el resto de heurísticas.
    lineasFinal = [...new Set(items.map(it => it.linea))].sort((a, b) => a - b);
    estructura = lineasFinal.length >= 2 ? 'por_linea' : 'plana';
    numeracion = lineasFinal.length >= 2 ? 'reinicia' : numeracion;
  } else if (numeracion === 'reinicia' && vioLineaExplicita) {
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
  // NUNCA parsear NUESTROS propios archivos generados (COSTEO_*) ni los "documentos propios"
  // que sube el usuario: el Excel de costeo trae 1 hoja por línea → el parser lo leería como
  // por_linea, contaminando la detección suma_alzada vs por_linea (bucle de realimentación).
  // (La ruta generar-costeo ya excluye estos mismos al armar el manifiesto; aquí se replica.)
  if (/^costeo_/i.test(doc.nombre)) return false;
  if ((doc.categoria || '').toUpperCase() === 'DOCUMENTOS_PROPIOS') return false;

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
