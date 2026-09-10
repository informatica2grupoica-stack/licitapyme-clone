// app/api/compras/incidencias/tipos/route.ts
// Catálogo enunciativo de tipos de incidencia (spec §9.3 + §1.3.5) — transversal, no por negocio.
import { NextRequest, NextResponse } from 'next/server';
import { listarCatalogoIncidencias } from '@/app/lib/compras-incidencias';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    const tipos = await listarCatalogoIncidencias();
    return NextResponse.json({ success: true, tipos });
  } catch (error) {
    console.error('[compras/incidencias/tipos][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar el catálogo.' }, { status: 500 });
  }
}
