// src/services/documentosService.server.ts
// ESTE ARCHIVO SOLO SE USA EN EL SERVIDOR (API ROUTES)
import pool from '@/app/lib/db';

export interface DocumentoCache {
  id?: number;
  licitacion_codigo: string;
  documento_nombre: string;
  documento_url_local: string;
  categoria?: string;
  size_bytes?: number;
  created_at?: Date;
}

export async function guardarDocumentoEnCache(
  licitacionCodigo: string,
  documentoNombre: string,
  url: string,
  sizeBytes?: number
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO documentos_cache (licitacion_codigo, documento_nombre, documento_url_local, size_bytes) 
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         documento_url_local = VALUES(documento_url_local),
         size_bytes = VALUES(size_bytes)`,
      [licitacionCodigo, documentoNombre, url, sizeBytes || 0]
    );
    console.log(`💾 Documento guardado en caché: ${documentoNombre}`);
  } catch (error) {
    console.error('Error guardando en caché:', error);
  }
}

export async function obtenerDocumentosCache(licitacionCodigo: string): Promise<DocumentoCache[]> {
  try {
    const [rows] = await pool.query(
      `SELECT documento_nombre, documento_url_local, size_bytes, categoria, created_at
       FROM documentos_cache
       WHERE licitacion_codigo = ?
       ORDER BY created_at ASC`,
      [licitacionCodigo]
    );
    return rows as DocumentoCache[];
  } catch (error) {
    console.error('Error obteniendo caché:', error);
    return [];
  }
}

export async function documentoYaDescargado(licitacionCodigo: string, documentoNombre: string): Promise<boolean> {
  try {
    const [rows] = await pool.query(
      `SELECT 1 FROM documentos_cache 
       WHERE licitacion_codigo = ? AND documento_nombre = ? 
       LIMIT 1`,
      [licitacionCodigo, documentoNombre]
    );
    return (rows as any[]).length > 0;
  } catch (error) {
    console.error('Error verificando caché:', error);
    return false;
  }
}

export async function obtenerUrlDocumentoCache(licitacionCodigo: string, documentoNombre: string): Promise<string | null> {
  try {
    const [rows] = await pool.query(
      `SELECT documento_url_local FROM documentos_cache 
       WHERE licitacion_codigo = ? AND documento_nombre = ? 
       LIMIT 1`,
      [licitacionCodigo, documentoNombre]
    );
    const result = rows as any[];
    return result.length > 0 ? result[0].documento_url_local : null;
  } catch (error) {
    console.error('Error obteniendo URL de caché:', error);
    return null;
  }
}