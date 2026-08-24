// src/lib/r2.ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

// MIME por extensión — fuente de verdad para que el navegador previsualice (PDF/imagen)
// y para que el visor de Office reconozca Word/Excel/PPT. Mercado Público suele
// devolver octet-stream / text/plain, así que NO confiamos en el contentType de origen.
const MIME_POR_EXT: Record<string, string> = {
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc:  'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls:  'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt:  'application/vnd.ms-powerpoint',
  rtf:  'application/rtf',
  zip:  'application/zip',
  rar:  'application/x-rar-compressed',
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  gif:  'image/gif',
  webp: 'image/webp',
  bmp:  'image/bmp',
  svg:  'image/svg+xml',
  txt:  'text/plain; charset=utf-8',
  csv:  'text/csv; charset=utf-8',
};

export function mimeDeNombre(nombre: string, fallback = 'application/octet-stream'): string {
  const ext = (nombre.split('.').pop() || '').toLowerCase();
  return MIME_POR_EXT[ext] || fallback;
}

// Content-Disposition con el nombre REAL del documento (no la key de R2, que lleva un timestamp
// de prefijo para no pisar versiones). Sin esto, un <a download="nombre.pdf"> a una URL de OTRO
// origen (R2 vive en su propio dominio) IGNORA el atributo `download` — es una regla del propio
// HTML, solo aplica same-origin — y el navegador cae al último segmento de la URL como nombre de
// archivo, o sea la key completa con el timestamp pegado al principio. `inline` (no `attachment`)
// para no romper la previsualización de PDF/imagen en el visor; el nombre igual se usa cuando el
// usuario guarda esa vista o el navegador la descarga. RFC 5987 (filename*=UTF-8''...) para que
// tildes/ñ viajen bien — el header debe ser ASCII puro, por eso el `filename=` es una versión
// transliterada de respaldo para navegadores viejos que no leen filename*.
export function contentDispositionInline(nombre: string): string {
  const ascii = nombre
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre)}`;
}

export async function subirDocumentoR2(
  licitacionCodigo: string,
  documentoNombre: string,
  buffer: Buffer,
  contentType?: string
): Promise<string> {
  const timestamp = Date.now();
  const nombreLimpio = documentoNombre.replace(/[^a-zA-Z0-9áéíóúñÑ\-_.]/g, '_');
  const key = `${licitacionCodigo}/${timestamp}_${nombreLimpio}`;

  // Prioridad: MIME derivado de la extensión > contentType recibido > octet-stream.
  // Así el PDF se sirve como application/pdf (embebible) y no como descarga forzada.
  const ext = (documentoNombre.split('.').pop() || '').toLowerCase();
  const mimeFinal = MIME_POR_EXT[ext]
    || (contentType && contentType !== 'application/octet-stream' && contentType !== 'text/plain' ? contentType : null)
    || 'application/octet-stream';

  await r2Client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mimeFinal,
    // inline → el navegador previsualiza (PDF/imagen) en vez de descargar. Con nombre real
    // (ver contentDispositionInline) para que la descarga no salga con el timestamp de la key.
    ContentDisposition: contentDispositionInline(documentoNombre),
  }));
  
  const publicBase = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;
  const publicUrl = `${publicBase}/${key}`;
  console.log(`📤 Documento subido a R2: ${publicUrl}`);

  return publicUrl;
}

// Borra un objeto de R2 a partir de su URL pública. Usado para limpiar los sub-PDFs
// temporales que se suben durante el OCR de bases largas (>100 págs). Best-effort:
// si falla, no rompe el flujo (solo queda un objeto huérfano). La key es el pathname
// de la URL pública (los docs se sirven como ${publicBase}/${key}).
export async function borrarDocumentoR2(publicUrl: string): Promise<void> {
  let key = '';
  // decodeURIComponent: el pathname de la URL viene percent-encoded (así se sirve por HTTP),
  // pero la Key real en R2 son los caracteres UTF-8 tal cual (ej. "Ñandú", no "%C3%91and%C3%BA").
  // Sin decodificar, el DeleteObject apunta a una key que no existe y el archivo queda huérfano.
  try { key = decodeURIComponent(new URL(publicUrl).pathname.replace(/^\/+/, '')); } catch { return; }
  if (!key) return;
  await r2Client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
}