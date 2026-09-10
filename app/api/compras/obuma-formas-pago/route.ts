// app/api/compras/obuma-formas-pago/route.ts
// Formas de pago reales de Obuma (habilitadas para compras) — para el selector del formulario de
// creación de orden de compra. Transversal (no depende de un negocio puntual), mismo criterio que
// /api/compras/obuma-subcategorias.
import { NextRequest, NextResponse } from 'next/server';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { formasDePagoObuma } from '@/app/lib/compras-oc-obuma';

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

  try {
    const formas = await formasDePagoObuma();
    return NextResponse.json({ success: true, formas });
  } catch (error: any) {
    console.error('[compras/obuma-formas-pago][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar Obuma.' }, { status: 500 });
  }
}
