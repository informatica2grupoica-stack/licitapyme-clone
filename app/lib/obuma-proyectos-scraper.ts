// app/lib/obuma-proyectos-scraper.ts
// Lee el módulo real de Proyectos de Obuma (v2.0) por LA WEB, no por API — la API v2.0 sigue
// bloqueada (falta OBUMA_ACCESS_URL, módulo no contratado, confirmado por el usuario 22-sep-2026).
// Reemplaza la extracción manual que se hizo la primera vez (ver docs/migration-122 y
// docs/BITACORA-MODULO-COMPRAS.md §17.3.7) por el mismo procedimiento, automatizado: login con
// OBUMA_WEB_RUT/OBUMA_WEB_CLAVE, ir a Listar Proyectos, subir el tamaño de página a 200 (para traer
// todo en una sola pasada) y leer la tabla real del DOM celda por celda — nunca parseo de texto
// plano, que se demostró poco confiable (filas sin "Referencia" corren los campos).
//
// Selectores confirmados en vivo el 22-sep-2026 (formulario real de login):
//   input#idLogin name="rut", input#idPassword name="clave", form action=usuario-login.php POST.
// Listado: home.php?page=mod-proyectos/listar, selector <select id="_pagi_cuantos"> (opciones
// 50..500).
import puppeteerCore from 'puppeteer-core';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import pool from '@/app/lib/db';
import { resolverChromium } from '@/app/lib/mp-descarga-browser';

const puppeteer = addExtra(puppeteerCore as any);
puppeteer.use(StealthPlugin());

const BASE = 'https://app.obuma.cl/obuma2.0';

export interface ProyectoObumaCrudo {
  folio: string; fechaIngreso: string; fechaInicio: string; nombre: string; referencia: string;
  cliente: string; presupuesto: string; costo: string; precioNeto: string; facturadoNeto: string; estado: string;
}

/** Login + lectura completa de la tabla de Proyectos. Lanza error si faltan las credenciales o si
 *  el login no queda logueado (selector del dashboard no aparece) — nunca sigue adelante a ciegas. */
export async function scrapearProyectosObuma(): Promise<ProyectoObumaCrudo[]> {
  const rut = process.env.OBUMA_WEB_RUT;
  const clave = process.env.OBUMA_WEB_CLAVE;
  if (!rut || !clave) throw new Error('OBUMA_WEB_RUT / OBUMA_WEB_CLAVE no configurados');

  const { executablePath, args } = await resolverChromium();
  const browser = await puppeteer.launch({ args, executablePath, headless: true });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('#idLogin', { timeout: 15_000 });
    await page.type('#idLogin', rut, { delay: 20 });
    await page.type('#idPassword', clave, { delay: 20 });
    await Promise.all([
      page.click('button[type=submit]'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => null),
    ]);

    // Confirmar que quedó logueado: el menú lateral trae el link a Proyectos solo con sesión activa.
    const logueado = await page.evaluate(() => !!document.querySelector('a[href*="mod-proyectos"]'));
    if (!logueado) throw new Error('Login a Obuma no quedó logueado — revisar OBUMA_WEB_RUT/OBUMA_WEB_CLAVE');

    await page.goto(`${BASE}/home.php?page=mod-proyectos/listar`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('#_pagi_cuantos', { timeout: 15_000 });
    await page.evaluate(() => {
      const sel = document.getElementById('_pagi_cuantos') as HTMLSelectElement | null;
      if (!sel) return;
      sel.value = '500';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // La grilla se recarga por AJAX — no hay evento propio que esperar, se espera un respiro fijo
    // (mismo patrón que mp-descarga-browser.ts: sleep corto en vez de una condición frágil de DOM).
    await new Promise(r => setTimeout(r, 3_000));

    const datos: ProyectoObumaCrudo[] = await page.evaluate(() => {
      const tabla = document.querySelectorAll('table')[0];
      if (!tabla) return [];
      const filas = [...tabla.rows].slice(1);
      return filas.map(r => {
        const c = [...r.cells].map(td => (td as HTMLElement).innerText.trim());
        return {
          folio: c[0], fechaIngreso: c[1], fechaInicio: c[2], nombre: c[3], referencia: c[4],
          cliente: c[5], presupuesto: c[6], costo: c[7], precioNeto: c[8], facturadoNeto: c[9], estado: c[10],
        };
      });
    });

    if (datos.length === 0) throw new Error('La tabla de Proyectos vino vacía — Obuma pudo haber cambiado el diseño de la página');
    return datos;
  } finally {
    await browser.close();
  }
}

function fechaSQL(s: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec((s || '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
function num(s: string): number | null {
  const n = Number(String(s || '').replace(/\./g, '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}
function montoFacturado(s: string): number | null {
  const t = (s || '').trim();
  if (!t || t === 'No') return null;
  return num(t);
}

/** Guarda el resultado del scrape en obuma_proyectos_reales (migration-122) — mismo INSERT ...
 *  ON DUPLICATE KEY UPDATE que se usó en la carga manual inicial. */
export async function guardarProyectosObuma(datos: ProyectoObumaCrudo[]): Promise<{ guardados: number }> {
  const ahora = new Date().toISOString().slice(0, 19).replace('T', ' ');
  for (const d of datos) {
    await pool.query(
      `INSERT INTO obuma_proyectos_reales
         (folio, fecha_ingreso, fecha_inicio, nombre, referencia, cliente, presupuesto, costo, precio_neto, facturado_neto, estado, capturado_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         fecha_ingreso=VALUES(fecha_ingreso), fecha_inicio=VALUES(fecha_inicio), nombre=VALUES(nombre),
         referencia=VALUES(referencia), cliente=VALUES(cliente), presupuesto=VALUES(presupuesto),
         costo=VALUES(costo), precio_neto=VALUES(precio_neto), facturado_neto=VALUES(facturado_neto),
         estado=VALUES(estado), capturado_at=VALUES(capturado_at)`,
      [
        Number(d.folio), fechaSQL(d.fechaIngreso), fechaSQL(d.fechaInicio), d.nombre || null,
        d.referencia || null, d.cliente || null, num(d.presupuesto), num(d.costo), num(d.precioNeto),
        montoFacturado(d.facturadoNeto), d.estado || null, ahora,
      ],
    );
  }
  return { guardados: datos.length };
}

/** Corrida completa: scrapear + guardar. Usada por el cron diario y por el botón "Actualizar". */
export async function actualizarProyectosObuma(): Promise<{ guardados: number }> {
  const datos = await scrapearProyectosObuma();
  return guardarProyectosObuma(datos);
}
