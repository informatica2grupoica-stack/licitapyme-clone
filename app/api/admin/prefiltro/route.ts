// app/api/admin/prefiltro/route.ts
// Endpoint admin para pre-filtrar (o re-filtrar) TODAS las licitaciones del sistema.
// Protegido por CRON_SECRET. No requiere sesión de usuario.
//
// FLUJO (dos pasos por lote):
//   1. Enriquecer las que no tienen caché (llama a MP API para obtener descripción + ítems).
//   2. Prefiltrar con la metadata completa (nombre + descripción + ítems).
//
// GET  ?secret=...              → estado: total / con_prefiltro / pendientes
// POST ?secret=...              → procesa el siguiente lote
//   body: { lote?: number, reset?: boolean }
//   reset=true borra registros existentes (re-run completo con nuevo prompt v2.0)

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { prefiltrarYGuardar } from '@/app/lib/prefiltro';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { leerCache, enriquecerYCachear } from '@/app/lib/licitaciones-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function autenticado(req: NextRequest): boolean {
  const secret = req.nextUrl.searchParams.get('secret')
    || req.headers.get('x-cron-secret');
  return !!secret && secret === process.env.CRON_SECRET;
}

async function contarEstado(): Promise<{ total: number; con_prefiltro: number; pendientes: number }> {
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(DISTINCT licitacion_codigo) AS total FROM alertas_licitaciones`,
  ) as any[];
  const [[{ con_prefiltro }]] = await pool.query(
    `SELECT COUNT(*) AS con_prefiltro FROM prefiltro_licitacion`,
  ) as any[];
  const t = Number(total); const c = Number(con_prefiltro);
  return { total: t, con_prefiltro: c, pendientes: Math.max(0, t - c) };
}

export async function GET(req: NextRequest) {
  if (!autenticado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const estado = await contarEstado();
    return NextResponse.json(estado);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!autenticado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const { lote = 20, reset = false } = await req.json().catch(() => ({}));
  const loteReal = Math.min(lote, 50);

  try {
    // reset=true → borra todos los registros de prefiltro (re-correr con v2.0)
    if (reset) {
      await pool.query(`DELETE FROM prefiltro_licitacion`);
      console.log('[admin/prefiltro] Reset completo — todos los registros eliminados.');
    }

    // Siguiente lote de códigos SIN prefiltro (todos los usuarios, más recientes primero)
    const [rows] = await pool.query(
      `SELECT DISTINCT al.licitacion_codigo
       FROM alertas_licitaciones al
       WHERE NOT EXISTS (
         SELECT 1 FROM prefiltro_licitacion pf WHERE pf.licitacion_codigo = al.licitacion_codigo
       )
       ORDER BY COALESCE(al.licitacion_fecha_publicacion, al.licitacion_cierre, al.created_at) DESC
       LIMIT ?`,
      [loteReal],
    ) as any[];

    const codigos = (rows as any[]).map(r => r.licitacion_codigo as string);

    if (codigos.length === 0) {
      const estado = await contarEstado();
      return NextResponse.json({ completado: true, procesados: [], enriquecidas: 0, ...estado });
    }

    // ── Paso 1: Enriquecer las que NO tienen caché ──────────────────────────────
    // Si no hay ticket de MP configurado, se salta y trabaja con lo que haya en caché.
    let enriquecidas = 0;
    const tieneTicket = !!process.env.MERCADO_PUBLICO_TICKET;

    if (tieneTicket) {
      const cache = await leerCache(codigos);
      const sinCache = codigos.filter(c => !cache.has(c));

      if (sinCache.length > 0) {
        console.log(`[admin/prefiltro] Enriqueciendo ${sinCache.length} sin caché antes de prefiltrar...`);
        const client = getMercadoPublicoClient();
        const res = await enriquecerYCachear(client, sinCache, {
          maxMs: 200_000,     // hasta ~3 min para el enriquecimiento
          baseDelayMs: 1_200,
          maxDelayMs: 8_000,
          guardarCada: 5,
        });
        enriquecidas = res.enriquecidas;
        console.log(`[admin/prefiltro] Enriquecidas: ${enriquecidas}/${sinCache.length}`);
      }
    } else {
      console.warn('[admin/prefiltro] Sin MERCADO_PUBLICO_TICKET — prefiltro solo con nombre/caché existente.');
    }

    // ── Paso 2: Prefiltrar con metadata completa (caché ya actualizado) ─────────
    const results = await prefiltrarYGuardar(codigos);

    const procesados = results.map(r => ({
      codigo: r.codigo,
      decision: r.decision,
      categoria: r.categoria,
      pasada: r.pasada,
      confianza: r.confianza,
      destino: r.destino,
      motivo: r.motivo,
      evidencia: r.evidencia,
    }));

    const estado = await contarEstado();
    return NextResponse.json({
      completado: estado.pendientes === 0,
      procesados,
      enriquecidas,
      sinTicketMP: !tieneTicket,
      ...estado,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
