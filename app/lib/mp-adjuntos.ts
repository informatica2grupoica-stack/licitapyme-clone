// app/lib/mp-adjuntos.ts
// Paso 1 del flujo de descarga: leer la ficha pública de Mercado Público y
// extraer los enlaces de adjuntos (ViewAttachmentLC.aspx?enc=...) + cookies de sesión.
// NO usa la API oficial (la API no entrega los binarios), sino la ficha HTML.

export const MP_BASE = 'https://www.mercadopublico.cl';
export const MP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export interface AdjuntoLink {
  nombre: string;
  url: string; // URL completa al pop-up ViewAttachmentLC.aspx?enc=...
}

export interface FichaAdjuntos {
  cookies: string;   // par(es) nombre=valor listos para reenviar en header Cookie
  referer: string;   // URL de la ficha (sirve como Referer en pasos siguientes)
  adjuntos: AdjuntoLink[];
}

export interface ArchivoDescargado {
  nombre: string;
  buffer: Buffer;
  contentType: string;
}

/**
 * Extrae las cookies de un Response y devuelve solo los pares `nombre=valor`
 * concatenados (sin atributos Path/HttpOnly/etc), listos para el header Cookie.
 * Usa getSetCookie() (Node 20+/undici), con fallback al header plano.
 */
export function extraerCookies(res: Response): string {
  const getSetCookie = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  const raw: string[] =
    typeof getSetCookie === 'function'
      ? getSetCookie.call(res.headers)
      : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);

  return raw
    .map(c => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

/** Combina dos cadenas de cookies, dejando ganar a la más reciente por nombre. */
export function combinarCookies(previas: string, nuevas: string): string {
  const mapa = new Map<string, string>();
  for (const fuente of [previas, nuevas]) {
    for (const par of fuente.split(';')) {
      const [k, ...rest] = par.trim().split('=');
      if (k) mapa.set(k, rest.join('='));
    }
  }
  return Array.from(mapa.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Lee la ficha de la licitación y devuelve la lista de pop-ups de adjuntos.
 * Requiere ejecutarse desde una IP chilena (el WAF de MP bloquea datacenters extranjeros).
 *
 * MP responde la ficha `?idlicitacion=` con un **302** hacia `?qs=<id-cifrado>` y
 * setea el `ASP.NET_SessionId` en ESA respuesta intermedia. El `fetch` nativo de
 * Node sigue el redirect pero NO reenvía ese Set-Cookie al request final, así que
 * la página `?qs=` cargaba sin sesión y sin adjuntos. Por eso seguimos el redirect
 * a mano, acumulando cookies en cada salto: la SessionId resultante es la que
 * después necesita el POST de descarga.
 */
export async function listarAdjuntos(codigo: string): Promise<FichaAdjuntos> {
  const inicial = `${MP_BASE}/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}`;

  let cookies = '';
  let url = inicial;
  let html = '';

  for (let salto = 0; salto < 5; salto++) {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual', // capturamos el 302 a mano para conservar la SessionId
      headers: {
        'User-Agent': MP_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9,en-US;q=0.8,en;q=0.7',
        ...(cookies ? { 'Cookie': cookies } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });

    cookies = combinarCookies(cookies, extraerCookies(res));

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) break;
      url = new URL(loc, url).href;
      continue;
    }

    if (!res.ok) throw new Error(`La ficha de MP respondió ${res.status} (¿WAF o IP no chilena?)`);

    html = await res.text();
    break;
  }

  // `url` quedó apuntando a la ficha final (?qs=...): sirve de Referer y base relativa.
  return { cookies, referer: url, adjuntos: extraerLinksAdjuntos(html, url) };
}

/**
 * Busca las URLs de pop-up `ViewAttachmentLC.aspx?enc=...` en TODO el HTML de la
 * ficha. En MP el enlace casi nunca está en un `<a href>`: suele venir dentro de
 * un `onclick="window.open('...enc=...')"` o un script, así que un selector de
 * cheerio sobre `href` no alcanza. Por eso barremos el HTML crudo con regex,
 * decodificamos entidades y resolvemos URLs relativas contra la ficha.
 */
export function extraerLinksAdjuntos(html: string, referer: string): AdjuntoLink[] {
  const adjuntos: AdjuntoLink[] = [];
  const vistos = new Set<string>();

  // Captura href/onclick/scripts. MP usa varias variantes del pop-up según el
  // tipo de licitación: ViewAttachmentLC.aspx, ViewAttachment.aspx y
  // VerAntecedentes.aspx — todas con ?enc=<token>.
  //
  // El token `enc` es base64 con URL-encoding (`%2b %2f %3d`) + base64url (`-` `_`),
  // así que su alfabeto real es [A-Za-z0-9%+/=_-]. Lo matcheamos de forma POSITIVA:
  // la versión anterior usaba un set negativo que cortaba el token a ~120 chars
  // (los enc reales miden 500-560) → token inválido → la descarga devolvía HTTP 500.
  const re = /(?:\.\.\/|\/|https?:\/\/[^"'\s]*?)?(?:Procurement\/Modules\/)?Attachment\/(?:ViewAttachment(?:LC)?|VerAntecedentes)\.aspx\?enc=[A-Za-z0-9%+/=_-]+/gi;
  const matches = html.match(re) || [];

  for (const bruto of matches) {
    // Decodificar entidades HTML típicas (&amp; → &) antes de resolver.
    const limpio = bruto.replace(/&amp;/gi, '&');
    let abs: string;
    try {
      abs = new URL(limpio, referer).href;
    } catch {
      continue;
    }
    if (vistos.has(abs)) continue;
    vistos.add(abs);
    adjuntos.push({ nombre: `Adjuntos_${adjuntos.length + 1}`, url: abs });
  }

  return adjuntos;
}

/**
 * Re-decodifica un texto que llegó como UTF-8 pero fue leído byte-a-byte como
 * Latin-1 (típico de cabeceras HTTP en undici). Corrige el mojibake `NÂ°` → `N°`.
 * Si el texto no tenía secuencias UTF-8 válidas, devuelve el original intacto.
 */
function repararLatin1(texto: string): string {
  if (![...texto].some(c => c.charCodeAt(0) > 0x7f)) return texto; // ASCII puro: nada que reparar
  try {
    const reparado = Buffer.from(texto, 'latin1').toString('utf8');
    // Solo aceptamos la reparación si no introdujo el carácter de reemplazo (�).
    return reparado.includes('�') ? texto : reparado;
  } catch {
    return texto;
  }
}

/** Deriva el nombre del archivo desde la cabecera Content-Disposition. */
export function nombreDesdeDisposition(res: Response): string | null {
  const cd = res.headers.get('content-disposition');
  if (!cd) return null;
  const utf8 = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (utf8?.[1]) { try { return decodeURIComponent(utf8[1].replace(/"/g, '')); } catch { /* noop */ } }
  const simple = cd.match(/filename="?([^";]+)"?/i);
  return simple?.[1] ? repararLatin1(simple[1].trim()) : null;
}

/** Mapea una extensión a su content-type para guardar en R2. */
export function contentTypePorNombre(nombre: string, fallback = 'application/octet-stream'): string {
  const ext = nombre.split('.').pop()?.toLowerCase() || '';
  const mapa: Record<string, string> = {
    pdf: 'application/pdf',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  };
  return mapa[ext] || fallback;
}
