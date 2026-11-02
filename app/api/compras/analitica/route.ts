// app/api/compras/analitica/route.ts
// ANALÍTICA DE COMPRAS — misma puerta que el dashboard (jefatura): solo lectura.
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { obtenerAnaliticaCompras } from '@/app/lib/compras-analitica';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const id = request.headers.get('x-user-id');
  const userId = id ? parseInt(id) : null;
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const p = await permisosCrudosDeUsuario(userId);
  if (!(p.compras_todo || p.aprobar_comercial || p.compras_ver)) {
    return NextResponse.json({ error: 'La analítica de Compras es solo para jefatura.' }, { status: 403 });
  }
  try {
    const analitica = await obtenerAnaliticaCompras();
    return NextResponse.json({ success: true, analitica });
  } catch (error: any) {
    console.error('[compras/analitica][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar la analítica de Compras.' }, { status: 500 });
  }
}
