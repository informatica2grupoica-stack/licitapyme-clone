// app/api/compras/proyectos-obuma/items/route.ts
// GET ?folio=XXXX — ítems de UNA orden de compra puntual, pedidos al expandir una fila en
// /compras/proyectos (pedido explícito del usuario, 22-sep-2026: "necesito poder ver las OC de
// estas compras" → qué se compró en cada una). Reusa itemsCompraOcObuma (compras-proveedores.ts):
// primero mira la tabla local sincronizada, si no está ahí recién pide a Obuma en vivo.
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { itemsCompraOcObuma } from '@/app/lib/compras-proveedores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null };
}

async function puedeVer(userId: number): Promise<boolean> {
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.compras || p.aprobar_comercial);
}

export async function GET(request: NextRequest) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVer(userId))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  const folio = request.nextUrl.searchParams.get('folio');
  if (!folio) return NextResponse.json({ error: 'Falta el folio.' }, { status: 400 });

  try {
    const items = await itemsCompraOcObuma(folio);
    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    console.error('[compras/proyectos-obuma/items][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudieron cargar los ítems.' }, { status: 500 });
  }
}
