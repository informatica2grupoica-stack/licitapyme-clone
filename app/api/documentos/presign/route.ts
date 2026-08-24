// app/api/documentos/presign/route.ts
//
// Genera una URL presignada de R2 para que el browser suba el archivo
// DIRECTAMENTE a R2 sin pasar por Vercel (evita el límite de 4.5 MB).
//
// Flujo:
//   1. Frontend → POST /api/documentos/presign  → recibe { uploadUrl, publicUrl }
//   2. Frontend → PUT <uploadUrl> con el archivo (directo a R2, sin Vercel)
//   3. Frontend → POST /api/documentos/guardar  → guarda en MySQL

import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2Client } from '@/app/lib/r2';

export async function POST(request: NextRequest) {
  try {
    const { licitacionCodigo, filename, contentType, size } = await request.json();

    if (!licitacionCodigo || !filename) {
      return NextResponse.json({ error: 'licitacionCodigo y filename requeridos' }, { status: 400 });
    }

    const timestamp = Date.now();
    const nombreLimpio = filename.replace(/[^a-zA-Z0-9áéíóúñÑ\-_.]/g, '_');
    const key = `${licitacionCodigo}/${timestamp}_${nombreLimpio}`;

    const publicBase = process.env.R2_PUBLIC_URL || `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev`;
    const publicUrl = `${publicBase}/${key}`;

    // OJO: el nombre de descarga correcto (sin el timestamp de la key) se fija DESPUÉS, en
    // POST /api/documentos/guardar (server-side, vía CopyObject) — no aquí. Incluir
    // ContentDisposition en ESTE PutObjectCommand lo metería en la firma SigV4, y el navegador
    // tendría que mandar ese header exacto en el PUT o R2 rechaza la subida entera por firma
    // inválida (además de depender de que el CORS del bucket permita ese header, que no
    // controlamos desde el código). Ver app/lib/r2.ts (contentDispositionInline) para el detalle.
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType || 'application/octet-stream',
      ...(size ? { ContentLength: size } : {}),
    });

    // URL válida por 1 hora
    const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 });

    return NextResponse.json({ uploadUrl, publicUrl, key });
  } catch (error) {
    console.error('Error generando URL presignada:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
