// app/api/prefiltro/analizar-pendientes/route.ts
// PROMPT 0 — procesa en lotes el prefiltro de las licitaciones del radar del usuario
// que aún NO tienen decisión de prefiltro. Espejo de /api/viabilidad/analizar-pendientes
// (llamadas sucesivas desde el cliente). La decisión es por código y compartida.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { prefiltrarYGuardar } from '@/app/lib/prefiltro';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function getUserId(req: NextRequest): number | null {
  const id = req.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}

// Códigos del usuario SIN decisión de prefiltro todavía. Devuelve count o lista.
async function pendientesQuery(userId: number, limit?: number): Promise<string[]> {
  const sql =
    `SELECT DISTINCT al.licitacion_codigo
     FROM alertas_licitaciones al
     WHERE al.usuario_id = ?
       AND NOT EXISTS (SELECT 1 FROM prefiltro_licitacion pf WHERE pf.licitacion_codigo = al.licitacion_codigo)
     ORDER BY COALESCE(al.licitacion_fecha_publicacion, al.licitacion_cierre, al.created_at) DESC`
    + (limit ? ` LIMIT ?` : '');
  const params = limit ? [userId, limit] : [userId];
  const [rows] = await pool.query(sql, params) as any[];
  return (rows as any[]).map(r => r.licitacion_codigo as string);
}

// GET — cuántas licitaciones quedan por prefiltrar
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    const pendientes = await pendientesQuery(userId);
    return NextResponse.json({ pendientes: pendientes.length });
  } catch (e: any) {
    // Si la tabla prefiltro_licitacion no existe aún (migración 21 pendiente), no romper el radar
    return NextResponse.json({ pendientes: 0, error: e.message });
  }
}

// POST — procesa el siguiente lote. Body: { lote?: number } (default 30)
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { lote = 30 } = await request.json().catch(() => ({}));

  try {
    const codigos = await pendientesQuery(userId, lote);
    if (codigos.length === 0) {
      return NextResponse.json({ completado: true, procesados: [], pendientes: 0 });
    }

    const results = await prefiltrarYGuardar(codigos);
    const procesados = results.map(r => ({
      codigo: r.codigo, decision: r.decision, categoria: r.categoria, confianza: r.confianza,
    }));

    const restantes = await pendientesQuery(userId);
    return NextResponse.json({ completado: restantes.length === 0, procesados, pendientes: restantes.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
