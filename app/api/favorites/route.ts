// src/app/api/favorites/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { addFavorite, removeFavorite, getFavorites, isFavorite } from '@/app/services/dbService';

// GET - Obtener todos los favoritos
export async function GET() {
  try {
    const favorites = await getFavorites();
    return NextResponse.json({ success: true, favorites });
  } catch (error) {
    console.error('Error al obtener favoritos:', error);
    return NextResponse.json(
      { success: false, error: 'Error al obtener favoritos' },
      { status: 500 }
    );
  }
}

// POST - Agregar favorito (con todos los campos)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const favoriteData = {
      codigo: body.codigo,
      nombre: body.nombre,
      organismo: body.organismo,
      monto_total: body.monto_total,
      monto_estimado: body.monto_estimado,
      moneda: body.moneda || 'CLP',
      fecha_cierre: body.fecha_cierre,
      fecha_adjudicacion: body.fecha_adjudicacion,
      estado: body.estado,
      tipo_licitacion: body.tipo_licitacion,
      region: body.region,
      comuna: body.comuna,
      descripcion: body.descripcion,
      resumen_ia: body.resumen_ia,
      detail_url: body.detail_url,
      search_url: body.search_url,
      semantic_score: body.semantic_score,
      final_score: body.final_score
    };
    
    const success = await addFavorite(favoriteData);
    
    if (success) {
      return NextResponse.json({ success: true, message: 'Favorito agregado' });
    } else {
      return NextResponse.json(
        { success: false, error: 'Error al agregar favorito' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error al agregar favorito:', error);
    return NextResponse.json(
      { success: false, error: 'Error al agregar favorito' },
      { status: 500 }
    );
  }
}

// DELETE - Eliminar favorito
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const codigo = searchParams.get('codigo');
    
    if (!codigo) {
      return NextResponse.json(
        { success: false, error: 'Se requiere código' },
        { status: 400 }
      );
    }
    
    const success = await removeFavorite(codigo);
    
    if (success) {
      return NextResponse.json({ success: true, message: 'Favorito eliminado' });
    } else {
      return NextResponse.json(
        { success: false, error: 'Error al eliminar favorito' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error al eliminar favorito:', error);
    return NextResponse.json(
      { success: false, error: 'Error al eliminar favorito' },
      { status: 500 }
    );
  }
}