// app/lib/costeo-ficha-producto.ts
// Ficha técnica de UN producto del costeo, extraída del link que el asistente pegó en el editor
// (link1/link2/link3, costeo-editor.ts) — no del PDF de un proveedor (eso es ficha-tecnica.ts,
// caso de uso distinto: la ficha que NOSOTROS presentamos). Acá es al revés: leer la página de la
// TIENDA donde se cotizó, para sacar lo que la ficha del fabricante normalmente trae.
//
// MEDIDO EN VIVO (04-sep-2026) con los links reales de DOS licitaciones, no genérico:
// - 2446-249-LE26: Sodimac (página de PRODUCTO, no de búsqueda): __NEXT_DATA__ trae
//   productData.attributes.specifications — 10 specs reales (garantía, material, medidas...).
//   Shopify (senaliza.cl, orbex.cl): JSON-LD Product.additionalProperty siempre vacío, pero la
//   `description` a veces trae prosa con datos técnicos reales.
// - 1271359-92-LE26 (BUG REAL reportado por el usuario, "esa página tiene ficha y no me la
//   encuentra"): 3 de 5 links son WooCommerce (ingequipos.cl, donlocker.cl, calas.cl) — NINGUNO
//   emite JSON-LD de tipo Product (solo WebPage/Organization/BreadcrumbList vía plugin SEO), así
//   que la cascada original (Sodimac → JSON-LD → null) los daba todos por perdidos aunque SÍ
//   tenían datos reales ricos. El dato vivía en `<meta name="description">` (NO en
//   `og:description`, que en el mismo sitio trae un resumen de marketing distinto y más pobre),
//   como texto "Clave: valor" línea por línea — ej. ingequipos: "Medidas: Altura 170 * Ancho 137
//   * Profundidad 45 CM.\nVolumen en caja: 0,0657 MT3\nMaterial: Acero laminado en frío...". Se
//   agregó un paso de cascada que parsea esas líneas con el mismo criterio de vocabulario acotado
//   que usa el resto del proyecto (nunca NLP genérico): clave corta (≤4 palabras) seguida de ":".
import { generarInformePdf } from '@/app/lib/generar-informe';

export interface EspecificacionProducto { clave: string; valor: string }

export type FuenteFichaProducto = 'sodimac_nextdata' | 'shopify_jsonld' | 'jsonld_generico' | 'meta_descripcion' | 'solo_imagen';

export interface FichaProductoExtraida {
  nombreTienda: string | null;
  marca: string | null;
  descripcion: string | null; // prosa libre, cuando no hay specs estructuradas
  especificaciones: EspecificacionProducto[];
  imagenUrl: string | null;
  fuente: FuenteFichaProducto;
  url: string;
}

const TIMEOUT_MS = 10_000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const LARGO_MIN_DESCRIPCION = 40;
const MAX_BYTES_IMAGEN = 4_000_000; // una foto de producto de 4MB ya es un error de carga, no una foto real

async function descargarHtml(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

// ── Paso Sodimac/VTEX-Next: __NEXT_DATA__.props.pageProps.productData.attributes.specifications
export function extraerDeSodimacNextData(html: string): { nombreTienda: string | null; especificaciones: EspecificacionProducto[] } | null {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    const pd = data?.props?.pageProps?.productData;
    const specsRaw = pd?.attributes?.specifications;
    if (!Array.isArray(specsRaw) || !specsRaw.length) return null;
    const especificaciones: EspecificacionProducto[] = specsRaw
      .filter((s: any) => s?.name && s?.value != null && String(s.value).trim())
      .map((s: any) => ({ clave: String(s.name).trim(), valor: String(s.value).trim() }));
    if (!especificaciones.length) return null;
    return { nombreTienda: (pd?.name || pd?.title || null), especificaciones };
  } catch {
    return null;
  }
}

// Shopify a veces llena additionalProperty con metadata de CATÁLOGO (Tags, Title genérico "Default
// Title", Type, Vendor), no con especificaciones del producto — caso real playplaza.cl (1271359-92-LE26):
// additionalProperty=[{name:"Tags",value:["Bancas y Escaños"]},{name:"Title",value:["Default Title"]}],
// nada de eso es una característica física. Se descartan por nombre antes de contarlas como "specs reales".
const RE_PROPIEDAD_CATALOGO_NO_SPEC = /^(tags?|title|type|vendor|handle|available|sku|status)$/i;

// ── Paso JSON-LD estándar (schema.org/Product) — Shopify y genérico
export function extraerDeJsonLd(html: string): { nombreTienda: string | null; marca: string | null; descripcion: string | null; especificaciones: EspecificacionProducto[] } | null {
  const bloques = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  for (const b of bloques) {
    let j: any;
    try { j = JSON.parse(b[1]); } catch { continue; }
    if (j?.['@type'] !== 'Product') continue;

    const especificaciones: EspecificacionProducto[] = Array.isArray(j.additionalProperty)
      ? j.additionalProperty
          .filter((p: any) => p?.name && !RE_PROPIEDAD_CATALOGO_NO_SPEC.test(String(p.name).trim()) && p?.value != null && String(p.value).trim())
          .map((p: any) => ({ clave: String(p.name).trim(), valor: String(p.value).trim() }))
      : [];

    const descripcionCruda = typeof j.description === 'string' ? j.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    // Largo mínimo NO alcanza (caso real Orbex: "Señaléticas cuya finalidad es notificar a los
    // usuarios de las vías..." mide más de 40 caracteres y es puro marketing). Se exige además AL
    // MENOS un dato numérico (medida, %, etc.) — proxy simple pero real de "esto describe una
    // característica medible", no solo "hay texto".
    const descripcion = (descripcionCruda.length >= LARGO_MIN_DESCRIPCION && /\d/.test(descripcionCruda)) ? descripcionCruda : null;

    if (!especificaciones.length && !descripcion) continue; // este bloque no aporta nada, seguir buscando otro

    return {
      nombreTienda: typeof j.name === 'string' ? j.name : null,
      marca: typeof j.brand?.name === 'string' ? j.brand.name : null,
      descripcion,
      especificaciones,
    };
  }
  return null;
}

export function esShopify(html: string): boolean {
  return /cdn\.shopify\.com|Shopify\.shop/.test(html);
}

// ── Imagen del producto: og:image primero (universal — medido 7/7 en los links reales de ambas
// licitaciones, incluidos los WooCommerce sin JSON-LD de producto), JSON-LD Product.image como
// respaldo. Solo la URL — la descarga+conversión a data: URI es aparte (generarFichaProductoPdf),
// porque acá el módulo sigue siendo "leer la página", no "traer bytes de imagen".
export function extraerImagenUrl(html: string): string | null {
  const og = /<meta\s+property="og:image"\s+content="([^"]*)"/i.exec(html);
  if (og?.[1]) return decodificarEntidadesHtml(og[1]);

  const bloques = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  for (const b of bloques) {
    let j: any;
    try { j = JSON.parse(b[1]); } catch { continue; }
    if (j?.['@type'] !== 'Product') continue;
    const img = j.image;
    const url = Array.isArray(img) ? img[0] : img;
    if (typeof url === 'string' && url.trim()) return url.trim();
  }
  return null;
}

/**
 * Descarga una imagen y la devuelve como data: URI — generarInformePdf carga el HTML con
 * setContent SIN recursos externos (mismo motivo documentado en ficha-tecnica/route.ts:
 * comoDataUri), así que un `<img src="https://…">` no se resolvería. Si falla, se devuelve null y
 * la ficha sale sin foto: mejor una ficha sin imagen que ninguna ficha.
 */
async function descargarImagenComoDataUri(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES_IMAGEN) return null;
    const tipo = res.headers.get('content-type') || 'image/jpeg';
    if (!tipo.startsWith('image/')) return null;
    return `data:${tipo};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  } finally {
    clearTimeout(tid);
  }
}

function decodificarEntidadesHtml(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// Vocabulario de "clave corta: valor" — el mismo criterio que ya usa el resto del proyecto
// (ver anexos-precios-columnas.ts, anexos-auditor-fuente.ts): regla por texto, acotada, nunca un
// NLP genérico. La clave debe ser corta (≤4 palabras, ≤40 caracteres) para no capturar una
// oración completa que de casualidad tenga ":" (ej. "Para más info contactar a ventas: fulano@x.cl").
const RE_LINEA_CLAVE_VALOR = /^([A-ZÁÉÍÓÚÑ][^:\n]{1,39}):\s*(.+)$/;
function esClaveCorta(clave: string): boolean {
  return clave.trim().split(/\s+/).length <= 4;
}

export function extraerSpecsDeTexto(texto: string): EspecificacionProducto[] {
  const lineas = texto.split(/\n|<br\s*\/?>/i).map(l => l.trim()).filter(Boolean);
  const out: EspecificacionProducto[] = [];
  const vistas = new Set<string>();
  for (const linea of lineas) {
    const m = RE_LINEA_CLAVE_VALOR.exec(linea);
    if (!m) continue;
    const clave = m[1].trim();
    const valor = m[2].trim();
    if (!esClaveCorta(clave) || !valor || vistas.has(clave.toLowerCase())) continue;
    vistas.add(clave.toLowerCase());
    out.push({ clave, valor });
  }
  return out;
}

// ── Paso meta tags: `<meta name="description">` y `<meta property="og:description">` — el
// fallback más genérico posible, funciona en cualquier CMS (no solo WooCommerce). En el mismo
// sitio pueden traer contenido DISTINTO (caso real ingequipos.cl: og:description es un resumen
// de marketing corto, name="description" trae el texto completo con "Medidas:/Material:/..."),
// así que se prueban los dos y se usa el que rinda más.
// BUG REAL (ingequipos.cl, 1271359-92-LE26): la página trae DOS <meta name="description"> — uno
// corto de marketing (probable plugin SEO) y otro con el excerpt completo de WooCommerce
// ("Medidas:/Material:/..."). Tomar solo el PRIMER match perdía el bueno. Se devuelven TODOS.
function extraerMetaContents(html: string, attr: 'name' | 'property', valor: string): string[] {
  const re = new RegExp(`<meta\\s+${attr}="${valor}"\\s+content="([^"]*)"`, 'gi');
  return [...html.matchAll(re)].map(m => decodificarEntidadesHtml(m[1]));
}

export function extraerDeMetaTags(html: string): { descripcion: string | null; especificaciones: EspecificacionProducto[] } | null {
  const candidatos = [...extraerMetaContents(html, 'name', 'description'), ...extraerMetaContents(html, 'property', 'og:description')]
    .filter((s): s is string => !!s && !!s.trim());
  if (!candidatos.length) return null;

  let mejorSpecs: EspecificacionProducto[] = [];
  let mejorDescripcion: string | null = null;
  for (const texto of candidatos) {
    const specs = extraerSpecsDeTexto(texto);
    if (specs.length > mejorSpecs.length) mejorSpecs = specs;
    const plano = texto.replace(/\s+/g, ' ').trim();
    if (!mejorDescripcion && plano.length >= LARGO_MIN_DESCRIPCION && /\d/.test(plano)) mejorDescripcion = plano;
  }
  if (!mejorSpecs.length && !mejorDescripcion) return null;
  return { descripcion: mejorSpecs.length ? null : mejorDescripcion, especificaciones: mejorSpecs };
}

/**
 * Cascada: Sodimac/VTEX-Next (specs estructuradas ricas) → JSON-LD (Shopify u otro, specs reales
 * o descripción en prosa) → meta tags (specs por patrón "Clave: valor", o descripción libre) →
 * null. Nunca lanza — un sitio caído, bloqueado, o sin nada aprovechable simplemente no aporta,
 * igual que el resto del sistema (ver anexos-datos.ts).
 */
export async function extraerFichaDeUrl(url: string): Promise<FichaProductoExtraida | null> {
  const html = await descargarHtml(url);
  if (!html) return null;

  // La imagen se busca UNA vez e independiente del resto — puede haber foto aunque no haya specs
  // (o viceversa), así que no condiciona ningún paso de la cascada de datos.
  const imagenUrl = extraerImagenUrl(html);

  const sodimac = extraerDeSodimacNextData(html);
  if (sodimac) {
    return { nombreTienda: sodimac.nombreTienda, marca: null, descripcion: null, especificaciones: sodimac.especificaciones, imagenUrl, fuente: 'sodimac_nextdata', url };
  }

  const jsonld = extraerDeJsonLd(html);
  if (jsonld) {
    return { ...jsonld, imagenUrl, fuente: esShopify(html) ? 'shopify_jsonld' : 'jsonld_generico', url };
  }

  const meta = extraerDeMetaTags(html);
  if (meta) {
    return { nombreTienda: null, marca: null, descripcion: meta.descripcion, especificaciones: meta.especificaciones, imagenUrl, fuente: 'meta_descripcion', url };
  }

  // Sin specs NI descripción, pero SÍ hay foto: sigue sin ser "nada que ofrecer" — antes esto daba
  // null a secas, perdiendo la imagen. Ficha mínima: solo la foto + el pie de fuente.
  if (imagenUrl) {
    return { nombreTienda: null, marca: null, descripcion: null, especificaciones: [], imagenUrl, fuente: 'solo_imagen', url };
  }

  return null;
}

/** Nombre de archivo seguro y legible: sin tildes, solo [A-Za-z0-9_-], cortado sin partir palabras. */
export function slugArchivo(texto: string, maxLen = 50): string {
  const limpio = texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  if (limpio.length <= maxLen) return limpio || 'producto';
  const cortado = limpio.slice(0, maxLen);
  const ultimoGuion = cortado.lastIndexOf('_');
  return (ultimoGuion > 10 ? cortado.slice(0, ultimoGuion) : cortado) || 'producto';
}

const FUENTE_LABEL: Record<FuenteFichaProducto, string> = {
  sodimac_nextdata: 'Sodimac',
  shopify_jsonld: 'la tienda (Shopify)',
  jsonld_generico: 'la tienda',
  meta_descripcion: 'la descripción publicada por la tienda',
  solo_imagen: 'la imagen publicada por la tienda',
};

/** HTML autocontenido (sin recursos externos) para generarInformePdf — mismo motor que ya usa
 *  ficha-tecnica.ts. `imagenDataUri` ya viene descargada y convertida (ver generarFichaProductoPdf
 *  / descargarImagenComoDataUri) — este builder es puro, no hace red. Foto centrada con el pie
 *  "Imagen referencial", mismo patrón que ya usa ficha-tecnica.ts para la ficha PROPIA. */
export function construirFichaProductoHtml(datos: { detalle: string; ficha: FichaProductoExtraida; fechaTexto: string; imagenDataUri?: string | null }): string {
  const { detalle, ficha, fechaTexto, imagenDataUri } = datos;
  const filasSpecs = ficha.especificaciones
    .map(e => `<tr><td class="clave">${escapeHtml(e.clave)}</td><td class="valor">${escapeHtml(e.valor)}</td></tr>`)
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; padding: 0; margin: 0; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .marca { color: #6b7280; font-size: 13px; margin: 0 0 16px; }
    .foto-wrap { text-align: center; margin: 12px 0; }
    .foto-wrap img { max-width: 260px; max-height: 260px; object-fit: contain; border: 1px solid #e5e7eb; border-radius: 6px; }
    .foto-pie { font-size: 10px; color: #9ca3af; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    td { padding: 6px 8px; border: 1px solid #e5e7eb; font-size: 12.5px; vertical-align: top; }
    .clave { width: 40%; font-weight: bold; background: #f9fafb; }
    .descripcion { font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
    .pie { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e5e7eb; font-size: 10.5px; color: #9ca3af; }
  </style></head><body>
    <h1>${escapeHtml(detalle)}</h1>
    ${ficha.marca ? `<p class="marca">Marca: ${escapeHtml(ficha.marca)}</p>` : ''}
    ${imagenDataUri ? `<div class="foto-wrap"><img src="${imagenDataUri}" /><p class="foto-pie">Imagen referencial</p></div>` : ''}
    ${filasSpecs ? `<table>${filasSpecs}</table>` : ''}
    ${!filasSpecs && ficha.descripcion ? `<p class="descripcion">${escapeHtml(ficha.descripcion)}</p>` : ''}
    <p class="pie">Dato de referencia tomado de ${FUENTE_LABEL[ficha.fuente]} el ${escapeHtml(fechaTexto)} —
      no reemplaza la ficha técnica oficial del fabricante. Fuente: ${escapeHtml(ficha.url)}</p>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function generarFichaProductoPdf(detalle: string, ficha: FichaProductoExtraida): Promise<Buffer> {
  const fechaTexto = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'long', year: 'numeric' });
  const imagenDataUri = ficha.imagenUrl ? await descargarImagenComoDataUri(ficha.imagenUrl) : null;
  const html = construirFichaProductoHtml({ detalle, ficha, fechaTexto, imagenDataUri });
  return generarInformePdf(html);
}
