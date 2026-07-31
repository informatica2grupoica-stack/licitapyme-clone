// app/lib/mp-ofertas.ts
// Frente F.2 — LECTURA de la apertura: quién ofertó y a qué precio.
//
// mp-apertura.ts responde "¿ya se aperturó?" mirando si la ficha trae el acceso real a los
// resultados (Opening*.aspx?enc=<token>). Este módulo ENTRA por ese mismo link y extrae la
// tabla de ofertas. Reusa las primitivas de la descarga de documentos (obtenerFichaHTML →
// cookies de sesión + fetchMPConReintentos), así que hereda su tolerancia a los 503
// intermitentes de MP y su requisito: IP CHILENA (WAF) → corre en el VPS, nunca en Vercel.
//
// ── CÓMO SE LLEGA A LA TABLA ─────────────────────────────────────────────────
// 1. Ficha DetailsAcquisition → cookies + los links Opening*.aspx?enc=
// 2. OpeningFrame.aspx es un CONTENEDOR (frameset/iframe): la tabla está en el documento hijo,
//    por eso se sigue un nivel de <iframe>/<frame> src. Sin ese salto se lee un HTML de 2 KB
//    sin una sola fila y parece "no hay ofertas".
// 3. En el HTML final, las filas de proveedor se reconocen por el RUT (no por el encabezado):
//    los encabezados del portal cambian de nombre entre apertura técnica y económica, el
//    formato de RUT no. Ancla estable > ancla bonita.
//
// ── LÍMITE HONESTO DE ESTE PARSER ────────────────────────────────────────────
// El HTML real de la apertura solo es accesible desde IP chilena, así que las heurísticas de
// abajo NO están calibradas contra una página real todavía. Por eso cada lectura devuelve un
// `diagnostico` (páginas visitadas, bytes, filas vistas, por qué se descartaron) que se guarda
// en licitacion_apertura.ofertas_diagnostico: cuando esto corra en el VPS, ese campo dice
// exactamente qué ajustar en vez de obligar a adivinar. `guardarHtmlCrudo` permite volcar el
// HTML a disco en el VPS para afinar sin re-pegarle al portal.

import { MP_BASE, MP_UA, obtenerFichaHTML, fetchMPConReintentos, combinarCookies, extraerCookies } from '@/app/lib/mp-adjuntos';

export interface OfertaLeida {
  proveedorRut: string;        // normalizado 76902659-2
  proveedorNombre: string;
  lineaNumero: number;         // 0 = oferta global
  lineaDescripcion: string | null;
  monto: number | null;        // null = la apertura no publicó montos (apertura técnica)
  moneda: string | null;
  fuente: string;              // página del portal que la entregó
}

export interface DocumentoOferta {
  proveedorRut: string | null;
  nombre: string;
  url: string;
}

export interface LecturaApertura {
  ofertas: OfertaLeida[];
  documentos: DocumentoOferta[];
  diagnostico: string;         // legible por humanos, se persiste para afinar el parser
  paginas: number;
  cookies: string;
  referer: string;
}

// ── Normalizadores ───────────────────────────────────────────────────────────

const RE_RUT = /\b(\d{1,2}\.?\d{3}\.?\d{3})\s*[-–—]\s*([\dkK])\b/;

/** RUT del portal (72.345.678-9 / 72345678-K / 72.345.678–k) → 72345678-K. */
export function normalizarRut(texto: string): string | null {
  const m = texto.match(RE_RUT);
  if (!m) return null;
  const cuerpo = m[1].replace(/\./g, '');
  if (cuerpo.length < 7) return null;      // 7 dígitos es el piso real de un RUT chileno
  return `${cuerpo}-${m[2].toUpperCase()}`;
}

/**
 * Monto chileno → number. "$ 1.234.567" → 1234567 · "1.234.567,89" → 1234567.89
 * El portal escribe miles con punto y decimales con coma (es-CL). Un parseFloat directo sobre
 * "1.234.567" devuelve 1.234 — de ahí que esto exista en vez de confiar en Number().
 */
export function montoChileno(texto: string): number | null {
  const limpio = texto.replace(/[^\d.,-]/g, '').trim();
  if (!limpio || !/\d/.test(limpio)) return null;
  // Con coma decimal: los puntos son separadores de miles.
  const normal = limpio.includes(',')
    ? limpio.replace(/\./g, '').replace(',', '.')
    : limpio.replace(/\./g, '');
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

function moneda(texto: string): string | null {
  if (/UTM/i.test(texto)) return 'UTM';
  if (/\bUF\b/i.test(texto)) return 'UF';
  if (/USD|US\$|d[óo]lar/i.test(texto)) return 'USD';
  if (/EUR|€/i.test(texto)) return 'EUR';
  if (/\$|CLP|peso/i.test(texto)) return 'CLP';
  return null;
}

function limpiar(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;?/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Extracción de filas de tabla (conservando los links de cada fila) ────────

interface Fila { celdas: string[]; enlaces: { texto: string; href: string }[] }

function extraerFilas(html: string, base: string): Fila[] {
  const filas: Fila[] = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const bruto = tr[1];
    const celdas = [...bruto.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => limpiar(c[1]));
    if (celdas.length < 2) continue;
    const enlaces: { texto: string; href: string }[] = [];
    for (const a of bruto.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      try { enlaces.push({ texto: limpiar(a[2]), href: new URL(a[1], base).href }); } catch { /* href basura */ }
    }
    filas.push({ celdas, enlaces });
  }
  return filas;
}

// ── Navegación del portal ────────────────────────────────────────────────────

const RE_LINK_APERTURA = /(?:href|src)=["']([^"']*Opening[A-Za-z]*\.aspx\?[^"']*enc=[^"']+)["']/gi;
const RE_FRAME         = /<(?:iframe|frame)[^>]+src=["']([^"']+)["']/gi;
const RE_ADJUNTO       = /ViewAttachment/i;

async function traer(url: string, cookies: string, referer: string): Promise<{ html: string; cookies: string }> {
  const res = await fetchMPConReintentos(url, {
    method: 'GET',
    headers: {
      'User-Agent': MP_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-CL,es;q=0.9',
      'Referer': referer,
      ...(cookies ? { Cookie: cookies } : {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  const nuevas = combinarCookies(cookies, extraerCookies(res));
  if (!res.ok) return { html: '', cookies: nuevas };
  return { html: await res.text(), cookies: nuevas };
}

/**
 * Lee la apertura de una licitación y devuelve las ofertas visibles.
 * Devuelve null SOLO si no se pudo entrar al portal (WAF/timeout/MP caído) → el caller debe
 * reintentar después. Una lectura exitosa con 0 ofertas NO es null: significa "entré y no
 * había tabla", que es un dato distinto y hay que poder distinguirlo.
 */
export async function leerOfertasApertura(codigo: string): Promise<LecturaApertura | null> {
  const notas: string[] = [];
  let ficha: { html: string; cookies: string; referer: string };
  try {
    ficha = await obtenerFichaHTML(codigo);
  } catch (e) {
    console.error(`[mp-ofertas] ${codigo}: no se pudo abrir la ficha:`, String(e).slice(0, 200));
    return null;
  }
  if (!ficha.html) return null;

  let cookies = ficha.cookies;
  const referer = ficha.referer;

  // 1) Links de apertura desde la ficha (los mismos que delatan que está aperturada).
  const porVisitar = new Set<string>();
  for (const m of ficha.html.matchAll(RE_LINK_APERTURA)) {
    try { porVisitar.add(new URL(m[1], MP_BASE).href); } catch { /* href basura */ }
  }
  if (porVisitar.size === 0) {
    return { ofertas: [], documentos: [], paginas: 0, cookies, referer,
      diagnostico: 'la ficha no trae ningún link Opening*.aspx?enc= (¿todavía sin apertura?)' };
  }

  // 2) Visitar cada link y, un nivel adentro, sus frames (OpeningFrame es un contenedor).
  const visitadas = new Set<string>();
  const paginas: { url: string; html: string }[] = [];
  const cola = [...porVisitar];
  let saltosFrame = 0;

  while (cola.length > 0 && paginas.length < 8) {
    const url = cola.shift()!;
    if (visitadas.has(url)) continue;
    visitadas.add(url);

    let html = '';
    try {
      const r = await traer(url, cookies, referer);
      html = r.html; cookies = r.cookies;
    } catch (e) {
      notas.push(`fallo al traer ${url.slice(0, 60)}: ${String(e).slice(0, 60)}`);
      continue;
    }
    if (!html) { notas.push(`vacío/HTTP-error: ${url.slice(0, 60)}`); continue; }
    paginas.push({ url, html });

    // Seguir frames hijos (un solo nivel: más que eso es navegar el portal entero).
    if (saltosFrame < 4) {
      for (const f of html.matchAll(RE_FRAME)) {
        try {
          const hijo = new URL(f[1], url).href;
          if (!visitadas.has(hijo) && /mercadopublico\.cl/i.test(hijo)) { cola.push(hijo); saltosFrame++; }
        } catch { /* src basura */ }
      }
    }
  }

  if (paginas.length === 0) {
    console.error(`[mp-ofertas] ${codigo}: ${porVisitar.size} link(s) de apertura y ninguna página legible`);
    return null; // no se pudo entrar → reintentar, no es "no hay ofertas"
  }

  // 3) Parsear ofertas y documentos.
  const ofertas = new Map<string, OfertaLeida>();   // clave rut|linea
  const documentos = new Map<string, DocumentoOferta>();
  let filasTotales = 0;
  let filasSinRut = 0;

  for (const { url, html } of paginas) {
    const fuente = (url.match(/\/([A-Za-z]+)\.aspx/)?.[1] || 'apertura').slice(0, 40);
    const filas = extraerFilas(html, url);
    filasTotales += filas.length;

    for (const fila of filas) {
      const textoFila = fila.celdas.join(' | ');
      const rut = normalizarRut(textoFila);
      if (!rut) { filasSinRut++; continue; }

      // Nombre: la celda más larga que NO sea el propio RUT ni un número suelto.
      const nombre = fila.celdas
        .filter(c => c.length >= 3 && !normalizarRut(c) && !/^[\d.,$\s%-]+$/.test(c))
        .sort((a, b) => b.length - a.length)[0] || rut;

      // Monto: la última celda numérica "grande". Se ignoran celdas que son cantidades o
      // porcentajes (un "1" o un "95,5 %" no es una oferta económica).
      let monto: number | null = null;
      let mon: string | null = null;
      for (const c of fila.celdas) {
        if (/%/.test(c)) continue;
        const n = montoChileno(c);
        if (n != null && n >= 1000) { monto = n; mon = moneda(c) || mon; }
      }
      if (mon == null && monto != null) mon = moneda(textoFila) || 'CLP';

      // Línea: si la fila trae "Línea N" / "Ítem N", la oferta es por línea; si no, global.
      const mLinea = textoFila.match(/(?:l[íi]nea|[íi]tem)\s*(?:n[°º]?\s*)?(\d{1,3})\b/i);
      const lineaNumero = mLinea ? Number(mLinea[1]) : 0;

      const clave = `${rut}|${lineaNumero}`;
      const previa = ofertas.get(clave);
      // Si ya la teníamos sin monto y ahora viene con monto, la enriquecemos (la apertura
      // técnica y la económica son páginas distintas del mismo acto).
      if (!previa || (previa.monto == null && monto != null)) {
        ofertas.set(clave, {
          proveedorRut: rut,
          proveedorNombre: previa?.proveedorNombre || nombre.slice(0, 255),
          lineaNumero,
          lineaDescripcion: mLinea ? textoFila.slice(0, 400) : null,
          monto: monto ?? previa?.monto ?? null,
          moneda: mon ?? previa?.moneda ?? null,
          fuente,
        });
      }

      for (const a of fila.enlaces) {
        if (!RE_ADJUNTO.test(a.href)) continue;
        documentos.set(a.href, {
          proveedorRut: rut,
          nombre: (a.texto || 'documento').slice(0, 400),
          url: a.href,
        });
      }
    }

    // Adjuntos sueltos (fuera de una fila con RUT): se registran sin proveedor en vez de
    // perderlos — en varias aperturas el listado de anexos va en un bloque aparte.
    for (const a of html.matchAll(/<a[^>]+href=["']([^"']*ViewAttachment[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      try {
        const href = new URL(a[1], url).href;
        if (!documentos.has(href)) documentos.set(href, { proveedorRut: null, nombre: (limpiar(a[2]) || 'documento').slice(0, 400), url: href });
      } catch { /* href basura */ }
    }
  }

  const bytes = paginas.reduce((s, p) => s + p.html.length, 0);
  const diagnostico = [
    `${paginas.length} pág (${Math.round(bytes / 1024)} KB)`,
    `${filasTotales} filas`,
    `${filasSinRut} sin RUT`,
    `${ofertas.size} ofertas`,
    `${documentos.size} docs`,
    ...notas,
  ].join(' · ').slice(0, 400);

  return { ofertas: [...ofertas.values()], documentos: [...documentos.values()], diagnostico, paginas: paginas.length, cookies, referer };
}

/**
 * Descarga un documento de oferta ya detectado. Devuelve el binario o null si el link expiró
 * (los `enc=` son efímeros: si falla, se vuelve a leer la apertura y se re-detecta).
 */
export async function descargarDocumentoOferta(
  url: string, cookies: string, referer: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const res = await fetchMPConReintentos(url, {
      method: 'GET',
      headers: {
        'User-Agent': MP_UA,
        'Referer': referer,
        ...(cookies ? { Cookie: cookies } : {}),
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return null;
    // Un HTML donde debería venir un PDF = el portal devolvió una pantalla de sesión/WAF.
    if (buffer.subarray(0, 200).toString('utf8').toLowerCase().includes('<!doctype html')) return null;
    return { buffer, contentType: res.headers.get('content-type') || 'application/octet-stream' };
  } catch {
    return null;
  }
}
