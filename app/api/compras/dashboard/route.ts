// app/api/compras/dashboard/route.ts
// DASHBOARD DE COMPRAS (spec §18.5/§18.6) — "la estadística de gestión por usuario es visible solo
// para la jefatura. No para el propio encargado" (§2.4). Por eso el gate acá es MÁS ANGOSTO que el
// resto de Compras: admin o `aprobar_comercial` (jefe de ventas) — el permiso `compras` (encargado)
// NO alcanza, a diferencia de las demás rutas del módulo.
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { obtenerDashboardCompras } from '@/app/lib/compras-dashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

async function esJefatura(userId: number, _rol: string | null): Promise<boolean> {
  // "Ser admin" ya no alcanza solo (pedido explícito, 10-sep-2026) — se lee con
  // `permisosCrudosDeUsuario` para que `aprobar_comercial` tampoco se auto-otorgue por ser admin.
  // Ver el comentario largo en app/api/compras/[negocioId]/route.ts.
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.aprobar_comercial);
}

export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await esJefatura(userId, rol))) {
    return NextResponse.json({ error: 'El dashboard de Compras es solo para jefatura (spec §2.4/§18.6).' }, { status: 403 });
  }

  try {
    const dashboard = await obtenerDashboardCompras();
    return NextResponse.json({ success: true, dashboard });
  } catch (error: any) {
    console.error('[compras/dashboard][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar el dashboard de Compras.' }, { status: 500 });
  }
}
