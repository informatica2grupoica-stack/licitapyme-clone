// app/api/compras/proveedores/[id]/compras-obuma/route.ts
// Historial REAL de compras a un proveedor puntual (pedido explícito del usuario, 14-sep-2026: "si
// les hemos comprado" y "qué le hemos comprado") — se pide bajo demanda al expandir la ficha de ESE
// proveedor en /compras/proveedores, nunca precargado para todo el catálogo.
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { obtenerProveedor, historialComprasObuma, itemsCompraOcObuma } from '@/app/lib/compras-proveedores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null };
}

async function puedeVerProveedores(userId: number): Promise<boolean> {
  const p = await permisosCrudosDeUsuario(userId);
  return !!(p.compras_todo || p.compras || p.aprobar_comercial || p.compras_ver);
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await puedeVerProveedores(userId))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  const { id } = await params;
  const proveedor = await obtenerProveedor(parseInt(id));
  if (!proveedor) return NextResponse.json({ error: 'Proveedor no encontrado.' }, { status: 404 });

  try {
    // ?folio=XXXX — pide los ítems de UNA orden de compra puntual (se despliega desde la lista de
    // compras del proveedor, ver abajo). Sin folio, trae el resumen de todas las OC.
    const folio = request.nextUrl.searchParams.get('folio');
    if (folio) {
      const items = await itemsCompraOcObuma(folio);
      return NextResponse.json({ success: true, items });
    }

    if (!proveedor.obumaProveedorId) {
      // Proveedor tipeado a mano, sin ficha en Obuma todavía — no es un error, simplemente no hay
      // nada que consultar.
      return NextResponse.json({ success: true, tieneObuma: false, compras: [], totalComprado: 0 });
    }

    const { compras, totalReal } = await historialComprasObuma(proveedor.obumaProveedorId);
    const totalComprado = compras.reduce((s, c) => s + c.total, 0);
    return NextResponse.json({ success: true, tieneObuma: true, compras, totalComprado, totalReal, hayMas: totalReal > compras.length });
  } catch (error: any) {
    console.error('[compras/proveedores/[id]/compras-obuma][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo consultar el historial de compras en Obuma.' }, { status: 500 });
  }
}
