// app/lib/auditor-segmentacion.ts
// PARTE PURA (sin IA, sin BD) del Auditor Técnico: parte un documento largo en BLOQUES por ítem
// y mapea cada bloque a la línea del checklist que le corresponde.
//
// POR QUÉ EXISTE (19-ago-2026, caso real 3489-29-LP26, reportado por el usuario): "Comparar
// contra un documento" mandaba el texto COMPLETO de la ficha (28 páginas, 36.000 caracteres, 88
// productos) a la IA UNA VEZ POR CADA LÍNEA. Dos problemas de fondo:
//   1) Precisión: pedirle al modelo "dime la capacidad de la balanza" con 88 productos delante es
//      buscar una aguja en un pajar — se contamina con los valores del producto vecino.
//   2) Costo/tiempo: 88 líneas × 36.000 caracteres = ~3 millones de tokens de entrada y decenas
//      de minutos secuenciales. Ninguna petición HTTP sobrevive eso.
// Segmentando, cada línea se compara SOLO contra su propio párrafo: la llamada es corta, precisa
// y barata, y el trabajo completo cabe en lotes paralelos.
//
// El mapeo va por NOMBRE, no por número. En 3489-29-LP26 las especificaciones vienen en DOS
// documentos ("Equipos" y "Equipamiento"), cada uno con su propia numeración desde ÍTEM 1, y la
// ficha del proveedor los mezcla en orden alfabético: el "ÍTEM 1" de un documento no es la
// "Línea 1" del checklist. El número solo sirve como desempate cuando el nombre ya concuerda.

export interface BloqueDocumento {
  /** Número de ítem tal como lo rotula el documento (null si el encabezado no lo trae). */
  numero: number | null;
  /** Título/nombre del producto según el documento. */
  titulo: string;
  /** Texto completo del bloque, encabezado incluido. */
  texto: string;
}

export interface LineaAMapear { linea: number; nombre: string }

export interface Mapeo {
  /** linea del checklist → bloque del documento. Solo pares por sobre el umbral de parecido. */
  porLinea: Map<number, BloqueDocumento>;
  /** Bloques del documento que no calzaron con ninguna línea (informativo, para el resumen). */
  sobrantes: BloqueDocumento[];
}

// ─── Normalización ──────────────────────────────────────────────────────────────────────────────

/** Minúsculas, sin tildes, sin puntuación, espacios colapsados. Base de toda comparación. */
export function normalizarNombre(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Palabras que no distinguen un producto de otro: si "de" y "con" cuentan como coincidencia,
// "SILLA DE RUEDAS" y "MESA DE PASTEUR" parecen parecidas. Se descartan al comparar.
const VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'o', 'con', 'sin', 'para', 'por', 'en', 'a',
  'un', 'una', 'al', 'su', 'tipo', 'item', 'items', 'linea', 'n', 'nro', 'no',
]);

function tokens(s: string): string[] {
  return normalizarNombre(s).split(' ').filter(t => t.length > 1 && !VACIAS.has(t));
}

/**
 * Parecido entre dos nombres de producto, 0-1 (coeficiente de Dice sobre palabras significativas).
 * Dice y no "incluye la subcadena" porque los nombres se escriben distinto en cada documento:
 * "BALANZA ADULTO CON TALLIMETRO" (ficha) vs "BALANZA ADULTO CON TALLÍMETRO" (bases) vs
 * "Balanza adulto c/ tallímetro" (catálogo del proveedor) tienen que dar todos alto.
 */
export function parecido(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Map<string, number>();
  for (const t of tb) setB.set(t, (setB.get(t) || 0) + 1);
  let comunes = 0;
  for (const t of ta) {
    const n = setB.get(t) || 0;
    if (n > 0) { comunes++; setB.set(t, n - 1); }
  }
  return (2 * comunes) / (ta.length + tb.length);
}

// ─── Segmentación ───────────────────────────────────────────────────────────────────────────────

// Encabezado explícito: "ÍTEM 12: NOMBRE", "ITEM N°12 - NOMBRE", "Item 12. NOMBRE".
const RE_ITEM_ROTULADO = /^[ \t>*#|]*[íi]tem\s*(?:n[°º.]?\s*)?(\d{1,3})\s*[:.\-–—)]?\s*(.*)$/i;
// Encabezado de tabla del proveedor: la fila empieza con el número y sigue el nombre en MAYÚSCULAS.
// Se exige MAYÚSCULAS para no confundir "3 compartimientos de almacenamiento" con un ítem nuevo.
// NO se ancla al fin de línea: cuando el PDF aplana la tabla, el nombre y la descripción quedan
// en el mismo renglón ("5 BOMBA ASPIRACION  Bomba de aspiración portátil de sobremesa…") —
// anclar con $ dejaba fuera 15 de los 88 productos de la ficha real de 3489-29-LP26.
// El grupo del título se lleva el RESTO del renglón (`.*`) a propósito: si la clase de mayúsculas
// cortara sola, se detendría en la primera minúscula y arrastraría la inicial de la palabra
// siguiente ("4 BALANZA ADULTO Balanza mecánica…" daba el título "BALANZA ADULTO B"). Quien corta
// de verdad es recortarTitulo(), que sabe distinguir esa inicial de una unidad legítima
// ("72 PAPELERO OFICINA 10 L Papelero abierto…" tiene que conservar la L de litros).
const RE_NUMERO_MAYUSCULAS = /^[ \t>*#|]*(\d{1,3})[.\-–—)]?\s+([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ0-9°/()\-.,"'\s]{3,}.*)$/;

/** ¿Esta línea es la continuación en MAYÚSCULAS de un título partido por el salto de celda? */
function esContinuacionDeTitulo(l: string): boolean {
  const t = l.trim();
  if (!t || t.length > 60) return false;
  if (!/[A-ZÁÉÍÓÚÑÜ]/.test(t)) return false;
  // Sin minúsculas (salvo unidades sueltas) y sin puntuación de frase.
  return !/[a-záéíóúñü]{3}/.test(t) && !/[.:;]$/.test(t);
}

/** Recorta el título cuando la misma línea sigue con la descripción en minúsculas
 *  ("72 PAPELERO OFICINA 10 L Papelero abierto sin tapa..." → "PAPELERO OFICINA 10 L"). */
function recortarTitulo(resto: string): string {
  const m = resto.match(/^([A-ZÁÉÍÓÚÑÜ0-9°/()\-.,\s]+?)(?=\s+[A-ZÁÉÍÓÚÑÜ]?[a-záéíóúñü]{2,})/);
  return limpiarTitulo(m ? m[1] : resto);
}

/**
 * Quita del título los metadatos que el OCR pega en el mismo renglón. Real en 3489-29-LP26:
 * "## ITEM 7: COMPUTADOR Cantidad: 10 unidades" — con "Cantidad: 10 unidades" adentro, el
 * parecido contra la línea "COMPUTADOR" caía a 0,4 y ese ítem quedaba sin especificaciones.
 */
function limpiarTitulo(s: string): string {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .split(/\b(?:cantidad|cant\.?|unidades|unidad|especificaciones)\b/i)[0]
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s,.:;\-–—]+$/, '');
}

/**
 * Guardia contra falsos encabezados en el camino heurístico: los ítems de un listado están
 * NUMERADOS EN ORDEN (1, 2, 3…), así que se conserva solo la subsecuencia creciente más larga.
 * Una fila de descripción que empieza con número y sigue en mayúsculas ("1 USB Type C de 10
 * Gb…", dentro del ítem 7) rompe el orden y se descarta sola, sin listas de excepciones.
 */
function soloSecuenciaCreciente<T extends { numero: number | null }>(marcas: T[]): T[] {
  if (marcas.length < 2) return marcas;
  // LIS clásica en O(n²): n es el número de encabezados candidatos (decenas), no de líneas.
  const largo = marcas.map(() => 1);
  const previo = marcas.map(() => -1);
  let mejor = 0;
  for (let i = 0; i < marcas.length; i++) {
    for (let j = 0; j < i; j++) {
      const nj = marcas[j].numero ?? -Infinity, ni = marcas[i].numero ?? Infinity;
      if (nj < ni && largo[j] + 1 > largo[i]) { largo[i] = largo[j] + 1; previo[i] = j; }
    }
    if (largo[i] > largo[mejor]) mejor = i;
  }
  const out: T[] = [];
  for (let k = mejor; k >= 0; k = previo[k]) out.unshift(marcas[k]);
  return out;
}

/**
 * Parte un documento en bloques, uno por ítem/producto. Devuelve [] si no encuentra una
 * estructura creíble — el llamador debe entonces caer al documento completo, no inventar cortes.
 */
export function segmentarPorItems(texto: string): BloqueDocumento[] {
  const lineas = String(texto || '').split(/\r?\n/);
  type Marca = { i: number; numero: number | null; titulo: string; rotulado: boolean };
  const marcas: Marca[] = [];

  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    let m = l.match(RE_ITEM_ROTULADO);
    if (m) {
      let titulo = limpiarTitulo(m[2]);
      // Título en la línea siguiente ("ÍTEM 5:" y abajo el nombre).
      if (!titulo && i + 1 < lineas.length) titulo = limpiarTitulo(lineas[i + 1]);
      marcas.push({ i, numero: Number(m[1]), titulo, rotulado: true });
      continue;
    }
    m = l.match(RE_NUMERO_MAYUSCULAS);
    if (m) {
      let titulo = recortarTitulo(m[2]);
      // Título partido en dos filas de celda: "1 BALANZA ADULTO CON" / "TALLIMETRO".
      let j = i + 1;
      while (j < lineas.length && esContinuacionDeTitulo(lineas[j]) && titulo.length < 90) {
        titulo += ` ${lineas[j].trim()}`;
        j++;
      }
      titulo = titulo.trim();
      if ((titulo.match(/[A-ZÁÉÍÓÚÑÜ]/g) || []).length >= 5) marcas.push({ i, numero: Number(m[1]), titulo, rotulado: false });
    }
  }

  // Los encabezados ROTULADOS ("ÍTEM 3:") son inequívocos. Si hay aunque sea unos pocos, se
  // ignoran los detectados por heurística de mayúsculas: mezclarlos parte el documento de más
  // (dentro de un ítem rotulado hay filas numeradas de especificaciones que también matchean).
  const rotuladas = marcas.filter(m => m.rotulado);
  const usadas = rotuladas.length >= 2 ? rotuladas : soloSecuenciaCreciente(marcas);
  if (usadas.length < 2) return [];

  const out: BloqueDocumento[] = [];
  for (let k = 0; k < usadas.length; k++) {
    const desde = usadas[k].i;
    const hasta = k + 1 < usadas.length ? usadas[k + 1].i : lineas.length;
    const cuerpo = lineas.slice(desde, hasta).join('\n').trim();
    if (!usadas[k].titulo) continue;
    out.push({ numero: usadas[k].numero, titulo: usadas[k].titulo.slice(0, 200), texto: cuerpo });
  }
  return out;
}

// ─── Mapeo bloque ↔ línea del checklist ─────────────────────────────────────────────────────────

/** Bajo esto, dos nombres no son el mismo producto. Preferimos dejar una línea sin bloque (se
 *  compara contra el documento completo, como antes) a cruzarla con el producto equivocado. */
export const UMBRAL_PARECIDO = 0.55;

/**
 * Empareja cada línea del checklist con un bloque del documento. Greedy sobre el parecido
 * global: se resuelven primero los pares más claros, así "SILLA DE RUEDAS" no se lleva el bloque
 * de "SILLA DE RUEDAS BARIATRICA" cuando ese bloque tiene dueño mejor.
 */
export function mapearBloquesALineas(lineas: LineaAMapear[], bloques: BloqueDocumento[]): Mapeo {
  const pares: Array<{ linea: number; idx: number; score: number }> = [];
  lineas.forEach(l => {
    bloques.forEach((b, idx) => {
      let score = parecido(l.nombre, b.titulo);
      // El número solo desempata entre candidatos que YA se parecen: numeraciones distintas
      // entre documentos son la norma, no la excepción.
      if (score >= UMBRAL_PARECIDO && b.numero === l.linea) score += 0.05;
      if (score >= UMBRAL_PARECIDO) pares.push({ linea: l.linea, idx, score });
    });
  });
  pares.sort((a, b) => b.score - a.score);

  const porLinea = new Map<number, BloqueDocumento>();
  const bloquesUsados = new Set<number>();
  for (const p of pares) {
    if (porLinea.has(p.linea) || bloquesUsados.has(p.idx)) continue;
    porLinea.set(p.linea, bloques[p.idx]);
    bloquesUsados.add(p.idx);
  }
  return { porLinea, sobrantes: bloques.filter((_, i) => !bloquesUsados.has(i)) };
}

// ─── Características exigidas dentro de un bloque de bases técnicas ─────────────────────────────

/**
 * Saca la lista de requisitos de un bloque de ESPECIFICACIONES TÉCNICAS, sin IA.
 * Las bases chilenas casi siempre traen una tabla "N° | Especificación | Condición y puntaje";
 * cuando el OCR la conservó como HTML se leen las celdas, y si no (OCR degradado a texto plano)
 * se cae a una fila por renglón. El resultado alimenta al Agente 1 (clasificarCaracteristicasLinea),
 * que es quien decide PISO/TECHO/EXACTO/RANGO — acá solo se separa el texto, no se interpreta.
 */
export function caracteristicasDeBloque(bloque: BloqueDocumento): string[] {
  const out: string[] = [];

  if (/<t[dr]\b/i.test(bloque.texto)) {
    for (const fila of bloque.texto.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []) {
      const celdas = (fila.match(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi) || [])
        .map(c => c.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
      if (!celdas.length) continue;
      // La celda con más texto es la especificación; las otras son N°, "OBLIGATORIA", puntaje.
      const spec = celdas.reduce((a, b) => (b.length > a.length ? b : a), '');
      if (esRequisitoUtil(spec)) out.push(spec);
    }
  }

  if (!out.length) {
    for (const raw of bloque.texto.split(/\r?\n/).slice(1)) {
      const l = raw.replace(/<[^>]+>/g, ' ').replace(/[|\[\]]+/g, ' ').replace(/\s+/g, ' ').trim()
        .replace(/^\d{1,3}[.\-–—)]?\s*/, '');   // numeración de la fila
      if (esRequisitoUtil(l)) out.push(l);
    }
  }

  // Dedupe conservando el orden (el OCR repite encabezados de tabla entre páginas).
  const vistos = new Set<string>();
  return out.filter(c => {
    const k = normalizarNombre(c);
    if (!k || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  }).slice(0, 60);
}

// Ruido típico del OCR de estas tablas: encabezados, la columna "Condición", pies de página.
const RUIDO = /^(n[°º]?|especificaciones? t[eé]cnicas?|condici[oó]n y puntaje|caracter[ií]sticas generales|obligatoria|deseable|cantidad\b|imagen referencial|item\b|[íi]tem\b|p[áa]gina\b|\d+)\s*$/i;

function esRequisitoUtil(s: string): boolean {
  const t = s.trim();
  if (t.length < 12 || t.length > 400) return false;
  if (RUIDO.test(t)) return false;
  // Necesita al menos unas palabras reales: descarta basura de OCR tipo "E NANA MAT Aus".
  return (t.match(/[a-záéíóúñü]{3,}/gi) || []).length >= 2;
}
