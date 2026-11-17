// app/lib/mp-oc-ficha-pdf.ts
// Copia en PDF de la FICHA PÚBLICA de una orden de compra de Mercado Público.
//
// Por qué existe: desde oct-2026 MP protege PDFReport.aspx (el PDF oficial) con reCAPTCHA y no se
// puede bajar solo. La ficha DetailsPurchaseOrder.aspx sigue siendo pública y trae los mismos datos
// (comprador, proveedor, productos, montos). Se abre en un navegador real y se imprime a PDF.
// NO resuelve captcha. No es el PDF oficial: se guarda con nombre «_ficha_MP» para distinguirlo.
import puppeteerCore from 'puppeteer-core';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { resolverChromium } from '@/app/lib/mp-descarga-browser';
import { MP_UA } from '@/app/lib/mp-adjuntos';

const puppeteer = addExtra(puppeteerCore as any);
puppeteer.use(StealthPlugin());

/**
 * PDF OFICIAL de la OC: abre la ficha en un Chrome con ventana (NO headless: el reCAPTCHA invisible de
 * MP da puntaje bajo al headless y no entrega el archivo; con ventana entrega el PDF solo, igual que
 * al hacer clic una persona) y pulsa el botón PDF. En Linux sin pantalla levanta un Xvfb propio.
 * No resuelve ningún desafío: si MP no lo entrega, devuelve null y se cae a la copia de la ficha.
 */
export async function descargarPdfOficialOrdenCompra(codigoOC: string): Promise<Buffer | null> {
  const { promises: fs } = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const { spawn } = await import('child_process');
  const { executablePath, args } = await resolverChromium();
  let xvfb: ReturnType<typeof spawn> | null = null;
  const env = { ...process.env } as Record<string, string>;
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    xvfb = spawn('Xvfb', [':99', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
    xvfb.on('error', () => {});
    env.DISPLAY = ':99';
    await new Promise(r => setTimeout(r, 1500));
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-pdf-'));
  const browser = await puppeteer.launch({ args, executablePath, headless: false, env });
  try {
    const sesion = await browser.target().createCDPSession();
    await sesion.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
    const page = await browser.newPage();
    await page.goto(urlFichaOrdenCompra(codigoOC), { waitUntil: 'networkidle2', timeout: 30_000 });
    if (!(await page.$('[id*="imgPDF"]'))) return null;
    await page.click('[id*="imgPDF"]');
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const listos = (await fs.readdir(dir)).filter(n => !n.endsWith('.crdownload'));
      if (listos.length) {
        const buf = await fs.readFile(path.join(dir, listos[0]));
        return buf.subarray(0, 5).toString('latin1') === '%PDF-' ? buf : null;
      }
    }
    return null;
  } finally {
    await browser.close().catch(() => {});
    xvfb?.kill();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function urlFichaOrdenCompra(codigoOC: string): string {
  return `https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=${encodeURIComponent(codigoOC)}`;
}

/** Imprime la ficha pública de la OC a PDF. Lanza error si la página no es la ficha esperada. */
export async function imprimirFichaOrdenCompra(codigoOC: string): Promise<Buffer> {
  const { executablePath, args } = await resolverChromium();
  const browser = await puppeteer.launch({ args, executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(MP_UA);
    await page.goto(urlFichaOrdenCompra(codigoOC), { waitUntil: 'networkidle2', timeout: 30_000 });
    // Debe ser la ficha de ESTA orden (si MP muestra captcha/error no se guarda basura).
    const texto: string = await page.evaluate(() => document.body?.innerText || '');
    if (!texto.includes(codigoOC) || !/Informaci[oó]n de la Orden de Compra/i.test(texto)) {
      throw new Error('la ficha pública no cargó (captcha o página de error)');
    }
    // Las secciones de abajo (proveedor, productos, totales) cargan después: se espera al total.
    await page.waitForFunction(
      () => /TOTAL OC/i.test(document.body?.innerText || '') && /Datos del Proveedor/i.test(document.body?.innerText || ''),
      { timeout: 20_000 },
    ).catch(() => { throw new Error('la ficha cargó incompleta (sin productos ni totales)'); });
    // La hoja de estilo de impresión de MP corta la ficha en la sección 3: se imprime con el estilo
    // de pantalla y el contenido se ajusta al ancho de la hoja.
    await page.emulateMediaType('screen');
    // El contenido vive en un panel con scroll propio de 700 px (#pnlPrincipalInformation): se abre.
    await page.evaluate(() => {
      document.querySelectorAll<HTMLElement>('div').forEach(el => {
        const o = getComputedStyle(el).overflow;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') { el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none'; }
      });
      for (const id of ['divContents', 'pnlPrincipalInformation']) {
        const el = document.getElementById(id);
        if (el) { el.style.height = 'auto'; el.style.maxHeight = 'none'; el.style.overflow = 'visible'; }
      }
    });
    const pdf = await page.pdf({
      format: 'A4', printBackground: true, preferCSSPageSize: false,
      margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
    });
    const buffer = Buffer.from(pdf);
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('el navegador no generó un PDF');
    return buffer;
  } finally {
    await browser.close().catch(() => {});
  }
}
