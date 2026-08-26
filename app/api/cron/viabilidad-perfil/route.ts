// app/api/cron/viabilidad-perfil/route.ts
// PILOTO (2026-08): analiza viabilidad automáticamente para las licitaciones ASIGNADAS Y ACTIVAS
// de los perfiles que tengan el permiso `viabilidad_automatica` (ver app/lib/api-auth.ts). Empieza
// con un solo perfil (el "Asesor") para validar costo/calidad antes de ofrecerlo a todos.
//
// POR QUÉ UN CRON APARTE (y no ampliar /api/cron/viabilidad): ese cron ya recorre TODO el sistema
// por orden de cierre, sin importar de quién es la asignación — las licitaciones del piloto ya
// caen ahí tarde o temprano, pero compitiendo por el mismo cupo (MAX_POR_CORRIDA=12) con miles de
// licitaciones sin dueño. Este cron es el canal dedicado del piloto: mismo motor
// (`procesarLicitacionCompleta`), mismos gates de prefiltro/fallos, pero prioriza SIEMPRE lo
// asignado a un perfil con el permiso activo, con su propio presupuesto chico (control de costo
// mientras se valida con un solo perfil).
//
// Universo = negocios.activo=TRUE AND estado_pipeline <> 'DESCARTADA' de un usuario con
// permisos.viabilidad_automatica=true, con documentos, que pasó el prefiltro y sin viabilidad aún.
// Se autovacía igual que el cron de sistema: cada análisis exitoso sale de la lista.
//
// Protección: mismo esquema que los demás cron (x-vercel-cron:1 · Bearer <CRON_SECRET> · ?secret= · x-cron-secret).
// GET → cuántas quedan (healthcheck). POST → procesa un lote.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { procesarLicitacionCompleta } from '@/app/lib/pipeline-licitacion';
import { AUTOMATIZACION_PAUSADA } from '@/app/lib/automatizacion';
import { ahoraChileSQL } from '@/app/lib/tz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_POR_CORRIDA = 6;    // universo chico (un solo perfil piloto) → tope bajo
const PRESUPUESTO_MS  = 240_000;

function autorizado(req: NextRequest): boolean {
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const secret =
    req.nextUrl.searchParams.get('secret') ||
    req.headers.get('x-cron-secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

// Mismo gate de prefiltro que el cron de sistema (Fase 0): solo PASA / REVISION_HUMANA.
const GATE_PREFILTRO =
  `AND EXISTS (
     SELECT 1 FROM prefiltro_licitacion pf
     WHERE pf.licitacion_codigo = n.licitacion_codigo
       AND pf.decision IN ('PASA','REVISION_HUMANA')
   )`;

// Mismo corte de reintento infinito que el cron de sistema (migración 57).
const MAX_INTENTOS = 3;
const GATE_FALLOS =
  `AND NOT EXISTS (
     SELECT 1 FROM pipeline_fallos pfa
     WHERE pfa.licitacion_codigo = n.licitacion_codigo
       AND pfa.intentos >= ${MAX_INTENTOS}
   )`;

// permisos.viabilidad_automatica=true — JSON_UNQUOTE+->> por compatibilidad con MySQL 5.7 de Bluehost.
const GATE_PERMISO =
  `AND JSON_UNQUOTE(JSON_EXTRACT(u.permisos, '$.viabilidad_automatica')) = 'true'`;

// Mismo set que RESUELTOS_CARGA de app/api/negocios/route.ts:170 — "vigente" = en trabajo, no
// resuelta. Una licitación ya postulada/adjudicada/perdida no necesita viabilidad automática:
// esa decisión ya se tomó (a mano o antes de que existiera este piloto).
const ESTADOS_RESUELTOS = `'POSTULADA','DESCARTADA','ADJUDICADA','POSIBLE_ADJ','PERDIDA'`;

async function pendientes(limit?: number, incluirVencidas = false): Promise<string[]> {
  const ahora = ahoraChileSQL();
  const sql = (gatePrefiltro: string, gateFallos: string) =>
    `SELECT n.licitacion_codigo, MIN(n.licitacion_cierre) AS cierre
       FROM negocios n
       JOIN usuarios u ON u.id = n.asignado_a
      WHERE n.activo = TRUE
        AND n.estado_pipeline NOT IN (${ESTADOS_RESUELTOS})
        ${GATE_PERMISO}
        AND EXISTS (
              SELECT 1 FROM documentos_cache dc
               WHERE dc.licitacion_codigo = n.licitacion_codigo)
        AND NOT EXISTS (
              SELECT 1 FROM viabilidad_licitacion v
               WHERE v.licitacion_codigo = n.licitacion_codigo)
        ${incluirVencidas ? '' : 'AND (n.licitacion_cierre IS NULL OR n.licitacion_cierre > ?)'}
        ${gatePrefiltro}
        ${gateFallos}
      GROUP BY n.licitacion_codigo
      ORDER BY (MIN(n.licitacion_cierre) < ?), MIN(n.licitacion_cierre) ASC` +
    (limit ? ` LIMIT ${Number(limit)}` : '');
  const params = incluirVencidas ? [ahora] : [ahora, ahora];

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
    const [vigentes, todas] = await Promise.all([pendientes(), pendientes(undefined, true)]);
    return NextResponse.json({ ok: true, pendientes: vigentes.length, pendientesConVencidas: todas.length });
  } catch (e: any) {
    return NextResponse.json({ ok: true, pendientes: 0, error: e.message });
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  if (AUTOMATIZACION_PAUSADA) {
    return NextResponse.json({ success: true, pausada: true, completado: true, pendientes: 0, procesados: [] });
  }

  const body = await req.json().catch(() => ({} as any));
  const lote = Math.min(Number(body?.lote) || 2, MAX_POR_CORRIDA);
  const incluirVencidas = body?.incluirVencidas === true;
  const t0 = Date.now();

  try {
    const codigos = await pendientes(lote, incluirVencidas);
    if (codigos.length === 0) {
      return NextResponse.json({ success: true, completado: true, pendientes: 0, procesados: [] });
    }

    const procesados: { codigo: string; exito: boolean; semaforo?: string; score?: number; error?: string }[] = [];
    for (const codigo of codigos) {
      if (Date.now() - t0 > PRESUPUESTO_MS) break;
      try {
        const r = await procesarLicitacionCompleta(codigo);
        if (!r.ok || !r.viabilidad) {
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
    console.log(`[cron viabilidad-perfil] ${exitos}/${procesados.length} analizadas · ${restantes} pendientes · ${Date.now() - t0}ms`);

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
