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
  sizeBytes?: number,
  /** 'oficial' (por defecto) = bajado de Mercado Público, compartido entre empresas (cliente_id 0).
   *  'propio' = subido por alguien de una empresa: queda con el cliente_id por defecto (Grupo ICA = 1; un cliente lo escribe bajo su código con prefijo). */
  origen: 'oficial' | 'propio' = 'oficial',
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO documentos_cache (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, cliente_id) 
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         documento_url_local = VALUES(documento_url_local),
         size_bytes = VALUES(size_bytes)`,
      [licitacionCodigo, documentoNombre, url, sizeBytes || 0, origen === 'oficial' ? 0 : (licitacionCodigo.match(/^c(\d+):/)?.[1] ? Number(licitacionCodigo.match(/^c(\d+):/)![1]) : 1)]
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

// `soloOficial`: una empresa-cliente solo ve los oficiales compartidos (cliente_id 0), nunca los propios de Grupo ICA que viven bajo el mismo código.
export async function documentoYaDescargado(licitacionCodigo: string, documentoNombre: string, soloOficial = false): Promise<boolean> {
  try {
    const [rows] = await pool.query(
      `SELECT 1 FROM documentos_cache 
       WHERE licitacion_codigo = ? AND documento_nombre = ? ${soloOficial ? 'AND cliente_id = 0' : ''}
       LIMIT 1`,
      [licitacionCodigo, documentoNombre]
    );
    return (rows as any[]).length > 0;
  } catch (error) {
    console.error('Error verificando caché:', error);
    return false;
  }
}

export async function obtenerUrlDocumentoCache(licitacionCodigo: string, documentoNombre: string, soloOficial = false): Promise<string | null> {
  try {
    const [rows] = await pool.query(
      `SELECT documento_url_local FROM documentos_cache 
       WHERE licitacion_codigo = ? AND documento_nombre = ? ${soloOficial ? 'AND cliente_id = 0' : ''}
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