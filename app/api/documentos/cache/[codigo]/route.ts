// src/app/api/documentos/cache/[codigo]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { codigo: string } }
) {
  const { codigo } = await params;
  
  try {
    const [rows] = await pool.query(
      `SELECT documento_nombre, documento_url_local, size_bytes, created_at 
       FROM documentos_cache 
       WHERE licitacion_codigo = ? 
       ORDER BY created_at ASC`,
      [codigo]
    );
    
    return NextResponse.json({
      success: true,
      codigo,
      documentos: rows,
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}