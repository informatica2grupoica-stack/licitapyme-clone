// app/lib/mp-ofertas.ts
// Frente F.2 — LECTURA de la apertura: quién ofertó, a qué precio y con qué anexos.
//
// Requiere IP CHILENA (WAF de MP) → corre en el VPS, nunca en Vercel. Reusa las primitivas de la
// descarga de documentos (obtenerFichaHTML → cookies + fetchMPConReintentos), así que hereda su
// tolerancia a los 503 intermitentes del portal.
//
// ════════ CADENA REAL DEL PORTAL (recorrida en vivo el 31-jul-2026) ══════════
// Nada de esto es adivinado: se verificó contra la licitación 1173418-1-LE26.
//
//   1. Ficha DetailsAcquisition          → link OpeningFrame.aspx?enc=<token>
//   2. OpeningFrame.aspx  (1,7 KB)       → <title>Cuadro Comparativo</title>. Es un FRAMESET de
//      dos frames: "Encabezado" (con src) y "Cuerpo" (SIN src).
//   3. OpeningHeader.aspx (17 KB)        → la barra de pasos. Dentro, en JavaScript:
//          parent.Cuerpo.location='SupplySummary.aspx?enc=<token>'
//      ← AQUÍ estaba la trampa: el frame del contenido NO tiene src en el HTML, lo setea el JS.
//        Un crawler que solo siga <frame src> se detiene en el marco y concluye "no hay ofertas".
//   4. SupplySummary.aspx (143 KB)       → el "Resumen de ofertas" de verdad.
//
// ════════ POR QUÉ SE PARSEA POR ID DE CONTROL Y NO POR FILAS ═════════════════
// La celda "Anexos" contiene una TABLA ANIDADA. Un regex de <tr> parte ese anidamiento y hace
// que un mismo oferente aparezca como varias filas incoherentes (verificado: el RUT quedaba en
// una fila y "Declaración Jurada / Información Proveedor" en otra).
// SupplySummary es un GridView de ASP.NET y cada oferente es un grupo `grdSupplies_ctlNN_*`:
//     _GvLblRutProvider · _GvLblProvider · _GvLblSuppliesName · TotalOferta · EstadoOferta
//     _GvImgbAdministrativeAttachment · _GvImgbTechnicalAttachment · _GvImgbEconomicAttachment
// Agrupar por ctlNN es inmune al anidamiento y al orden de columnas. Ancla estable > ancla obvia.
//
// De los CINCO iconos de la columna Anexos, solo TRES son páginas de adjuntos:
//     Administrativos · Técnicos · Económico   → openPopUp('/BID/Modules/POPUPS/ViewBidAttachment.aspx?enc=…')
// Los otros dos NO lo son: "Firma declaración Jurada" llama a ver_declaracion(rut, codigo) y
// "Información Proveedor" a verFicha(rut) — son la ficha de ChileProveedores, no archivos de la
// oferta. Tratarlos como adjuntos generaba dos descargas fantasma por oferente.

import { MP_BASE, MP_UA, obtenerFichaHTML, fetchMPConReintentos, combinarCookies, extraerCookies } from '@/app/lib/mp-adjuntos';

export type CategoriaAnexo =
  | 'DECLARACION_JURADA' | 'INFORMACION_PROVEEDOR' | 'ADMINISTRATIVOS'
  | 'TECNICOS' | 'ECONOMICOS' | 'OTRO';

export interface OfertaLeida {
  proveedorRut: string;
  proveedorNombre: string;
  nombreOferta: string | null;
  estado: string | null;       // Aceptada / Rechazada / …
  lineaNumero: number;         // 0 = oferta global (SupplySummary siempre es global)
  lineaDescripcion: string | null;
  monto: number | null;
  moneda: string | null;
  fuente: string;
}

export interface DocumentoOferta {
  proveedorRut: string;
  categoria: CategoriaAnexo;
  nombre: string;
  tipoMp: string | null;
  descripcion: string | null;
  tamanoKb: number | null;
  urlContenedor: string;
  url: string;                 // '' si MP no expone link directo (postback)
  // Página de la grilla de anexos donde vive el archivo (1 = la que se ve al entrar).
  // NO es decorativo: el nombre del ImageButton (`DWNL$grdId$ctl03$search`) se REINICIA en cada
  // página, así que sin este número la descarga de un archivo de la página 2 traería el tercer
  // archivo de la página 1. Ver descargarAnexoPorPostback().
  pagina: number;
}

export interface LecturaApertura {
  ofertas: OfertaLeida[];
  documentos: DocumentoOferta[];
  diagnostico: string;
  paginas: number;
  cookies: string;
  referer: string;
  // true = la lectura se cortó por tope/presupuesto y QUEDÓ INCOMPLETA. El llamador no debe
  // marcarla como "leída": una apertura a medias que se da por cerrada nunca se completa sola.
  truncada: boolean;
}

// ── Normalizadores ───────────────────────────────────────────────────────────

const RE_RUT = /\b(\d{1,2}\.?\d{3}\.?\d{3})\s*[-–—]\s*([\dkK])\b/;

/**
 * Dígito verificador de un RUT chileno (módulo 11).
 *
 * NO es un lujo: sin esto, el CÓDIGO DE LICITACIÓN se cuela como RUT. "1173418-1-LE26" calza
 * perfecto con el patrón de RUT (7 dígitos + guión + dígito) y en la primera corrida real se
 * guardó como si fuera un competidor, con el nombre de la licitación como razón social. El DV
 * de 1173418 es 9, no 1 → validarlo lo mata. Un patrón que "parece" no basta.
 */
export function dvValido(cuerpo: string, dv: string): boolean {
  let suma = 0, mult = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return esperado === dv.toUpperCase();
}

/** RUT del portal (76.681.561-8) → 76681561-8. null si el DV no cuadra. */
export function normalizarRut(texto: string): string | null {
  const m = texto.match(RE_RUT);
  if (!m) return null;
  const cuerpo = m[1].replace(/\./g, '');
  if (cuerpo.length < 7) return null;
  const dv = m[2].toUpperCase();
  if (!dvValido(cuerpo, dv)) return null;
  return `${cuerpo}-${dv}`;
}

/** "$ 42.000.000" → 42000000 · "1.234.567,89" → 1234567.89 (es-CL: miles con punto). */
export function montoChileno(texto: string): number | null {
  const limpio = texto.replace(/[^\d.,-]/g, '').trim();
  if (!limpio || !/\d/.test(limpio)) return null;
  const normal = limpio.includes(',')
    ? limpio.replace(/\./g, '').replace(',', '.')
    : limpio.replace(/\./g, '');
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

function moneda(texto: string): string | null {
  if (/UTM/i.test(texto)) return 'UTM';
  if (/\bUF\b/i.test(texto)) return 'UF';
  if (/USD|US\$/i.test(texto)) return 'USD';
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

/** Decodifica las entidades que ASP.NET mete dentro de los atributos onclick. */
function desescapar(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

/** "4827 KB" → 4827 · "1,2 MB" → 1229 */
function tamanoEnKb(texto: string): number | null {
  const m = texto.match(/([\d.,]+)\s*(KB|MB|GB)/i);
  if (!m) return null;
  const n = montoChileno(m[1]);
  if (n == null) return null;
  const f = m[2].toUpperCase() === 'MB' ? 1024 : m[2].toUpperCase() === 'GB' ? 1024 * 1024 : 1;
  return Math.round(n * f);
}

export const ROTULO_CATEGORIA: Record<CategoriaAnexo, string> = {
  DECLARACION_JURADA: 'Declaración jurada',
  INFORMACION_PROVEEDOR: 'Información del proveedor',
  ADMINISTRATIVOS: 'Anexos administrativos',
  TECNICOS: 'Anexos técnicos',
  ECONOMICOS: 'Anexos económicos',
  OTRO: 'Otros',
};

/** Sufijo del control de ASP.NET → categoría. Es el nombre interno, no el rótulo visible. */
function categoriaDeControl(sufijo: string, title: string): CategoriaAnexo {
  const s = `${sufijo} ${title}`.toLowerCase();
  if (/administrative|administrativ/.test(s)) return 'ADMINISTRATIVOS';
  if (/technical|t[ée]cnic/.test(s))          return 'TECNICOS';
  if (/economic|econ[óo]mic/.test(s))         return 'ECONOMICOS';
  if (/firma|jurada/.test(s))                 return 'DECLARACION_JURADA';
  if (/other|proveedor/.test(s))              return 'INFORMACION_PROVEEDOR';
  return 'OTRO';
}

// ── Navegación ───────────────────────────────────────────────────────────────

// Tope de páginas de anexo A RECORRER (contando las páginas 2, 3… de cada grilla). Con 13
// oferentes × 3 categorías × hasta 3 páginas cada una se llega a ~120: 60 dejaba la mitad afuera.
const MAX_PAGINAS_ANEXO = 160;
const PRESUPUESTO_MS    = 210_000;   // el llamador corta a 260 s y el cron a 300
const MAX_PAGINAS_GRILLA = 30;       // freno duro por grilla: un pager corrupto no debe dar vueltas

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

/** Los hidden del formulario (__VIEWSTATE, __EVENTVALIDATION, WucPagerGrid$hid*, …). */
function hiddenDelFormulario(html: string): URLSearchParams {
  const cuerpo = new URLSearchParams();
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/gi)) {
    const name = m[0].match(/name="([^"]+)"/i)?.[1];
    if (!name) continue;
    cuerpo.set(name, desescapar(m[0].match(/value="([^"]*)"/i)?.[1] ?? ''));
  }
  return cuerpo;
}

/**
 * Ejecuta un __doPostBack de NAVEGACIÓN (cambio de página de una grilla) y devuelve el HTML
 * resultante. Es un POST del formulario completo con el __VIEWSTATE de la página que se tiene
 * en la mano: ASP.NET no acepta un viewstate de otra página, por eso se encadena
 * (pág 1 → pág 2 → pág 3) en vez de pedir cada página contra el HTML original.
 */
async function postearNavegacion(
  url: string, html: string, cookies: string, referer: string, target: string, argumento: string,
): Promise<{ html: string; cookies: string }> {
  const accion = html.match(/<form[^>]+action=["']([^"']+)["']/i)?.[1] || url;
  const cuerpo = hiddenDelFormulario(html);
  cuerpo.set('__EVENTTARGET', target);
  cuerpo.set('__EVENTARGUMENT', argumento);
  try {
    const res = await fetchMPConReintentos(new URL(desescapar(accion), url).href, {
      method: 'POST',
      headers: {
        'User-Agent': MP_UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9',
        'Referer': referer,
        ...(cookies ? { Cookie: cookies } : {}),
      },
      body: cuerpo.toString(),
      redirect: 'follow',
      signal: AbortSignal.timeout(45_000),
    });
    const nuevas = combinarCookies(cookies, extraerCookies(res));
    if (!res.ok) return { html: '', cookies: nuevas };
    return { html: await res.text(), cookies: nuevas };
  } catch {
    return { html: '', cookies };
  }
}

/**
 * Números de página de la grilla de anexos (GridView estándar):
 *     <a href="javascript:__doPostBack('DWNL$grdId','Page$2')">2</a>
 * Devuelve solo las páginas DISTINTAS de la actual, ordenadas.
 */
function paginasDeAnexo(html: string): number[] {
  const n = new Set<number>();
  for (const m of html.matchAll(/Page\$(\d+)/g)) n.add(Number(m[1]));
  return [...n].filter(p => p > 1 && p <= MAX_PAGINAS_GRILLA).sort((a, b) => a - b);
}

/**
 * Números de página del Resumen de ofertas. Su pager NO es el del GridView: es un control propio
 * de MP que llama a fnMovePage(N,"WucPagerGrid") y postea contra WucPagerGrid$btn_GoToPage.
 *
 * Verificado en vivo (25-ago-2026): con 13 oferentes, SupplySummary muestra 10 y deja el resto en
 * la página 2. Leer solo la primera página era la razón por la que TODAS las licitaciones grandes
 * quedaban con exactamente 10 competidores guardados.
 */
function paginasDeOferentes(html: string): number[] {
  const n = new Set<number>();
  for (const m of html.matchAll(/fnMovePage\(\s*(\d+)\s*,\s*(?:&quot;|["'])WucPagerGrid/gi)) n.add(Number(m[1]));
  return [...n].filter(p => p > 1 && p <= MAX_PAGINAS_GRILLA).sort((a, b) => a - b);
}

/**
 * Valor de un control del GridView dentro del segmento de UN oferente.
 *
 * NO se ancla en `id="…"`: el segmento empieza justo EN el token `grdSupplies_ctlNN_`, de modo
 * que el `id="` que lo precedía quedó en el segmento anterior. Exigirlo devolvía vacío para
 * todos los oferentes y el lector reportaba "0 ofertas" con la tabla completa delante.
 */
function valorControl(segmento: string, sufijo: string): string {
  const re = new RegExp(`grdSupplies_ctl\\d+_${sufijo}"[^>]*>([\\s\\S]*?)</(?:a|span|td)>`, 'i');
  return limpiar(segmento.match(re)?.[1] ?? '');
}

/**
 * Parte SupplySummary en un segmento por oferente, usando los índices `ctlNN` del GridView.
 * Cada segmento va desde la primera aparición de su ctl hasta la del siguiente.
 */
function segmentosPorOferente(html: string): { ctl: string; segmento: string }[] {
  const marcas: { ctl: string; pos: number }[] = [];
  const vistos = new Set<string>();
  for (const m of html.matchAll(/grdSupplies[_$]ctl(\d+)[_$]/g)) {
    const ctl = m[1];
    if (vistos.has(ctl)) continue;
    vistos.add(ctl);
    marcas.push({ ctl, pos: m.index! });
  }
  marcas.sort((a, b) => a.pos - b.pos);
  return marcas.map((m, i) => ({
    ctl: m.ctl,
    segmento: html.slice(m.pos, i + 1 < marcas.length ? marcas[i + 1].pos : html.length),
  }));
}

/**
 * Lee la apertura: ofertas + anexos de cada oferente.
 * Devuelve null SOLO si no se pudo entrar al portal → reintentar. Una lectura con 0 ofertas NO
 * es null: "entré y no había tabla" es un dato distinto de "no pude entrar".
 */
export async function leerOfertasApertura(codigo: string): Promise<LecturaApertura | null> {
  const inicio = Date.now();
  const notas: string[] = [];
  let paginas = 0;

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

  const vacio = (diag: string): LecturaApertura =>
    ({ ofertas: [], documentos: [], paginas, cookies, referer, diagnostico: diag, truncada: false });

  // ── 1) Ficha → OpeningFrame ────────────────────────────────────────────────
  const frameUrl = [...ficha.html.matchAll(/(?:href|src)=["']([^"']*OpeningFrame\.aspx\?[^"']*enc=[^"']+)["']/gi)]
    .map(m => { try { return new URL(desescapar(m[1]), MP_BASE).href; } catch { return ''; } })
    .find(Boolean);
  if (!frameUrl) return vacio('la ficha no trae OpeningFrame.aspx?enc= (¿todavía sin apertura?)');

  // ── 2) OpeningFrame → OpeningHeader ────────────────────────────────────────
  const marco = await traer(frameUrl, cookies, referer); cookies = marco.cookies; paginas++;
  if (!marco.html) return null;
  const headerSrc = marco.html.match(/<frame[^>]+src=["']([^"']*OpeningHeader[^"']+)["']/i)?.[1];
  if (!headerSrc) return vacio('OpeningFrame no declara el frame OpeningHeader');

  const header = await traer(new URL(desescapar(headerSrc), frameUrl).href, cookies, frameUrl);
  cookies = header.cookies; paginas++;
  if (!header.html) return null;

  // ── 3) OpeningHeader → SupplySummary (lo carga el JS, no un <frame src>) ───
  const destino = desescapar(header.html).match(/parent\.Cuerpo\.location\s*=\s*'(SupplySummary[^']+)'/i)?.[1];
  if (!destino) return vacio('OpeningHeader no apunta a SupplySummary (¿cambió el portal?)');

  const resumenUrl = new URL(destino, frameUrl).href;
  const resumen = await traer(resumenUrl, cookies, frameUrl); cookies = resumen.cookies; paginas++;
  if (!resumen.html) return null;
  if (!/rut\s*proveedor/i.test(resumen.html)) {
    return vacio(`SupplySummary sin tabla de ofertas (${Math.round(resumen.html.length / 1024)} KB)`);
  }

  // ── 4) Parsear el Resumen de ofertas por grupos ctlNN ──────────────────────
  const ofertas: OfertaLeida[] = [];
  const pendientesAnexo: { rut: string; categoria: CategoriaAnexo; url: string }[] = [];
  let sinRut = 0;
  const rutsVistos = new Set<string>();

  const parsearResumen = (html: string) => {
  for (const { segmento } of segmentosPorOferente(html)) {
    const rut = normalizarRut(valorControl(segmento, '_GvLblRutProvider'));
    if (!rut) { sinRut++; continue; }
    // La misma tabla puede volver a parsearse (página 2 que repite un oferente por un pager
    // inestable): sin este freno se duplicarían sus anexos y el conteo de competidores.
    if (rutsVistos.has(rut)) continue;
    rutsVistos.add(rut);

    const nombre = valorControl(segmento, '_GvLblProvider') || rut;
    const total  = valorControl(segmento, 'TotalOferta');
    const monto  = montoChileno(total);

    ofertas.push({
      proveedorRut: rut,
      proveedorNombre: nombre.slice(0, 255),
      nombreOferta: valorControl(segmento, '_GvLblSuppliesName').slice(0, 400) || null,
      estado: valorControl(segmento, 'EstadoOferta').slice(0, 40) || null,
      lineaNumero: 0,               // SupplySummary es el total por oferente, no por línea
      lineaDescripcion: null,
      monto,
      moneda: monto == null ? null : (moneda(total) || 'CLP'),
      fuente: 'SupplySummary',
    });

    // Iconos de anexo: solo los que abren ViewBidAttachment son archivos de la oferta.
    for (const im of segmento.matchAll(/<input[^>]*grdSupplies_ctl\d+__GvImgb?([A-Za-z]+)"[^>]*>/gi)) {
      const tag = im[0];
      if (!/ViewBidAttachment/i.test(tag)) continue;
      const url = desescapar(tag).match(/openPopUp\('([^']+)'/i)?.[1];
      if (!url) continue;
      const title = tag.match(/title="([^"]*)"/i)?.[1] || '';
      try {
        pendientesAnexo.push({ rut, categoria: categoriaDeControl(im[1], title), url: new URL(desescapar(url), MP_BASE).href });
      } catch { /* url basura */ }
    }
  }
  };

  parsearResumen(resumen.html);

  // ── 4b) Páginas 2..N del Resumen de ofertas ────────────────────────────────
  // Cada salto se hace contra el HTML de la página anterior (el __VIEWSTATE es de esa página).
  let truncada = false;
  let htmlPagina = resumen.html;
  const pagsOferentes = paginasDeOferentes(resumen.html);
  for (const p of pagsOferentes) {
    if (Date.now() - inicio > PRESUPUESTO_MS) { notas.push('presupuesto agotado en oferentes'); truncada = true; break; }
    const sig = await postearNavegacion(
      resumenUrl, htmlPagina, cookies, resumenUrl, 'WucPagerGrid$btn_GoToPage', String(p));
    cookies = sig.cookies;
    if (!sig.html) { notas.push(`pág ${p} de oferentes ilegible`); truncada = true; break; }
    paginas++;
    htmlPagina = sig.html;
    parsearResumen(sig.html);
  }
  if (pagsOferentes.length) notas.push(`${pagsOferentes.length + 1} pág de oferentes`);

  // ── 5) Entrar a cada página de anexos y listar sus archivos ────────────────
  const documentos: DocumentoOferta[] = [];
  const visto = new Set<string>();
  const vistoDoc = new Set<string>();
  let pagsAnexo = 0, sinLink = 0, pagsExtra = 0;

  /** Extrae las filas-archivo de UNA página de la grilla de anexos. */
  const filasDeAnexo = (html: string, ax: { rut: string; categoria: CategoriaAnexo; url: string }, pagina: number) => {
    for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const bruto = tr[1];
      const celdas = [...bruto.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => limpiar(c[1]));
      // Una fila de archivo se reconoce por traer un nombre CON EXTENSIÓN: encabezados,
      // "Seleccionar Todos" y pies de tabla no la tienen.
      const nombre = celdas.find(c => /\.[a-z0-9]{2,5}$/i.test(c) && c.length > 4);
      if (!nombre) continue;

      const idx = celdas.indexOf(nombre);
      // El botón "Ver" NO es un enlace: es un ImageButton de ASP.NET
      //     <input type="image" name="DWNL$grdId$ctl02$search" title="Ver Anexo">
      // que baja el archivo por POSTBACK (POST del formulario con __VIEWSTATE). Por eso se
      // guarda el NOMBRE DEL CONTROL con el prefijo `postback:` en vez de una URL: la descarga
      // se resuelve después con descargarAnexoPorPostback() contra la página contenedora.
      // (Buscar un href acá devolvía "0 links" para todos los archivos y parecía un bloqueo.)
      const control = bruto.match(/name="(DWNL\$grdId\$ctl\d+\$\w+)"[^>]*type="image"/i)?.[1]
        || bruto.match(/type="image"[^>]*name="(DWNL\$grdId\$ctl\d+\$\w+)"/i)?.[1];
      const href = control ? `postback:${control}`
        : (bruto.match(/<a[^>]+href=["'](?!javascript:)([^"']+)["']/i)?.[1]
          || desescapar(bruto).match(/openPopUp\('([^']+)'/i)?.[1]
          || '');
      if (!href) sinLink++;

      // La clave en base es (licitación, proveedor, categoría, nombre): si el mismo nombre
      // apareciera dos veces, la segunda pisaría a la primera. Se queda la primera.
      const claveDoc = `${ax.rut}|${ax.categoria}|${nombre}`;
      if (vistoDoc.has(claveDoc)) continue;
      vistoDoc.add(claveDoc);

      documentos.push({
        pagina,
        proveedorRut: ax.rut,
        categoria: ax.categoria,
        nombre: nombre.slice(0, 400),
        tipoMp: (celdas[idx + 1] || '').slice(0, 120) || null,
        descripcion: (celdas[idx + 2] || '').slice(0, 400) || null,
        tamanoKb: tamanoEnKb(celdas.join(' ')),
        urlContenedor: ax.url,
        url: href.startsWith('postback:') ? href
          : href ? (() => { try { return new URL(desescapar(href), ax.url).href; } catch { return ''; } })() : '',
      });
    }
  };

  for (const ax of pendientesAnexo) {
    if (pagsAnexo >= MAX_PAGINAS_ANEXO) { notas.push(`tope ${MAX_PAGINAS_ANEXO} pág anexos`); truncada = true; break; }
    if (Date.now() - inicio > PRESUPUESTO_MS) { notas.push('presupuesto agotado en anexos'); truncada = true; break; }
    if (visto.has(ax.url)) continue;
    visto.add(ax.url);

    const r = await traer(ax.url, cookies, resumenUrl); cookies = r.cookies;
    if (!r.html) { notas.push(`anexo ilegible (${ROTULO_CATEGORIA[ax.categoria]})`); truncada = true; continue; }
    pagsAnexo++; paginas++;
    filasDeAnexo(r.html, ax, 1);

    // La grilla de anexos muestra 6 archivos por página y pagina el resto:
    //     <a href="javascript:__doPostBack('DWNL$grdId','Page$2')">2</a>
    // Sin recorrerlas, un oferente con 15 anexos aparecía con 6 y los otros 9 no existían para
    // el sistema — nadie los echaba de menos porque el conteo "6 documentos" se veía normal.
    let htmlAnexo = r.html;
    for (const p of paginasDeAnexo(r.html)) {
      if (pagsAnexo >= MAX_PAGINAS_ANEXO) { notas.push(`tope ${MAX_PAGINAS_ANEXO} pág anexos`); truncada = true; break; }
      if (Date.now() - inicio > PRESUPUESTO_MS) { notas.push('presupuesto agotado en anexos'); truncada = true; break; }
      const sig = await postearNavegacion(ax.url, htmlAnexo, cookies, ax.url, 'DWNL$grdId', `Page$${p}`);
      cookies = sig.cookies;
      if (!sig.html) { notas.push(`pág ${p} de ${ROTULO_CATEGORIA[ax.categoria]} ilegible`); truncada = true; break; }
      pagsAnexo++; paginas++; pagsExtra++;
      htmlAnexo = sig.html;
      filasDeAnexo(sig.html, ax, p);
    }
  }

  const diagnostico = [
    `${paginas} pág`,
    `${ofertas.length} ofertas`,
    `${sinRut} grupos sin RUT válido`,
    `${pendientesAnexo.length} anexos`,
    `${pagsAnexo} pág anexos`,
    ...(pagsExtra ? [`${pagsExtra} pág extra por paginación`] : []),
    `${documentos.length} docs`,
    ...(sinLink ? [`${sinLink} sin link`] : []),
    ...(truncada ? ['LECTURA INCOMPLETA'] : []),
    ...notas,
  ].join(' · ').slice(0, 400);

  return { ofertas, documentos, diagnostico, paginas, cookies, referer, truncada };
}

/**
 * Descarga un anexo cuyo botón "Ver" es un ImageButton de ASP.NET (postback).
 *
 * Se re-pide la página contenedora para tener un __VIEWSTATE FRESCO —reutilizar uno viejo hace
 * que el servidor responda la página de error de validación en vez del archivo— y se hace POST
 * del formulario agregando las coordenadas del click (`control.x` / `control.y`), que es lo que
 * ASP.NET usa para saber qué ImageButton se apretó.
 *
 * `numeroPagina` NO es opcional por gusto: los controles de la grilla se llaman ctl02..ctl07 en
 * TODAS las páginas. Si el archivo está en la página 3 y se hace click sin navegar hasta ella,
 * ASP.NET entrega el archivo homólogo de la página 1 — descarga silenciosa del PDF equivocado,
 * que es peor que un error. Por eso primero se pagina y recién ahí se aprieta el botón.
 */
export async function descargarAnexoPorPostback(
  paginaUrl: string, control: string, cookies: string, referer: string, numeroPagina = 1,
): Promise<{ buffer: Buffer; contentType: string; nombre: string | null } | null> {
  try {
    const pagina = await traer(paginaUrl, cookies, referer);
    if (!pagina.html) return null;
    let html = pagina.html;
    let cookiesPag = pagina.cookies;

    // Caminar 1 → 2 → … → N encadenando viewstates (ASP.NET no acepta saltos con uno viejo).
    for (let p = 2; p <= Math.min(numeroPagina, MAX_PAGINAS_GRILLA); p++) {
      const sig = await postearNavegacion(paginaUrl, html, cookiesPag, paginaUrl, 'DWNL$grdId', `Page$${p}`);
      cookiesPag = sig.cookies;
      if (!sig.html) return null;      // sin la página correcta, mejor fallar que bajar otro archivo
      html = sig.html;
    }
    // Si el control que se va a apretar no está en esta página, el postback traería otra cosa.
    if (!html.includes(`name="${control}"`)) return null;

    const accion = html.match(/<form[^>]+action=["']([^"']+)["']/i)?.[1] || paginaUrl;
    // Todos los hidden del formulario (__VIEWSTATE, __VIEWSTATEGENERATOR, __EVENTVALIDATION…).
    const cuerpo = hiddenDelFormulario(html);
    cuerpo.set(`${control}.x`, '8');
    cuerpo.set(`${control}.y`, '8');

    const res = await fetchMPConReintentos(new URL(desescapar(accion), paginaUrl).href, {
      method: 'POST',
      headers: {
        'User-Agent': MP_UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': paginaUrl,
        ...(cookiesPag ? { Cookie: cookiesPag } : {}),
      },
      body: cuerpo.toString(),
      redirect: 'follow',
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return null;
    // Si vuelve HTML es que el postback falló (viewstate vencido / sesión perdida), no el archivo.
    const cabecera = buffer.subarray(0, 200).toString('utf8').toLowerCase();
    if (cabecera.includes('<!doctype html') || cabecera.includes('<html')) return null;

    const disp = res.headers.get('content-disposition') || '';
    return {
      buffer,
      contentType: res.headers.get('content-type') || 'application/octet-stream',
      nombre: disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? null,
    };
  } catch {
    return null;
  }
}

/** Descarga un archivo de oferta por link directo. null si expiró o si vino una pantalla HTML. */
export async function descargarDocumentoOferta(
  url: string, cookies: string, referer: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!url) return null;
  try {
    const res = await fetchMPConReintentos(url, {
      method: 'GET',
      headers: { 'User-Agent': MP_UA, 'Referer': referer, ...(cookies ? { Cookie: cookies } : {}) },
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) return null;
    if (buffer.subarray(0, 200).toString('utf8').toLowerCase().includes('<!doctype html')) return null;
    return { buffer, contentType: res.headers.get('content-type') || 'application/octet-stream' };
  } catch {
    return null;
  }
}
