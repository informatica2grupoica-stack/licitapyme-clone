// app/api/cron/viabilidad/route.ts
// Analiza en lotes la viabilidad de las licitaciones que YA tienen documentos descargados,
// pasaron el prefiltro y siguen SIN viabilidad calculada.
//
// POR QUÉ EXISTE (y no se reusó /api/viabilidad/analizar-pendientes): ese endpoint es POR
// USUARIO — exige x-user-id y filtra por las alertas de ese perfil, así que el scheduler (que
// se autentica con CRON_SECRET, sin sesión) no puede llamarlo. Éste hace lo mismo pero a nivel
// de SISTEMA: recorre el conjunto completo sin importar de quién sea la alerta.
//
// Conjunto objetivo = exactamente la "clase A" del doctor del pipeline (scripts/doctor-pipeline.mts):
// tiene documentos legibles, no está excluida por prefiltro, y no tiene viabilidad. Es un conjunto
// que se AUTOVACÍA (cada análisis exitoso sale de la lista), así que no se recalcula nada dos veces.
//
// CONTROL DE COSTO: cada licitación es una llamada a la IA. Por eso va por lotes chicos
// (`lote`, default 3) y con tope duro por corrida (`max`, default 12). El scheduler loopea
// mientras queden pendientes, pero cada pasada respeta el tope.
// Priorización: las de cierre más PRÓXIMO primero (las que aún se pueden postular).
//
// Protección (igual que los otros cron): x-vercel-cron:1 · Bearer <CRON_SECRET> · ?secret= · x-cron-secret.
// GET → cuántas quedan (healthcheck). POST → procesa un lote.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { procesarLicitacionCompleta } from '@/app/lib/pipeline-licitacion';
import { AUTOMATIZACION_PAUSADA } from '@/app/lib/automatizacion';
import { ahoraChileSQL } from '@/app/lib/tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_POR_CORRIDA = 12;   // tope duro de análisis IA por pasada (control de costo)
const PRESUPUESTO_MS  = 240_000; // margen bajo maxDuration

function autorizado(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const secret =
    req.nextUrl.searchParams.get('secret') ||
    req.headers.get('x-cron-secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

// Gate de prefiltro (Fase 0): solo PASA / REVISION_HUMANA. Las EXCLUIDO no deberían tener
// documentos (gate en descarga), pero se refuerza acá.
// (prefiltro_licitacion y alertas_licitaciones comparten charset+collation → comparación directa)
const GATE_PREFILTRO =
  `AND EXISTS (
     SELECT 1 FROM prefiltro_licitacion pf
     WHERE pf.licitacion_codigo = al.licitacion_codigo
       AND pf.decision IN ('PASA','REVISION_HUMANA')
   )`;

/**
 * Códigos con documentos, que pasaron el prefiltro y no tienen viabilidad — de TODO el sistema
 * (sin filtro por usuario). Cierre más próximo primero; las ya vencidas al final (no se pueden
 * postular, pero igual sirven para el histórico).
 * Si prefiltro_licitacion no existe (migración 21 pendiente) → fallback sin gate.
 *
 * (26-ago-2026: ya NO hace falta convertir el charset acá. `documentos_cache.licitacion_codigo`
 * estuvo en utf8/utf8_unicode_ci mientras el resto era utf8mb4 — la migración-78 unificó toda la
 * base a utf8mb4_general_ci, así que la comparación directa ya usa el índice sin coerción.)
 */
// Corta el reintento infinito: una licitación que falla siempre (documentos ilegibles, PDF
// corrupto, modelo que no logra el JSON) volvería a salir en TODAS las pasadas y el cron la
// reintentaría para siempre, gastando IA cada vez. A partir de MAX_INTENTOS sale de la cola
// automática y queda en `pipeline_fallos` para que el doctor la mire. Re-analizarla a mano
// (botón "Re-analizar" de la ficha) sigue funcionando: ese camino no pasa por acá.
const MAX_INTENTOS = 3;
const GATE_FALLOS =
  `AND NOT EXISTS (
     SELECT 1 FROM pipeline_fallos pfa
     WHERE pfa.licitacion_codigo = al.licitacion_codigo
       AND pfa.intentos >= ${MAX_INTENTOS}
   )`;

async function pendientes(limit?: number, incluirVencidas = false): Promise<string[]> {
  // Comparar SIEMPRE contra ahoraChileSQL(), nunca contra NOW(): los cierres se guardan en hora
  // de pared chilena y el MySQL de Bluehost corre en otra zona (ver app/lib/tz.ts).
  const ahora = ahoraChileSQL();
  const sql = (gatePrefiltro: string, gateFallos: string) =>
    `SELECT al.licitacion_codigo, MIN(al.licitacion_cierre) AS cierre
       FROM alertas_licitaciones al
      WHERE EXISTS (
              SELECT 1 FROM documentos_cache dc
               WHERE dc.licitacion_codigo = al.licitacion_codigo)
        AND NOT EXISTS (
              SELECT 1 FROM viabilidad_licitacion v
               WHERE v.licitacion_codigo = al.licitacion_codigo)
        ${incluirVencidas ? '' : 'AND (al.licitacion_cierre IS NULL OR al.licitacion_cierre > ?)'}
        ${gatePrefiltro}
        ${gateFallos}
      GROUP BY al.licitacion_codigo
      ORDER BY (MIN(al.licitacion_cierre) < ?), MIN(al.licitacion_cierre) ASC` +
    (limit ? ` LIMIT ${Number(limit)}` : '');
  const params = incluirVencidas ? [ahora] : [ahora, ahora];

  // Degradación por migración pendiente: se prueba con ambos gates y se van soltando los que
  // dependen de una tabla que todavía no existe (21 = prefiltro, 57 = pipeline_fallos).
  const variantes: Array<[string, string]> = [
    [GATE_PREFILTRO, GATE_FALLOS],
    [GATE_PREFILTRO, ''],
    ['', GATE_FALLOS],
    ['', ''],
  ];
  let ultimoError: any;
  for (const [gp, gf] of variantes) {
    try {
      const [rows] = await pool.query(sql(gp, gf), params) as any[];
      return (rows as any[]).map(r => r.licitacion_codigo as string);
    } catch (e: any) {
      const msg = String(e).toLowerCase();
      if (!msg.includes('prefiltro_licitacion') && !msg.includes('pipeline_fallos')) throw e;
      ultimoError = e;
    }
  }
  throw ultimoError;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    // GET informa ambos universos: lo que el cron va a tomar (vigentes) y el backlog total.
    const [vigentes, todas] = await Promise.all([pendientes(), pendientes(undefined, true)]);
    return NextResponse.json({ ok: true, pendientes: vigentes.length, pendientesConVencidas: todas.length });
  } catch (e: any) {
    return NextResponse.json({ ok: true, pendientes: 0, error: e.message });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  // Modo manual (NEXT_PUBLIC_AUTOMATIZACION_PAUSADA): no gastar IA sin que nadie lo pida.
  // El scheduler ya lo respeta, pero se refuerza acá: este endpoint gasta IA por licitación
  // y puede llamarse a mano con el secret.
  if (AUTOMATIZACION_PAUSADA) {
    return NextResponse.json({ success: true, pausada: true, completado: true, pendientes: 0, procesados: [] });
  }

  const body = await req.json().catch(() => ({} as any));
  const lote = Math.min(Number(body?.lote) || 3, MAX_POR_CORRIDA);
  // Por defecto SOLO VIGENTES. Medido en la base real (2026-07-30): 1.414 licitaciones con
  // documentos y sin viabilidad, de las cuales apenas 52 tienen cierre futuro. Analizar las
  // 1.362 vencidas serían 1.362 llamadas de IA pagadas por informes que ya no sirven para
  // postular. El backlog histórico se procesa a pedido con { incluirVencidas: true }.
  const incluirVencidas = body?.incluirVencidas === true;
  const t0 = Date.now();

  try {
    const codigos = await pendientes(lote, incluirVencidas);
    if (codigos.length === 0) {
      return NextResponse.json({ success: true, completado: true, pendientes: 0, procesados: [] });
    }

    const procesados: { codigo: string; exito: boolean; semaforo?: string; score?: number; error?: string }[] = [];
    for (const codigo of codigos) {
      if (Date.now() - t0 > PRESUPUESTO_MS) break; // sin tiempo → el resto queda para la próxima pasada
      try {
        const r = await procesarLicitacionCompleta(codigo);
        if (!r.ok || !r.viabilidad) {
          // El fallo ya quedó marcado en `pipeline_fallos` dentro del pipeline (migración 57).
          procesados.push({ codigo, exito: false, error: r.error || 'sin viabilidad' });
          continue;
        }
        procesados.push({
          codigo, exito: true,
          semaforo: r.viabilidad.score_viabilidad.semaforo,
          score: r.viabilidad.score_viabilidad.total,
        });
      } catch (e: any) {
        procesados.push({ codigo, exito: false, error: String(e?.message ?? e).slice(0, 200) });
      }
    }

    const restantes = (await pendientes(undefined, incluirVencidas)).length;
    const exitos = procesados.filter(p => p.exito).length;
    console.log(`[cron viabilidad] ${exitos}/${procesados.length} analizadas · ${restantes} pendientes · ${Date.now() - t0}ms`);

    return NextResponse.json({
      success: true,
      completado: restantes === 0,
      pendientes: restantes,
      procesados,
      duracionMs: Date.now() - t0,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
