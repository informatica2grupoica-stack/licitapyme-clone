// src/services/documentosService.ts
import pool from '@/app/lib/db';
import { DocumentoAdjunto } from '@/app/types/search.types';

// Tipos de archivo
const TIPOS_DOCUMENTO = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  rar: 'application/x-rar-compressed',
  dwg: 'application/x-autocad',
  jpg: 'image/jpeg',
  png: 'image/png',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

// Interfaz para documentos en caché
export interface DocumentoCache {
  id?: number;
  licitacion_codigo: string;
  documento_nombre: string;
  documento_url_local: string;
  size_bytes?: number;
  created_at?: Date;
}

// ============================================
// FUNCIONES DE UTILIDAD
// ============================================

// Obtener extensión del archivo
function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

// Obtener ícono según el tipo de archivo
export function getIconForDocument(filename: string): string {
  const ext = getExtension(filename);
  const iconos: Record<string, string> = {
    pdf: '📄',
    zip: '📦',
    rar: '📦',
    dwg: '📐',
    jpg: '🖼️',
    png: '🖼️',
    doc: '📝',
    docx: '📝',
    xls: '📊',
    xlsx: '📊'
  };
  return iconos[ext] || '📎';
}

// Formatear tamaño de archivo
export function formatFileSize(bytes?: number): string {
  if (!bytes) return 'Desconocido';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================
// FUNCIONES DE CACHÉ EN BASE DE DATOS
// ============================================

// Guardar documento en caché
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

// Obtener todos los documentos cacheados de una licitación
export async function obtenerDocumentosCache(licitacionCodigo: string): Promise<DocumentoCache[]> {
  try {
    const [rows] = await pool.query(
      `SELECT documento_nombre, documento_url_local, size_bytes, created_at 
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

// Verificar si un documento ya está descargado
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

// Obtener URL de documento cacheados
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

// ============================================
// FUNCIONES DE DOCUMENTOS MOCK (FALLBACK)
// ============================================

// Obtener documentos simulados (fallback cuando la API falla)
export function getMockDocumentos(codigo: string): DocumentoAdjunto[] {
  return [
    {
      nombre: `Bases_Licitacion_${codigo}.pdf`,
      url: `https://www.mercadopublico.cl/Procurement/Modules/Attachment/ViewAttachmentLC.aspx?id=${codigo}`,
      tipo: 'application/pdf',
      size: 1024 * 1024 * 2.5
    },
    {
      nombre: `Anexos_Tecnicos_${codigo}.pdf`,
      url: `https://www.mercadopublico.cl/Procurement/Modules/Attachment/ViewAttachmentLC.aspx?id=${codigo}&anexo=1`,
      tipo: 'application/pdf',
      size: 1024 * 1024 * 1.2
    },
    {
      nombre: `Planos_${codigo}.zip`,
      url: `https://www.mercadopublico.cl/Procurement/Modules/Attachment/ViewAttachmentLC.aspx?id=${codigo}&planos=1`,
      tipo: 'application/zip',
      size: 1024 * 1024 * 8.3
    }
  ];
}

// ============================================
// FUNCIONES DE DESCARGA (CLIENTE)
// ============================================

// Descargar un documento (versión simple)
export async function descargarDocumento(url: string, nombre: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`);
    if (!response.ok) throw new Error('Error al descargar');
    
    const blob = await response.blob();
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = nombre;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
    return true;
  } catch (error) {
    console.error('Error al descargar:', error);
    return false;
  }
}

// Descargar documento usando el worker (con captcha)
export async function descargarDocumentoConWorker(
  licitacionCodigo: string,
  documentoUrl: string,
  documentoNombre: string,
  onStatusChange?: (status: string, url?: string) => void
): Promise<string | null> {
  try {
    // 1. Solicitar descarga al worker
    const response = await fetch('/api/documentos/solicitar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        licitacionCodigo,
        documentoUrl,
        documentoNombre
      })
    });
    
    const data = await response.json();
    
    if (data.cached && data.url) {
      // Ya está en caché, devolver URL
      onStatusChange?.('completed', data.url);
      return data.url;
    }
    
    if (!data.jobId) {
      throw new Error('No se pudo iniciar la descarga');
    }
    
    // 2. Polling para obtener resultado
    const jobId = data.jobId;
    let intentos = 0;
    const maxIntentos = 60; // 60 * 2 segundos = 120 segundos máximo
    
    return new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        intentos++;
        
        const statusRes = await fetch(`/api/documentos/estado?jobId=${jobId}`);
        const status = await statusRes.json();
        
        onStatusChange?.(status.status, status.url);
        
        if (status.status === 'completed') {
          clearInterval(interval);
          resolve(status.url);
        } else if (status.status === 'failed') {
          clearInterval(interval);
          reject(new Error(status.error || 'Error en la descarga'));
        } else if (intentos >= maxIntentos) {
          clearInterval(interval);
          reject(new Error('Timeout en la descarga'));
        }
      }, 2000);
    });
    
  } catch (error) {
    console.error('Error en descarga con worker:', error);
    throw error;
  }
}

// Descargar todos los documentos
export async function descargarTodosDocumentos(documentos: DocumentoAdjunto[], codigo: string): Promise<void> {
  for (const doc of documentos) {
    await descargarDocumento(doc.url, doc.nombre);
    await new Promise(r => setTimeout(r, 500));
  }
}