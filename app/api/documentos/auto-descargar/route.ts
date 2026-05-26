// app/api/documentos/auto-descargar/route.ts
// Pipeline completo: ficha MP → ViewAttachment → ViewAttachmentLC → descarga → R2
import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { guardarDocumentoEnCache } from '@/app/services/documentosService.server';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

// ─── Utilidades ────────────────────────────────────────────────────────────

function resolveUrl(raw: string): string {
  if (!raw || raw.startsWith('javascript')) return '';
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

// Extrae cookies de una respuesta y las concatena al jar actual
function mergeCookies(jar: string, response: Response): string {
  // Intentar getSetCookie() si está disponible (Node 18+)
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
  const existing = Object.fromEntries(jar.split('; ').filter(Boolean).map(c => c.split('=')));
  parsed.forEach(c => {
    const [k, v] = c.split('=');
    if (k) existing[k.trim()] = v ?? '';
  });
  return Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('; ');
}

function headers(jar: string, referer?: string) {
  return {
    ...BASE_HEADERS,
    ...(jar ? { Cookie: jar } : {}),
    ...(referer ? { Referer: referer } : {}),
  };
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
    // ── PASO 1: Ficha principal → encontrar link de adjuntos ─────────────
    const fichaUrl = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(licitacionCodigo)}`;
    log.push(`🔍 Paso 1 — Ficha: ${fichaUrl}`);

    const res1 = await fetch(fichaUrl, { headers: headers(jar) });
    jar = mergeCookies(jar, res1);

    if (!res1.ok) throw new Error(`Ficha HTTP ${res1.status}`);
    const html1 = await res1.text();

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
    log.push(`🔗 Adjuntos: ${adjuntoUrl.slice(0, 80)}...`);

    // ── PASO 2: ViewAttachment → extraer ViewAttachmentLC del JS ──────────
    let lcUrl = adjuntoUrl;

    if (!adjuntoUrl.includes('ViewAttachmentLC')) {
      log.push('🔄 Paso 2 — Extrayendo ViewAttachmentLC del JS...');
      const res2 = await fetch(adjuntoUrl, { headers: headers(jar, fichaUrl) });
      jar = mergeCookies(jar, res2);

      if (res2.ok) {
        const html2 = await res2.text();
        const m = html2.match(/window\.location\.href\s*=\s*['"]([^'"]*ViewAttachmentLC\.aspx[^'"]+)['"]/);
        if (m) {
          lcUrl = resolveUrl(m[1]);
          log.push(`✅ ViewAttachmentLC extraído del JS`);
        } else {
          // Intentar buscar en href o src
          const $2 = cheerio.load(html2);
          $2('[href*="ViewAttachmentLC"], [src*="ViewAttachmentLC"]').each((_, el) => {
            if (lcUrl !== adjuntoUrl) return;
            const href = $2(el).attr('href') || $2(el).attr('src') || '';
            if (href.includes('ViewAttachmentLC')) lcUrl = resolveUrl(href);
          });
        }
      }
    }

    log.push(`📋 Paso 3 — ViewAttachmentLC: ${lcUrl.slice(0, 80)}...`);

    // ── PASO 3: Scrape ViewAttachmentLC → obtener docs y URLs de descarga ──
    const res3 = await fetch(lcUrl, { headers: headers(jar, adjuntoUrl) });
    jar = mergeCookies(jar, res3);

    if (!res3.ok) throw new Error(`ViewAttachmentLC HTTP ${res3.status}`);
    const html3 = await res3.text();

    if (html3.includes('reCAPTCHA') || html3.includes('recaptcha')) {
      log.push('⚠️ reCAPTCHA detectado en ViewAttachmentLC');
    }

    const $3 = cheerio.load(html3);
    const docsEncontrados: { nombre: string; downloadUrl: string; size?: number }[] = [];

    $3('table tr').each((_, row) => {
      const cells = $3(row).find('td');
      // Umbral flexible: al menos 2 columnas (era 5, demasiado estricto)
      if (cells.length < 2) return;

      // Buscar nombre del documento: priorizar celdas con extensión de archivo conocida
      let nombre = '';
      let sizeStr = '';

      cells.each((_, cell) => {
        const text = $3(cell).text().trim();
        if (/\.(pdf|doc|docx|xlsx|xls|zip|rar|txt|jpg|png|ppt|pptx|xml|csv|odt)/i.test(text)) {
          if (!nombre) nombre = text;
        }
        if (/^\d[\d.,]*\s*(KB|MB|B)\b/i.test(text)) {
          sizeStr = text;
        }
      });

      // Fallback: celda con texto más largo (>= 3 chars, no solo números)
      if (!nombre) {
        let maxLen = 0;
        cells.each((_, cell) => {
          const text = $3(cell).text().trim();
          if (text.length > maxLen && text.length >= 3 && !/^\d+$/.test(text)) {
            maxLen = text.length;
            nombre = text;
          }
        });
      }

      if (!nombre || nombre.length < 3) return;

      let downloadUrl = '';

      // Buscar link de descarga en toda la fila
      $3(row).find('a').each((_, a) => {
        if (downloadUrl) return;
        const href = $3(a).attr('href') || '';
        if (href && (href.includes('Download') || href.includes('download') || href.includes('Attachment'))) {
          downloadUrl = resolveUrl(href);
        }
      });

      // Buscar en onclick de la fila
      if (!downloadUrl) {
        $3(row).find('[onclick]').each((_, el) => {
          if (downloadUrl) return;
          const onclick = $3(el).attr('onclick') || '';
          const m = onclick.match(/['"]([^'"]*(?:[Dd]ownload|[Aa]ttachment)[^'"]*)['"]/);
          if (m?.[1]) downloadUrl = resolveUrl(m[1]);
        });
      }

      docsEncontrados.push({ nombre, downloadUrl, size: parseSizeStr(sizeStr) });
    });

    log.push(`📄 ${docsEncontrados.length} documentos encontrados en la tabla`);

    // ── Fallback global: escanear TODOS los <a> con links de descarga ────────
    if (docsEncontrados.length === 0) {
      log.push('🔄 Fallback: buscando links de descarga directos en la página...');

      $3('a').each((_, a) => {
        const href = $3(a).attr('href') || '';
        if (!href || href.startsWith('javascript')) return;
        if (href.includes('Download') || href.includes('DownloadAttachment') || href.includes('GetAttachment')) {
          const text = ($3(a).text().trim()) || `Documento_${docsEncontrados.length + 1}`;
          docsEncontrados.push({ nombre: text, downloadUrl: resolveUrl(href) });
        }
      });

      // También en atributos onclick
      $3('[onclick]').each((_, el) => {
        const onclick = $3(el).attr('onclick') || '';
        const m = onclick.match(/['"]([^'"]*(?:[Dd]ownload|[Gg]et[Aa]ttachment)[^'"]*)['"]/);
        if (m?.[1]) {
          const url = resolveUrl(m[1]);
          if (!docsEncontrados.some(d => d.downloadUrl === url)) {
            const text = ($3(el).text().trim()) || `Documento_${docsEncontrados.length + 1}`;
            docsEncontrados.push({ nombre: text, downloadUrl: url });
          }
        }
      });

      log.push(`📄 Fallback encontró: ${docsEncontrados.length} links de descarga`);
    }

    if (docsEncontrados.length === 0) {
      // Devolver preview del HTML para diagnóstico
      return NextResponse.json({
        success: false,
        error: 'No se encontraron documentos (posible bloqueo o cambio de estructura)',
        log,
        html_preview: html3.substring(0, 3000),
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
            ...headers(jar, lcUrl),
            Accept: 'application/pdf,application/octet-stream,application/vnd.openxmlformats-officedocument.*,*/*',
          },
        });
        jar = mergeCookies(jar, resDoc);

        if (!resDoc.ok) {
          log.push(`❌ Error HTTP ${resDoc.status} para ${doc.nombre}`);
          resultados.push({ nombre: doc.nombre, status: `error_http_${resDoc.status}` });
          continue;
        }

        const contentType = resDoc.headers.get('content-type') || 'application/octet-stream';

        // Si responde HTML → bloqueado o redirección a login
        if (contentType.includes('text/html')) {
          log.push(`⚠️ Respuesta HTML (posible bloqueo) para: ${doc.nombre}`);
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
      log,
    });

  } catch (error: any) {
    log.push(`💥 Error crítico: ${error.message}`);
    return NextResponse.json({ success: false, error: error.message, log }, { status: 500 });
  }
}
