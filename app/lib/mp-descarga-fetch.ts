// app/lib/mp-descarga-fetch.ts
// Descarga de adjuntos de Mercado Público vía fetch puro (sin captcha).
//
// MP expone los adjuntos en grillas ASP.NET. Hay tres puntos de entrada:
//   • VerAntecedentes.aspx?enc=...   → grilla directa de la sección "Anexos"     ✅
//   • ViewAttachmentLC.aspx?enc=...  → grilla "Ver anexos" (incluye las bases)    ✅
//   • ViewAttachment.aspx?enc=...    → página con reCAPTCHA que SOLO redirige a
//                                      ViewAttachmentLC. El gate (302→403) es
//                                      cosmético: la grilla LC entrega el binario
//                                      por POST sin validar ningún token.          ✅
//
// Todas las grillas son el mismo formulario: GET para leer __VIEWSTATE + los
// botones-lupa por fila (input[type=image] cuyo name termina en grdIbtnView o
// $search), y un POST por botón que devuelve el binario. No interviene CapSolver
// ni reCAPTCHA en ningún punto.

import * as cheerio from 'cheerio';
import {
  MP_UA,
  ArchivoDescargado,
  extraerCookies,
  combinarCookies,
  nombreDesdeDisposition,
  contentTypePorNombre,
} from '@/app/lib/mp-adjuntos';

type Cheerio$ = ReturnType<typeof cheerio.load>;

/** Nombre del archivo leído de la fila de la grilla donde está el botón. */
function nombreDeFila($: Cheerio$, boton: any, indice: number): string {
  const fila = $(boton).closest('tr');
  let nombre = '';
  fila.find('td, span').each((_, celda) => {
    const txt = $(celda).text().trim();
    if (!nombre && /\.(pdf|docx?|xlsx?|zip|rar|png|jpe?g|kmz|kml|txt|rtf|pptx?|dwg)$/i.test(txt)) nombre = txt;
  });
  return nombre || `archivo_${indice + 1}`;
}

/** Clave normalizada para deduplicar nombres entre grillas (espacios/_/mayúsculas). */
function claveNombre(nombre: string): string {
  return nombre.toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

const headersBase = (referer: string, cookies: string) => ({
  'User-Agent': MP_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-CL,es;q=0.9',
  'Referer': referer,
  ...(cookies ? { 'Cookie': cookies } : {}),
});

/**
 * Descarga todos los archivos de una grilla ASP.NET (VerAntecedentes o
 * ViewAttachmentLC). Lee el cuerpo aunque la respuesta sea un 302 (la grilla LC
 * llega con el HTML completo pese al redirect cosmético). `yaTenemos` evita
 * volver a bajar un archivo que otra grilla ya entregó.
 */
async function descargarGrilla(
  gridUrl: string,
  cookies: string,
  referer: string,
  yaTenemos: Set<string>,
): Promise<ArchivoDescargado[]> {
  const headers = headersBase(referer, cookies);

  const getRes = await fetch(gridUrl, {
    method: 'GET',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });

  const cookiesActuales = combinarCookies(cookies, extraerCookies(getRes));
  const html = await getRes.text(); // se lee siempre, incluso en 302 con cuerpo

  const $ = cheerio.load(html);

  const hidden: Record<string, string> = {};
  $('input[type="hidden"]').each((_, el) => {
    const name = $(el).attr('name');
    if (name) hidden[name] = $(el).attr('value') || '';
  });

  // Sin __VIEWSTATE no es una grilla procesable (403 puro o página de captcha vacía).
  if (!hidden['__VIEWSTATE']) return [];

  const botones = $('input[type="image"]')
    .toArray()
    .map((el, i) => {
      const name = $(el).attr('name') || '';
      if (!/(grdIbtnView|\$search)$/i.test(name)) return null;
      return { ctl: name, nombre: nombreDeFila($, el, i) };
    })
    .filter((b): b is { ctl: string; nombre: string } => b !== null);

  if (botones.length === 0) return [];

  const archivos: ArchivoDescargado[] = [];

  for (const fila of botones) {
    // Saltar lo que ya bajó otra grilla (las bases LC y los anexos VerAntecedentes
    // se solapan). El nombre de la fila basta para deduplicar antes del POST.
    if (yaTenemos.has(claveNombre(fila.nombre))) continue;

    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(hidden)) form.append(k, v);
    form.append(`${fila.ctl}.x`, '8');
    form.append(`${fila.ctl}.y`, '8');

    const postRes = await fetch(gridUrl, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookiesActuales,
        'Referer': gridUrl,
      },
      body: form.toString(),
      signal: AbortSignal.timeout(60_000),
    });

    if (!postRes.ok) continue;

    const ct = postRes.headers.get('content-type') || '';
    if (ct.includes('text/html') || ct.includes('text/plain')) continue;

    const buffer = Buffer.from(await postRes.arrayBuffer());
    if (buffer.length < 128) continue;

    const nombre = nombreDesdeDisposition(postRes) || fila.nombre;
    yaTenemos.add(claveNombre(nombre));
    yaTenemos.add(claveNombre(fila.nombre));
    console.log(`[fetch] Descargado: ${nombre} (${buffer.length} bytes)`);
    archivos.push({ nombre, buffer, contentType: ct || contentTypePorNombre(nombre) });
  }

  return archivos;
}

/**
 * Descarga todos los archivos disponibles desde un pop-up de adjuntos.
 *
 * - VerAntecedentes.aspx / ViewAttachmentLC.aspx → grilla directa.
 * - ViewAttachment.aspx → se deriva el enc de la grilla LC desde su JS y se baja
 *   de ahí (incluye las bases en PDF/Excel; el captcha no bloquea el POST).
 *
 * `yaTenemos` se comparte entre los pop-ups de una misma licitación para no
 * descargar dos veces los archivos que aparecen en más de una grilla.
 */
export async function descargarViaPopup(
  encUrl: string,
  cookies: string,
  referer: string,
  yaTenemos: Set<string> = new Set(),
): Promise<ArchivoDescargado[]> {
  // Grillas directas.
  if (!/\/ViewAttachment\.aspx/i.test(encUrl)) {
    return descargarGrilla(encUrl, cookies, referer, yaTenemos);
  }

  // ViewAttachment.aspx: leer la página gate y derivar la URL de la grilla LC.
  const gateRes = await fetch(encUrl, {
    method: 'GET',
    headers: headersBase(referer, cookies),
    signal: AbortSignal.timeout(20_000),
  });
  const cookiesGate = combinarCookies(cookies, extraerCookies(gateRes));
  const gateHtml = await gateRes.text();

  const m = gateHtml.match(/ViewAttachmentLC\.aspx\?enc=[A-Za-z0-9%+/=_-]+/i);
  if (!m) {
    console.warn('[fetch] ViewAttachment sin enc de grilla LC — se omite');
    return [];
  }
  const lcUrl = new URL(m[0], encUrl).href;
  return descargarGrilla(lcUrl, cookiesGate, encUrl, yaTenemos);
}
