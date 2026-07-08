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
      [rows] = await pool.query(
        `SELECT documento_nombre, documento_url_local, size_bytes, categoria, created_at
         FROM documentos_cache
         WHERE licitacion_codigo = ?
         ORDER BY created_at ASC`,
        [codigo]
      ) as any[];
    } catch {
      // columna 'categoria' no existe aún — fallback sin ella
      [rows] = await pool.query(
        `SELECT documento_nombre, documento_url_local, size_bytes, created_at
         FROM documentos_cache
         WHERE licitacion_codigo = ?
         ORDER BY created_at ASC`,
        [codigo]
      ) as any[];
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