// app/lib/auditor-compras-captura.ts
// S1 DEL PROMPT 5 — "Visitar URL": el sistema (no el modelo) abre cada link EN EL MOMENTO de auditar y
// guarda una CAPTURA FECHADA (texto extraído + imagen) como evidencia inmutable. Un link no es
// respaldo hasta que se ve; una captura no se edita: cada auditoría agrega las suyas.
//
// Cómo lee la página: primero con un navegador real (puppeteer, mismo Chromium que el resto del
// sistema) porque las tiendas chilenas pintan el precio con JavaScript; si no hay navegador, cae a
// un fetch simple + cheerio. Del HTML saca además el JSON-LD de "Product" (precio, moneda, stock, SKU),
// que es donde las tiendas serias declaran los datos de forma estructurada.
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';

export type EstadoLink = 'activo' | 'caido' | 'redirige' | 'login' | 'precio_variable_region';

export interface Captura {
  url: string; urlFinal: string | null; estado: EstadoLink; httpStatus: number | null; titulo: string;
  texto: string; imagen: Buffer | null; capturadoAt: string; metodo: 'navegador' | 'fetch'; error?: string;
}
export interface CapturaGuardada extends Captura { id: number }

const MAX_TEXTO = 14_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export function normalizarUrl(u: string): string {
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** Datos estructurados de producto que declara la página (JSON-LD schema.org/Product). */
export function resumirJsonLd(bloques: string[]): string {
  const lineas: string[] = [];
  const visitar = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(visitar); return; }
    if (n['@graph']) visitar(n['@graph']);
    const tipo = ([] as string[]).concat(n['@type'] || []).join(',');
    if (/Product/i.test(tipo)) {
      const ofertas = ([] as any[]).concat(n.offers?.offers || n.offers || []);
      const brand = typeof n.brand === 'object' ? n.brand?.name : n.brand;
      lineas.push(`JSON-LD Producto: nombre="${n.name ?? ''}" marca="${brand ?? ''}" sku="${n.sku ?? n.mpn ?? ''}"`);
      for (const o of ofertas.slice(0, 4)) {
        lineas.push(`JSON-LD Oferta: precio=${o?.price ?? o?.lowPrice ?? ''} moneda=${o?.priceCurrency ?? ''} disponibilidad=${String(o?.availability ?? '').split('/').pop()} vendedor="${typeof o?.seller === 'object' ? o.seller?.name : o?.seller ?? ''}"`);
      }
    }
  };
  for (const b of bloques) { try { visitar(JSON.parse(b)); } catch { /* JSON-LD mal formado: se ignora */ } }
  return lineas.join('\n');
}

function detectarEstado(urlOriginal: string, urlFinal: string, http: number | null, texto: string): EstadoLink {
  if (http != null && (http >= 400)) return 'caido';
  const rutaO = (() => { try { return new URL(urlOriginal).pathname.replace(/\/+$/, ''); } catch { return ''; } })();
  const rutaF = (() => { try { return new URL(urlFinal).pathname.replace(/\/+$/, ''); } catch { return ''; } })();
  const t = texto.toLowerCase();
  if (texto.length < 800 && /(inicia(r)? sesi[oó]n|iniciar sesión|log ?in|ingresa a tu cuenta)/.test(t)) return 'login';
  // Un link a un producto que termina en la portada, en un buscador o en una categoría = "redirige a otro producto".
  if (rutaO.length > 6 && (rutaF === '' || /\/(search|buscar|busqueda|catalogsearch)/i.test(urlFinal) || (rutaF.length + 6 < rutaO.length && !rutaF.includes(rutaO.split('/').filter(Boolean).pop() || '@@'))))
    return 'redirige';
  if (/(producto no disponible|p[aá]gina no encontrada|no hemos encontrado|error 404|404 not found|ya no est[aá] disponible)/.test(t) && texto.length < 4000) return 'caido';
  return 'activo';
}

async function capturarConNavegador(browser: any, url: string): Promise<Captura> {
  const capturadoAt = ahoraChileSQL();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CL,es;q=0.9' });
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 }).catch(async () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 }));
    await new Promise(r => setTimeout(r, 1200));
    const http = resp ? resp.status() : null;
    const urlFinal = page.url();
    const datos = await page.evaluate(() => ({
      titulo: document.title || '',
      texto: (document.body?.innerText || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'),
      jsonld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent || ''),
      metaPrecio: [...document.querySelectorAll('meta[property="product:price:amount"],meta[property="og:price:amount"],meta[itemprop="price"]')].map(m => (m as HTMLMetaElement).content || m.getAttribute('content') || ''),
    }));
    let imagen: Buffer | null = null;
    try { imagen = Buffer.from(await page.screenshot({ type: 'jpeg', quality: 55, clip: { x: 0, y: 0, width: 1280, height: 1100 } })); } catch { /* sin imagen: queda el texto */ }
    const ld = resumirJsonLd(datos.jsonld);
    const texto = [`TITULO: ${datos.titulo}`, `URL FINAL: ${urlFinal}`, ld, datos.metaPrecio.filter(Boolean).length ? `META precio: ${datos.metaPrecio.filter(Boolean).join(' | ')}` : '', datos.texto].filter(Boolean).join('\n').slice(0, MAX_TEXTO);
    return { url, urlFinal, estado: detectarEstado(url, urlFinal, http, datos.texto), httpStatus: http, titulo: datos.titulo.slice(0, 400), texto, imagen, capturadoAt, metodo: 'navegador' };
  } finally { await page.close().catch(() => {}); }
}

async function capturarConFetch(url: string): Promise<Captura> {
  const capturadoAt = ahoraChileSQL();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-CL,es;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    const html = await res.text();
    const $ = cheerio.load(html);
    const jsonld = $('script[type="application/ld+json"]').map((_, e) => $(e).text()).get();
    const titulo = $('title').first().text().trim();
    $('script,style,noscript,svg').remove();
    const cuerpo = $('body').text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    const ld = resumirJsonLd(jsonld);
    const texto = [`TITULO: ${titulo}`, `URL FINAL: ${res.url}`, ld, cuerpo].filter(Boolean).join('\n').slice(0, MAX_TEXTO);
    return { url, urlFinal: res.url, estado: detectarEstado(url, res.url, res.status, cuerpo), httpStatus: res.status, titulo: titulo.slice(0, 400), texto, imagen: null, capturadoAt, metodo: 'fetch' };
  } catch (e) {
    return { url, urlFinal: null, estado: 'caido', httpStatus: null, titulo: '', texto: '', imagen: null, capturadoAt, metodo: 'fetch', error: String((e as Error).message || e).slice(0, 200) };
  }
}

/** Visita todos los links (con un solo navegador) y guarda cada captura. Nunca lanza: un link que no
 *  se pudo abrir queda registrado como `caido` con su error — eso también es evidencia. */
export async function capturarLinks(negocioId: number, filaId: string, urls: string[]): Promise<CapturaGuardada[]> {
  const limpias = [...new Set(urls.map(normalizarUrl))].slice(0, 3);
  if (limpias.length === 0) return [];
  let browser: any = null;
  try {
    const puppeteerCore = (await import('puppeteer-core')).default;
    const { addExtra } = await import('puppeteer-extra');
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    const { resolverChromium } = await import('@/app/lib/mp-descarga-browser');
    const pp: any = addExtra(puppeteerCore as any); pp.use(StealthPlugin());
    const { executablePath, args } = await resolverChromium();
    browser = await pp.launch({ args, executablePath, headless: true });
  } catch (e) {
    console.warn('[auditor-compras] sin navegador, se usa fetch simple:', String((e as Error).message || e).slice(0, 160));
  }

  const out: CapturaGuardada[] = [];
  try {
    for (const url of limpias) {
      let cap: Captura;
      try { cap = browser ? await capturarConNavegador(browser, url) : await capturarConFetch(url); }
      catch (e) {
        console.warn('[auditor-compras] navegador falló en', url, String((e as Error).message || e).slice(0, 120));
        cap = await capturarConFetch(url);
      }
      // Si el navegador devolvió una página casi vacía, se prueba también con fetch (algunas tiendas bloquean headless).
      if (cap.texto.length < 300 && cap.estado === 'activo' && cap.metodo === 'navegador') {
        const alt = await capturarConFetch(url);
        if (alt.texto.length > cap.texto.length) cap = { ...alt, imagen: cap.imagen };
      }
      const hash = createHash('sha256').update(cap.texto).digest('hex');
      const [r] = await pool.query(
        `INSERT INTO compras_auditor_costeo_captura (negocio_id, fila_id, url, capturado_at, http_status, estado_link, titulo, texto, hash_texto, imagen)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [negocioId, filaId, url.slice(0, 1000), cap.capturadoAt, cap.httpStatus, cap.estado, cap.titulo, cap.texto, hash, cap.imagen],
      ) as any;
      out.push({ ...cap, id: (r as any).insertId });
    }
  } finally { if (browser) await browser.close().catch(() => {}); }
  return out;
}

export async function imagenDeCaptura(capturaId: number, negocioId: number): Promise<Buffer | null> {
  const [rows] = await pool.query(`SELECT imagen FROM compras_auditor_costeo_captura WHERE id = ? AND negocio_id = ? LIMIT 1`, [capturaId, negocioId]) as any;
  return (rows as any[])[0]?.imagen ?? null;
}
