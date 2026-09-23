// app/api/compras/proyectos-obuma/exportar/route.ts
// GET — Excel con TODOS los datos de la pantalla "Proyectos (Obuma)": una fila por proyecto/centro
// de costo (hoja "Proyectos") y una fila por orden de compra (hoja "Órdenes de compra"), con link
// directo al documento en Obuma. Reusa el mismo listarProyectosObuma() de la pantalla — mismos
// datos, misma caché de 5 min.
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { listarProyectosObuma } from '@/app/lib/compras-proyectos-obuma';
import { ESTADOS_PROYECTO_OBUMA } from '@/app/lib/obuma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONTENT_TYPE_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const urlOcEnObuma = (compraOcId: string) => `https://app.obuma.cl/obuma2.0/mod-compras/oc/iframe-main.php?id=${compraOcId}`;

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

  try {
    const { proyectos } = await listarProyectosObuma(false);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Licitank';
    wb.created = new Date();

    const hojaP = wb.addWorksheet('Proyectos');
    hojaP.columns = [
      { header: 'Tiene ficha real', key: 'ficha', width: 15 },
      { header: 'Folio', key: 'folio', width: 8 },
      { header: 'Nombre / Centro de costo', key: 'nombre', width: 38 },
      { header: 'Cliente', key: 'cliente', width: 28 },
      { header: 'Referencia', key: 'referencia', width: 24 },
      { header: 'Estado', key: 'estado', width: 12 },
      { header: 'Fecha ingreso', key: 'fechaIngreso', width: 18 },
      { header: 'Fecha inicio', key: 'fechaInicio', width: 18 },
      { header: 'Presupuesto', key: 'presupuesto', width: 15 },
      { header: 'Costo', key: 'costo', width: 15 },
      { header: 'Precio neto (venta)', key: 'precioNeto', width: 16 },
      { header: 'Facturado (ficha Proyecto)', key: 'facturadoMonto', width: 18 },
      { header: 'Gasto en OC', key: 'totalGastado', width: 15 },
      { header: 'Cantidad OC', key: 'cantidadOc', width: 12 },
      { header: 'Facturado real (cruce facturas)', key: 'totalFacturado', width: 20 },
      { header: 'Cantidad facturas', key: 'cantidadFacturas', width: 14 },
      { header: 'Centros de costo', key: 'centros', width: 30 },
      { header: 'Negocio(s) nuestro(s)', key: 'negocios', width: 40 },
    ];
    hojaP.getRow(1).font = { bold: true };
    hojaP.getRow(1).alignment = { vertical: 'middle' };
    hojaP.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hojaP.columns.length } };

    for (const p of proyectos) {
      hojaP.addRow({
        ficha: p.tieneProyectoReal ? 'Sí' : 'No',
        folio: p.folio ?? '',
        nombre: p.tieneProyectoReal ? (p.nombre || `Proyecto #${p.folio}`) : (p.centros[0]?.nombre || 'Centro de costo sin nombre'),
        cliente: p.cliente || '',
        referencia: p.referencia || '',
        estado: p.estado ? `${p.estado}` : '',
        fechaIngreso: p.fechaIngreso || '',
        fechaInicio: p.fechaInicio || '',
        presupuesto: p.presupuesto ?? '',
        costo: p.costo ?? '',
        precioNeto: p.precioNeto ?? '',
        facturadoMonto: p.facturadoMonto ?? '',
        totalGastado: p.totalGastado,
        cantidadOc: p.cantidadOc,
        totalFacturado: p.totalFacturado,
        cantidadFacturas: p.cantidadFacturas,
        centros: p.centros.map(c => c.nombre || `(ID ${c.id})`).join(' · '),
        negocios: p.negociosCoincidentes.map(n => `${n.licitacionCodigo}${n.licitacionNombre ? ` — ${n.licitacionNombre}` : ''}`).join(' | '),
      });
    }
    for (const col of ['presupuesto', 'costo', 'precioNeto', 'facturadoMonto', 'totalGastado', 'totalFacturado']) {
      hojaP.getColumn(col).numFmt = '#,##0';
    }

    const hojaOc = wb.addWorksheet('Órdenes de compra');
    hojaOc.columns = [
      { header: 'Proyecto / Centro de costo', key: 'proyecto', width: 38 },
      { header: 'Folio OC', key: 'folio', width: 10 },
      { header: 'Proveedor', key: 'proveedor', width: 30 },
      { header: 'RUT proveedor', key: 'rut', width: 14 },
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Total', key: 'total', width: 15 },
      { header: 'Ver en Obuma', key: 'link', width: 40 },
    ];
    hojaOc.getRow(1).font = { bold: true };
    hojaOc.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hojaOc.columns.length } };

    for (const p of proyectos) {
      const nombreProyecto = p.tieneProyectoReal ? (p.nombre || `Proyecto #${p.folio}`) : (p.centros[0]?.nombre || 'Centro de costo sin nombre');
      for (const oc of p.ocs) {
        const row = hojaOc.addRow({
          proyecto: nombreProyecto,
          folio: oc.folio || '',
          proveedor: oc.proveedorNombre || '',
          rut: oc.proveedorRut || '',
          fecha: oc.fecha ? oc.fecha.slice(0, 10) : '',
          estado: oc.estado || '',
          total: oc.total,
        });
        row.getCell('link').value = { text: 'Abrir documento', hyperlink: urlOcEnObuma(oc.compraOcId) };
        row.getCell('link').font = { color: { argb: 'FF4F46E5' }, underline: true };
      }
    }
    hojaOc.getColumn('total').numFmt = '#,##0';

    const buffer = await wb.xlsx.writeBuffer();
    const fecha = new Date().toISOString().slice(0, 10);
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': CONTENT_TYPE_XLSX,
        'Content-Disposition': `attachment; filename="proyectos-obuma-${fecha}.xlsx"`,
      },
    });
  } catch (error: any) {
    console.error('[compras/proyectos-obuma/exportar][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo exportar.' }, { status: 500 });
  }
}
