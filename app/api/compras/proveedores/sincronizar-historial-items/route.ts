// app/api/compras/proveedores/sincronizar-historial-items/route.ts
// Backfill INCREMENTAL de los ítems de cada OC (pedido explícito del usuario, 14-sep-2026: "todo en
// nuestra base de datos"). Traer los ítems es caro — una llamada a Obuma POR CADA OC — así que este
// endpoint procesa un lote por invocación y devuelve cuántas quedan pendientes; la UI lo vuelve a
// llamar sola hasta vaciar el pendiente (ver /compras/proveedores).
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { sincronizarItemsHistorialOc } from '@/app/lib/compras-proveedores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null };
}

async function puedeVerProveedores(userId: number): Promise<boolean> {
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.compras || p.aprobar_comercial);
}

export async function POST(request: NextRequest) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerProveedores(userId))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  try {
    const resultado = await sincronizarItemsHistorialOc(100);
    return NextResponse.json({ success: true, ...resultado });
  } catch (error: any) {
    console.error('[compras/proveedores/sincronizar-historial-items][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo sincronizar el historial.' }, { status: 500 });
  }
}
