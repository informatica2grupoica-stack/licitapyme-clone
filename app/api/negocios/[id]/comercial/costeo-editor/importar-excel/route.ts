// app/api/negocios/[id]/comercial/costeo-editor/importar-excel/route.ts
// POST multipart { file: .xlsx, estado: JSON del costeo que se ve en pantalla } → LEE el Excel (mismo parser que el Motor Comercial:
// detalle, cantidad, costo neto, precio de venta y los links de «Link 1/2/3») y lo FUSIONA con ese estado (fusionarDesdeExcel).
// Devuelve el costeo ya fusionado + el resumen. NO escribe nada en la base: recién se guarda con el botón «Guardar» de siempre.
import ExcelJS from 'exceljs';
import { NextRequest, NextResponse } from 'next/server';
import { puedeVerNegocioAsignado, permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { parsearCosteo } from '@/app/lib/motor-comercial';
import { fusionarDesdeExcel, type EstadoCosteoEditor, type FilaExcelImport } from '@/app/lib/costeo-editor';
import { cargarNegocio } from '../../route';
import { yaCongelado } from '@/app/lib/congelamiento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };
const MAX_BYTES = 8 * 1024 * 1024;

/** Links por (hoja, fila): las columnas cuyo encabezado es «Link 1/2/3». */
async function linksPorFila(buf: Buffer): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    wb.eachSheet(ws => {
      let cols: number[] = [], hdr = 0;
      ws.eachRow((row, n) => {
        if (hdr) return;
        const c: number[] = [];
        row.eachCell((cell, i) => { if (/^link\s*\d?$/i.test(String(cell.text || '').trim())) c.push(i); });
        if (c.length) { cols = c; hdr = n; }
      });
      if (!hdr) return;
      ws.eachRow((row, n) => {
        if (n <= hdr) return;
        const ls = cols.map(i => {
          const v: any = row.getCell(i).value;
          return String((v && typeof v === 'object' ? (v.hyperlink || v.text || '') : v) ?? '').trim();
        }).filter(t => /^https?:\/\//i.test(t));
        if (ls.length) out.set(`${ws.name}|${n}`, ls);
      });
    });
  } catch { /* links ilegibles: se importa igual lo demás */ }
  return out;
}

export async function POST(request: NextRequest, { params }: Params) {
  const idH = request.headers.get('x-user-id');
  const rol = request.headers.get('x-user-rol');
  const userId = idH ? parseInt(idH) : null;
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (rol !== 'admin' && !(await permisosCrudosDeUsuario(userId)).costeo_editor)
    return NextResponse.json({ error: 'El costeo del sistema está habilitado solo para administradores o para quien tenga el permiso "Costeo — trabajarlo".' }, { status: 403 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a))) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (await yaCongelado(negocio.id, rol)) return NextResponse.json({ error: 'Este negocio ya se postuló: el costeo quedó congelado, de solo lectura.' }, { status: 409 });

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Falta el archivo Excel' }, { status: 400 });
    if (!/\.xlsx?m?$/i.test(file.name) || /\.xls$/i.test(file.name)) return NextResponse.json({ error: 'Sube un Excel .xlsx (el .xls antiguo no se puede leer).' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'El Excel pesa más de 8 MB.' }, { status: 400 });

    const buf = Buffer.from(await file.arrayBuffer());
    const [filas, links] = await Promise.all([parsearCosteo(buf), linksPorFila(buf)]);
    const out: FilaExcelImport[] = filas.map(f => ({
      hoja: f.hoja, fila: f.fila, detalle: f.detalle, unidad: f.unidad, cantidad: f.cantidadOriginal,
      costoNeto: f.costoUnitarioNeto, precioVenta: f.precioUnitarioSinDecimales, links: links.get(`${f.hoja}|${f.fila}`) ?? [], lineaPublicada: f.lineaPublicada,
    }));
    if (!out.length) return NextResponse.json({ error: 'No encontré filas de costeo en ese Excel. ¿Es la planilla de costeo (Detalle, Cantidad, Costo unit. neto…)?' }, { status: 422 });
    let actual: EstadoCosteoEditor | null = null;
    try { actual = JSON.parse(String(form?.get('estado') || 'null')); } catch { /* estado ilegible */ }
    if (!actual || !Array.isArray(actual.grupos)) return NextResponse.json({ error: 'Falta el costeo que está en pantalla.' }, { status: 400 });
    const r = fusionarDesdeExcel(actual, out);
    return NextResponse.json({ success: true, ...r, filasExcel: out.length });
  } catch (error) {
    console.error('[comercial/costeo-editor/importar-excel]', String(error));
    return NextResponse.json({ error: 'No se pudo leer el Excel' }, { status: 500 });
  }
}
