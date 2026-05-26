// app/api/documentos/auto-descargar/route.ts
// Pipeline: ViewAttachment → ViewAttachmentLC → form POST download → R2
//
// ESTRUCTURA DE ViewAttachmentLC.aspx:
//
//   <table id="DWNL_grdId">
//     <tr> ... header ... </tr>
//     <tr class="cssFwkItemStyle">                          ← fila de documento
//       <td><input type="checkbox" name="DWNL$grdId$ctl02$chk"></td>
//       <td><span id="DWNL_grdId_ctl02_File">BASES.pdf</span></td>
//       <td><span id="DWNL_grdId_ctl02_Type">Tipo</span></td>
//       <td><span id="DWNL_grdId_ctl02_Description">Descripción</span></td>
//       <td><span id="DWNL_grdId_ctl02_FileLength">3675 KB</span></td>
//       <td><span id="DWNL_grdId_ctl02_AtcDateTime">18-05-2026...</span></td>
//       <td><input type="image" name="DWNL$grdId$ctl02$search"></td>  ← "Ver Anexo"
//     </tr>
//     <tr class="cssFwkAlternatingItemStyle">...</tr>
//     ...
//   </table>
//
// NO HAY <a href> de descarga. La descarga es un form POST:
//   POST ViewAttachmentLC.aspx?enc=...
//   Body: __VIEWSTATE=...&DWNL$grdId$ctl02$search.x=1&DWNL$grdId$ctl02$search.y=1
//
// Sin CAPTCHA para "Ver Anexo" individual (solo para "Descargar seleccionados").
//
// ANTI-WAF:
//   ScrapingAnt browser=true → Chromium + IP residencial → bypass WAF para GET
//   Luego form POST directo desde Vercel para descarga de archivos

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

// ─── Proxies anti-WAF de Mercado Público ─────────────────────────────────
//
// El WAF de MP bloquea IPs que no son chilenas (o de AS conocidos).
// Para bypassearlo necesitamos IPs residenciales chilenas.
//
// Variables de entorno (configura al menos una en Vercel):
//
//   SCRAPINGANT_API_KEY  → scrapingant.com  (ya configurado)
//                          Requiere browser=true + proxy_country=CL
//                          Free tier: 10 000 créditos/mes (10 créditos/req con browser)
//
//   ZENROWS_API_KEY      → zenrows.com       (registrarse gratis)
//                          Premium proxy con geo-targeting
//                          Free tier: 1 000 req/mes
//
// Se intenta en orden: ScrapingAnt → ZenRows → fetch directo (bloqueado)

function isBlocked(html: string): boolean {
  return html.includes('robot.png') || html.includes('Acceso denegado');
}

async function intentarScrapingAnt(url: string, log: string[]): Promise<string | null> {
  const apiKey = process.env.SCRAPINGANT_API_KEY;
  if (!apiKey) return null;

  // proxy_country=CL → IP residencial CHILENA → bypass geo-bloqueo de MP
  const proxyUrl =
    `https://api.scrapingant.com/v2/general` +
    `?x-api-key=${encodeURIComponent(apiKey)}` +
    `&url=${encodeURIComponent(url)}` +
    `&browser=true` +
    `&proxy_country=CL`;                    // ← CLAVE: IP chilena

  log.push(`🕷️ ScrapingAnt (CL) → ${url.slice(0, 80)}`);
  try {
    const res = await fetch(proxyUrl, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(55_000),
    });
    const html = await res.text();
    if (!res.ok) {
      log.push(`⚠️ ScrapingAnt HTTP ${res.status}: ${html.slice(0, 200)}`);
      return null;
    }
    const blocked = isBlocked(html);
    log.push(`🕷️ ScrapingAnt → HTTP ${res.status} len=${html.length} robot=${blocked}`);
    return blocked ? null : html;
  } catch (e: any) {
    log.push(`⚠️ ScrapingAnt excepción: ${e.message}`);
    return null;
  }
}

async function intentarZenRows(url: string, log: string[]): Promise<string | null> {
  const apiKey = process.env.ZENROWS_API_KEY;
  if (!apiKey) return null;

  // premium_proxy=true + proxy_country=CL → IP residencial chilena
  // js_render=true → renderiza JavaScript (igual que browser real)
  const proxyUrl =
    `https://api.zenrows.com/v1/` +
    `?apikey=${encodeURIComponent(apiKey)}` +
    `&url=${encodeURIComponent(url)}` +
    `&premium_proxy=true` +
    `&proxy_country=CL` +
    `&js_render=true`;

  log.push(`🌿 ZenRows (CL) → ${url.slice(0, 80)}`);
  try {
    const res = await fetch(proxyUrl, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(55_000),
    });
    const html = await res.text();
    if (!res.ok) {
      log.push(`⚠️ ZenRows HTTP ${res.status}: ${html.slice(0, 200)}`);
      return null;
    }
    const blocked = isBlocked(html);
    log.push(`🌿 ZenRows → HTTP ${res.status} len=${html.length} robot=${blocked}`);
    return blocked ? null : html;
  } catch (e: any) {
    log.push(`⚠️ ZenRows excepción: ${e.message}`);
    return null;
  }
}

async function fetchConProxy(
  url: string,
  log: string[],
): Promise<{ html: string; ok: boolean; status: number }> {
  // 1. ScrapingAnt con proxy_country=CL
  const htmlSA = await intentarScrapingAnt(url, log);
  if (htmlSA) return { html: htmlSA, ok: true, status: 200 };

  // 2. ZenRows con proxy_country=CL
  const htmlZR = await intentarZenRows(url, log);
  if (htmlZR) return { html: htmlZR, ok: true, status: 200 };

  // 3. Directo (siempre bloqueado desde Vercel — solo para diagnóstico)
  if (!process.env.SCRAPINGANT_API_KEY && !process.env.ZENROWS_API_KEY) {
    log.push(`⚠️ Sin proxies configurados — fetch directo (será bloqueado por WAF de MP)`);
  } else {
    log.push(`🌐 Ambos proxies bloqueados — fetch directo como diagnóstico`);
  }
  const res = await fetch(url, { headers: buildHeaders(''), redirect: 'follow' });
  const html = await res.text();
  return { html, ok: res.ok, status: res.status };
}

// ─── Utilidades ────────────────────────────────────────────────────────────

function resolveUrl(raw: string, base = ''): string {
  if (!raw || raw.startsWith('javascript') || raw === '#') return '';
  if (raw.startsWith('http')) return raw;
  if (raw.startsWith('./') && base) {
    const baseDir = base.split('/').slice(0, -1).join('/');
    return `${baseDir}/${raw.slice(2)}`;
  }
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

function htmlDiag(html: string): string {
  const $ = cheerio.load(html);
  const hasCapt = html.includes('recaptcha') || html.includes('reCAPTCHA');
  const hasRobot = html.includes('robot.png') || html.includes('Acceso denegado');
  const hasDwnl = html.includes('DWNL_grdId') || html.includes('DWNL$grdId');
  return `tables=${$('table').length} tr=${$('tr').length} dwnl=${hasDwnl} len=${html.length} robot=${hasRobot} captcha=${hasCapt}`;
}

// ─── Tipo DocEntry ─────────────────────────────────────────────────────────

// ctlId: e.g. 'ctl02' — para el form POST de descarga de ViewAttachmentLC
type DocEntry = { nombre: string; size?: number; ctlId?: string };

// ─── Extractor específico para ViewAttachmentLC ────────────────────────────
//
// Extrae documentos usando los span IDs: DWNL_grdId_ctl02_File, etc.
// NO busca <a href> porque no existen — la descarga es por form POST.

function extraerDocsDeViewAttachmentLC(html: string, log: string[]): DocEntry[] {
  const $ = cheerio.load(html);
  const docs: DocEntry[] = [];
  const seen = new Set<string>();

  // Buscar todos los spans con id que termine en _File (patrón de ViewAttachmentLC)
  $('span[id]').each((_, span) => {
    const id = $(span).attr('id') || '';
    // Patrón: cualquier_prefijo_ctl02_File, ctl03_File, etc.
    const match = id.match(/(ctl\d{2,})_File$/i);
    if (!match) return;

    const ctlId = match[1]; // e.g., 'ctl02'
    const nombre = $(span).text().trim();
    if (!nombre || nombre.length < 2) return;

    // Extraer tamaño del span _FileLength
    const sizeSpanId = id.replace(/_File$/, '_FileLength');
    const sizeText = $(`#${CSS.escape(sizeSpanId)}`).text().trim()
      || $(`[id$="${ctlId}_FileLength"]`).first().text().trim();
    const size = parseSizeStr(sizeText);

    if (!seen.has(nombre)) {
      seen.add(nombre);
      docs.push({ nombre, size, ctlId });
      log.push(`  📎 ${ctlId}: ${nombre}${size ? ` (${(size / 1024).toFixed(0)} KB)` : ''}`);
    }
  });

  return docs;
}

// ─── Descarga vía form POST ────────────────────────────────────────────────
//
// ViewAttachmentLC descarga archivos al hacer POST al mismo URL con:
//   DWNL$grdId$ctl0N$search.x=1
//   DWNL$grdId$ctl0N$search.y=1
// Sin CAPTCHA (el CAPTCHA es solo para "Descargar seleccionados").

async function descargarViaFormPost(
  lcUrl: string,
  ctlId: string,
  viewState: string,
  evValidation: string,
  vsGenerator: string,
  jar: string,
  log: string[],
): Promise<{ buffer: Buffer; contentType: string; filename?: string } | null> {
  const body = new URLSearchParams({
    __EVENTTARGET: '',
    __EVENTARGUMENT: '',
    __VIEWSTATE: viewState,
    __EVENTVALIDATION: evValidation,
    __VIEWSTATEGENERATOR: vsGenerator,
    [`DWNL$grdId$${ctlId}$search.x`]: '1',
    [`DWNL$grdId$${ctlId}$search.y`]: '1',
  });

  try {
    const res = await fetch(lcUrl, {
      method: 'POST',
      headers: {
        ...buildHeaders(jar, lcUrl),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.*,application/octet-stream,*/*',
      },
      body: body.toString(),
      redirect: 'follow',
    });

    if (!res.ok) {
      log.push(`  ❌ POST ${ctlId}: HTTP ${res.status}`);
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      log.push(`  🚫 POST ${ctlId}: bloqueado (respuesta HTML)`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 100) {
      log.push(`  ⚠️ POST ${ctlId}: respuesta muy pequeña (${buffer.length} bytes)`);
      return null;
    }

    // Extraer filename del Content-Disposition si existe
    let filename: string | undefined;
    const cd = res.headers.get('content-disposition') || '';
    const mcd = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (mcd?.[1]) filename = mcd[1].replace(/['"]/g, '').trim();

    log.push(`  ✅ POST ${ctlId}: ${buffer.length} bytes (${contentType})`);
    return { buffer, contentType, filename };
  } catch (e: any) {
    log.push(`  ❌ POST ${ctlId}: ${e.message}`);
    return null;
  }
}

// ─── Pipeline principal ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const { licitacionCodigo } = await request.json();

  if (!licitacionCodigo) {
    return NextResponse.json({ error: 'licitacionCodigo requerido' }, { status: 400 });
  }

  const proxyConfigurado = !!process.env.SCRAPINGANT_API_KEY;
  let jar = '';
  const log: string[] = [];

  log.push(`🔧 ScrapingAnt: ${proxyConfigurado ? '✅ configurado (browser=true)' : '⚠️ sin clave — WAF bloqueará el acceso'}`);

  const fichaUrl = `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(licitacionCodigo)}`;
  let adjuntoUrl = '';
  let lcUrl = '';

  try {
    // ── PASO 1: Warm-up de sesión ──────────────────────────────────────────
    try {
      const resHome = await fetch('https://www.mercadopublico.cl/', {
        headers: buildHeaders(jar), redirect: 'follow',
      });
      jar = mergeCookies(jar, resHome);
      log.push(`🏠 Sesión: ${jar.split('; ').filter(Boolean).length} cookies`);
    } catch {
      log.push('⚠️ Warm-up falló — continuando sin sesión');
    }

    // ── PASO 2: DetailsAcquisition → link de adjuntos ──────────────────────
    log.push(`🔍 Ficha: ${fichaUrl}`);
    const res1 = await fetch(fichaUrl, {
      headers: buildHeaders(jar, 'https://www.mercadopublico.cl/'),
      redirect: 'follow',
    });
    jar = mergeCookies(jar, res1);
    if (!res1.ok) throw new Error(`Ficha HTTP ${res1.status}`);
    const html1 = await res1.text();
    log.push(`📄 Ficha: ${html1.length} bytes`);

    if (html1.includes('actividad anormal') || html1.includes('unusual activity')) {
      throw new Error('Ficha bloqueada por WAF de Mercado Público');
    }

    const $1 = cheerio.load(html1);

    // Buscar link de adjuntos (ViewAttachmentLC o ViewAttachment)
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
        adjunto_url_mp: fichaUrl,
        ficha_url_mp: fichaUrl,
        proxy_configurado: proxyConfigurado,
        log,
      });
    }
    log.push(`🔗 Link adjuntos: ${adjuntoUrl.slice(0, 100)}`);

    // ── PASO 3: ViewAttachment.aspx → extraer URL de ViewAttachmentLC ────────
    lcUrl = adjuntoUrl;

    if (!adjuntoUrl.toLowerCase().includes('viewattachmentlc')) {
      log.push('🔄 Paso 3 — Cargando ViewAttachment (redirect JS)...');
      const res2 = await fetch(adjuntoUrl, {
        headers: buildHeaders(jar, fichaUrl), redirect: 'follow',
      });
      jar = mergeCookies(jar, res2);
      if (res2.ok) {
        const html2 = await res2.text();
        log.push(`📄 ViewAttachment: ${html2.length} bytes`);
        const mLC = html2.match(/window\.location(?:\.href)?\s*=\s*['"]([^'"]*ViewAttachmentLC\.aspx[^'"]+)['"]/i);
        if (mLC) {
          lcUrl = resolveUrl(mLC[1]);
          log.push(`✅ ViewAttachmentLC: ${lcUrl.slice(0, 100)}`);
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

    // ── PASO 4: GET ViewAttachmentLC vía ScrapingAnt ──────────────────────
    const { html: htmlLC, ok: lcOk, status: lcStatus } = await fetchConProxy(lcUrl, log);
    log.push(`📊 ViewAttachmentLC: ${htmlDiag(htmlLC)} (HTTP ${lcStatus})`);

    if (!lcOk || htmlLC.includes('robot.png') || htmlLC.includes('Acceso denegado')) {
      const bloqueado = htmlLC.includes('robot.png') || htmlLC.includes('Acceso denegado');
      log.push(bloqueado
        ? '🤖 ViewAttachmentLC bloqueado por WAF — incluso con ScrapingAnt'
        : `❌ ViewAttachmentLC HTTP ${lcStatus}`);
      if (!proxyConfigurado) {
        log.push('💡 Configura SCRAPINGANT_API_KEY en Vercel → Settings → Environment Variables');
      }
      return NextResponse.json({
        success: false,
        error: 'Mercado Público bloquea el acceso automático desde servidores externos.',
        adjunto_url_mp: lcUrl,
        ficha_url_mp: fichaUrl,
        proxy_configurado: proxyConfigurado,
        log,
      });
    }

    // ── PASO 4b: Extraer VIEWSTATE para form POST ──────────────────────────
    const $lc = cheerio.load(htmlLC);
    const viewState    = ($lc('input[name="__VIEWSTATE"]').val()          as string) || '';
    const evValidation = ($lc('input[name="__EVENTVALIDATION"]').val()    as string) || '';
    const vsGenerator  = ($lc('input[name="__VIEWSTATEGENERATOR"]').val() as string) || '';

    log.push(`🔑 VIEWSTATE: ${viewState ? `${viewState.length} chars` : '❌ no encontrado'}`);

    // ── PASO 4c: Extraer documentos con el extractor de ViewAttachmentLC ──
    log.push('🔍 Extrayendo documentos...');
    const docs = extraerDocsDeViewAttachmentLC(htmlLC, log);
    log.push(`📄 ${docs.length} documentos encontrados en ViewAttachmentLC`);

    if (docs.length === 0) {
      // Diagnóstico adicional
      log.push(`🔎 Preview HTML: ${htmlLC.replace(/\s+/g, ' ').substring(0, 400)}`);
      return NextResponse.json({
        success: false,
        error: 'Se obtuvo el HTML de ViewAttachmentLC pero no se encontraron documentos. Revisa los logs.',
        adjunto_url_mp: lcUrl,
        ficha_url_mp: fichaUrl,
        proxy_configurado: proxyConfigurado,
        log,
      });
    }

    // ── PASO 5: Descargar cada doc vía form POST y subir a R2 ──────────────
    log.push(`─── PASO 5: Descargando ${docs.length} documentos vía form POST ───`);
    const resultados: any[] = [];
    let descargados = 0;
    let bloqueados = 0;

    for (const doc of docs) {
      if (!doc.ctlId) {
        resultados.push({ nombre: doc.nombre, status: 'sin_ctl_id' });
        continue;
      }

      log.push(`⬇️ Descargando: ${doc.nombre} (${doc.ctlId})`);
      const fileData = await descargarViaFormPost(
        lcUrl, doc.ctlId, viewState, evValidation, vsGenerator, jar, log,
      );

      if (!fileData) {
        bloqueados++;
        resultados.push({ nombre: doc.nombre, status: 'descarga_bloqueada', downloadUrl: lcUrl });
        continue;
      }

      let nombreFinal = fileData.filename || doc.nombre;
      if (!/\.\w{2,5}$/.test(nombreFinal)) {
        const ext = fileData.contentType.includes('pdf') ? '.pdf'
          : fileData.contentType.includes('word') ? '.docx'
          : fileData.contentType.includes('excel') ? '.xlsx'
          : fileData.contentType.includes('zip') ? '.zip' : '';
        if (ext) nombreFinal += ext;
      }

      try {
        const publicUrl = await subirDocumentoR2(licitacionCodigo, nombreFinal, fileData.buffer, fileData.contentType);
        await guardarDocumentoEnCache(licitacionCodigo, nombreFinal, publicUrl, fileData.buffer.length);

        descargados++;
        log.push(`✅ Guardado: ${nombreFinal} (${(fileData.buffer.length / 1024).toFixed(0)} KB)`);
        resultados.push({ nombre: nombreFinal, status: 'ok', url: publicUrl, size: fileData.buffer.length });
      } catch (e: any) {
        log.push(`❌ Error guardando ${nombreFinal}: ${e.message}`);
        resultados.push({ nombre: doc.nombre, status: 'error_storage', error: e.message });
      }
    }

    // Si todos los form POSTs fueron bloqueados, informar pero mostrar lista de docs
    if (descargados === 0 && bloqueados > 0) {
      log.push(`🚫 Descarga bloqueada desde Vercel para los ${bloqueados} documentos (WAF también bloquea POST)`);
      log.push(`💡 Los documentos están disponibles en: ${lcUrl}`);
      return NextResponse.json({
        success: false,
        total: docs.length,
        descargados: 0,
        documentos: resultados,
        // Lista de nombres para mostrar en UI
        lista_documentos: docs.map(d => ({ nombre: d.nombre, size: d.size })),
        adjunto_url_mp: lcUrl,   // URL directa a ViewAttachmentLC (abre en browser del usuario)
        ficha_url_mp: fichaUrl,
        proxy_configurado: proxyConfigurado,
        error: `ViewAttachmentLC accesible ✅, pero la descarga de archivos también está bloqueada desde el servidor. Abre el portal de MP y descarga manualmente.`,
        log,
      });
    }

    return NextResponse.json({
      success: descargados > 0,
      total: docs.length,
      descargados,
      bloqueados,
      documentos: resultados,
      adjunto_url_mp: lcUrl,
      ficha_url_mp: fichaUrl,
      proxy_configurado: proxyConfigurado,
      log,
    });

  } catch (error: any) {
    log.push(`💥 Error crítico: ${error.message}`);
    return NextResponse.json({
      success: false,
      error: error.message,
      adjunto_url_mp: adjuntoUrl || fichaUrl,
      ficha_url_mp: fichaUrl,
      proxy_configurado: proxyConfigurado,
      log,
    }, { status: 500 });
  }
}
