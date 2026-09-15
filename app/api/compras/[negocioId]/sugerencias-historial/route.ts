// app/api/compras/[negocioId]/sugerencias-historial/route.ts
// "Cuando ingrese una cotización... que me diga el sistema ojo le hemos comprado clavos a este
// proveedor... según los ítems que tengamos que cotizar en el módulo de compra" (pedido explícito
// del usuario, 14-sep-2026). Para cada producto del negocio (los que hay que cotizar de verdad,
// §14), busca en el historial LOCAL de compras (compras_historial_oc_item) qué proveedores ya nos
// vendieron algo parecido antes.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion, listarProductosCompra } from '@/app/lib/compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { sugerirProveedoresPorDescripcion } from '@/app/lib/compras-proveedores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const productos = (await listarProductosCompra(id)).filter(p => p.subestado !== 'RENUNCIADO');
    const porProducto = await Promise.all(
      productos.map(async p => ({ productoId: p.id, descripcion: p.descripcion, sugerencias: await sugerirProveedoresPorDescripcion(p.descripcion) })),
    );
    // Solo se devuelven productos con AL MENOS una sugerencia — la pantalla no necesita saber de
    // los que no tienen historial.
    const conSugerencias = porProducto.filter(p => p.sugerencias.length > 0);
    return NextResponse.json({ success: true, productos: conSugerencias });
  } catch (error: any) {
    console.error('[compras/sugerencias-historial][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudieron cargar las sugerencias.' }, { status: 500 });
  }
}
