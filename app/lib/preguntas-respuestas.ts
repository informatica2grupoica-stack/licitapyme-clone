// app/lib/preguntas-respuestas.ts
// Capa de CACHÉ + POLLER para el foro de Preguntas y Respuestas (migración 44). Separado de
// app/lib/mp-preguntas-respuestas.ts (que solo sabe SCRAPEAR el portal, sin BD) igual que
// adjudicacion.ts separa el scraping/consulta de la persistencia.
//
// "respondido=1" es un HECHO FINAL (como adjudicacion_cache con la adjudicación): una vez que
// fecha_publicacion_respuestas ya pasó Y se scrapeó después de esa fecha, no se vuelve a
// consultar el portal para ese código — ahorra abrir navegador de nuevo sin necesidad.
import pool from '@/app/lib/db';
import { obtenerPreguntasRespuestas, type ForoPreguntas } from '@/app/lib/mp-preguntas-respuestas';

const CONCURRENCIA   = 2;       // navegadores reales en paralelo (pesado, ir con cuidado)
const PRESUPUESTO_MS = 120_000; // margen bajo maxDuration=300 del cron
const REVERIFICAR_MIN = 60;     // no reintentar un código "no resuelto" antes de esto

export interface ForoPreguntasCache extends ForoPreguntas {
  respondido: boolean;
  consultadoEn: string | null;
}

// "DD-MM-YYYY HH:mm:ss" (texto del portal) → "YYYY-MM-DD HH:mm:ss" (DATETIME de MySQL). null si no matchea.
function aFechaMySQL(texto: string | null): string | null {
  if (!texto) return null;
  const m = texto.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2}:\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hora] = m;
  return `${yyyy}-${mm}-${dd} ${hora}`;
}

// mysql2 (timezone:'local', ver app/lib/db.ts) devuelve las columnas DATETIME como objetos Date
// YA en hora de pared de Chile — de vuelta a "DD-MM-YYYY HH:mm:ss" (mismo formato del portal de
// MP) con los componentes LOCALES del Date, nunca toISOString (eso aplicaría UTC y correría la hora).
function fechaDeVuelta(d: Date | string | null): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// ── Lectura del cache (instantánea, sin tocar el portal) ──────────────────────────
export async function leerCachePreguntas(codigo: string): Promise<ForoPreguntasCache | null> {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM preguntas_respuestas_cache WHERE licitacion_codigo = ? LIMIT 1`, [codigo],
    ) as any[];
    const row = (rows as any[])[0];
    if (!row) return null;
    let preguntas: ForoPreguntas['preguntas'] = [];
    try { preguntas = row.preguntas ? JSON.parse(row.preguntas) : []; } catch { /* JSON corrupto */ }
    return {
      fechaInicioPreguntas: fechaDeVuelta(row.fecha_inicio_preguntas),
      fechaFinPreguntas: fechaDeVuelta(row.fecha_fin_preguntas),
      fechaPublicacionRespuestas: fechaDeVuelta(row.fecha_publicacion_respuestas),
      preguntas,
      respondido: !!row.respondido,
      consultadoEn: fechaDeVuelta(row.consultado_en),
    };
  } catch {
    return null; // tabla ausente (migración 44 pendiente) → sin cache
  }
}

// ── Escritura del cache (best-effort) ──────────────────────────────────────────────
async function guardarCachePreguntas(codigo: string, foro: ForoPreguntas): Promise<void> {
  const fechaPub = aFechaMySQL(foro.fechaPublicacionRespuestas);
  // Hecho final: ya pasó la fecha de publicación de respuestas Y la estamos guardando DESPUÉS de
  // haberla scrapeado en este momento → no hace falta volver a mirarla nunca más.
  const respondido = !!fechaPub && new Date(fechaPub.replace(' ', 'T')) <= new Date();
  try {
    await pool.query(
      `INSERT INTO preguntas_respuestas_cache
         (licitacion_codigo, fecha_inicio_preguntas, fecha_fin_preguntas, fecha_publicacion_respuestas,
          preguntas, n_preguntas, respondido, ultimo_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON DUPLICATE KEY UPDATE
         fecha_inicio_preguntas = VALUES(fecha_inicio_preguntas),
         fecha_fin_preguntas = VALUES(fecha_fin_preguntas),
         fecha_publicacion_respuestas = VALUES(fecha_publicacion_respuestas),
         preguntas = VALUES(preguntas),
         n_preguntas = VALUES(n_preguntas),
         respondido = VALUES(respondido),
         ultimo_error = NULL`,
      [
        codigo, aFechaMySQL(foro.fechaInicioPreguntas), aFechaMySQL(foro.fechaFinPreguntas), fechaPub,
        JSON.stringify(foro.preguntas), foro.preguntas.length, respondido ? 1 : 0,
      ],
    );
  } catch (e) {
    console.error(`[preguntas-respuestas] guardarCache ${codigo} falló:`, String(e).slice(0, 200));
  }
}

async function marcarError(codigo: string, error: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO preguntas_respuestas_cache (licitacion_codigo, ultimo_error)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE ultimo_error = VALUES(ultimo_error), consultado_en = NOW()`,
      [codigo, error.slice(0, 255)],
    );
  } catch { /* best-effort */ }
}

/**
 * Trae y guarda el foro para UN código (usado por el botón "Actualizar" — fuerza scrape real
 * ignorando el estado "respondido"). Devuelve el resultado guardado, o null si falló.
 */
export async function refrescarPreguntas(codigo: string): Promise<ForoPreguntasCache | null> {
  const foro = await obtenerPreguntasRespuestas(codigo);
  if (!foro) { await marcarError(codigo, 'Scrape del portal falló'); return null; }
  await guardarCachePreguntas(codigo, foro);
  return leerCachePreguntas(codigo);
}

// ── Candidatos pendientes: negocios activos (no descartados) sin "respondido=1" ──────
async function candidatosPendientes(lote: number): Promise<string[]> {
  const [rows] = await pool.query(
    `SELECT DISTINCT n.licitacion_codigo AS codigo
     FROM negocios n
     LEFT JOIN preguntas_respuestas_cache c
       ON c.licitacion_codigo COLLATE utf8mb4_general_ci = n.licitacion_codigo COLLATE utf8mb4_general_ci
     WHERE n.activo = TRUE
       AND n.estado_pipeline != 'DESCARTADA'
       AND (c.licitacion_codigo IS NULL OR (
         c.respondido = 0
         AND TIMESTAMPDIFF(MINUTE, c.consultado_en, NOW()) >= ?
       ))
     ORDER BY n.licitacion_cierre ASC
     LIMIT ?`,
    [REVERIFICAR_MIN, Math.max(1, Math.min(lote, 100))],
  ) as any[];
  return (rows as any[]).map(r => r.codigo as string);
}

export async function contarPendientesPreguntas(): Promise<number> {
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(DISTINCT n.licitacion_codigo) AS n
       FROM negocios n
       LEFT JOIN preguntas_respuestas_cache c
         ON c.licitacion_codigo COLLATE utf8mb4_general_ci = n.licitacion_codigo COLLATE utf8mb4_general_ci
       WHERE n.activo = TRUE AND n.estado_pipeline != 'DESCARTADA'
         AND (c.licitacion_codigo IS NULL OR c.respondido = 0)`,
    ) as any[];
    return Number((rows as any[])[0]?.n) || 0;
  } catch (e) {
    console.error('[preguntas-respuestas] contarPendientes falló:', String(e).slice(0, 200));
    return 0;
  }
}

// ── Poller del cron ─────────────────────────────────────────────────────────────────
export async function procesarPreguntasPendientes(lote = 20): Promise<{
  revisadas: number; conContenido: number; errores: number;
}> {
  const stats = { revisadas: 0, conContenido: 0, errores: 0 };
  const inicio = Date.now();

  const codigos = await candidatosPendientes(lote);
  if (codigos.length === 0) return stats;

  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, codigos.length) }, async () => {
    while (i < codigos.length) {
      const codigo = codigos[i++];
      if (Date.now() - inicio > PRESUPUESTO_MS) return;
      try {
        const foro = await obtenerPreguntasRespuestas(codigo);
        stats.revisadas++;
        if (!foro) { await marcarError(codigo, 'Scrape del portal falló'); stats.errores++; continue; }
        await guardarCachePreguntas(codigo, foro);
        if (foro.preguntas.length > 0) stats.conContenido++;
      } catch (e) {
        stats.errores++;
        console.error(`[preguntas-respuestas] "${codigo}" falló:`, String(e).slice(0, 200));
        await marcarError(codigo, String(e).slice(0, 200));
      }
    }
  }));
  return stats;
}
