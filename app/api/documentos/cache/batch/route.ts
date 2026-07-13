// src/app/api/documentos/cache/batch/route.ts
// Versión BATCH de /api/documentos/cache/[codigo]: resuelve MUCHOS códigos en UNA sola
// consulta (evita el N+1 de disparar un fetch por cada tarjeta en Postuladas/listas).
// Body: { codigos: string[], categoria?: string }
// Respuesta: { success, docs: { [codigo]: fila[] } }
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, permisosDeUsuario } from '@/app/lib/api-auth';

export async function POST(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { body = {}; }
  const codigosRaw: unknown = body?.codigos;
  const categoria: string | undefined = typeof body?.categoria === 'string' ? body.categoria : undefined;

  // Sanea: únicos, no vacíos, límite razonable para no explotar el IN(...).
  const codigos = Array.from(new Set(
    Array.isArray(codigosRaw) ? codigosRaw.filter((c): c is string => typeof c === 'string' && c.trim() !== '') : []
  )).slice(0, 500);

  if (codigos.length === 0) return NextResponse.json({ success: true, docs: {} });

  try {
    // Autorización: admin / ver_otros_negocios / usuario normal → ven todos los solicitados.
    // externo → SOLO los códigos asignados a él (mismo criterio que puedeVerLicitacion).
    let permitidos = codigos;
    if (u.rol !== 'admin') {
      const p = await permisosDeUsuario(u.id, u.rol);
      if (!p.ver_otros_negocios && u.rol === 'externo') {
        const [asig] = await pool.query(
          `SELECT DISTINCT licitacion_codigo FROM negocios
           WHERE asignado_a = ? AND activo = TRUE AND licitacion_codigo IN (?)`,
          [u.id, codigos],
        ) as any[];
        const set = new Set((asig as any[]).map(r => r.licitacion_codigo));
        permitidos = codigos.filter(c => set.has(c));
      }
    }
    if (permitidos.length === 0) return NextResponse.json({ success: true, docs: {} });

    let rows: any[];
    try {
      [rows] = await pool.query(
        `SELECT licitacion_codigo, documento_nombre, documento_url_local, size_bytes, categoria, created_at
         FROM documentos_cache
         WHERE licitacion_codigo IN (?)${categoria ? ' AND UPPER(categoria) = ?' : ''}
         ORDER BY created_at ASC`,
        categoria ? [permitidos, categoria.toUpperCase()] : [permitidos],
      ) as any[];
    } catch {
      // columna 'categoria' no existe aún — fallback sin ella (ignora el filtro de categoría)
      [rows] = await pool.query(
        `SELECT licitacion_codigo, documento_nombre, documento_url_local, size_bytes, created_at
         FROM documentos_cache
         WHERE licitacion_codigo IN (?)
         ORDER BY created_at ASC`,
        [permitidos],
      ) as any[];
    }

    // Agrupa por código.
    const docs: Record<string, any[]> = {};
    for (const c of permitidos) docs[c] = [];
    for (const row of rows as any[]) {
      (docs[row.licitacion_codigo] ||= []).push(row);
    }

    return NextResponse.json({ success: true, docs });
  } catch (error) {
    console.error('Error batch documentos/cache:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
