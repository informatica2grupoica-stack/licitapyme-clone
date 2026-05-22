// src/app/services/documentosService.ts
import { DocumentoAdjunto } from '@/app/types/search.types';

// Lista de tipos de archivo que podemos mostrar
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

// Función para formatear tamaño de archivo
export function formatFileSize(bytes?: number): string {
  if (!bytes) return 'Desconocido';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Función para obtener documentos simulados (mientras la API no los entrega)
export function getMockDocumentos(codigo: string): DocumentoAdjunto[] {
  // Esto es un ejemplo - en producción estos datos vendrían de la API
  return [
    {
      nombre: `Bases_Licitacion_${codigo}.pdf`,
      url: `https://www.mercadopublico.cl/Procurement/Modules/Attachment/ViewAttachmentLC.aspx?id=${codigo}`,
      tipo: 'application/pdf',
      size: 1024 * 1024 * 2.5 // 2.5 MB
    },
    {
      nombre: `Anexos_Tecnicos_${codigo}.pdf`,
      url: `https://www.mercadopublico.cl/Procurement/Modules/Attachment/ViewAttachmentLC.aspx?id=${codigo}&anexo=1`,
      tipo: 'application/pdf',
      size: 1024 * 1024 * 1.2 // 1.2 MB
    },
    {
      nombre: `Planos_${codigo}.zip`,
      url: `https://www.mercadopublico.cl/Procurement/Modules/Attachment/ViewAttachmentLC.aspx?id=${codigo}&planos=1`,
      tipo: 'application/zip',
      size: 1024 * 1024 * 8.3 // 8.3 MB
    }
  ];
}

// Función para descargar un documento
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

// Función para descargar todos los documentos en ZIP
export async function descargarTodosDocumentos(documentos: DocumentoAdjunto[], codigo: string): Promise<void> {
  // Esto requiere una librería como jszip
  // Por ahora, descargamos uno por uno
  for (const doc of documentos) {
    await descargarDocumento(doc.url, doc.nombre);
    // Pequeña pausa para no saturar
    await new Promise(r => setTimeout(r, 500));
  }
}