// src/app/api/documentos/solicitar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { crearJob } from '@/app/lib/redis';
import { documentoYaDescargado, obtenerUrlDocumentoCache } from '@/app/services/documentosService.server';

export async function POST(request: NextRequest) {
  try {
    const { licitacionCodigo, documentoUrl, documentoNombre } = await request.json();

    if (!licitacionCodigo || !documentoUrl) {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 });
    }

    // Verificar si ya está descargado
    const yaDescargado = await documentoYaDescargado(licitacionCodigo, documentoNombre);
    
    if (yaDescargado) {
      const url = await obtenerUrlDocumentoCache(licitacionCodigo, documentoNombre);
      return NextResponse.json({
        success: true,
        cached: true,
        url: url,
        mensaje: 'Documento ya descargado anteriormente'
      });
    }

    const jobId = await crearJob({
      licitacionCodigo,
      documentoUrl,
      documentoNombre,
    });

    return NextResponse.json({
      success: true,
      jobId,
      mensaje: 'Descarga iniciada, espera unos segundos'
    });

  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}