// app/lib/pipeline-licitacion.ts
// Orquesta el procesamiento completo de una licitación tras descargar sus documentos:
//   Fase 1 (clasificar/encajonar) → Análisis exhaustivo IA → Fase 2 (viabilidad).
// Cada paso es best-effort: si uno falla, los siguientes intentan continuar.

import pool from '@/app/lib/db';
import { clasificarLicitacion } from '@/app/lib/clasificacion';
import { tieneAnalisisExhaustivo, generarAnalisisExhaustivo, generarAnalisisExhaustivoFusionado } from '@/app/lib/analisis-exhaustivo';
import { calcularYGuardarViabilidad, ViabilidadResult } from '@/app/lib/viabilidad';
import { ViabilidadJuicioIA } from '@/app/lib/gemini';

// Pipeline FUSIONADO (por defecto ON): clasificación + análisis + juicio de viabilidad en UNA
// llamada al LLM (elimina la llamada de clasificación y la del juicio). Poner
// IA_PIPELINE_FUSIONADO=0 en el entorno revierte al pipeline clásico de 3 pasos separados.
const PIPELINE_FUSIONADO = process.env.IA_PIPELINE_FUSIONADO !== '0';

// ¿La licitación fue EXCLUIDA por el prefiltro (Fase 0)?
// Si lo está, NO se gasta clasificación/análisis/viabilidad en ella.
// Ante cualquier duda (tabla inexistente, sin decisión, error) → false (no bloquear).
async function estaExcluidaPorPrefiltro(codigo: string): Promise<boolean> {
  try {
    const [rows] = await pool.query(
      `SELECT decision FROM prefiltro_licitacion WHERE licitacion_codigo = ? LIMIT 1`,
      [codigo],
    );
    return ((rows as any[])[0]?.decision || '').toUpperCase() === 'EXCLUIDO';
  } catch {
    return false; // tabla puede no existir (migración 21 pendiente) → no bloquear
  }
}

// ¿Hay documentos sin clasificar (categoria NULL)?
async function faltaClasificar(codigo: string): Promise<boolean> {
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS sinCat FROM documentos_cache
       WHERE licitacion_codigo = ? AND (categoria IS NULL OR categoria = '')`,
      [codigo],
    );
    return Number((rows as any[])[0]?.sinCat ?? 0) > 0;
  } catch {
    return true; // si la columna no existe, intentar clasificar igual
  }
}

export interface ResultadoPipeline {
  ok: boolean;
  error?: string;
  viabilidad?: ViabilidadResult | null;
}

// Procesa una licitación de punta a punta. `forzar` re-genera el análisis aunque exista.
export async function procesarLicitacionCompleta(
  codigo: string,
  opts: { forzar?: boolean } = {},
): Promise<ResultadoPipeline> {
  // 0. Gate de prefiltro — si fue EXCLUIDA, no se procesa (ni clasificación ni viabilidad).
  //    `forzar` permite re-procesar manualmente aunque esté excluida.
  if (!opts.forzar && await estaExcluidaPorPrefiltro(codigo)) {
    return { ok: false, error: 'Licitación EXCLUIDA por el prefiltro (Fase 0).' };
  }

  // Juicio de viabilidad obtenido en el análisis fusionado (si aplica) → evita otra llamada IA.
  let juicioFusionado: ViabilidadJuicioIA | null | undefined;

  if (PIPELINE_FUSIONADO) {
    // Ruta FUSIONADA: clasificación + análisis + juicio en UNA llamada.
    if (opts.forzar || !(await tieneAnalisisExhaustivo(codigo))) {
      try {
        const r = await generarAnalisisExhaustivoFusionado(codigo);
        if (!r.ok) return { ok: false, error: r.error };
        juicioFusionado = r.juicio;
      } catch (e: any) {
        console.error(`[pipeline] Análisis fusionado falló para ${codigo}:`, String(e?.message ?? e).slice(0, 200));
        return { ok: false, error: `Análisis falló: ${String(e?.message ?? e).slice(0, 150)}` };
      }
    } else if (await faltaClasificar(codigo)) {
      // Análisis ya existe (de una corrida previa) pero faltan categorías → clasificar aparte.
      try { await clasificarLicitacion(codigo); }
      catch (e) { console.warn(`[pipeline] Clasificación (fallback) falló para ${codigo}:`, String(e).slice(0, 150)); }
    }
  } else {
    // Ruta CLÁSICA (3 pasos separados).
    // 1. Fase 1 — clasificar (solo si hay documentos sin categoría, para no re-extraer en vano)
    try {
      if (opts.forzar || await faltaClasificar(codigo)) {
        await clasificarLicitacion(codigo);
      }
    } catch (e) {
      console.warn(`[pipeline] Clasificación falló para ${codigo}:`, String(e).slice(0, 150));
    }

    // 2. Análisis exhaustivo (si falta o se fuerza). Blindado: si revienta (red/LLM), devuelve
    //    error estructurado en vez de propagar la excepción.
    if (opts.forzar || !(await tieneAnalisisExhaustivo(codigo))) {
      try {
        const r = await generarAnalisisExhaustivo(codigo);
        if (!r.ok) return { ok: false, error: r.error };
      } catch (e: any) {
        console.error(`[pipeline] Análisis exhaustivo falló para ${codigo}:`, String(e?.message ?? e).slice(0, 200));
        return { ok: false, error: `Análisis falló: ${String(e?.message ?? e).slice(0, 150)}` };
      }
    }
  }

  // 3. Fase 2 — viabilidad. Igualmente blindada. En modo fusionado reusa el juicio ya obtenido.
  try {
    const viabilidad = await calcularYGuardarViabilidad(codigo, { juicioPrecomputado: juicioFusionado });
    return { ok: !!viabilidad, viabilidad };
  } catch (e: any) {
    console.error(`[pipeline] Viabilidad falló para ${codigo}:`, String(e?.message ?? e).slice(0, 200));
    return { ok: false, error: `Viabilidad falló: ${String(e?.message ?? e).slice(0, 150)}` };
  }
}
