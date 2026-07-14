// app/api/documentos/subir/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { guardarDocumentoEnCache } from '@/app/services/documentosService.server';
import { registrarActividad, userIdFromHeaders } from '@/app/lib/actividad';

const CONTENT_TYPES: Record<string, string> = {
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc:  'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls:  'application/vnd.ms-excel',
  zip:  'application/zip',
  rar:  'application/x-rar-compressed',
  png:  'image/png',
  jpg:  'image/jpeg',
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const licitacionCodigo = formData.get('licitacionCodigo') as string;

    if (!licitacionCodigo) {
      return NextResponse.json({ error: 'licitacionCodigo requerido' }, { status: 400 });
    }

    const files = formData.getAll('files') as File[];
    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No se recibieron archivos' }, { status: 400 });
    }

    const resultado: { nombre: string; url: string; size: number }[] = [];

    for (const file of files) {
      const nombre = file.name;
      const ext = nombre.split('.').pop()?.toLowerCase() || 'bin';
      const contentType = file.type || CONTENT_TYPES[ext] || 'application/octet-stream';

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const publicUrl = await subirDocumentoR2(licitacionCodigo, nombre, buffer, contentType);
      await guardarDocumentoEnCache(licitacionCodigo, nombre, publicUrl, buffer.length);

      // Bitácora: subió un documento a esta licitación (best-effort, aparece en el Historial).
      registrarActividad({
        usuarioId: userIdFromHeaders(request.headers), accion: 'documento',
        entidadTipo: 'licitacion', entidadId: licitacionCodigo,
        descripcion: `Subió el documento "${nombre}"`,
        metadata: { licitacion_codigo: licitacionCodigo, documento: nombre },
      });

      resultado.push({ nombre, url: publicUrl, size: buffer.length });
    }

    return NextResponse.json({ success: true, documentos: resultado });
  } catch (error) {
    console.error('Error subiendo documentos:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// Next.js App Router soporta archivos grandes por defecto, no se necesita config
