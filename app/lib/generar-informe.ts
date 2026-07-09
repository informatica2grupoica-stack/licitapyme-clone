// app/lib/generar-informe.ts
// Genera el DOCUMENTO "Informe Técnico" del equipamiento de una licitación en PDF. NO es la viabilidad
// completa (eso se ve en pantalla): es una FICHA TÉCNICA por cada máquina/equipo detectado, con sus
// especificaciones LIMPIAS (specs reales separadas de lo administrativo/comercial). Se arma un HTML
// autocontenido y se renderiza a PDF con el chromium del scraping (puppeteer-core + @sparticuz/chromium).
import puppeteerCore from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { existsSync } from 'fs';

const esc = (x: any): string => String(x ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Una ficha técnica de un equipo, ya con las specs separadas por el analizador.
export interface FichaTecnica {
  nombre: string;
  marca_referencia?: string;
  cantidad?: number | null;
  unidad?: string;
  ruta?: string;
  admite_equivalente?: boolean;
  specs_tecnicas: string[];
  requisitos_admisibilidad: string[];
  condiciones_no_tecnicas: string[];
}

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

/** HTML del Informe Técnico: una ficha por equipo, specs limpias, admisibilidad destacada. */
export function construirInformeTecnicoHtml(
  codigo: string,
  meta: { nombre?: string; organismo?: string; region?: string },
  fichas: FichaTecnica[],
): string {
  const fecha = new Date().toISOString().slice(0, 10);
  const fichasHtml = fichas.map((f, i) => `
    <section class="ficha">
      <div class="fhead">
        <span class="num">${i + 1}</span>
        <div>
          <h2>${esc(f.nombre)}</h2>
          <p class="meta">${f.marca_referencia ? `Referencia: ${esc(f.marca_referencia)}` : ''}${f.cantidad != null ? ` · Cantidad: ${esc(f.cantidad)}${f.unidad ? ' ' + esc(f.unidad) : ''}` : ''}${f.ruta ? ` · Ruta ${esc(f.ruta)}` : ''}${f.admite_equivalente === false ? ' · <b>marca exacta exigida</b>' : f.admite_equivalente ? ' · admite equivalente' : ''}</p>
        </div>
      </div>

      ${f.requisitos_admisibilidad.length ? `
      <div class="bloque adm">
        <h3>⚠ Requisitos de admisibilidad (piso innegociable)</h3>
        <ul>${f.requisitos_admisibilidad.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>` : ''}

      <div class="bloque">
        <h3>Especificaciones técnicas</h3>
        <ul class="specs">${f.specs_tecnicas.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>

      ${f.condiciones_no_tecnicas.length ? `
      <details class="bloque cond">
        <summary>Condiciones no técnicas (logística / garantía / comercial) — ${f.condiciones_no_tecnicas.length}</summary>
        <ul>${f.condiciones_no_tecnicas.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      </details>` : ''}
    </section>`).join('');

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color:#1e293b; font-size:11.5px; line-height:1.45; margin:0; }
    .head { border-bottom:2px solid #7c3aed; padding-bottom:8px; margin-bottom:14px; }
    .head h1 { font-size:16px; margin:0 0 2px; }
    .head .sub { color:#64748b; font-size:10.5px; }
    .head .kicker { font-size:10px; font-weight:800; letter-spacing:.06em; color:#7c3aed; text-transform:uppercase; }
    .ficha { border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; margin-bottom:14px; page-break-inside:avoid; }
    .fhead { display:flex; gap:10px; align-items:flex-start; margin-bottom:8px; }
    .num { flex-shrink:0; width:24px; height:24px; border-radius:50%; background:#7c3aed; color:#fff; font-weight:800; font-size:12px; display:flex; align-items:center; justify-content:center; }
    .fhead h2 { font-size:14px; margin:0; color:#0f172a; }
    .fhead .meta { font-size:10.5px; color:#64748b; margin:2px 0 0; }
    .bloque { margin-top:8px; }
    .bloque h3 { font-size:11.5px; margin:0 0 4px; color:#334155; }
    .bloque ul { margin:0; padding-left:18px; }
    .bloque li { margin:1.5px 0; }
    .specs { columns:2; column-gap:22px; }
    .specs li { break-inside:avoid; }
    .adm { background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:7px 10px; }
    .adm h3 { color:#b45309; }
    .cond { color:#64748b; font-size:10.5px; }
    .cond summary { cursor:pointer; color:#7c3aed; font-weight:600; }
    .foot { margin-top:12px; border-top:1px solid #e2e8f0; padding-top:6px; font-size:9.5px; color:#94a3b8; text-align:center; }
  </style></head><body>
    <div class="head">
      <p class="kicker">Informe Técnico de Equipamiento</p>
      <h1>${esc(meta.nombre || 'Informe Técnico')}</h1>
      <div class="sub">${esc(meta.organismo || '')}${meta.region ? ` · ${esc(meta.region)}` : ''} · ${esc(codigo)} · ${fichas.length} equipo(s)</div>
    </div>
    ${fichasHtml}
    <div class="foot">Especificaciones extraídas de las bases y ordenadas por IA · Ficha para sourcing/cotización · Generado ${esc(fecha)}</div>
  </body></html>`;
}
