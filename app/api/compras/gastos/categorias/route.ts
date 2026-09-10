// app/api/compras/gastos/categorias/route.ts
// Catálogo enunciativo de categorías de gasto (§1.3.5) — transversal, no por negocio.
import { NextRequest, NextResponse } from 'next/server';
import { listarCategoriasGasto } from '@/app/lib/compras-gastos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    const categorias = await listarCategoriasGasto();
    return NextResponse.json({ success: true, categorias });
  } catch (error) {
    console.error('[compras/gastos/categorias][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar el catálogo.' }, { status: 500 });
  }
}
