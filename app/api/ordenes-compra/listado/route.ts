// app/api/ordenes-compra/listado/route.ts
// GET /api/ordenes-compra/listado — vista de gestión transversal de TODAS las órdenes de compra
// (las dos empresas), con filtros. A diferencia de /api/ordenes-compra (una licitación puntual),
// esto pagina sobre toda la tabla — pensado para /ordenes-compra en el sidebar (GESTIÓN).
import { NextRequest, NextResponse } from 'next/server';
import { listarOrdenesCompra } from '@/app/lib/ordenes-compra';

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
  if (rol !== 'admin') return NextResponse.json({ error: 'Solo administradores.' }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  try {
    const { ordenes, total, sumaTotal } = await listarOrdenesCompra({
      desde: sp.get('desde') || undefined,
      hasta: sp.get('hasta') || undefined,
      empresaId: sp.get('empresaId') ? Number(sp.get('empresaId')) : undefined,
      codigoEstado: sp.get('estado') ? Number(sp.get('estado')) : undefined,
      q: sp.get('q') || undefined,
      incluirTerceros: sp.get('incluirTerceros') === '1',
      limit: sp.get('limit') ? Number(sp.get('limit')) : 30,
      offset: sp.get('offset') ? Number(sp.get('offset')) : 0,
    });
    return NextResponse.json({ success: true, ordenes, total, sumaTotal });
  } catch (error: any) {
    console.error('[api/ordenes-compra/listado]', String(error?.message || error));
    // La tabla puede no existir todavía (migración 64 sin aplicar): se responde vacío en vez de
    // reventar la pantalla entera.
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      return NextResponse.json({ success: true, ordenes: [], total: 0, migracionPendiente: true });
    }
    return NextResponse.json({ error: 'No se pudo cargar las órdenes de compra.' }, { status: 500 });
  }
}
