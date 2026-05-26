// app/api/documentos/[codigo]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  if (!codigo) {
    return NextResponse.json({ error: 'Código requerido' }, { status: 400 });
  }

  try {
    const [rows] = await pool.query(
      `SELECT documento_nombre, documento_url_local, size_bytes, created_at
       FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY created_at ASC`,
      [codigo]
    );
    const docs = rows as any[];

    return NextResponse.json({
      success: true,
      codigo,
      documentos: docs.map(d => ({
        nombre: d.documento_nombre,
        url: d.documento_url_local,
        url_local: d.documento_url_local,
        size: d.size_bytes,
        ya_descargado: true,
        fecha: d.created_at,
      })),
      total: docs.length,
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
