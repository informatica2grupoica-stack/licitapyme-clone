// app/lib/generar-informe.ts
// Renderer genérico de HTML autocontenido → PDF A4, vía el chromium del scraping (puppeteer-core +
// @sparticuz/chromium). Antes también construía el HTML del "Informe Técnico" de equipamiento
// (eliminado 13-ago-2026, pedido explícito del usuario: gastaba tokens de IA en cada análisis de
// viabilidad para un documento que no se usaba). `generarInformePdf` queda como infraestructura
// compartida — lo sigue usando entrega-pdf.ts (Frente F.1, PDF de Entrega de Proyectos).
import puppeteerCore from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { existsSync } from 'fs';

// Chromium: env → binario del sistema → @sparticuz (igual que mp-descarga-browser).
const CANDIDATOS_WINDOWS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const CANDIDATOS_LINUX = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
const ARGS_SISTEMA = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

async function resolverChromium(): Promise<{ executablePath: string; args: string[] }> {
  const crudo = process.env.CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '';
  const limpio = crudo.trim().replace(/^["']|["']$/g, '');
  if (limpio && existsSync(limpio)) return { executablePath: limpio, args: ARGS_SISTEMA };
  const candidatos = process.platform === 'win32' ? CANDIDATOS_WINDOWS : CANDIDATOS_LINUX;
  const encontrado = candidatos.find(p => p && existsSync(p));
  if (encontrado) return { executablePath: encontrado, args: ARGS_SISTEMA };
  return { executablePath: await chromium.executablePath(), args: chromium.args };
}

/** Renderiza un HTML autocontenido a PDF A4 (buffer). */
export async function generarInformePdf(html: string): Promise<Buffer> {
  const { executablePath, args } = await resolverChromium();
  const browser = await puppeteerCore.launch({ args, executablePath, headless: true });
  try {
    const page = await browser.newPage();
    // HTML autocontenido (CSS inline, sin recursos externos) → 'load' basta.
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    const pdf = await page.pdf({
      format: 'A4', printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}


/** Abre una página REAL de la app con la sesión del usuario, deja solo el elemento `selector` (ya cargado y desplegado) y lo imprime a PDF con el
 *  mismo aspecto que en pantalla (misma hoja de estilos, mismo ancho). Es lo que hace el «PDF» del Auditor: tal cual la vista.
 *  @param cookieHeader   el header `cookie` de la petición del usuario (así la página abre autenticada)
 *  @param selectorListo  atributo/selector que la página pone cuando terminó de cargar sus datos */
export async function generarPdfDePagina(opts: {
  url: string; cookieHeader: string; selector: string; selectorListo: string; ancho?: number; ocultar?: string; timeoutMs?: number;
}): Promise<Buffer> {
  const ancho = opts.ancho ?? 1360, timeout = opts.timeoutMs ?? 80_000;
  const { executablePath, args } = await resolverChromium();
  const browser = await puppeteerCore.launch({ args, executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: ancho, height: 1000, deviceScaleFactor: 1 });
    const base = new URL(opts.url);
    const cookies = opts.cookieHeader.split(';').map(c => c.trim()).filter(Boolean).map(c => {
      const i = c.indexOf('=');
      return { name: c.slice(0, i), value: c.slice(i + 1), url: base.origin };
    }).filter(c => c.name);
    if (cookies.length) await page.setCookie(...cookies);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    // La app mantiene conexiones abiertas (SSE): no se espera "networkidle", se espera a que el panel diga que está listo.
    await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector(opts.selectorListo, { timeout });
    await new Promise(r => setTimeout(r, 800));   // imágenes y fuentes
    const encontrado = await page.evaluate((selector: string, ocultar: string) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return false;
      if (ocultar) el.querySelectorAll(ocultar).forEach(n => ((n as HTMLElement).style.display = 'none'));
      document.documentElement.classList.remove('dark');
      document.body.innerHTML = '';
      document.body.style.cssText = 'background:#fff;margin:0;padding:12px 14px;';
      document.body.appendChild(el);
      const st = document.createElement('style');
      st.textContent = 'tr,li,h3{break-inside:avoid} thead{display:table-header-group} *{-webkit-print-color-adjust:exact;print-color-adjust:exact}';
      document.head.appendChild(st);
      return true;
    }, opts.selector, opts.ocultar ?? '');
    if (!encontrado) throw new Error('La página no mostró el contenido a imprimir.');
    const pdf = await page.pdf({ width: `${ancho + 28}px`, height: '1900px', printBackground: true, margin: { top: '6mm', bottom: '6mm', left: '0', right: '0' } });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}
