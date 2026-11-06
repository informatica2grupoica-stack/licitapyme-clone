// GET /api/ordenes-compra/aceptacion — OC por aceptar (de la más próxima a vencer a la más lejana)
// y OC ya aceptadas, para la pestaña «Aceptación» de /ordenes-compra.
import { NextRequest, NextResponse } from 'next/server';
import { listarOrdenesCompra, type OrdenCompraListaFila } from '@/app/lib/ordenes-compra';
import { estadoAceptacionOcs, type AceptacionOc } from '@/app/lib/compras';
import { permisosDeUsuario } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function unir(lista: AceptacionOc[]) {
  if (lista.length === 0) return [];
  const { ordenes } = await listarOrdenesCompra({ codigos: lista.map(a => a.codigo), limit: 100 });
  const porCodigo = new Map<string, OrdenCompraListaFila>(ordenes.map(o => [o.codigo, o]));
  return lista.flatMap(a => {
    const oc = porCodigo.get(a.codigo);
    return oc ? [{ ...oc, limite: a.limite, horas: a.horas, aceptadaEn: a.aceptadaEn }] : [];
  });
}

export async function GET(request: NextRequest) {
  const id = request.headers.get('x-user-id');
  const rol = request.headers.get('x-user-rol');
  if (!id) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (rol !== 'admin') {
    const p = await permisosDeUsuario(parseInt(id), rol);
    if (!p.compras && !p.compras_todo && !p.compras_ver && !p.compras_auditor) return NextResponse.json({ error: 'Sin acceso a las órdenes de compra.' }, { status: 403 });
  }
  try {
    const { porAceptar, aceptadas } = await estadoAceptacionOcs();
    const [pend, acep] = await Promise.all([unir(porAceptar.slice(0, 100)), unir(aceptadas)]);
    return NextResponse.json({ success: true, porAceptar: pend, aceptadas: acep, totalPorAceptar: porAceptar.length });
  } catch (error: any) {
    console.error('[api/ordenes-compra/aceptacion]', String(error?.message || error));
    return NextResponse.json({ error: 'No se pudo cargar la aceptación de órdenes de compra.' }, { status: 500 });
  }
}
