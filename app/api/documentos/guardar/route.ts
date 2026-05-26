// src/app/api/documentos/guardar/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { guardarDocumentoEnCache } from '@/app/services/documentosService.server';

export async function POST(request: NextRequest) {
  try {
    const { licitacionCodigo, documentoNombre, url, size } = await request.json();
    
    await guardarDocumentoEnCache(licitacionCodigo, documentoNombre, url, size);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}