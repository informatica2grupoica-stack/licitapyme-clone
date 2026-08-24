// src/app/api/documentos/cache/[codigo]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerLicitacion } from '@/app/lib/api-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  if (!(await puedeVerLicitacion(request, decodeURIComponent(codigo))))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  try {
    let rows: unknown[];
    try {
      // origen_manual viene de una tabla aparte (documentos_origen_manual, migration-75), no de
      // una columna en documentos_cache — ver el porqué en esa migración.
      [rows] = await pool.query(
        `SELECT dc.id, dc.documento_nombre, dc.documento_url_local, dc.size_bytes, dc.categoria, dc.subcategoria,
                (om.documento_id IS NOT NULL) AS origen_manual, dc.created_at
         FROM documentos_cache dc
         LEFT JOIN documentos_origen_manual om ON om.documento_id = dc.id
         WHERE dc.licitacion_codigo = ?
         ORDER BY dc.created_at ASC`,
        [codigo]
      ) as any[];
    } catch {
      try {
        // tabla 'documentos_origen_manual' no existe aún (migración 75 pendiente) — fallback sin ella
        [rows] = await pool.query(
          `SELECT id, documento_nombre, documento_url_local, size_bytes, categoria, subcategoria, created_at
           FROM documentos_cache
           WHERE licitacion_codigo = ?
           ORDER BY created_at ASC`,
          [codigo]
        ) as any[];
      } catch {
        try {
          // columna 'subcategoria' tampoco existe aún (migración 45 pendiente) — fallback sin ella
          [rows] = await pool.query(
            `SELECT id, documento_nombre, documento_url_local, size_bytes, categoria, created_at
             FROM documentos_cache
             WHERE licitacion_codigo = ?
             ORDER BY created_at ASC`,
            [codigo]
          ) as any[];
        } catch {
          // columna 'categoria' tampoco existe — fallback sin ella
          [rows] = await pool.query(
            `SELECT id, documento_nombre, documento_url_local, size_bytes, created_at
             FROM documentos_cache
             WHERE licitacion_codigo = ?
             ORDER BY created_at ASC`,
            [codigo]
          ) as any[];
        }
      }
    }

    // El costeo (con precios de mercado incluido) es visible para cualquier perfil asignado.
    const documentos = rows as any[];

    return NextResponse.json({
      success: true,
      codigo,
      documentos,
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}