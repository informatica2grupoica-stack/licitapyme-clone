// src/app/api/documentos/solicitar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { crearJob } from '@/app/lib/redis';
import { documentoYaDescargado, obtenerUrlDocumentoCache } from '@/app/services/documentosService.server';
import { getClienteId, puedeVerLicitacion } from '@/app/lib/api-auth';
import { CLIENTE_ICA } from '@/app/lib/tenant';

export async function POST(request: NextRequest) {
  try {
    const { licitacionCodigo, documentoUrl, documentoNombre } = await request.json();

    if (!licitacionCodigo || !documentoUrl) {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 });
    }

    if (!(await puedeVerLicitacion(request, String(licitacionCodigo))))
      return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
    // Multi-cliente: una empresa-cliente solo reutiliza documentos OFICIALES compartidos.
    const soloOficial = (await getClienteId(request)) !== CLIENTE_ICA;

    // Verificar si ya está descargado
    const yaDescargado = await documentoYaDescargado(licitacionCodigo, documentoNombre, soloOficial);
    
    if (yaDescargado) {
      const url = await obtenerUrlDocumentoCache(licitacionCodigo, documentoNombre, soloOficial);
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