// app/api/documentos/auto-descargar/route.ts
// Descarga documentos de una licitación y luego dispara el análisis IA automáticamente.
// maxDuration=300 da tiempo suficiente para ambas operaciones.
import { NextRequest, NextResponse } from 'next/server';
import { descargarDocumentosLicitacion } from '@/app/lib/mp-descarga-orquestador';
import { procesarLicitacionCompleta } from '@/app/lib/pipeline-licitacion';
import { iaTextoConfigurada } from '@/app/lib/gemini';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { licitacionCodigo, triggerIA = true } = await request.json().catch(() => ({}));

    if (!licitacionCodigo) {
      return NextResponse.json({ error: 'licitacionCodigo requerido' }, { status: 400 });
    }

    const resultado = await descargarDocumentosLicitacion(licitacionCodigo);

    if (!resultado.exito) {
      return NextResponse.json({
        success: false,
        error: resultado.error,
        fichaUrl: resultado.fichaUrl,
        pasos: resultado.pasos,
      });
    }

    // Pipeline completo en background (Fase 1 clasificar → análisis → viabilidad)
    if (triggerIA && iaTextoConfigurada()) {
      procesarLicitacionCompleta(licitacionCodigo).catch(e =>
        console.error('[auto-descargar] Error en pipeline IA automático:', e)
      );
    }

    return NextResponse.json({
      success: true,
      mensaje: resultado.nuevos > 0
        ? `${resultado.nuevos} documento(s) descargado(s) y guardado(s).`
        : 'Los documentos ya estaban guardados.',
      nuevos: resultado.nuevos,
      omitidos: resultado.omitidos,
      totalEncontrados: resultado.totalEncontrados,
      revisarManual: resultado.revisarManual,
      tiposNoComunes: resultado.tiposNoComunes,
      mensajeRevision: resultado.mensajeRevision,
    });

  } catch (error: any) {
    console.error('Error en auto-descarga:', error);
    return NextResponse.json(
      { success: false, error: `Fallo en el servidor: ${error.message}` },
      { status: 500 },
    );
  }
}

