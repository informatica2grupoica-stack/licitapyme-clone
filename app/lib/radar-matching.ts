// app/lib/radar-matching.ts
// ─────────────────────────────────────────────────────────────────────────────
// Lógica COMPARTIDA de matching del radar: cargar keywords (positivas + negativas),
// evaluar una licitación, aplicar EXCLUSIÓN por palabras negativas e insertar
// alertas. La usan el cron (app/api/cron/alertas) y el enriquecimiento masivo
// reanudable (app/api/radar/enriquecer-pendientes).
//
// Palabras NEGATIVAS: si una licitación calza CUALQUIER keyword con es_negativa=1,
// queda excluida y no genera alertas, aunque calce keywords positivas. Se evalúan
// con el mismo matcher field-aware (nombre/categoría/ítems/descripción).
// ─────────────────────────────────────────────────────────────────────────────

import pool from '@/app/lib/db';
import type { Licitacion } from '@/app/types/mercado-publico.types';
import {
  indexarLicitacion, evaluarKeyword, normalizar, tokenizar,
  type LicitacionIndexada,
} from '@/app/lib/text-match';

export interface KwRow { id: number; usuario_id: number; keyword: string }
export interface KeywordsRadar { positivas: KwRow[]; negativas: KwRow[] }

const INSERT_BATCH = 200;

// ── Cargar keywords activas, separadas en positivas y negativas ───────────────
// Degrada con gracia si la columna es_negativa no existe (migración 30 pendiente):
// en ese caso todas se tratan como positivas.
export async function cargarKeywordsRadar(): Promise<KeywordsRadar> {
  try {
    const [rows] = await pool.query(
      `SELECT pk.id, pk.usuario_id, pk.keyword, pk.es_negativa
       FROM palabras_clave pk
       JOIN usuarios u ON u.id = pk.usuario_id AND u.activo = TRUE
       WHERE pk.activo = TRUE
       ORDER BY ISNULL(pk.ultima_busqueda) DESC, pk.ultima_busqueda ASC, pk.id ASC`,
    );
    const positivas: KwRow[] = [];
    const negativas: KwRow[] = [];
    for (const r of rows as any[]) {
      const kw: KwRow = { id: r.id, usuario_id: r.usuario_id, keyword: r.keyword };
      if (Number(r.es_negativa) === 1) negativas.push(kw);
      else positivas.push(kw);
    }
    return { positivas, negativas };
  } catch {
    // Sin columna es_negativa → todas positivas.
    const [rows] = await pool.query(
      `SELECT pk.id, pk.usuario_id, pk.keyword
       FROM palabras_clave pk
       JOIN usuarios u ON u.id = pk.usuario_id AND u.activo = TRUE
       WHERE pk.activo = TRUE
       ORDER BY ISNULL(pk.ultima_busqueda) DESC, pk.ultima_busqueda ASC, pk.id ASC`,
    );
    return { positivas: rows as KwRow[], negativas: [] };
  }
}

// ── Campos buscables de una licitación para el matcher ────────────────────────
export function camposDe(lic: Licitacion) {
  const items     = (lic.Items || []).map(it => `${it.NombreProducto || ''} ${it.Descripcion || ''}`).join(' ');
  const categoria = (lic.Items || []).map(it => it.Categoria || '').join(' ');
  return {
    nombre:      lic.Nombre || '',
    descripcion: lic.Descripcion || '',
    items,
    categoria,
  };
}

// ¿La licitación (ya indexada) calza alguna de las keywords negativas? → excluir.
export function estaExcluidaPorNegativas(idx: LicitacionIndexada, negativas: KwRow[]): KwRow | null {
  for (const neg of negativas) {
    if (evaluarKeyword(idx, neg.keyword).match) return neg;
  }
  return null;
}

// ── Contexto del match (snippet) — acento-insensible ──────────────────────────
function contieneAlgunToken(texto: string, kwTokens: string[]): boolean {
  const palabras = new Set(normalizar(texto).split(' ').filter(Boolean));
  return kwTokens.some(t =>
    palabras.has(t) || (t.length >= 4 && [...palabras].some(w => w.startsWith(t) || (t.length >= 6 && w.includes(t)))),
  );
}
function snippetAlrededor(texto: string, kwTokens: string[]): string {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const idx = palabras.findIndex(w => {
    const n = normalizar(w);
    return kwTokens.some(t => n === t || (t.length >= 4 && (n.startsWith(t) || (t.length >= 6 && n.includes(t)))));
  });
  if (idx === -1) return '';
  const start = Math.max(0, idx - 8);
  const end   = Math.min(palabras.length, idx + 9);
  return (start > 0 ? '…' : '') + palabras.slice(start, end).join(' ').trim() + (end < palabras.length ? '…' : '');
}
export function extraerContexto(lic: Licitacion, keyword: string): string {
  const kwTokens = tokenizar(keyword);
  if (kwTokens.length === 0) return '';
  if (contieneAlgunToken(lic.Nombre || '', kwTokens)) return '';
  const candidatos = [
    lic.Descripcion || '',
    ...(lic.Items || []).map(it => `${it.NombreProducto || ''} ${it.Descripcion || ''} ${it.Categoria || ''}`),
  ];
  for (const texto of candidatos) {
    const ctx = snippetAlrededor(texto, kwTokens);
    if (ctx) return ctx;
  }
  return '';
}

// ── INSERT de alertas por lote (con fallbacks por columnas faltantes) ──────────
export interface Coincidencia { lic: Licitacion; fuente: string; contexto: string; score: number }

export async function insertarAlertas(kw: KwRow, coincidencias: Coincidencia[]): Promise<number> {
  if (coincidencias.length === 0) return 0;
  let total = 0;

  for (let start = 0; start < coincidencias.length; start += INSERT_BATCH) {
    const chunk = coincidencias.slice(start, start + INSERT_BATCH);
    try {
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      const values: unknown[] = [];
      for (const { lic, fuente, contexto, score } of chunk) {
        values.push(
          kw.usuario_id, kw.id, kw.keyword, lic.Codigo,
          lic.Nombre?.substring(0, 500)    ?? null,
          lic.Organismo?.substring(0, 500) || null,
          lic.MontoEstimado                || null,
          lic.FechaCierre      ? new Date(lic.FechaCierre)      : null,
          lic.FechaPublicacion ? new Date(lic.FechaPublicacion) : null,
          lic.EstadoNombre || lic.Estado   || null,
          lic.Region                       || null,
          (lic.Tipo || '').substring(0, 20) || null,
          fuente, contexto || null,
          Number.isFinite(score) ? Number(score.toFixed(3)) : null,
        );
      }
      const [res] = await pool.query(
        `INSERT INTO alertas_licitaciones
           (usuario_id, palabra_clave_id, keyword_texto, licitacion_codigo,
            licitacion_nombre, licitacion_organismo, licitacion_monto,
            licitacion_cierre, licitacion_fecha_publicacion,
            licitacion_estado, licitacion_region,
            licitacion_tipo, match_fuente, match_contexto, match_score)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           licitacion_organismo       = IF(licitacion_organismo IS NULL OR licitacion_organismo = '', VALUES(licitacion_organismo), licitacion_organismo),
           licitacion_monto           = IF(licitacion_monto IS NULL, VALUES(licitacion_monto), licitacion_monto),
           licitacion_region          = IF(licitacion_region IS NULL OR licitacion_region = '', VALUES(licitacion_region), licitacion_region),
           licitacion_tipo            = IF(licitacion_tipo IS NULL OR licitacion_tipo = '', VALUES(licitacion_tipo), licitacion_tipo),
           licitacion_fecha_publicacion = IF(licitacion_fecha_publicacion IS NULL, VALUES(licitacion_fecha_publicacion), licitacion_fecha_publicacion),
           licitacion_estado          = COALESCE(VALUES(licitacion_estado), licitacion_estado),
           match_contexto             = IF(match_contexto IS NULL, VALUES(match_contexto), match_contexto),
           match_score                = GREATEST(COALESCE(match_score, 0), COALESCE(VALUES(match_score), 0))`,
        values,
      ) as any[];
      total += Math.min((res as any).affectedRows ?? 0, chunk.length);
    } catch (e: any) {
      if (!String(e).toLowerCase().includes('unknown column')) continue;
      // Fallback: sin match_score
      try {
        const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
        const values: unknown[] = [];
        for (const { lic, fuente, contexto } of chunk) {
          values.push(
            kw.usuario_id, kw.id, kw.keyword, lic.Codigo,
            lic.Nombre?.substring(0, 500)    ?? null,
            lic.Organismo?.substring(0, 500) || null,
            lic.MontoEstimado                || null,
            lic.FechaCierre      ? new Date(lic.FechaCierre)      : null,
            lic.FechaPublicacion ? new Date(lic.FechaPublicacion) : null,
            lic.EstadoNombre || lic.Estado   || null,
            lic.Region                       || null,
            (lic.Tipo || '').substring(0, 20) || null,
            fuente, contexto || null,
          );
        }
        const [res] = await pool.query(
          `INSERT INTO alertas_licitaciones
             (usuario_id, palabra_clave_id, keyword_texto, licitacion_codigo,
              licitacion_nombre, licitacion_organismo, licitacion_monto,
              licitacion_cierre, licitacion_fecha_publicacion,
              licitacion_estado, licitacion_region,
              licitacion_tipo, match_fuente, match_contexto)
           VALUES ${placeholders}
           ON DUPLICATE KEY UPDATE
             licitacion_organismo = IF(licitacion_organismo IS NULL OR licitacion_organismo = '', VALUES(licitacion_organismo), licitacion_organismo),
             licitacion_estado    = COALESCE(VALUES(licitacion_estado), licitacion_estado),
             match_contexto       = IF(match_contexto IS NULL, VALUES(match_contexto), match_contexto)`,
          values,
        ) as any[];
        total += Math.min((res as any).affectedRows ?? 0, chunk.length);
      } catch { /* silencioso */ }
    }
  }
  return total;
}

// ── Corregir datos REALES desde el detalle (fecha de publicación, etc.) ───────
// La API solo entrega la FechaPublicacion REAL en el objeto Fechas del detalle
// (?codigo=), nunca en el batch. El cron, al no tenerla, guardaba un fallback (la
// fecha de consulta) → fecha de publicación FALSA. Como el ON DUPLICATE solo
// rellena si está NULL, esa fecha falsa nunca se corregía. Aquí, al enriquecer
// (ya tenemos el detalle), SOBREESCRIBIMOS la fecha de publicación con la real en
// TODAS las alertas de esa licitación, y rellenamos organismo/región/monto si
// faltaban. Idempotente: la fecha de publicación de MP no cambia.
export async function corregirCamposDesdeDetalle(lics: Licitacion[]): Promise<number> {
  // Solo las que traen fecha de publicación real válida.
  const conFecha = lics.filter(l => {
    if (!l.Codigo || !l.FechaPublicacion) return false;
    return !isNaN(new Date(l.FechaPublicacion).getTime());
  });
  if (conFecha.length === 0) return 0;

  // CLAVE DE RENDIMIENTO: un ÚNICO UPDATE por lote con CASE, no N updates.
  // El índice de alertas sobre licitacion_codigo es compuesto (usuario_id, codigo),
  // así que `WHERE licitacion_codigo = ?` no lo usa → cada UPDATE suelto era un
  // escaneo completo de la tabla (~2 s c/u) y saturaba el pool. Con un solo UPDATE
  // `WHERE licitacion_codigo IN (...)` hacemos UN escaneo por lote (12×) y un viaje.
  const codigos = conFecha.map(l => l.Codigo);
  const ph = codigos.map(() => '?').join(',');
  const casePub = conFecha.map(() => 'WHEN ? THEN ?').join(' ');
  const params: unknown[] = [];
  for (const l of conFecha) params.push(l.Codigo, new Date(l.FechaPublicacion));

  try {
    const [res] = await pool.query(
      `UPDATE alertas_licitaciones
       SET licitacion_fecha_publicacion = CASE licitacion_codigo ${casePub} ELSE licitacion_fecha_publicacion END
       WHERE licitacion_codigo IN (${ph})`,
      [...params, ...codigos],
    ) as any[];
    return (res as any).affectedRows ?? 0;
  } catch {
    // Si falta la columna fecha_publicacion (migración antigua pendiente), no rompe.
    return 0;
  }
}

// ── Matchear un conjunto de licitaciones contra TODAS las keywords ────────────
// Aplica exclusión por negativas, inserta alertas e informa qué códigos pegaron.
// Devuelve: alertas nuevas insertadas + set de códigos con match positivo (no excluidos).
export interface ResultadoMatchLote {
  alertasNuevas: number;
  codigosConMatch: Set<string>;
  excluidasPorNegativa: number;
  fechasCorregidas: number;
}

export async function matchearEInsertar(
  lics: Licitacion[],
  keywords: KeywordsRadar,
): Promise<ResultadoMatchLote> {
  const indices = new Map<string, LicitacionIndexada>(
    lics.map(l => [l.Codigo, indexarLicitacion(camposDe(l))]),
  );

  // 1) Excluir por negativas (una pasada).
  const excluidos = new Set<string>();
  if (keywords.negativas.length > 0) {
    for (const l of lics) {
      if (estaExcluidaPorNegativas(indices.get(l.Codigo)!, keywords.negativas)) excluidos.add(l.Codigo);
    }
  }

  // 2) Matchear positivas e insertar alertas.
  let alertasNuevas = 0;
  const codigosConMatch = new Set<string>();
  for (const kw of keywords.positivas) {
    const coincidencias: Coincidencia[] = [];
    for (const lic of lics) {
      if (excluidos.has(lic.Codigo)) continue; // negativa manda
      const r = evaluarKeyword(indices.get(lic.Codigo)!, kw.keyword);
      if (!r.match) continue;
      codigosConMatch.add(lic.Codigo);
      coincidencias.push({
        lic,
        fuente:   r.fuentes.join(',') || 'titulo',
        contexto: extraerContexto(lic, kw.keyword),
        score:    r.score,
      });
    }
    if (coincidencias.length > 0) {
      const insertadas = await insertarAlertas(kw, coincidencias);
      alertasNuevas += insertadas;
      // Actualizar contadores de la keyword (best-effort).
      try {
        await pool.query(
          `UPDATE palabras_clave
           SET ultima_busqueda = NOW(),
               resultados_nuevos = resultados_nuevos + ?,
               total_encontradas = total_encontradas + ?
           WHERE id = ?`,
          [insertadas, coincidencias.length, kw.id],
        );
      } catch { /* silencioso */ }
    }
  }

  // 3) Corregir la fecha de publicación REAL (y campos faltantes) en las alertas
  //    existentes de estas licitaciones — ahora que tenemos el detalle enriquecido.
  const fechasCorregidas = await corregirCamposDesdeDetalle(lics);

  return { alertasNuevas, codigosConMatch, excluidasPorNegativa: excluidos.size, fechasCorregidas };
}
