// app/lib/mp-preguntas-respuestas.ts
// Trae el foro de "Preguntas y Respuestas" de una licitación desde el PORTAL de Mercado Público.
// La API pública NO expone el contenido — solo las fechas (FechaInicioPreguntas/FechaFinPreguntas/
// FechaPublicacionRespuestas, verificado 2026-07-21 contra la API real: el JSON completo no trae
// ni una vez la palabra "Pregunta"/"Aclarac"/"Foro" con contenido). El texto real solo vive en el
// portal, detrás del ícono "Preguntas Licitación" (id="imgPreguntasLicitacion", class="fancy").
//
// MECANISMO (verificado 2026-07-21, con Puppeteer real): el ícono NO abre una ventana nueva — es
// un lightbox FancyBox que INYECTA un <iframe class="fancybox-iframe"> en la MISMA página, con
// src = /Foros/Modules/FNormal/PopUps/PublicView.aspx?qs=<token de sesión>. Intentar primero con
// browser.once('targetcreated', ...) (como mp-descarga-browser.ts para los adjuntos) NO funciona
// acá: se abre un target "about:blank" que nunca navega — es ruido, no el contenido real. Y navegar
// por separado a una URL con el token `qs` capturado de otra carga de la ficha devuelve la tabla
// vacía en silencio (el token es específico de ESA carga). Por eso: click en el mismo contexto →
// esperar el iframe → leerlo directo con contentFrame(), sin cazar pop-ups.
//
// El link correcto es "Preguntas Licitación" (id=imgPreguntasLicitacion) → PublicView.aspx bajo
// FNormal/PopUps. NO confundir con "imgAclaracionOferta" → BuyQuestionAndAnswers.aspx, que es
// "Aclaraciones a la oferta" (proceso post-cierre DISTINTO, probado vacío en licitaciones con
// Preguntas reales).
import { addExtra } from 'puppeteer-extra';
import puppeteerCore from 'puppeteer-core';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { MP_BASE, MP_UA } from '@/app/lib/mp-adjuntos';
import { resolverChromium } from '@/app/lib/mp-descarga-browser';

const puppeteer = addExtra(puppeteerCore as any);
puppeteer.use(StealthPlugin());

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface PreguntaRespuesta {
  numero: number | null;
  fechaPregunta: string | null;
  pregunta: string;
  fechaRespuesta: string | null;
  respuesta: string | null; // null = MP aún no responde esa pregunta
}

export interface ForoPreguntas {
  fechaInicioPreguntas: string | null;
  fechaFinPreguntas: string | null;
  fechaPublicacionRespuestas: string | null;
  preguntas: PreguntaRespuesta[];
}

const RE_FECHA = /\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2}/;

// Clickea el ícono "Preguntas Licitación" (id=imgPreguntasLicitacion) y espera el <iframe
// class="fancybox-iframe"> que FancyBox inyecta en la MISMA página. Devuelve el Frame de Puppeteer
// del iframe (para leer su contenido directo), o null si el ícono no existe o el iframe no aparece
// (licitación sin ese módulo, o el portal cambió de estructura).
async function abrirIframeForoPreguntas(page: any): Promise<any | null> {
  const clicado = await page.evaluate(() => {
    const el = document.getElementById('imgPreguntasLicitacion') as HTMLElement | null;
    if (!el) return false;
    el.click();
    return true;
  }).catch(() => false);
  if (!clicado) return null;

  // Poll corto: el iframe se inyecta casi al instante, pero le damos margen a que cargue su src.
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const handle = await page.$('iframe.fancybox-iframe, iframe[id^="fancybox-frame"], iframe[src*="PublicView.aspx"]');
    if (handle) {
      const frame = await handle.contentFrame().catch(() => null);
      if (frame) return frame;
    }
  }
  return null;
}

// Extrae fechas del bloque de cabecera ("Inicio de preguntas", etc.) del texto plano de la página.
function extraerFechasCabecera(texto: string): Pick<ForoPreguntas, 'fechaInicioPreguntas' | 'fechaFinPreguntas' | 'fechaPublicacionRespuestas'> {
  const buscar = (etiqueta: RegExp): string | null => {
    const m = texto.match(etiqueta);
    return m ? (m[1].match(RE_FECHA)?.[0] ?? null) : null;
  };
  return {
    fechaInicioPreguntas: buscar(/Inicio de preguntas\s*:?\s*([\s\S]{0,40})/i),
    fechaFinPreguntas: buscar(/T[ée]rmino de preguntas\s*:?\s*([\s\S]{0,40})/i),
    fechaPublicacionRespuestas: buscar(/Publicaci[oó]n de respuestas(?:\s+hasta)?\s*:?\s*([\s\S]{0,40})/i),
  };
}

// Empareja filas de tabla (cada una un array de celdas de texto) en preguntas+respuesta. Robusto a
// variaciones de columnas: identifica la marca P/R, la fecha (regex) y usa la ÚLTIMA celda no vacía
// como el texto (pregunta o respuesta). Una fila "R" sin número se cuelga de la última "P" vista.
function parsearFilas(filas: string[][]): PreguntaRespuesta[] {
  const preguntas: PreguntaRespuesta[] = [];
  let actual: PreguntaRespuesta | null = null;

  for (const celdas of filas) {
    const limpias = celdas.map(c => c.trim()).filter((c, i) => i === 0 || c !== ''); // conserva 1ª celda aunque venga vacía (marca ausencia de N°)
    const marca = celdas.find(c => c.trim() === 'P' || c.trim() === 'R')?.trim();
    if (!marca) continue; // fila de cabecera u otra cosa, no es P/R

    const fecha = celdas.find(c => RE_FECHA.test(c))?.match(RE_FECHA)?.[0] ?? null;
    const texto = [...celdas].reverse().find(c => c.trim().length > 3 && !RE_FECHA.test(c) && c.trim() !== 'P' && c.trim() !== 'R')?.trim() || '';
    const numeroCelda = celdas.find(c => /^\d+$/.test(c.trim()));
    const numero = numeroCelda ? Number(numeroCelda) : null;

    if (marca === 'P') {
      actual = { numero, fechaPregunta: fecha, pregunta: texto, fechaRespuesta: null, respuesta: null };
      preguntas.push(actual);
    } else if (marca === 'R' && actual) {
      actual.fechaRespuesta = fecha;
      actual.respuesta = texto;
    }
  }
  return preguntas;
}

/**
 * Trae el foro de preguntas y respuestas de una licitación desde el portal de MP.
 * Devuelve null si no se pudo llegar al iframe (licitación sin ese módulo, WAF, o cambio de
 * estructura del portal) — nunca lanza, para no romper el flujo que lo llama (best-effort).
 */
export async function obtenerPreguntasRespuestas(codigo: string): Promise<ForoPreguntas | null> {
  const { executablePath, args } = await resolverChromium();
  const ficha = `${MP_BASE}/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${encodeURIComponent(codigo)}`;
  const headful = process.env.MP_DEBUG_HEADFUL === '1';

  const browser = await puppeteer.launch({ args, executablePath, headless: !headful, slowMo: headful ? 120 : 0 });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(MP_UA);
    await page.goto(ficha, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((e: any) =>
      console.warn(`[preguntas-mp] goto ficha timeout/error: ${e.message} — continuando`)
    );
    await sleep(3_000);

    const frame = await abrirIframeForoPreguntas(page);
    if (!frame) {
      console.log(`[preguntas-mp] ${codigo}: no se encontró/abrió el ícono de Preguntas Licitación`);
      return null;
    }

    await sleep(1_000);
    const { texto, filas } = await frame.evaluate(() => ({
      texto: document.body?.textContent || '',
      filas: Array.from(document.querySelectorAll('table tr')).map((tr: Element) =>
        Array.from(tr.querySelectorAll('td,th')).map((td: Element) => (td as HTMLElement).textContent || '')
      ),
    })).catch(() => ({ texto: '', filas: [] as string[][] }));

    console.log(`[preguntas-mp] ${codigo}: iframe leído — ${filas.length} fila(s) de tabla`);
    const preguntas = parsearFilas(filas);
    if (preguntas.length === 0 && filas.length > 0) {
      // Diagnóstico: si hay tabla pero no se extrajo nada, el formato cambió — volcar para depurar.
      console.log('[preguntas-mp][diag] filas crudas (sin parsear):', JSON.stringify(filas.slice(0, 6)));
    }

    return { ...extraerFechasCabecera(texto), preguntas };
  } catch (e: any) {
    console.error(`[preguntas-mp] ${codigo} falló:`, String(e?.message ?? e).slice(0, 200));
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}
