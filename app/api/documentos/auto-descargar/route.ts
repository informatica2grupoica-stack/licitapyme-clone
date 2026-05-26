// app/api/documentos/auto-descargar/route.ts
// Pipeline: API MP → (descarga directa | scraping ViewAttachmentLC) → R2
//
// ESTRATEGIA ANTI-WAF — dos capas:
//
// 1) API OFICIAL (primaria):
//    api.mercadopublico.cl devuelve Documentos.Listado con URLs de descarga.
//    Esta API no tiene WAF. Las URLs son Download.aspx?enc=... que se pueden
//    intentar descargar directamente desde Vercel (diferente a ViewAttachmentLC).
//
// 2) SCRAPING + SCRAPINGANT (fallback):
//    Si la API no devuelve documentos o las descargas fallan, scrapeamos
//    ViewAttachmentLC.aspx via ScrapingAnt con browser=true (Chromium +
//    proxies residenciales → bypass del WAF de Mercado Público).
//    Sign-up gratuito: https://scrapingant.com (10 000 créditos/mes).
//    NOTA: browser=true usa 10 créditos/req. proxy_type=residential solo
//    funciona con browser=true; con browser=false usa datacenter.

import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { guardarDocumentoEnCache } from '@/app/services/documentosService.server';

// ─── Headers de browser real ───────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function buildHeaders(jar: string, referer?: string): Record<string, string> {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'es-CL,es;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    ...(jar ? { Cookie: jar } : {}),
    ...(referer ? { Referer: referer } : {}),
  };
}

// ─── API oficial de Mercado Público ───────────────────────────────────────
//
// Devuelve la lista de documentos adjuntos directamente desde la API JSON
// (sin scraping). Esta API no tiene el WAF que bloquea ViewAttachmentLC.
//
// Variables de entorno necesarias:
//   MERCADO_PUBLICO_TICKET → ticket de la API (ya configurado en .env.local)

type DocEntry = { nombre: string; downloadUrl: string; size?: number };

async function obtenerDocsDesdeAPI(codigo: string, log: string[]): Promise<DocEntry[]> {
  const ticket = process.env.MERCADO_PUBLICO_TICKET;
  if (!ticket) {
    log.push('⚠️ API MP: MERCADO_PUBLICO_TICKET no configurado');
    return [];
  }

  try {
    const url = `https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?codigo=${encodeURIComponent(codigo)}&ticket=${encodeURIComponent(ticket)}`;
    log.push(`🔌 API MP: ${url.replace(ticket, 'TICKET')}`);

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      // No cache — necesitamos los docs actuales
      cache: 'no-store',
    });

    if (!res.ok) {
      log.push(`⚠️ API MP: HTTP ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json();

    // La API devuelve Codigo=10000 cuando hay error de autenticación/límite
    if (data.Codigo === 10000) {
      log.push(`⚠️ API MP: error ${data.Codigo} — ${data.Mensaje}`);
      return [];
    }

    const licitacion = data.Listado?.[0];
    if (!licitacion) {
      log.push('⚠️ API MP: licitación no encontrada');
      return [];
    }

    // Documentos: puede estar en Documentos.Listado o Documentos directamente
    const rawDocs: any[] = (
      licitacion.Documentos?.Listado ||
      licitacion.Documentos ||
      []
    );

    if (!Array.isArray(rawDocs) || rawDocs.length === 0) {
      log.push('📄 API MP: sin documentos en la respuesta');
      // Log la estructura real para diagnóstico
      const keys = Object.keys(licitacion).filter(k => /doc|adjunto|attach/i.test(k));
      if (keys.length) log.push(`   Campos relacionados: ${keys.join(', ')}`);
      return [];
    }

    const docs: DocEntry[] = rawDocs
      .map((d: any) => ({
        nombre: (d.Nombre || d.nombre || d.Name || 'Documento').trim(),
        downloadUrl: (d.Url || d.URL || d.url || d.DownloadUrl || '').trim(),
      }))
      .filter((d: DocEntry) => !!d.downloadUrl);

    log.push(`✅ API MP: ${docs.length} documentos encontrados (de ${rawDocs.length} totales)`);
    docs.slice(0, 5).forEach((d, i) =>
      log.push(`   ${i + 1}. ${d.nombre} → ${d.downloadUrl.slice(0, 80)}`)
    );
    return docs;

  } catch (e: any) {
    log.push(`⚠️ API MP falló: ${e.message}`);
    return [];
  }
}

// ─── Proxy anti-WAF (ScrapingAnt) ─────────────────────────────────────────
//
// Usa Chromium con proxies residenciales para acceder a ViewAttachmentLC.aspx.
// browser=true → Chromium, proxy residencial por defecto → bypass WAF.
// Costo: 10 créditos/req (free tier = 1 000 req/mes con browser=true).
//
// IMPORTANTE: browser=false con proxy_type=residential no funciona en el
// free tier y causa excepción → fallback a directo → siempre bloqueado.

async function fetchConProxy(
  url: string,
  jar: string,
  referer: string | undefined,
  log: string[],
): Promise<{ html: string; ok: boolean; status: number; usedProxy: boolean }> {
  const apiKey = process.env.SCRAPINGANT_API_KEY;

  if (apiKey) {
    // browser=true: Chromium + residential IPs por defecto → bypass WAF
    const proxyUrl =
      `https://api.scrapingant.com/v2/general` +
      `?x-api-key=${encodeURIComponent(apiKey)}` +
      `&url=${encodeURIComponent(url)}` +
      `&browser=true`;

    log.push(`🕷️ ScrapingAnt → ${url.slice(0, 80)}`);

    try {
      const res = await fetch(proxyUrl, {
        headers: { Accept: 'text/html' },
        // ScrapingAnt puede tardar 15-30s con browser=true
        signal: AbortSignal.timeout(50_000),
      });
      const html = await res.text();

      // ScrapingAnt devuelve 422 si el parámetro es inválido, 402 si sin créditos
      if (!res.ok) {
        log.push(`⚠️ ScrapingAnt HTTP ${res.status}: ${html.slice(0, 200)}`);
        // Caer al fetch directo
      } else {
        log.push(`🕷️ ScrapingAnt OK — HTTP ${res.status} len=${html.length} robot=${html.includes('robot.png') || html.includes('Acceso denegado')}`);
        return { html, ok: res.ok, status: res.status, usedProxy: true };
      }
    } catch (e: any) {
      log.push(`⚠️ ScrapingAnt excepción: ${e.message}`);
    }
  }

  // Fetch directo (bloqueado por MP WAF desde IPs de AWS/Vercel, solo como último recurso)
  log.push(`🌐 Fetch directo → ${url.slice(0, 80)}`);
  const res = await fetch(url, { headers: buildHeaders(jar, referer), redirect: 'follow' });
  const html = await res.text();
  return { html, ok: res.ok, status: res.status, usedProxy: false };
}

// ─── Utilidades ────────────────────────────────────────────────────────────

function resolveUrl(raw: string): string {
  if (!raw || raw.startsWith('javascript') || raw === '#') return '';
  if (raw.startsWith('http')) return raw;
  if (raw.startsWith('../')) return `https://www.mercadopublico.cl/Procurement/Modules/${raw.slice(3)}`;
  if (raw.startsWith('/')) return `https://www.mercadopublico.cl${raw}`;
  return `https://www.mercadopublico.cl/Procurement/Modules/Attachment/${raw}`;
}

function parseSizeStr(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s.trim().match(/^([\d.,]+)\s*(KB|MB|B)?$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(',', '.'));
  const u = (m[2] || 'B').toUpperCase();
  if (u === 'MB') return Math.round(n * 1048576);
  if (u === 'KB') return Math.round(n * 1024);
  return Math.round(n);
}

function mergeCookies(jar: string, response: Response): string {
  let newCookies: string[] = [];
  try { newCookies = (response.headers as any).getSetCookie?.() ?? []; } catch {}
  if (!newCookies.length) {
    const raw = response.headers.get('set-cookie');
    if (raw) newCookies = raw.split(/,(?=[^;]*=)/);
  }
  const parsed = newCookies.map(c => c.split(';')[0].trim()).filter(Boolean);
  if (!parsed.length) return jar;
  const existing = Object.fromEntries(jar.split('; ').filter(Boolean).map(c => {
    const idx = c.indexOf('=');
    return idx > 0 ? [c.slice(0, idx), c.slice(idx + 1)] : [c, ''];
  }));
  parsed.forEach(c => {
    const idx = c.indexOf('=');
    if (idx > 0) existing[c.slice(0, idx).trim()] = c.slice(idx + 1);
  });
  return Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Extrae documentos descargables de HTML.
 * Estrategia 1: filas de tabla con URL de descarga real (obligatoria)
 * Estrategia 2: <a href> con patrones de descarga o extensión de archivo
 * Estrategia 3: atributos onclick con rutas de descarga
 *
 * IMPORTANTE: Solo se agregan entradas con downloadUrl no vacía.
 */
function extraerDocumentosDe(html: string, pageUrl: string, log: string[]): DocEntry[] {
  const $ = cheerio.load(html);
  const docs: DocEntry[] = [];
  const seen = new Set<string>();

  // ── Estrategia 1: filas de tabla ────────────────────────────────────────
  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;

    // Buscar URL de descarga PRIMERO — si no hay, esta fila no es un documento
    let downloadUrl = '';
    $(row).find('a[href]').each((_, a) => {
      if (downloadUrl) return;
      const href = $(a).attr('href') || '';
      if (isDownloadHref(href)) downloadUrl = resolveUrl(href);
    });
    if (!downloadUrl) {
      $(row).find('[onclick]').each((_, el) => {
        if (downloadUrl) return;
        downloadUrl = extractOnclickUrl($(el).attr('onclick') || '');
      });
    }

    // Sin URL → no es un documento descargable (ignorar)
    if (!downloadUrl) return;

    // Nombre: celda con extensión de archivo, o la más larga (< 200 chars)
    let nombre = '';
    let sizeStr = '';
    cells.each((_, cell) => {
      const t = $(cell).text().trim();
      if (/\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|csv|txt|xml|dwg|jpg|png|odt|ods)/i.test(t) && !nombre) {
        nombre = t;
      }
      if (/^\d[\d.,]*\s*(KB|MB|B)\b/i.test(t)) sizeStr = t;
    });
    if (!nombre) {
      let max = 0;
      cells.each((_, cell) => {
        const t = $(cell).text().trim();
        if (t.length > max && t.length >= 3 && t.length < 200 && !/^\d+$/.test(t)) {
          max = t.length; nombre = t;
        }
      });
    }
    if (!nombre) nombre = extractFilenameFromUrl(downloadUrl) || `Documento_${docs.length + 1}`;

    if (!seen.has(downloadUrl)) {
      seen.add(downloadUrl);
      docs.push({ nombre, downloadUrl, size: parseSizeStr(sizeStr) });
    }
  });

  log.push(`📊 Estrategia tabla: ${docs.length} docs con URL`);
  if (docs.length > 0) return docs;

  // ── Estrategia 2: todos los <a> con href de descarga o extensión ────────
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (!href || href === '#' || href.startsWith('javascript')) return;
    if (!isDownloadHref(href) && !isFileHref(href)) return;
    const url = resolveUrl(href);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const nombre = $(a).text().trim() || extractFilenameFromUrl(href) || `Documento_${docs.length + 1}`;
    docs.push({ nombre, downloadUrl: url });
  });

  // ── Estrategia 3: onclick ───────────────────────────────────────────────
  $('[onclick]').each((_, el) => {
    const url = extractOnclickUrl($(el).attr('onclick') || '');
    if (!url || seen.has(url)) return;
    seen.add(url);
    const nombre = $(el).text().trim() || `Documento_${docs.length + 1}`;
    docs.push({ nombre, downloadUrl: url });
  });

  log.push(`📊 Estrategia links/onclick: ${docs.length} docs con URL`);
  return docs;
}

function isDownloadHref(href: string): boolean {
  const lower = href.toLowerCase();
  // Excluir páginas del portal que NO son descargas directas de archivos
  if (lower.includes('viewattachment')    // viewer de adjuntos (HTML)
   || lower.includes('detailsacquisition') // ficha de licitación (HTML)
   || lower.includes('rfb/'))              // sección RFB (HTML)
    return false;
  // Solo patrones que apuntan a endpoints de descarga real
  return lower.includes('download') || lower.includes('getattachment') || lower.includes('getfile') || lower.includes('archivo');
}

function isFileHref(href: string): boolean {
  return /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|csv|xml|dwg)/i.test(href);
}

function extractFilenameFromUrl(url: string): string {
  try { return decodeURIComponent(url.split('/').pop()?.split('?')[0] || ''); } catch { return ''; }
}

function extractOnclickUrl(onclick: string): string {
  if (!onclick) return '';
  const m = onclick.match(/['"]([^'"]*(?:[Dd]ownload|[Aa]ttachment|[Gg]et[Ff]ile)[^'"]*)['"]/);
  return m?.[1] ? resolveUrl(m[1]) : '';
}

function htmlDiag(html: string): string {
  const $ = cheerio.load(html);
  const hasCapt = html.includes('recaptcha') || html.includes('reCAPTCHA');
  const hasRobot = html.includes('robot.png') || html.includes('Acceso denegado');
  return `tables=${$('table').length} tr=${$('tr').length} a=${$('a[href]').length} len=${html.length} captcha=${hasCapt} robot=${hasRobot}`;
}

// ─── Pipeline principal ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { licitacionCodigo } = await request.json();

  if (!licitacionCodigo) {
    return NextResponse.json({ error: 'licitacionCodigo requerido' }, { status: 400 });
  }

  const proxyConfigurado = !!process.env.SCRAPINGANT_API_KEY;
  const apiConfigurada   = !!process.env.MERCADO_PUBLICO_TICKET;
  let jar = '';
  const log: string[] = [];

  log.push(`🔧 API oficial MP: ${apiConfigurada ? '✅ ticket configurado' : '⚠️ sin ticket'}`);
  log.push(`🔧 Proxy ScrapingAnt: ${proxyConfigurado ? '✅ configurado' : '⚠️ sin clave'}`);

  const fichaUrl = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(licitacionCodigo)}`;
  let adjuntoUrl = '';

  try {
    // ── PASO 0: API oficial de Mercado Público ────────────────────────────
    //
    // La API JSON no tiene WAF. Devuelve Documentos.Listado con URLs de
    // Download.aspx. Estas URLs se pueden intentar descargar directamente
    // desde Vercel — si no están bloqueadas, el problema queda resuelto
    // sin necesidad de ningún proxy.

    log.push('─── PASO 0: API oficial ───');
    let docsEncontrados: DocEntry[] = await obtenerDocsDesdeAPI(licitacionCodigo, log);

    // Si la API encontró documentos, ya tenemos las URLs — saltar scraping
    if (docsEncontrados.length === 0) {
      // ── PASO 1: Warm-up de sesión ────────────────────────────────────────
      log.push('─── PASO 1: Sesión + Ficha ───');
      try {
        const resHome = await fetch('https://www.mercadopublico.cl/', {
          headers: buildHeaders(jar), redirect: 'follow',
        });
        jar = mergeCookies(jar, resHome);
        log.push(`🏠 Sesión: ${jar.split('; ').filter(Boolean).length} cookies`);
      } catch {
        log.push('⚠️ Warm-up falló — continuando sin sesión');
      }

      // ── PASO 2: DetailsAcquisition → encontrar link de adjuntos ──────────
      log.push(`🔍 Ficha: ${fichaUrl}`);
      const res1 = await fetch(fichaUrl, { headers: buildHeaders(jar, 'https://www.mercadopublico.cl/'), redirect: 'follow' });
      jar = mergeCookies(jar, res1);
      if (!res1.ok) throw new Error(`Ficha HTTP ${res1.status}`);
      const html1 = await res1.text();
      log.push(`📄 Ficha: ${html1.length} bytes`);

      if (html1.includes('actividad anormal') || html1.includes('unusual activity')) {
        throw new Error('Bloqueado por WAF de Mercado Público');
      }

      const $1 = cheerio.load(html1);

      for (const pat of [/ViewAttachmentLC\.aspx[^'")\s]*/i, /ViewAttachment\.aspx[^'")\s]*/i]) {
        if (adjuntoUrl) break;
        $1('[href]').each((_, el) => {
          if (adjuntoUrl) return;
          const m = ($1(el).attr('href') || '').match(pat);
          if (m) adjuntoUrl = resolveUrl(m[0]);
        });
        $1('[onclick]').each((_, el) => {
          if (adjuntoUrl) return;
          const mOpen = ($1(el).attr('onclick') || '').match(/open\(\s*['"]([^'"]+)['"]/i);
          if (mOpen) { const m = mOpen[1].match(pat); if (m) adjuntoUrl = resolveUrl(mOpen[1]); }
        });
      }

      if (!adjuntoUrl) {
        log.push('⚠️ No se encontró link de adjuntos en la ficha');
        return NextResponse.json({
          success: false,
          error: 'No hay adjuntos para esta licitación',
          ficha_url_mp: fichaUrl,
          proxy_configurado: proxyConfigurado,
          log,
        });
      }
      log.push(`🔗 Adjuntos: ${adjuntoUrl.slice(0, 100)}`);

      // ── PASO 3: ViewAttachment → extraer URL de ViewAttachmentLC ─────────
      let lcUrl = adjuntoUrl;
      let html2 = '';
      log.push('─── PASO 3: ViewAttachment → ViewAttachmentLC ───');

      if (!adjuntoUrl.includes('ViewAttachmentLC')) {
        const res2 = await fetch(adjuntoUrl, { headers: buildHeaders(jar, fichaUrl), redirect: 'follow' });
        jar = mergeCookies(jar, res2);
        if (res2.ok) {
          html2 = await res2.text();
          log.push(`📄 ViewAttachment: ${html2.length} bytes`);
          const mLC = html2.match(/window\.location(?:\.href)?\s*=\s*['"]([^'"]*ViewAttachmentLC\.aspx[^'"]+)['"]/);
          if (mLC) {
            lcUrl = resolveUrl(mLC[1]);
            log.push('✅ ViewAttachmentLC extraído del JS redirect');
          } else {
            const $2 = cheerio.load(html2);
            $2('[href*="ViewAttachmentLC"],[src*="ViewAttachmentLC"]').each((_, el) => {
              if (lcUrl !== adjuntoUrl) return;
              const v = $2(el).attr('href') || $2(el).attr('src') || '';
              if (v.includes('ViewAttachmentLC')) lcUrl = resolveUrl(v);
            });
          }
        }
      }

      log.push(`📋 Paso 4 — ViewAttachmentLC: ${lcUrl.slice(0, 100)}`);

      // ── PASO 4: ViewAttachmentLC vía ScrapingAnt ──────────────────────────
      log.push('─── PASO 4: ViewAttachmentLC (ScrapingAnt) ───');
      const { html: htmlLC, ok: lcOk, status: lcStatus } = await fetchConProxy(lcUrl, jar, adjuntoUrl, log);
      const html3 = htmlLC;
      log.push(`📊 ViewAttachmentLC: ${htmlDiag(html3)} (HTTP ${lcStatus})`);

      if (!lcOk) {
        log.push(`❌ ViewAttachmentLC HTTP ${lcStatus}`);
      } else if (html3.includes('robot.png') || html3.includes('Acceso denegado')) {
        log.push('🤖 ViewAttachmentLC bloqueado por WAF (robot.png)');
        if (!proxyConfigurado) {
          log.push('💡 Configura SCRAPINGANT_API_KEY en Vercel → Settings → Environment Variables');
        } else {
          log.push('💡 ScrapingAnt también fue bloqueado. Opciones: 1) upgrade ScrapingAnt, 2) usar docs del API MP si están disponibles');
        }
      } else {
        // ── PASO 4b: WebForms POST si hay __VIEWSTATE ──────────────────
        const $3get = cheerio.load(html3);
        const viewState     = ($3get('input[name="__VIEWSTATE"]').val() as string)          || '';
        const evValidation  = ($3get('input[name="__EVENTVALIDATION"]').val() as string)    || '';
        const vsGenerator   = ($3get('input[name="__VIEWSTATEGENERATOR"]').val() as string) || '';

        if (viewState && html3.length > 2000) {
          log.push('🔄 Intentando POST WebForms...');
          try {
            const form = new URLSearchParams({
              __VIEWSTATE: viewState, __EVENTVALIDATION: evValidation,
              __VIEWSTATEGENERATOR: vsGenerator, __EVENTTARGET: '',
              __EVENTARGUMENT: '', __ASYNCPOST: 'true',
            });
            const resPost = await fetch(lcUrl, {
              method: 'POST',
              headers: {
                ...buildHeaders(jar, lcUrl),
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                'X-MicrosoftAjax': 'Delta=true',
              },
              body: form.toString(), redirect: 'follow',
            });
            jar = mergeCookies(jar, resPost);
            if (resPost.ok) {
              const htmlPost = await resPost.text();
              log.push(`📊 POST WebForms: ${htmlDiag(htmlPost)}`);
              if (htmlPost.length > html3.length || htmlPost.includes('Download') || htmlPost.includes('Attachment')) {
                log.push('✅ POST devolvió contenido más completo');
                docsEncontrados = extraerDocumentosDe(htmlPost, lcUrl, log);
              }
            }
          } catch (e: any) { log.push(`⚠️ POST falló: ${e.message}`); }
        }

        // ── PASO 4c: Extraer documentos del HTML ───────────────────────
        if (docsEncontrados.length === 0) {
          docsEncontrados = extraerDocumentosDe(html3, lcUrl, log);
        }
      }

      // ── PASO 4d: Fallback → ViewAttachment directo ─────────────────
      if (docsEncontrados.length === 0 && html2) {
        log.push('🔄 Fallback: extrayendo de ViewAttachment.aspx...');
        docsEncontrados = extraerDocumentosDe(html2, adjuntoUrl, log);
      }

      // ── PASO 4e: JSON en <script> ───────────────────────────────────
      if (docsEncontrados.length === 0) {
        for (const script of (html3.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [])) {
          const jsonMatch = script.match(/\[\s*\{[^<]{50,}\}\s*\]/);
          if (jsonMatch) {
            try {
              const arr = JSON.parse(jsonMatch[0]);
              for (const item of arr) {
                const u = item.url || item.Url || item.downloadUrl || item.DownloadUrl || '';
                const n = item.nombre || item.Nombre || item.name || item.Name || `Documento_${docsEncontrados.length + 1}`;
                if (u) docsEncontrados.push({ nombre: n, downloadUrl: resolveUrl(u) });
              }
              if (docsEncontrados.length > 0) {
                log.push(`✅ JSON en script: ${docsEncontrados.length} docs`);
                break;
              }
            } catch {}
          }
        }
      }
    } // end scraping path

    log.push(`📄 Total documentos: ${docsEncontrados.length}`);

    if (docsEncontrados.length === 0) {
      return NextResponse.json({
        success: false,
        error: proxyConfigurado || apiConfigurada
          ? 'No se encontraron documentos. La API MP no los devolvió y el scraping fue bloqueado.'
          : 'Mercado Público bloquea el acceso automático. Configura SCRAPINGANT_API_KEY o descarga manualmente.',
        adjunto_url_mp: adjuntoUrl || fichaUrl,
        ficha_url_mp: fichaUrl,
        proxy_configurado: proxyConfigurado,
        log,
      });
    }

    // ── PASO 5: Descargar cada doc y subir a R2 ────────────────────────────
    log.push('─── PASO 5: Descargando y subiendo a R2 ───');
    const resultados: any[] = [];
    let descargados = 0;

    for (const doc of docsEncontrados) {
      if (!doc.downloadUrl) {
        resultados.push({ nombre: doc.nombre, status: 'sin_url' });
        continue;
      }
      try {
        log.push(`⬇️ ${doc.nombre}`);
        const resDoc = await fetch(doc.downloadUrl, {
          headers: {
            ...buildHeaders(jar, adjuntoUrl || fichaUrl),
            Accept: 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.*,application/octet-stream,*/*',
          },
          redirect: 'follow',
        });
        jar = mergeCookies(jar, resDoc);

        if (!resDoc.ok) {
          log.push(`❌ HTTP ${resDoc.status} — ${doc.nombre}`);
          resultados.push({ nombre: doc.nombre, status: `error_http_${resDoc.status}` });
          continue;
        }

        const contentType = resDoc.headers.get('content-type') || 'application/octet-stream';
        if (contentType.includes('text/html')) {
          // Download.aspx también bloqueado — esto es común en Vercel
          log.push(`🚫 Download.aspx bloqueado (HTML) — ${doc.nombre}`);
          resultados.push({ nombre: doc.nombre, status: 'descarga_bloqueada', downloadUrl: doc.downloadUrl });
          continue;
        }

        const buffer = Buffer.from(await resDoc.arrayBuffer());
        let nombreFinal = doc.nombre;
        const cd = resDoc.headers.get('content-disposition');
        if (cd) {
          const mcd = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (mcd?.[1]) nombreFinal = mcd[1].replace(/['"]/g, '').trim();
        }
        if (!/\.\w{2,5}$/.test(nombreFinal)) {
          const ext = contentType.includes('pdf') ? '.pdf'
            : contentType.includes('word') ? '.docx'
            : contentType.includes('excel') ? '.xlsx'
            : contentType.includes('zip') ? '.zip' : '';
          if (ext) nombreFinal += ext;
        }

        const publicUrl = await subirDocumentoR2(licitacionCodigo, nombreFinal, buffer, contentType);
        await guardarDocumentoEnCache(licitacionCodigo, nombreFinal, publicUrl, buffer.length);

        descargados++;
        log.push(`✅ ${nombreFinal} (${(buffer.length / 1024).toFixed(0)} KB)`);
        resultados.push({ nombre: nombreFinal, status: 'ok', url: publicUrl, size: buffer.length });

      } catch (e: any) {
        log.push(`❌ Error ${doc.nombre}: ${e.message}`);
        resultados.push({ nombre: doc.nombre, status: 'error', error: e.message });
      }
    }

    // Si las descargas fueron bloqueadas pero tenemos las URLs de la API,
    // igual devolvemos éxito parcial con los links de MP
    const descargasBloqueadas = resultados.filter(r => r.status === 'descarga_bloqueada');
    const urlsDocumentoMP = descargasBloqueadas.map(r => r.downloadUrl).filter(Boolean);

    return NextResponse.json({
      success: descargados > 0,
      total: docsEncontrados.length,
      descargados,
      documentos: resultados,
      adjunto_url_mp: adjuntoUrl || fichaUrl,
      ficha_url_mp: fichaUrl,
      proxy_configurado: proxyConfigurado,
      // Si descarga bloqueada pero tenemos URLs del API, retornarlas al frontend
      urls_documentos_mp: urlsDocumentoMP.length > 0 ? urlsDocumentoMP : undefined,
      log,
    });

  } catch (error: any) {
    log.push(`💥 Error crítico: ${error.message}`);
    return NextResponse.json({ success: false, error: error.message, log }, { status: 500 });
  }
}
