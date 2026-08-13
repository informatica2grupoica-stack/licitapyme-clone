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

