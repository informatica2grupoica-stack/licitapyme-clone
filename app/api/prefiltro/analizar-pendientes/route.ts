// app/api/prefiltro/analizar-pendientes/route.ts
// PROMPT 0 — procesa en lotes el prefiltro de las licitaciones del radar del usuario
// que aún NO tienen decisión de prefiltro. Espejo de /api/viabilidad/analizar-pendientes
// (llamadas sucesivas desde el cliente). La decisión es por código y compartida.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { prefiltrarYGuardar } from '@/app/lib/prefiltro';
import { getAuthedUser } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Ámbito del prefiltro:
//  • admin  → "super": prefiltra el radar COMPLETO de la empresa (todos los perfiles).
//    La decisión de prefiltro es por-código y compartida, así que un único run del admin
//    cubre a todos los usuarios. Se ignora usuario_id (WHERE 1 = 1).
//  • usuario → solo sus propias alertas.
// Espejo del scope de /api/alertas.
async function resolverAmbito(req: NextRequest): Promise<{ where: string; params: number[] } | null> {
  const u = await getAuthedUser(req);
  if (!u) return null;
  if (u.rol === 'admin') return { where: '1 = 1', params: [] };
  return { where: 'al.usuario_id = ?', params: [u.id] };
}

// Códigos SIN decisión de prefiltro todavía (según ámbito). Devuelve la lista.
async function pendientesQuery(where: string, scopeParams: number[], limit?: number): Promise<string[]> {
  const sql =
    `SELECT DISTINCT al.licitacion_codigo
     FROM alertas_licitaciones al
     WHERE ${where}
       AND NOT EXISTS (SELECT 1 FROM prefiltro_licitacion pf WHERE pf.licitacion_codigo = al.licitacion_codigo)
     ORDER BY COALESCE(al.licitacion_fecha_publicacion, al.licitacion_cierre, al.created_at) DESC`
    + (limit ? ` LIMIT ?` : '');
  const params = limit ? [...scopeParams, limit] : [...scopeParams];
  const [rows] = await pool.query(sql, params) as any[];
  return (rows as any[]).map(r => r.licitacion_codigo as string);
}

// GET — cuántas licitaciones quedan por prefiltrar
export async function GET(request: NextRequest) {
  const ambito = await resolverAmbito(request);
  if (!ambito) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    const pendientes = await pendientesQuery(ambito.where, ambito.params);
    return NextResponse.json({ pendientes: pendientes.length });
  } catch (e: any) {
    // Si la tabla prefiltro_licitacion no existe aún (migración 21 pendiente), no romper el radar
    return NextResponse.json({ pendientes: 0, error: e.message });
  }
}

// POST — procesa el siguiente lote. Body: { lote?: number } (default 30)
export async function POST(request: NextRequest) {
  const ambito = await resolverAmbito(request);
  if (!ambito) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { lote = 30 } = await request.json().catch(() => ({}));

  try {
    const codigos = await pendientesQuery(ambito.where, ambito.params, lote);
    if (codigos.length === 0) {
      return NextResponse.json({ completado: true, procesados: [], pendientes: 0 });
    }

    const results = await prefiltrarYGuardar(codigos);
    const procesados = results.map(r => ({
      codigo: r.codigo, decision: r.decision, categoria: r.categoria, confianza: r.confianza,
    }));

    const restantes = await pendientesQuery(ambito.where, ambito.params);
    return NextResponse.json({ completado: restantes.length === 0, procesados, pendientes: restantes.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
