// app/api/documentos/guardar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    const { licitacionCodigo, documentoNombre, url, size } = await request.json();

    if (!licitacionCodigo || !documentoNombre || !url) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
    }

    await pool.query(
      `INSERT INTO documentos_cache (usuario_id, licitacion_codigo, documento_nombre, documento_url_local, size_bytes)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         documento_url_local = VALUES(documento_url_local),
         size_bytes = VALUES(size_bytes),
         usuario_id = COALESCE(usuario_id, VALUES(usuario_id))`,
      [userId ? parseInt(userId) : null, licitacionCodigo, documentoNombre, url, size || 0]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error guardando documento:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
