// app/api/anexos/analizar-xlsx/route.ts
// GET /api/anexos/analizar-xlsx?codigo=&documentoId=
// SOLO LECTURA: analiza el anexo económico en .xlsx/.xlsm y devuelve qué precios se completarían
// solos. Hermano de /api/anexos/analizar (que es para .docx) — motor separado a propósito, ver
// app/lib/anexos-excel-precios.ts.
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { cargarDocumentoXlsx, obtenerItemsCosteoParaAnexo, obtenerDatosAuditorParaAnexo } from '@/app/lib/anexos-datos';
import {
  detectarTablaPrecios, matchearPreciosExcel, detectarPie,
  detectarCamposSueltos, matchearCamposSueltos,
} from '@/app/lib/anexos-excel-precios';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const codigo = searchParams.get('codigo');
  const documentoId = searchParams.get('documentoId');

  if (!codigo || !documentoId) {
    return NextResponse.json({ error: 'Faltan parámetros: codigo, documentoId' }, { status: 400 });
  }
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  // Mismo gate que el resto del Anexo Creator (admin-only por ahora).
  if (!(await esAdmin(request))) {
    return NextResponse.json({ error: 'El creador de anexos está disponible solo para administradores por ahora' }, { status: 403 });
  }

  try {
    const [{ bufferOriginal, nombreOriginal }, itemsCosteo, datosAuditor] = await Promise.all([
      cargarDocumentoXlsx(codigo, documentoId),
      obtenerItemsCosteoParaAnexo(codigo),
      obtenerDatosAuditorParaAnexo(codigo),
    ]);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bufferOriginal as any);
    const ws = wb.worksheets.find(h => detectarTablaPrecios(h)) || wb.worksheets[0];
    const tabla = ws ? detectarTablaPrecios(ws) : null;

    if (!tabla || !ws) {
      return NextResponse.json({
        success: true, nombre: nombreOriginal, tabla: null,
        aviso: 'No se reconoció una tabla de precios (columna de producto + columna de precio unitario) en este archivo.',
      });
    }

    const matches = itemsCosteo.length ? await matchearPreciosExcel(tabla, itemsCosteo) : [];
    const porFila = new Map(matches.map(m => [m.fila, m]));
    const pie = detectarPie(ws, tabla);
    const camposSueltos = matchearCamposSueltos(detectarCamposSueltos(ws, tabla.filaFinTabla), datosAuditor);

    return NextResponse.json({
      success: true, nombre: nombreOriginal,
      tabla: {
        hoja: tabla.hoja, encabezadoPrecio: tabla.encabezadoPrecio,
        filas: tabla.filas.map(f => ({
          fila: f.fila, texto: f.texto,
          match: porFila.has(f.fila)
            ? { itemDescripcion: porFila.get(f.fila)!.itemDescripcion, precioUnitario: porFila.get(f.fila)!.precioUnitario }
            : null,
        })),
      },
      // Se informa acá para que el usuario lo vea ANTES de generar — la corrección real ocurre en
      // /api/anexos/generar-xlsx, este endpoint es solo lectura.
      pieDetectado: !!(pie.sumatoria || pie.iva || pie.bruto),
      camposSueltos: camposSueltos.map(c => ({ texto: c.texto, valor: c.valor })),
      sinCosteo: itemsCosteo.length === 0,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 400 });
  }
}
