// app/api/compras/[negocioId]/sku/[skuId]/verificar-obuma/route.ts
// Obuma no avisa cuando alguien borra/edita un producto directamente en el ERP (sin webhook
// conectado) — pedido explícito del usuario tras encontrar un SKU que seguía mostrando "Creado en
// Obuma" con un producto que él mismo había borrado ahí. Este endpoint releé en vivo y corrige el
// vínculo local si ya no coincide con la realidad.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { verificarVinculoObuma } from '@/app/lib/compras-aprobaciones';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; skuId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, skuId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const resultado = await verificarVinculoObuma(id, Number(skuId), userId, nombre);
    return NextResponse.json({ success: true, ...resultado });
  } catch (error: any) {
    console.error('[compras/sku/verificar-obuma][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo verificar contra Obuma.' }, { status: 400 });
  }
}
