// src/services/documentosService.client.ts
// ESTE ARCHIVO SOLO SE USA EN EL CLIENTE (COMPONENTES)
import { DocumentoAdjunto } from '@/app/types/search.types';

// Función para obtener la extensión del archivo
function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

// Función para obtener el ícono según el tipo de archivo
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

// Obtener documentos simulados (fallback)
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

// Descargar documento usando el worker (cliente)
export async function descargarDocumentoConWorker(
  licitacionCodigo: string,
  documentoUrl: string,
  documentoNombre: string,
  onStatusChange?: (status: string, url?: string) => void
): Promise<string | null> {
  try {
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
      onStatusChange?.('completed', data.url);
      return data.url;
    }
    
    if (!data.jobId) {
      throw new Error('No se pudo iniciar la descarga');
    }
    
    const jobId = data.jobId;
    let intentos = 0;
    const maxIntentos = 60;
    
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