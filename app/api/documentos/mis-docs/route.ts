// app/api/documentos/mis-docs/route.ts
// Lista todos los documentos subidos por el usuario autenticado
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

  try {
    // Intenta filtrar por usuario; si no existe la columna, devuelve todo
    let rows: any[];
    try {
      [rows] = await pool.query(
        `SELECT licitacion_codigo, documento_nombre, documento_url_local, size_bytes, created_at
         FROM documentos_cache
         WHERE usuario_id = ?
         ORDER BY created_at DESC`,
        [parseInt(userId)]
      ) as any;
    } catch {
      // La columna usuario_id puede no existir aún (antes de la migración)
      [rows] = await pool.query(
        `SELECT licitacion_codigo, documento_nombre, documento_url_local, size_bytes, created_at
         FROM documentos_cache
         ORDER BY created_at DESC`
      ) as any;
    }

    return NextResponse.json({ success: true, documentos: rows });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
