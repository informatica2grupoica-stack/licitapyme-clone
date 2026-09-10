// app/api/compras/obuma-siguiente-sku/route.ts
// Preview del código comercial que Obuma va a asignar (§7.3) — mismo gesto que grupoica-intranet:
// se muestra ANTES de crear, apenas se elige la subcategoría, para que quien está armando el SKU
// vea el código real y no una sorpresa después de guardar.
import { NextRequest, NextResponse } from 'next/server';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { siguienteSkuMercadoPublico } from '@/app/lib/obuma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (rol !== 'admin') {
    const p = await permisosDeUsuario(userId, rol);
    if (!p.compras && !p.aprobar_comercial) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
  }

  const subcategoriaId = request.nextUrl.searchParams.get('subcategoriaId')?.trim();
  if (!subcategoriaId) return NextResponse.json({ error: 'Falta subcategoriaId' }, { status: 400 });

  try {
    const sku = await siguienteSkuMercadoPublico(subcategoriaId);
    return NextResponse.json({ success: true, sku });
  } catch (error: any) {
    console.error('[compras/obuma-siguiente-sku][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar Obuma.' }, { status: 500 });
  }
}
