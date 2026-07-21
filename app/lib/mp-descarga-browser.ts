// app/lib/mp-descarga-browser.ts
// Fallback robusto: abre el pop-up en un navegador headless real (puppeteer-extra
// con plugin stealth para renderizar como un navegador normal), hace clic en cada
// ícono "Ver" de la grilla y captura los binarios.
//
// NO resuelve reCAPTCHA: la variante ViewAttachment.aspx (con captcha) se ignora
// a propósito. Los mismos archivos llegan por VerAntecedentes.aspx / la lupa "Ver"
// por fila, que MP no protege con captcha.
import puppeteerCore from 'puppeteer-core';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import chromium from '@sparticuz/chromium';
import os from 'os';
import path from 'path';
import { promises as fs, existsSync } from 'fs';
import {
  MP_BASE,
  MP_UA,
  ArchivoDescargado,
  contentTypePorNombre,
  extraerLinksAdjuntos,
} from '@/app/lib/mp-adjuntos';

const puppeteer = addExtra(puppeteerCore as any);
puppeteer.use(StealthPlugin());

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const ARGS_SISTEMA = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

/** Rutas típicas de Chrome/Edge en Windows para autodetección en dev local. */
const CANDIDATOS_WINDOWS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

/** Rutas típicas de Chromium en Linux (Docker/VPS). */
const CANDIDATOS_LINUX = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];

/**
 * Resuelve el ejecutable del navegador con tolerancia a errores comunes:
 * limpia comillas/espacios del env (.env.local suele traer basura), valida que
 * el archivo exista de verdad y, si no, autodetecta Chrome/Edge/Chromium.
 * Último recurso: el binario de @sparticuz (serverless).
 */
export async function resolverChromium(): Promise<{ executablePath: string; args: string[] }> {
  const crudo = process.env.CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '';
  const limpio = crudo.trim().replace(/^["']|["']$/g, '');

  if (limpio && existsSync(limpio)) {
    return { executablePath: limpio, args: ARGS_SISTEMA };
  }
  if (limpio) {
    console.warn(`[browser] CHROME_EXECUTABLE_PATH no existe ("${limpio}") → autodetectando...`);
  }

  const candidatos = process.platform === 'win32' ? CANDIDATOS_WINDOWS : CANDIDATOS_LINUX;
  const encontrado = candidatos.find(p => p && existsSync(p));
  if (encontrado) {
    console.log(`[browser] Navegador autodetectado: ${encontrado}`);
    return { executablePath: encontrado, args: ARGS_SISTEMA };
  }

  // Serverless / sin navegador del sistema.
  return { executablePath: await chromium.executablePath(), args: chromium.args };
}

/** Lee todos los archivos descargados en un directorio temporal y los carga a memoria. */
async function leerDescargas(dir: string): Promise<ArchivoDescargado[]> {
  const archivos: ArchivoDescargado[] = [];
  let nombres: string[] = [];
  try {
    nombres = await fs.readdir(dir);
  } catch {
    return archivos;
  }
  for (const nombre of nombres) {
    if (nombre.endsWith('.crdownload') || nombre.endsWith('.tmp')) continue;
    const full = path.join(dir, nombre);
    try {
      const buffer = await fs.readFile(full);
      if (buffer.length < 128) continue;
      archivos.push({ nombre, buffer, contentType: contentTypePorNombre(nombre) });
    } catch { /* ignorar archivos que aún no terminan */ }
  }
  return archivos;
}

/**
 * Abre cada pop-up de adjuntos en el navegador, dispara las descargas y
 * devuelve todos los binarios obtenidos.
 */
export async function descargarViaNavegador(
  encUrls: string[],
  referer: string,
): Promise<ArchivoDescargado[]> {
  const { executablePath, args } = await resolverChromium();

  const browser = await puppeteer.launch({
    args,
    executablePath,
    headless: true,
  });

  try {
    const resultado: ArchivoDescargado[] = [];

    for (const url of encUrls) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-adj-'));
      const page = await browser.newPage();
      try {
        await page.setUserAgent(MP_UA);
        await page.setExtraHTTPHeaders({ Referer: referer });

        const client = await page.createCDPSession();
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20_000 });
        await sleep(2_000);

        // Clic en cada botón de descarga de la grilla (ícono "ver").
        const botones = await page.$$(
          'input[type="image"][src*="ver"], input[type="image"][name*="search"], a[href*="Download"]',
        );
        if (botones.length === 0) {
          // Algunos pop-ups entregan el archivo directo al cargar la URL.
          await sleep(4_000);
        }
        for (const boton of botones) {
          await boton.click().catch(() => {});
          await sleep(4_000); // dar tiempo a que arranque cada descarga
        }

        // Esperar a que las descargas terminen (sin .crdownload).
        for (let i = 0; i < 15; i++) {
          await sleep(1_000);
          const pendientes = (await fs.readdir(dir).catch(() => [] as string[]))
            .some(n => n.endsWith('.crdownload'));
          if (!pendientes) break;
        }

        resultado.push(...(await leerDescargas(dir)));
      } finally {
        await page.close().catch(() => {});
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }

    return resultado;
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Flujo completo desde la ficha, dentro de UNA sola sesión de navegador
 * (el token `enc` está atado a la sesión, así que hay que derivarlo en el mismo
 * contexto donde luego se descarga). Abre la ficha, encuentra los pop-ups de
 * adjuntos, y en cada uno pincha la lupa "Ver" de cada fila — que entrega el
 * archivo sin pasar por el captcha del botón "Descargar seleccionados".
 */
export async function descargarDesdeFicha(codigo: string): Promise<ArchivoDescargado[]> {
  const { executablePath, args } = await resolverChromium();
  const ficha = `${MP_BASE}/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}`;
  const headful = process.env.MP_DEBUG_HEADFUL === '1'; // ver el navegador para depurar

  const browser = await puppeteer.launch({
    args,
    executablePath,
    headless: !headful,
    slowMo: headful ? 120 : 0,
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(MP_UA);

    await page.goto(ficha, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((e: any) =>
      console.warn(`[browser] goto ficha timeout/error: ${e.message} — continuando con contenido parcial`)
    );
    await sleep(3_000);
    const titFicha = await page.title().catch(() => '?');
    console.log(`[browser] ficha cargada → ${page.url()} (título: "${titFicha}")`);
    if (titFicha.toLowerCase().includes('login') || titFicha.toLowerCase().includes('iniciar sesión') || titFicha.toLowerCase().includes('captcha')) {
      console.error('[browser] MP redirigió a login/captcha — la ficha no es pública');
    }

    // 1) Buscar el enc en TODOS los frames (MP a veces mete la ficha en un iframe).
    let encUrls = await encEnFrames(page, ficha);
    console.log(`[browser] encEnFrames encontró ${encUrls.length} URL(s) de adjunto`);

    // 2) Si no aparece, pinchar "Ver adjuntos" (en cualquier frame) y capturar el pop-up.
    if (encUrls.length === 0) {
      const popupUrl = await intentarAbrirVerAdjuntos(browser, page);
      if (popupUrl) encUrls = [popupUrl];
    }

    // 3) Si aún no hay enc, volcar diagnóstico para saber cómo está armado el botón.
    if (encUrls.length === 0) {
      await dumpDiagnostico(page);
      console.log('[browser] No se pudo derivar el enc de la ficha (ver diagnóstico arriba)');
      return [];
    }

    console.log(`[browser] enc derivado: ${encUrls.length} pop-up(s)`);

    const resultado: ArchivoDescargado[] = [];
    for (const url of encUrls) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mp-fic-'));
      // Abrir cada pop-up en una NUEVA página (mismo contexto de browser = mismas cookies)
      // sin navegar la ficha, ya que el token enc está atado a esa sesión.
      const popup = await browser.newPage();
      try {
        await popup.setUserAgent(MP_UA);
        await popup.setExtraHTTPHeaders({ Referer: ficha });

        const client = await popup.createCDPSession();
        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });

        await popup.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((e: any) =>
          console.warn(`[browser] popup goto timeout/error: ${e.message} — continuando`)
        );
        await sleep(2_500);
        console.log(`[browser] popup cargado → ${popup.url()}`);

        // Detectar "acceso denegado" (robot.png o texto explícito) — token enc expirado.
        // IMPORTANTE: no usar 'acceso' solo porque páginas válidas lo incluyen en el título.
        const { accesoDenegado, tituloPopup } = await popup.evaluate(() => ({
          accesoDenegado: !!document.querySelector('img[src*="robot"]') ||
            document.title.toLowerCase().includes('denegado') ||
            (document.body?.textContent || '').toLowerCase().includes('acceso denegado'),
          tituloPopup: document.title,
        })).catch(() => ({ accesoDenegado: false, tituloPopup: '?' }));
        console.log(`[browser] popup titulo: "${tituloPopup}"`);
        if (accesoDenegado) {
          console.warn('[browser] popup respondió "Acceso denegado" — token enc expirado o WAF bloqueó');
          continue;
        }

        // Si el popup es la variante protegida con reCAPTCHA (ViewAttachment.aspx),
        // lo omitimos: los archivos llegan por VerAntecedentes.aspx / la lupa "Ver".
        const tieneRecaptcha = await popup.evaluate(() =>
          !!document.querySelector('script[src*="recaptcha"]') &&
          !document.querySelector('input[type="image"]')
        ).catch(() => false);

        if (tieneRecaptcha) {
          console.log('[browser] popup con reCAPTCHA y sin grilla (ViewAttachment.aspx) — se omite');
          continue;
        }

        // Lupa "Ver" por fila → descarga ese archivo sin captcha.
        // Se busca en todos los frames del pop-up.
        let clics = 0;
        let allFrames: any[] = [];
        try { allFrames = popup.frames(); } catch { allFrames = []; }
        for (const frame of allFrames) {
          let lupas: any[] = [];
          try {
            lupas = await frame.$$(
              'input[type="image"][src*="ver"], input[type="image"][name*="search"], a[href*="Download"], a[onclick*="Download"], input[type="image"]',
            );
          } catch { continue; }
          for (const lupa of lupas) {
            await lupa.click().catch(() => {});
            clics++;
            await sleep(4_000);
          }
        }
        console.log(`[browser] ${clics} clic(s) de descarga en el pop-up`);

        // Si no hubo clics, volcar el HTML del popup para diagnóstico.
        if (clics === 0) {
          const htmlSnip = await popup.evaluate(() =>
            document.body?.innerHTML?.slice(0, 3000) || '(vacío)'
          ).catch(() => '(error evaluando)');
          console.log('[browser][diag] popup sin botones — HTML del body (primeros 3000 chars):');
          console.log(htmlSnip);
        }

        // Si 0 clics: MP a veces redirige directamente al binario al cargar la URL.
        if (clics === 0) await sleep(5_000);

        for (let i = 0; i < 20; i++) {
          await sleep(1_000);
          const pendientes = (await fs.readdir(dir).catch(() => [] as string[]))
            .some(n => n.endsWith('.crdownload'));
          if (!pendientes) break;
        }

        resultado.push(...(await leerDescargas(dir)));
      } finally {
        await popup.close().catch(() => {});
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }

    return resultado;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Recorre todos los frames de la página y junta las URLs de pop-up de adjuntos. */
async function encEnFrames(page: any, base: string): Promise<string[]> {
  const urls = new Set<string>();
  let frames: any[] = [];
  try { frames = page.frames(); } catch { return []; }
  console.log(`[browser] frames en la ficha: ${frames.length}`);
  for (const frame of frames) {
    try {
      const html = await frame.content();
      for (const adj of extraerLinksAdjuntos(html, frame.url() || base)) urls.add(adj.url);
    } catch (e: any) {
      const msg = e?.message || '';
      if (!msg.includes('cross-origin') && !msg.includes('detached') && !msg.includes('Target closed')) {
        console.warn(`[browser] frame.content() error: ${msg}`);
      }
    }
  }
  // Fallback: usa el contenido del frame principal directamente
  if (urls.size === 0) {
    try {
      const html = await page.content();
      for (const adj of extraerLinksAdjuntos(html, base)) urls.add(adj.url);
    } catch { /* noop */ }
  }
  return Array.from(urls);
}

/** Pincha "Ver adjuntos" en cualquier frame y devuelve la URL del pop-up resultante. */
async function intentarAbrirVerAdjuntos(browser: any, page: any): Promise<string | null> {
  const nuevaPestana = new Promise<any>((resolve) => {
    browser.once('targetcreated', async (t: any) => resolve(await t.page().catch(() => null)));
  });

  let clicado = false;
  for (const frame of page.frames()) {
    clicado = await frame.evaluate(() => {
      const nodos = Array.from(document.querySelectorAll('a, input, img, button, area'));
      const coincide = (n: Element) => {
        const attrs = (n.getAttribute('onclick') || '') + (n.getAttribute('href') || '') +
          (n.getAttribute('title') || '') + (n.getAttribute('alt') || '') + (n.textContent || '');
        return /ViewAttachment|ver\s*adjunto|adjunto|anexo/i.test(attrs);
      };
      const el = nodos.find(coincide) as HTMLElement | undefined;
      if (el) { el.click(); return true; }
      return false;
    }).catch(() => false);
    if (clicado) break;
  }
  if (!clicado) return null;

  const popup = await Promise.race([nuevaPestana, sleep(8_000).then(() => null)]);
  if (popup) {
    try {
      await popup.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
      const url = popup.url();
      await popup.close().catch(() => {});
      if (url && url.includes('ViewAttachmentLC')) return url;
    } catch { /* noop */ }
  }
  // El clic pudo haber navegado en la misma pestaña en vez de abrir pop-up.
  await sleep(2_000);
  const aqui = page.url();
  return aqui.includes('ViewAttachmentLC') ? aqui : null;
}

/** Imprime pistas sobre la estructura de la ficha para depurar cuando no hay enc. */
async function dumpDiagnostico(page: any): Promise<void> {
  try {
    for (const frame of page.frames()) {
      const info = await frame.evaluate(() => {
        const out: string[] = [];
        const nodos = Array.from(document.querySelectorAll('a, input[type="image"], img, button, area'));
        for (const n of nodos) {
          const txt = (n.getAttribute('title') || n.getAttribute('alt') || n.textContent || '').trim();
          const oc = n.getAttribute('onclick') || '';
          const href = n.getAttribute('href') || '';
          if (/adjunto|anexo|attachment/i.test(txt + oc + href)) {
            out.push(`<${n.tagName.toLowerCase()}> txt="${txt.slice(0, 40)}" onclick="${oc.slice(0, 120)}" href="${href.slice(0, 120)}"`);
          }
        }
        return out;
      }).catch(() => [] as string[]);
      if (info.length) {
        console.log(`[diag] frame ${frame.url()}:`);
        info.forEach((l: string) => console.log(`[diag]   ${l}`));
      }
    }
  } catch { /* noop */ }
}
