// app/api/compras/proveedores/ficha/route.ts
// Ficha de un proveedor para el modal «¿a quién le hemos comprado esto?» (Cotizaciones): datos de
// contacto del catálogo + órdenes de compra recientes + productos que le hemos comprado.
//   ?id=<id local>&obumaId=<id Obuma>  — alcanza con uno; si hay ficha local manda esa.
//   ?folio=<folio>                     — ítems de UNA orden de compra (se despliega desde el modal).
import { mensajeSeguro } from '@/app/lib/errores-api';
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { obtenerProveedor, historialComprasObuma, itemsCompraOcObuma, productosCompradosAProveedor } from '@/app/lib/compras-proveedores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  // Lectura abierta a todo perfil interno; solo el externo (cliente) necesita permiso de Compras.
  if (request.headers.get('x-user-rol') === 'externo') {
    const p = await permisosCrudosDeUsuario(userId);
    if (!(p.compras_todo || p.compras || p.aprobar_comercial || p.compras_ver || p.compras_auditor)) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
  }
  try {
    const q = request.nextUrl.searchParams;
    const folio = q.get('folio');
    if (folio) return NextResponse.json({ success: true, items: await itemsCompraOcObuma(folio) });

    const idLocal = parseInt(q.get('id') || '');
    const prov = Number.isFinite(idLocal) ? await obtenerProveedor(idLocal) : null;
    const obumaId = prov?.obumaProveedorId || q.get('obumaId') || null;
    const [historial, productos] = obumaId
      ? await Promise.all([historialComprasObuma(obumaId, 30), productosCompradosAProveedor(obumaId)])
      : [{ compras: [], totalReal: 0 }, []];
    return NextResponse.json({
      success: true,
      // Sin datos bancarios: el modal es para contactar y recordar qué se compró, no para pagar.
      proveedor: prov ? {
        id: prov.id, rut: prov.rut, nombreEmpresa: prov.nombreEmpresa, nombreFantasia: prov.nombreFantasia, categoria: prov.categoria,
        giro: prov.giro, contactoNombre: prov.contactoNombre, correo: prov.correo, telefono: prov.telefono,
        direccion: prov.direccion, comuna: prov.comuna, region: prov.region, notas: prov.notas,
      } : null,
      compras: historial.compras, totalOrdenes: historial.totalReal, totalComprado: historial.compras.reduce((s, c) => s + c.total, 0),
      productos,
    });
  } catch (error: any) {
    console.error('[compras/proveedores/ficha][GET]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudo cargar la ficha del proveedor.') }, { status: 500 });
  }
}
