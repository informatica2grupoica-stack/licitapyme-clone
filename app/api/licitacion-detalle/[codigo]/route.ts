// app/api/licitacion-detalle/[codigo]/route.ts
// Obtiene los detalles completos de una licitación específica
// consultando directamente la API oficial de Mercado Público por código.
// Esto funciona para licitaciones de cualquier fecha, no solo los últimos 7 días.
import { NextRequest, NextResponse } from 'next/server';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { searchEngine } from '@/app/lib/search-engine';
import { puedeVerLicitacion } from '@/app/lib/api-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ codigo: string }> }
) {
  const { codigo } = await params;
  const codigoDecoded = decodeURIComponent(codigo);
  if (!(await puedeVerLicitacion(request, codigoDecoded)))
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });

  if (!codigoDecoded) {
    return NextResponse.json({ error: 'Código requerido' }, { status: 400 });
  }

  try {
    const client = getMercadoPublicoClient();
    const licitacion = await client.obtenerPorCodigo(codigoDecoded);

    if (!licitacion) {
      return NextResponse.json(
        { success: false, error: 'Licitación no encontrada en la API de Mercado Público' },
        { status: 404 }
      );
    }

    const oportunidad = searchEngine.licitacionToOportunidad(licitacion, '');

    // Devolvemos TANTO la oportunidad (compatibilidad) COMO la licitación completa (para detail page)
    return NextResponse.json({ success: true, licitacion: oportunidad, licitacion_raw: licitacion });
  } catch (error: any) {
    console.error(`❌ Error obteniendo licitación ${codigoDecoded}:`, error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error al consultar la API' },
      { status: 500 }
    );
  }
}
