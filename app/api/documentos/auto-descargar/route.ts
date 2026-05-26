// app/api/documentos/auto-descargar/route.ts
// Pipeline completo: ficha MP → ViewAttachment → ViewAttachmentLC → descarga → R2
// Estrategia multi-capa para superar WAF / AJAX / WebForms de Mercado Público
import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { guardarDocumentoEnCache } from '@/app/services/documentosService.server';

// ─── Headers realistas ─────────────────────────────────────────────────────

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

/** Extrae todas las cookies Set-Cookie y las fusiona al jar */
function mergeCookies(jar: string, response: Response): string {
  let newCookies: string[] = [];
  try {
    newCookies = (response.headers as any).getSetCookie?.() ?? [];
  } catch {}
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

type DocEntry = { nombre: string; downloadUrl: string; size?: number };

/**
 * Extrae todos los documentos descargables de un HTML ya parseado.
 * Estrategia 1: tabla con celdas (≥2 columnas)
 * Estrategia 2: cualquier <a> con href que apunte a un archivo/Download
 * Estrategia 3: onclick con rutas de descarga
 */
function extraerDocumentosDe(html: string, pageUrl: string, log: string[]): DocEntry[] {
  const $ = cheerio.load(html);
  const docs: DocEntry[] = [];
  const seen = new Set<string>();

  // ── Estrategia 1: filas de tabla ────────────────────────────────────────
  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) return;

    // Nombre: celda con extensión de archivo conocida, o la más larga
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
        if (t.length > max && t.length >= 3 && !/^\d+$/.test(t) && !/^[<>]/.test(t)) {
          max = t.length; nombre = t;
        }
      });
    }
    if (!nombre || nombre.length < 3) return;

    // URL de descarga: buscar <a href> en la fila con patrones de descarga
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

    const key = downloadUrl || nombre;
    if (!seen.has(key)) { seen.add(key); docs.push({ nombre, downloadUrl, size: parseSizeStr(sizeStr) }); }
  });

  log.push(`📊 Estrategia tabla: ${docs.length} docs`);
  if (docs.length > 0) return docs;

  // ── Estrategia 2: todos los <a> de la página ────────────────────────────
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (!href || href === '#' || href.startsWith('javascript')) return;
    if (!isDownloadHref(href) && !isFileHref(href)) return;
    const url = resolveUrl(href);
    if (!url) return;
    const nombre = $(a).text().trim() || extractFilenameFromUrl(href) || `Documento_${docs.length + 1}`;
    if (!seen.has(url)) { seen.add(url); docs.push({ nombre, downloadUrl: url }); }
  });

  // ── Estrategia 3: onclick en cualquier elemento ─────────────────────────
  $('[onclick]').each((_, el) => {
    const url = extractOnclickUrl($(el).attr('onclick') || '');
    if (!url || seen.has(url)) return;
    seen.add(url);
    const nombre = $(el).text().trim() || `Documento_${docs.length + 1}`;
    docs.push({ nombre, downloadUrl: url });
  });

  log.push(`📊 Estrategia links: ${docs.length} docs`);
  return docs;
}

function isDownloadHref(href: string): boolean {
  const lower = href.toLowerCase();
  return lower.includes('download') || lower.includes('attachment') || lower.includes('getfile') || lower.includes('archivo');
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

/** Resumen de estructura HTML para logs de diagnóstico */
function htmlDiag(html: string): string {
  const $ = cheerio.load(html);
  const tables = $('table').length;
  const trs = $('tr').length;
  const tds = $('td').length;
  const anchors = $('a[href]').length;
  const forms = $('form').length;
  const hasVS = !!$('input[name="__VIEWSTATE"]').val();
  const hasCapt = html.includes('recaptcha') || html.includes('reCAPTCHA');
  const hasError = html.includes('Error') || html.includes('error') || html.includes('acceso denegado');
  return `tables=${tables} tr=${trs} td=${tds} a=${anchors} form=${forms} viewState=${hasVS} captcha=${hasCapt} error=${hasError} len=${html.length}`;
}

// ─── Pipeline principal ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { licitacionCodigo } = await request.json();

  if (!licitacionCodigo) {
    return NextResponse.json({ error: 'licitacionCodigo requerido' }, { status: 400 });
  }

  let jar = '';
  const log: string[] = [];

  try {
    // ── PASO 0: Calentar sesión en homepage de MP ──────────────────────────
    // Establece cookies de sesión antes de navegar a la ficha
    try {
      const resHome = await fetch('https://www.mercadopublico.cl/', {
        headers: buildHeaders(jar),
        redirect: 'follow',
      });
      jar = mergeCookies(jar, resHome);
      log.push(`🏠 Sesión iniciada (${jar.split('; ').length} cookies)`);
    } catch {
      log.push('⚠️ Warm-up falló — continuando sin sesión');
    }

    // ── PASO 1: Ficha principal → encontrar link de adjuntos ─────────────
    const fichaUrl = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(licitacionCodigo)}`;
    log.push(`🔍 Paso 1 — Ficha: ${fichaUrl}`);

    const res1 = await fetch(fichaUrl, { headers: buildHeaders(jar, 'https://www.mercadopublico.cl/'), redirect: 'follow' });
    jar = mergeCookies(jar, res1);

    if (!res1.ok) throw new Error(`Ficha HTTP ${res1.status}`);
    const html1 = await res1.text();
    log.push(`📄 Ficha: ${html1.length} bytes`);

    if (html1.includes('actividad anormal') || html1.includes('unusual activity')) {
      throw new Error('Bloqueado por WAF de Mercado Público');
    }

    const $1 = cheerio.load(html1);
    let adjuntoUrl = '';

    const patterns = [/ViewAttachmentLC\.aspx[^'")\s]*/i, /ViewAttachment\.aspx[^'")\s]*/i];

    for (const pat of patterns) {
      if (adjuntoUrl) break;
      $1('[href]').each((_, el) => {
        if (adjuntoUrl) return;
        const m = ($1(el).attr('href') || '').match(pat);
        if (m) adjuntoUrl = resolveUrl(m[0]);
      });
      $1('[onclick]').each((_, el) => {
        if (adjuntoUrl) return;
        const onclick = $1(el).attr('onclick') || '';
        const mOpen = onclick.match(/open\(\s*['"]([^'"]+)['"]/i);
        if (mOpen) {
          const m = mOpen[1].match(pat);
          if (m) adjuntoUrl = resolveUrl(mOpen[1]);
        }
      });
    }

    if (!adjuntoUrl) {
      log.push('⚠️ No se encontró link de adjuntos en la ficha');
      return NextResponse.json({ success: false, error: 'No hay adjuntos para esta licitación', log });
    }
    log.push(`🔗 Adjuntos: ${adjuntoUrl.slice(0, 100)}`);

    // ── PASO 2: ViewAttachment → extraer ViewAttachmentLC ─────────────────
    let lcUrl = adjuntoUrl;
    let html2 = '';

    if (!adjuntoUrl.includes('ViewAttachmentLC')) {
      log.push('🔄 Paso 2 — Cargando ViewAttachment...');
      const res2 = await fetch(adjuntoUrl, { headers: buildHeaders(jar, fichaUrl), redirect: 'follow' });
      jar = mergeCookies(jar, res2);

      if (res2.ok) {
        html2 = await res2.text();
        log.push(`📄 ViewAttachment: ${html2.length} bytes`);

        // Buscar window.location.href = 'ViewAttachmentLC...' en el JS
        const mLC = html2.match(/window\.location(?:\.href)?\s*=\s*['"]([^'"]*ViewAttachmentLC\.aspx[^'"]+)['"]/);
        if (mLC) {
          lcUrl = resolveUrl(mLC[1]);
          log.push(`✅ ViewAttachmentLC extraído del JS`);
        } else {
          // Buscar en href/src/meta refresh
          const $2 = cheerio.load(html2);
          $2('[href*="ViewAttachmentLC"],[src*="ViewAttachmentLC"]').each((_, el) => {
            if (lcUrl !== adjuntoUrl) return;
            const v = $2(el).attr('href') || $2(el).attr('src') || '';
            if (v.includes('ViewAttachmentLC')) lcUrl = resolveUrl(v);
          });
          const metaRefresh = html2.match(/content=["']\d+;\s*url=([^"']+ViewAttachmentLC[^"']+)["']/i);
          if (metaRefresh && lcUrl === adjuntoUrl) lcUrl = resolveUrl(metaRefresh[1]);
        }
      }
    }

    log.push(`📋 Paso 3 — ViewAttachmentLC: ${lcUrl.slice(0, 100)}`);

    // ── PASO 3a: GET ViewAttachmentLC ──────────────────────────────────────
    const res3 = await fetch(lcUrl, { headers: buildHeaders(jar, adjuntoUrl), redirect: 'follow' });
    jar = mergeCookies(jar, res3);

    if (!res3.ok) throw new Error(`ViewAttachmentLC HTTP ${res3.status}`);
    let html3 = await res3.text();
    log.push(`📊 ViewAttachmentLC GET: ${htmlDiag(html3)}`);

    // ── PASO 3b: WebForms POST si la página tiene __VIEWSTATE ─────────────
    // ASP.NET WebForms a veces carga la grilla solo después de un postback
    const $3get = cheerio.load(html3);
    const viewState = ($3get('input[name="__VIEWSTATE"]').val() as string) || '';
    const eventValidation = ($3get('input[name="__EVENTVALIDATION"]').val() as string) || '';
    const vsGenerator = ($3get('input[name="__VIEWSTATEGENERATOR"]').val() as string) || '';

    if (viewState && html3.length > 2000) {
      log.push('🔄 Intentando POST WebForms...');
      try {
        const form = new URLSearchParams({
          __VIEWSTATE: viewState,
          __EVENTVALIDATION: eventValidation,
          __VIEWSTATEGENERATOR: vsGenerator,
          __EVENTTARGET: '',
          __EVENTARGUMENT: '',
          __ASYNCPOST: 'true',
        });
        const resPost = await fetch(lcUrl, {
          method: 'POST',
          headers: {
            ...buildHeaders(jar, lcUrl),
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'X-MicrosoftAjax': 'Delta=true',
          },
          body: form.toString(),
          redirect: 'follow',
        });
        jar = mergeCookies(jar, resPost);
        if (resPost.ok) {
          const htmlPost = await resPost.text();
          log.push(`📊 WebForms POST: ${htmlDiag(htmlPost)}`);
          // Usar respuesta POST si contiene más contenido relevante
          if (htmlPost.length > html3.length || htmlPost.includes('Download') || htmlPost.includes('Attachment')) {
            html3 = htmlPost;
            log.push('✅ POST devolvió contenido más completo');
          }
        }
      } catch (e: any) {
        log.push(`⚠️ POST WebForms falló: ${e.message}`);
      }
    }

    // ── PASO 3c: Extraer documentos con estrategias múltiples ─────────────
    let docsEncontrados = extraerDocumentosDe(html3, lcUrl, log);

    // ── PASO 3d: Fallback → re-intentar con ViewAttachment.aspx directo ───
    if (docsEncontrados.length === 0 && html2) {
      log.push('🔄 Fallback: extrayendo de ViewAttachment.aspx directamente...');
      docsEncontrados = extraerDocumentosDe(html2, adjuntoUrl, log);
    }

    // ── PASO 3e: Último recurso — parse de scripts (JSON en <script>) ──────
    if (docsEncontrados.length === 0) {
      log.push('🔄 Buscando JSON en <script>...');
      const scriptMatches = html3.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
      for (const script of scriptMatches) {
        const jsonMatch = script.match(/\[\s*\{[^<]{50,}\}\s*\]/);
        if (jsonMatch) {
          try {
            const arr = JSON.parse(jsonMatch[0]);
            for (const item of arr) {
              const url = item.url || item.Url || item.downloadUrl || item.DownloadUrl || '';
              const nombre = item.nombre || item.Nombre || item.name || item.Name || `Documento_${docsEncontrados.length + 1}`;
              if (url) docsEncontrados.push({ nombre, downloadUrl: resolveUrl(url) });
            }
            if (docsEncontrados.length > 0) { log.push(`✅ JSON en script: ${docsEncontrados.length} docs`); break; }
          } catch {}
        }
      }
    }

    log.push(`📄 Total documentos encontrados: ${docsEncontrados.length}`);

    if (docsEncontrados.length === 0) {
      // HTML preview para diagnóstico (primeros 2000 chars sin whitespace excesivo)
      const preview = html3.replace(/\s+/g, ' ').substring(0, 2000);
      log.push(`🔎 HTML preview: ${preview}`);
      return NextResponse.json({
        success: false,
        error: 'No se encontraron documentos. Revisa los logs para diagnóstico.',
        adjunto_url_mp: adjuntoUrl, // URL directa de MP para abrir manualmente
        log,
      });
    }

    // ── PASO 4: Descargar cada doc y subir a R2 ────────────────────────────
    const resultados: any[] = [];
    let descargados = 0;

    for (const doc of docsEncontrados) {
      if (!doc.downloadUrl) {
        log.push(`⚠️ Sin URL de descarga para: ${doc.nombre}`);
        resultados.push({ nombre: doc.nombre, status: 'sin_url' });
        continue;
      }

      try {
        log.push(`⬇️ Descargando: ${doc.nombre}`);

        const resDoc = await fetch(doc.downloadUrl, {
          headers: {
            ...buildHeaders(jar, lcUrl),
            Accept: 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.*,application/octet-stream,*/*',
          },
          redirect: 'follow',
        });
        jar = mergeCookies(jar, resDoc);

        if (!resDoc.ok) {
          log.push(`❌ HTTP ${resDoc.status} para ${doc.nombre}`);
          resultados.push({ nombre: doc.nombre, status: `error_http_${resDoc.status}` });
          continue;
        }

        const contentType = resDoc.headers.get('content-type') || 'application/octet-stream';

        if (contentType.includes('text/html')) {
          const snippet = (await resDoc.text()).substring(0, 300).replace(/\s+/g, ' ');
          log.push(`⚠️ HTML en descarga (bloqueado): ${snippet}`);
          resultados.push({ nombre: doc.nombre, status: 'bloqueado_html' });
          continue;
        }

        const buffer = Buffer.from(await resDoc.arrayBuffer());

        // Nombre real desde Content-Disposition
        let nombreFinal = doc.nombre;
        const cd = resDoc.headers.get('content-disposition');
        if (cd) {
          const mcd = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
          if (mcd?.[1]) nombreFinal = mcd[1].replace(/['"]/g, '').trim();
        }
        // Asegurar extensión si no la tiene
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
        log.push(`✅ Guardado: ${nombreFinal} (${(buffer.length / 1024).toFixed(0)} KB)`);
        resultados.push({ nombre: nombreFinal, status: 'ok', url: publicUrl, size: buffer.length });

      } catch (e: any) {
        log.push(`❌ Error descargando ${doc.nombre}: ${e.message}`);
        resultados.push({ nombre: doc.nombre, status: 'error', error: e.message });
      }
    }

    return NextResponse.json({
      success: descargados > 0,
      total: docsEncontrados.length,
      descargados,
      documentos: resultados,
      adjunto_url_mp: adjuntoUrl,
      log,
    });

  } catch (error: any) {
    log.push(`💥 Error crítico: ${error.message}`);
    return NextResponse.json({ success: false, error: error.message, log }, { status: 500 });
  }
}
