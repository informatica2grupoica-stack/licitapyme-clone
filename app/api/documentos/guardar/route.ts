// app/api/documentos/guardar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerLicitacion } from '@/app/lib/api-auth';
import { registrarActividad } from '@/app/lib/actividad';

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    const { licitacionCodigo, documentoNombre, url, size, categoria } = await request.json();

    if (!licitacionCodigo || !documentoNombre || !url) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
    }
    // El externo solo puede subir documentos a SUS licitaciones asignadas.
    if (!(await puedeVerLicitacion(request, String(licitacionCodigo))))
      return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

    try {
      // Con categoría (documentos propios subidos a una caja específica).
      await pool.query(
        `INSERT INTO documentos_cache (usuario_id, licitacion_codigo, documento_nombre, documento_url_local, size_bytes, categoria)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           documento_url_local = VALUES(documento_url_local),
           size_bytes = VALUES(size_bytes),
           categoria = COALESCE(VALUES(categoria), categoria),
           usuario_id = COALESCE(usuario_id, VALUES(usuario_id))`,
        [userId ? parseInt(userId) : null, licitacionCodigo, documentoNombre, url, size || 0, categoria || null]
      );
    } catch {
      // Fallback: columna 'categoria' no existe aún.
      await pool.query(
        `INSERT INTO documentos_cache (usuario_id, licitacion_codigo, documento_nombre, documento_url_local, size_bytes)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           documento_url_local = VALUES(documento_url_local),
           size_bytes = VALUES(size_bytes),
           usuario_id = COALESCE(usuario_id, VALUES(usuario_id))`,
        [userId ? parseInt(userId) : null, licitacionCodigo, documentoNombre, url, size || 0]
      );
    }

    // Bitácora: subió un documento propio a esta licitación (best-effort).
    registrarActividad({
      usuarioId: userId ? parseInt(userId) : null, accion: 'documento',
      entidadTipo: 'licitacion', entidadId: String(licitacionCodigo),
      descripcion: `Subió el documento "${documentoNombre}"`,
      metadata: { licitacion_codigo: licitacionCodigo, documento: documentoNombre, categoria: categoria || null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error guardando documento:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
