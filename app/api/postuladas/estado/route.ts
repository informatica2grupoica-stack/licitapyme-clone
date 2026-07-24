// app/api/postuladas/estado/route.ts
// Devuelve, en UNA sola llamada, el estado de TODAS las postuladas del usuario:
//   · resultado de adjudicación (SOLO cache de la BD),
//   · si está APERTURADA (SOLO tabla licitacion_apertura).
//
// INSTANTÁNEO por diseño: NO consulta MP ni el portal en vivo (nada de red saliente). Solo
// lee lo que dejó el cron, con 2 consultas batcheadas a la BD. Así nunca se "queda pegada"
// esperando a Mercado Público. El refresco de adjudicaciones y aperturas lo hace el
// scheduler cada 2 horas (procesar-postuladas + detectar-aperturas).

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { tienePermiso } from '@/app/lib/api-auth';
import { respuestaDesdeCache, enriquecer } from '@/app/lib/adjudicacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null };
}

export async function GET(request: NextRequest) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    // Alcance por rol: admin ve todas; el resto solo las suyas (igual que /api/negocios).
    const verOtros = await tienePermiso(request, 'ver_otros_negocios').catch(() => false);
    // Universo = TODO lo que pasó por postulación (no solo las que siguen en POSTULADA): así
    // Postuladas y /adjudicadas comparten la MISMA fuente instantánea y sus conteos cuadran.
    const ESTADOS = `n.estado_pipeline IN ('POSTULADA','POSIBLE_ADJ','ADJUDICADA','PERDIDA')`;
    const where = verOtros
      ? `n.activo = TRUE AND ${ESTADOS}`
      : `n.activo = TRUE AND ${ESTADOS} AND n.asignado_a = ?`;
    const [rows] = await pool.query(
      `SELECT DISTINCT n.licitacion_codigo AS codigo FROM negocios n WHERE ${where}`,
      verOtros ? [] : [userId],
    ) as any[];
    const codigos = (rows as any[]).map(r => r.codigo).filter(Boolean) as string[];
    if (codigos.length === 0) return NextResponse.json({ estados: {} });

    const ph = codigos.map(() => '?').join(',');

    // 1) Adjudicación: leer TODO el cache en UNA consulta (sin tocar MP).
    const cachePorCodigo = new Map<string, any>();
    try {
      const [cacheRows] = await pool.query(
        `SELECT * FROM adjudicacion_cache WHERE licitacion_codigo IN (${ph})`,
        codigos,
      ) as any[];
      for (const r of cacheRows as any[]) cachePorCodigo.set(r.licitacion_codigo, r);
    } catch { /* tabla ausente → todo "en evaluación" */ }

    // 2) Apertura: leer TODO en UNA consulta (sin rascar el portal).
    const aperturaPorCodigo = new Map<string, boolean>();
    try {
      const [apRows] = await pool.query(
        `SELECT licitacion_codigo, aperturada FROM licitacion_apertura WHERE licitacion_codigo IN (${ph})`,
        codigos,
      ) as any[];
      for (const r of apRows as any[]) aperturaPorCodigo.set(r.licitacion_codigo, !!r.aperturada);
    } catch { /* migración pendiente → todo sin apertura */ }

    // Construir la respuesta. enriquecer() usa el set de RUT nuestros (memoizado) → sin IO extra.
    const estados: Record<string, any> = {};
    for (const codigo of codigos) {
      const row = cachePorCodigo.get(codigo);
      const adj = row ? await enriquecer(respuestaDesdeCache(codigo, row)) : null;
      const esAdjudicada = !!adj?.esAdjudicada;
      estados[codigo] = {
        // BUG real (24-jul-2026): esta entrada se creaba SIEMPRE, con esAdjudicada=false cuando
        // no había fila en adjudicacion_cache. El frontend (resultadoDeNegocio) usa `if (a) …`
        // para decidir si confía en MP o cae al estado_pipeline propio — como `a` nunca era
        // null/undefined, el fallback interno JAMÁS se ejecutaba: toda postulada sin caché de
        // adjudicación (p. ej. un backfill histórico desde Licitalab, o cualquier ADJUDICADA/
        // PERDIDA a la que el cron aún no le tocó el turno) se mostraba como "En evaluación"
        // aunque estado_pipeline ya dijera lo contrario. `tieneCacheReal` distingue ambos casos
        // sin tocar `aperturada` (que sigue siendo válido aunque no haya adjudicación aún).
        tieneCacheReal: !!row,
        esAdjudicada,
        estado: adj?.estado ?? null,
        codigoEstado: adj?.codigoEstado ?? null,
        ganamos: !!adj?.ganamos,
        montoNuestro: adj?.montoNuestro ?? null,
        montoAdjudicadoTotal: adj?.montoAdjudicadoTotal ?? null,
        fechaAdjudicacion: adj?.fechaAdjudicacion ?? null,
        // Fechas estimadas de la ficha (planificación del organismo) — para ordenar y mostrar
        // "cuándo se decide cada una" en /postuladas, aunque aún no haya resultado.
        fechaEstimadaAdjudicacion: adj?.fechaEstimadaAdjudicacion ?? null,
        fechaAperturaTecnica: adj?.fechaAperturaTecnica ?? null,
        adjudicacion: adj?.adjudicacion ?? null,
        lineasAdjudicadas: adj?.lineasAdjudicadas ?? [],
        // Una ADJUDICADA ya pasó por apertura por definición.
        aperturada: esAdjudicada || aperturaPorCodigo.get(codigo) ? 1 : 0,
      };
    }

    return NextResponse.json({ estados });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
