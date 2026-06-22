// app/lib/text-match.ts
// ─────────────────────────────────────────────────────────────────────────────
// Núcleo de matching de texto, COMPARTIDO por el cron del radar
// (app/api/cron/alertas/route.ts) y la búsqueda manual (app/lib/search-engine.ts).
//
// Razón de ser: hoy el cron hace `texto.includes(keyword)` literal → pierde
// coincidencias por tildes y plurales ("articulos" no pega en "artículos",
// "camara" no pega en "cámaras"). Este módulo normaliza, maneja plurales y
// compara por token con soporte de prefijo, sin perder lo bueno del substring
// intencional (keyword "electr" debe seguir cazando "eléctrico").
//
// Diseño FIELD-AWARE: la API batch de MP solo trae el Nombre; el detalle trae
// además Descripción, Items y Categoría (taxonomía oficial). El matcher pondera
// cada campo distinto para que el score sirva igual con o sin enriquecimiento.
// ─────────────────────────────────────────────────────────────────────────────

// Palabras vacías del español: no deben exigirse como token de una keyword
// multi-palabra ("articulos DE aseo" → exigir solo "articulos" y "aseo").
const STOPWORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'y', 'o', 'u', 'e', 'a', 'en', 'con', 'por', 'para', 'del', 'al',
  'su', 'sus', 'lo', 'se', 'que', 'mas',
]);

const MIN_TOKEN = 2; // largo mínimo de token útil (admite "pc", "tv", "ups")

/**
 * Normaliza texto para comparación: minúsculas, sin acentos/diacríticos
 * (ñ → n, á → a), sin puntuación, espacios colapsados.
 */
export function normalizar(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // elimina diacríticos combinantes
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Stemming ligero de plural español. Conservador a propósito: aplica a ambos
 * lados (keyword y texto), así que basta con que ambos colapsen al mismo radical.
 *   computadores → computador · sillas → silla · articulos → articulo
 * Casos irregulares (luz/luces, lápiz/lápices) los cubre el match por prefijo.
 */
export function stemLite(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

/** Tokeniza texto normalizado en palabras útiles (sin stopwords ni muy cortas). */
export function tokenizar(text: string): string[] {
  return normalizar(text)
    .split(' ')
    .filter(w => w.length >= MIN_TOKEN && !STOPWORDS.has(w));
}

// ── Índice de un campo de texto ya preparado ────────────────────────────────
// Precomputamos por campo: la forma normalizada (para frase/substring), el set
// de tokens exactos y el set de tokens "stemmeados". Construir esto una sola vez
// por licitación evita re-normalizar N veces (1 por keyword) en el cron.
interface CampoIndexado {
  norm: string;          // texto normalizado completo (para match de frase)
  tokens: Set<string>;   // tokens exactos
  stems: Set<string>;    // tokens stemmeados
}

function indexarCampo(text: string): CampoIndexado {
  const norm = normalizar(text);
  const palabras = norm.split(' ').filter(w => w.length >= MIN_TOKEN && !STOPWORDS.has(w));
  const tokens = new Set(palabras);
  const stems = new Set(palabras.map(stemLite));
  return { norm, tokens, stems };
}

// Campos buscables de una licitación, ya indexados. Reutilizable entre keywords.
// NO incluye organismo a propósito: la keyword es de producto/servicio, y matchear
// el nombre del comprador ("Servicio de Salud", "Municipalidad de…") sería ruido.
export interface LicitacionIndexada {
  nombre: CampoIndexado;
  descripcion: CampoIndexado;
  items: CampoIndexado;      // NombreProducto + Descripcion de items
  categoria: CampoIndexado;  // taxonomía oficial de Items.Categoria (muy buscable)
}

export interface CamposLicitacion {
  nombre?: string;
  descripcion?: string;
  items?: string;
  categoria?: string;
}

/** Indexa los campos de una licitación una sola vez para evaluar muchas keywords. */
export function indexarLicitacion(c: CamposLicitacion): LicitacionIndexada {
  return {
    nombre: indexarCampo(c.nombre || ''),
    descripcion: indexarCampo(c.descripcion || ''),
    items: indexarCampo(c.items || ''),
    categoria: indexarCampo(c.categoria || ''),
  };
}

// ── Match de un token de keyword contra un campo ────────────────────────────
// Un token de keyword "calza" en un campo si:
//   1. exacto           → set de tokens contiene el token
//   2. mismo radical    → set de stems contiene stemLite(token)
//   3. prefijo          → algún token del campo empieza con el de la keyword
//                         (preserva el substring intencional: "electr" → "electrico")
//   4. substring interno → solo si la keyword es larga (≥6): "vigilancia" caza
//                         "televigilancia". El umbral evita falsos positivos de
//                         keywords cortas ("aseo" NO debe cazar "paseo").
/**
 * ¿Un token de keyword "calza" con una palabra (ya normalizada)? Misma regla que
 * usa el matcher. Exportada para que el resaltado de la UI marque exactamente las
 * palabras que el matcher considera coincidentes (acento/plural/prefijo).
 */
export function tokenCalzaPalabra(kwToken: string, palabraNorm: string): boolean {
  if (palabraNorm === kwToken) return true;
  if (stemLite(palabraNorm) === stemLite(kwToken)) return true;
  if (kwToken.length >= 4 && palabraNorm.startsWith(kwToken)) return true;
  if (kwToken.length >= 6 && palabraNorm.includes(kwToken)) return true;
  return false;
}

function tokenEnCampo(token: string, campo: CampoIndexado): boolean {
  if (campo.tokens.has(token)) return true;
  if (campo.stems.has(stemLite(token))) return true;
  if (token.length >= 4) {
    for (const tw of campo.tokens) {
      if (tw.startsWith(token)) return true;
      if (token.length >= 6 && tw.includes(token)) return true;
    }
  }
  return false;
}

// Factor de relevancia por campo (0..1): qué tan fuerte es encontrar la keyword
// ahí. El Nombre es la señal máxima; la Categoría (taxonomía oficial) e Items le
// siguen; la Descripción complementa. Se usa como MULTIPLICADOR del score del
// campo, no como divisor — así un match perfecto en el título puntúa alto aunque
// la licitación no esté enriquecida (solo Nombre).
const FACTOR = { nombre: 1.0, categoria: 0.8, items: 0.7, descripcion: 0.65 };

export interface ResultadoMatch {
  match: boolean;       // ¿calzó la keyword completa?
  score: number;        // 0..1 para ordenar por relevancia
  fuentes: string[];    // campos donde se detectó ('titulo','descripcion','items','categoria')
}

/**
 * Evalúa una keyword (1 o varias palabras) contra una licitación ya indexada.
 *
 * Gate (match=true): TODOS los tokens de la keyword deben aparecer en AL MENOS
 * un campo (no necesariamente el mismo). Esto generaliza el `includes()` actual
 * añadiendo normalización, plurales y prefijo. Para keywords de varias palabras
 * es más laxo que exigir la frase contigua, pero el score premia la frase exacta.
 */
export function evaluarKeyword(idx: LicitacionIndexada, keyword: string): ResultadoMatch {
  const tokens = tokenizar(keyword);
  if (tokens.length === 0) return { match: false, score: 0, fuentes: [] };

  const campos: [keyof typeof FACTOR, CampoIndexado][] = [
    ['nombre', idx.nombre],
    ['categoria', idx.categoria],
    ['items', idx.items],
    ['descripcion', idx.descripcion],
  ];

  // Gate: cada token debe estar en algún campo
  const fuentesSet = new Set<string>();
  for (const token of tokens) {
    let encontrado = false;
    for (const [nombre, campo] of campos) {
      if (tokenEnCampo(token, campo)) {
        encontrado = true;
        fuentesSet.add(nombre);
      }
    }
    if (!encontrado) return { match: false, score: 0, fuentes: [] };
  }

  // Score: el campo más fuerte manda (un match en el título vale por sí solo),
  // más un pequeño bonus por cada campo adicional que también coincide (más
  // campos = más confianza). Cada campo: fracción de tokens cubiertos (+ bonus
  // si la frase aparece contigua) × su factor de relevancia.
  const fraseNorm = normalizar(keyword);
  let mejorCampo = 0;
  let camposHit = 0;
  for (const [nombre, campo] of campos) {
    const cubiertos = tokens.filter(t => tokenEnCampo(t, campo)).length / tokens.length;
    if (cubiertos === 0) continue;
    camposHit++;
    const fraseBonus = fraseNorm && campo.norm.includes(fraseNorm) ? 0.25 : 0;
    const campoScore = Math.min(cubiertos + fraseBonus, 1) * FACTOR[nombre];
    if (campoScore > mejorCampo) mejorCampo = campoScore;
  }
  const score = Math.min(mejorCampo + Math.max(0, camposHit - 1) * 0.05, 1);

  // Etiquetas legibles para la UI (compat con match_fuente actual: 'titulo')
  const fuentes: string[] = [];
  if (fuentesSet.has('nombre')) fuentes.push('titulo');
  if (fuentesSet.has('descripcion')) fuentes.push('descripcion');
  if (fuentesSet.has('items')) fuentes.push('items');
  if (fuentesSet.has('categoria')) fuentes.push('categoria');

  return { match: true, score, fuentes };
}
