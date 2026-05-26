// src/lib/r2.ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function subirDocumentoR2(
  licitacionCodigo: string,
  documentoNombre: string,
  buffer: Buffer,
  contentType: string = 'application/pdf'
): Promise<string> {
  const timestamp = Date.now();
  const nombreLimpio = documentoNombre.replace(/[^a-zA-Z0-9áéíóúñÑ\-_.]/g, '_');
  const key = `${licitacionCodigo}/${timestamp}_${nombreLimpio}`;
  
  await r2Client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  
  const publicBase = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;
  const publicUrl = `${publicBase}/${key}`;
  console.log(`📤 Documento subido a R2: ${publicUrl}`);
  
  return publicUrl;
}