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
      // origen_manual viene de documentos_origen_manual (migration-75) y generado_separar de
      // documentos_generados_separar (migration-89) — ninguna es columna de documentos_cache, ver
      // el porqué en esas migraciones. generado_separar es lo que "Documentos y Bases" usa para
      // pintar NARANJO un archivo que produjo "Separar anexos" (pedido explícito del usuario,
      // 7-sep-2026), a diferencia de un documento original de Mercado Público.
      [rows] = await pool.query(
        `SELECT dc.id, dc.documento_nombre, dc.documento_url_local, dc.size_bytes, dc.categoria, dc.subcategoria,
                (om.documento_id IS NOT NULL) AS origen_manual,
                (gs.documento_id IS NOT NULL) AS generado_separar, dc.created_at
         FROM documentos_cache dc
         LEFT JOIN documentos_origen_manual om ON om.documento_id = dc.id
         LEFT JOIN documentos_generados_separar gs ON gs.documento_id = dc.id
         WHERE dc.licitacion_codigo = ?
         ORDER BY dc.created_at ASC`,
        [codigo]
      ) as any[];
    } catch {
      try {
        // tabla 'documentos_generados_separar' no existe aún (migración 89 pendiente) — fallback sin ella
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
          // tabla 'documentos_origen_manual' tampoco existe aún (migración 75 pendiente) — fallback sin ella
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