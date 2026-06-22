// app/api/viabilidad/analizar-pendientes/route.ts
// Procesa en lotes la viabilidad de TODAS las licitaciones del radar que ya tienen
// documentos descargados pero aún no tienen viabilidad calculada.
// Espejo de /api/documentos/descargar-pendientes (llamadas sucesivas desde el cliente).

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { procesarLicitacionCompleta } from '@/app/lib/pipeline-licitacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function getUserId(req: NextRequest): number | null {
  const id = req.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}

// Gate de prefiltro (Fase 0): solo se analiza viabilidad de PASA / REVISION_HUMANA.
// Las EXCLUIDO no deberían tener documentos (gate en descarga), pero lo reforzamos aquí.
const GATE_PREFILTRO =
  `AND EXISTS (
     SELECT 1 FROM prefiltro_licitacion pf
     WHERE pf.licitacion_codigo = al.licitacion_codigo
       AND pf.decision IN ('PASA','REVISION_HUMANA')
   )`;

// Códigos del usuario CON documentos, que pasaron el prefiltro, pero SIN viabilidad.
// Si la tabla prefiltro_licitacion no existe (migración 21 pendiente) → fallback sin gate.
async function pendientesQuery(userId: number, limit?: number): Promise<string[]> {
  const sql = (gate: string) =>
    `SELECT DISTINCT al.licitacion_codigo
     FROM alertas_licitaciones al
     WHERE al.usuario_id = ?
       AND EXISTS (SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = al.licitacion_codigo)
       AND NOT EXISTS (SELECT 1 FROM viabilidad_licitacion v WHERE v.licitacion_codigo = al.licitacion_codigo)
       ${gate}
     ORDER BY al.licitacion_cierre DESC` + (limit ? ` LIMIT ?` : '');
  const params = limit ? [userId, limit] : [userId];
  try {
    const [rows] = await pool.query(sql(GATE_PREFILTRO), params) as any[];
    return (rows as any[]).map(r => r.licitacion_codigo as string);
  } catch (e: any) {
    if (!String(e).toLowerCase().includes('prefiltro_licitacion')) throw e;
    const [rows] = await pool.query(sql(''), params) as any[];
    return (rows as any[]).map(r => r.licitacion_codigo as string);
  }
}

// GET — cuántas licitaciones quedan por analizar
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    const pendientes = await pendientesQuery(userId);
    return NextResponse.json({ pendientes: pendientes.length });
  } catch (e: any) {
    // Si la tabla viabilidad_licitacion no existe aún (migración pendiente), no romper el radar
    return NextResponse.json({ pendientes: 0, error: e.message });
  }
}

// POST — procesa el siguiente lote. Body: { lote?: number } (default 2)
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { lote = 2 } = await request.json().catch(() => ({}));

  try {
    const codigos = await pendientesQuery(userId, lote);
    if (codigos.length === 0) {
      return NextResponse.json({ completado: true, procesados: [], pendientes: 0 });
    }

    const procesados: { codigo: string; exito: boolean; semaforo?: string; score?: number; error?: string }[] = [];

    for (const codigo of codigos) {
      try {
        const r = await procesarLicitacionCompleta(codigo);
        if (!r.ok || !r.viabilidad) { procesados.push({ codigo, exito: false, error: r.error || 'sin viabilidad' }); continue; }
        procesados.push({ codigo, exito: true, semaforo: r.viabilidad.score_viabilidad.semaforo, score: r.viabilidad.score_viabilidad.total });
      } catch (e: any) {
        procesados.push({ codigo, exito: false, error: e.message });
      }
    }

    const restantes = await pendientesQuery(userId);
    return NextResponse.json({ completado: restantes.length === 0, procesados, pendientes: restantes.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
