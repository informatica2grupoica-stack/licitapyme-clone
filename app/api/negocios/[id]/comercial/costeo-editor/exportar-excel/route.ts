// app/api/negocios/[id]/comercial/costeo-editor/exportar-excel/route.ts
// POST { estado: JSON del costeo que se ve en pantalla, presupuestos: tope NETO de cada hoja (mismo
// orden que estado.grupos) } → devuelve el .xlsx del costeo digital armado sobre la MISMA plantilla
// que el costeo automático (generarCosteoExcelDesdeEditor). Exporta lo que está en pantalla, aunque
// no se haya guardado. NO escribe nada en la base.
import { NextRequest, NextResponse } from 'next/server';
import { puedeVerNegocioAsignado, permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { generarCosteoExcelDesdeEditor, type HojaExportCosteo } from '@/app/lib/generar-costeo';
import { margenDeFila, MARGEN_VENTA_DEFECTO, type EstadoCosteoEditor } from '@/app/lib/costeo-editor';
import { IVA } from '@/app/lib/costeo-comparativo';
import { cargarNegocio } from '../../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const idH = request.headers.get('x-user-id');
  const rol = request.headers.get('x-user-rol');
  const userId = idH ? parseInt(idH) : null;
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  // Mismo acceso que VER el costeo (GET del editor): quien lo trabaja o el perfil de Compras.
  const p = await permisosCrudosDeUsuario(userId);
  const puedeTrabajar = rol === 'admin' || !!p.costeo_editor;
  if (!puedeTrabajar && !(p.compras_ver || p.compras_todo || p.compras))
    return NextResponse.json({ error: 'Sin acceso al costeo' }, { status: 403 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (puedeTrabajar && !(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    const body = await request.json().catch(() => null);
    const estado = body?.estado as EstadoCosteoEditor | null;
    if (!estado || !Array.isArray(estado.grupos)) return NextResponse.json({ error: 'Falta el costeo que está en pantalla.' }, { status: 400 });
    const presupuestos: unknown[] = Array.isArray(body?.presupuestos) ? body.presupuestos : [];
    const general = Number.isFinite(estado.margenVenta) ? estado.margenVenta : MARGEN_VENTA_DEFECTO;

    // Las hojas apagadas ("no ofertamos") no van, igual que no suman en pantalla.
    const hojas: HojaExportCosteo[] = estado.grupos.flatMap((g, k) => {
      if (g.ofertamos === false) return [];
      const neto = Number(presupuestos[k]);
      return [{
        nombre: g.nombre,
        presupuestoConIva: presupuestos[k] != null && Number.isFinite(neto) && neto > 0 ? Math.round(neto * IVA) : null,
        filas: g.filas.map(f => ({
          detalle: [f.detalle, f.complemento].filter(Boolean).join('\n'),
          unidad: (f.unidad || '').trim(),
          sku: f.skuProveedor || '',
          cantidad: f.esCostoAdicional ? null : f.cantidad,
          valorConIva: f.esCostoAdicional ? null : f.valorConIva,
          recargo: margenDeFila(f, g, general),
          costoRealUnitario: f.costoRealUnitario,
          costoAdicionalNeto: f.esCostoAdicional ? (f.costoAdicionalNeto ?? null) : null,
          links: [f.link1, f.link2, f.link3].map(l => (l || '').trim()),
        })),
      }];
    });
    if (!hojas.some(h => h.filas.length)) return NextResponse.json({ error: 'El costeo no tiene ítems para exportar.' }, { status: 422 });

    const buffer = await generarCosteoExcelDesdeEditor(hojas, estado.modalidad !== 'suma_alzada');
    const fecha = new Date().toISOString().slice(0, 10);
    const nombre = `COSTEO_${negocio.licitacion_codigo}_${fecha}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nombre.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error) {
    console.error('[comercial/costeo-editor/exportar-excel]', String(error));
    return NextResponse.json({ error: 'No se pudo armar el Excel' }, { status: 500 });
  }
}
