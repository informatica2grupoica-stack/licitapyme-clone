// app/lib/generar-costeo.ts
// Genera el Excel de costeo basado en TABLA_DE_COSTEO_V3.xlsx usando SheetJS.
// Estructura: hoja "Costeo" + hoja "AUDITORIA" con cross-refs.

import * as XLSX from 'xlsx';
import type { ManifiestoLinea, ViabilidadIAResult } from '@/app/lib/viabilidad-ia';

export interface DatosCosteo {
  codigo: string;
  nombre: string;
  organismo: string;
  presupuesto_bruto: number | null;
  lineas: Map<number, ManifiestoLinea[]>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function c(col: string, row: number) { return `${col}${row}`; }
function txt(v: string): XLSX.CellObject { return { t: 's', v }; }
function num(v: number): XLSX.CellObject { return { t: 'n', v }; }
function fml(f: string): XLSX.CellObject { return { t: 'n', f }; }
function set(ws: XLSX.WorkSheet, ref: string, cell: XLSX.CellObject) { ws[ref] = cell; }

// ─── Hoja Costeo ──────────────────────────────────────────────────────────────

function crearHojaCosteo(
  items: ManifiestoLinea[],
  presupuesto: number,
  sheetName: string,
): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const N = items.length;

  // Filas 1-2: cabeceras secciones
  set(ws, 'C1', txt('SECCION ASISTENTE DE GESTIÓN'));
  set(ws, 'L1', txt('SECCION COMPRAS'));
  set(ws, 'F2', txt('COSTEO ORIGINAL'));
  set(ws, 'J2', txt('PRECIOS PARA MERCADOPUBLICO'));
  set(ws, 'L2', txt('Proceso de compra'));

  // Fila 3: headers columnas
  const hdrs: [string, string][] = [
    ['A','ITEM'],['B','Detalle de producto'],['C','Unidad de medida'],
    ['D','Sku de proveedor'],['E','Cantidad  original'],['F','VALOR C/ IVA'],
    ['G','Costo unitario neto'],['H','Costo total neto'],['I','Precio unitario venta'],
    ['J','Precio unitario sin decimales'],['K','Precio total neto'],
    ['L','Costo unitario REAL'],['M','Costo total neto REAL'],['N','VARIACION'],
    ['O','Orden de compra'],['P','Factura recibida'],['Q','Pago realizado por:'],
    ['R','Estado de recepción'],['S','Link 1'],['T','Link 2'],['U','Sku propio'],['V','Link 3'],
  ];
  hdrs.forEach(([col, label]) => set(ws, c(col, 3), txt(label)));

  // Posiciones de filas
  const ITEM_START    = 4;
  const ITEM_END      = ITEM_START + N - 1;
  const TOTAL_ROW     = ITEM_END + 1;
  const PRES_NETO_ROW = TOTAL_ROW + 2;
  const PRES_IVA_ROW  = TOTAL_ROW + 3;
  const VENTA_ROW     = TOTAL_ROW + 4;
  const IVA_ROW       = TOTAL_ROW + 5;
  const UTIL_ROW      = TOTAL_ROW + 6;
  const MARGEN_ROW    = TOTAL_ROW + 7;
  const DIST_ROW      = TOTAL_ROW + 8;

  // Ítems
  items.forEach((it, idx) => {
    const r = ITEM_START + idx;
    const detalle = [it.descripcion, it.modelo].filter(Boolean).join(' - ');
    set(ws, c('A', r), num(idx + 1));
    set(ws, c('B', r), txt(detalle));
    set(ws, c('C', r), txt(it.unidad_medida || 'UN'));
    if (it.cantidad != null) set(ws, c('E', r), num(it.cantidad));
    set(ws, c('G', r), fml(`F${r}/1.19`));
    set(ws, c('H', r), fml(`E${r}*G${r}`));
    set(ws, c('I', r), fml(`G${r}*1.34`));
    set(ws, c('J', r), fml(`TRUNC(I${r},0)`));
    set(ws, c('K', r), fml(`J${r}*E${r}`));
    set(ws, c('L', r), num(0));
    set(ws, c('M', r), fml(`L${r}*E${r}`));
    set(ws, c('N', r), fml(`(L${r}/G${r})-1`));
    set(ws, c('R', r), txt('Pendiente'));
  });

  // Totales
  set(ws, c('E', TOTAL_ROW), fml(`SUM(E${ITEM_START}:E${ITEM_END})`));
  set(ws, c('F', TOTAL_ROW), fml(`K${TOTAL_ROW}<K${PRES_NETO_ROW}`));
  set(ws, c('H', TOTAL_ROW), fml(`SUM(H${ITEM_START}:H${ITEM_END})`));
  set(ws, c('K', TOTAL_ROW), fml(`SUM(K${ITEM_START}:K${ITEM_END})`));
  set(ws, c('M', TOTAL_ROW), fml(`SUM(M${ITEM_START}:M${ITEM_END})`));
  set(ws, c('N', TOTAL_ROW), fml(`AVERAGE(N${ITEM_START}:N${ITEM_END})`));

  set(ws, c('F', TOTAL_ROW + 1), fml(`H${TOTAL_ROW}`));

  // Presupuesto
  set(ws, c('F', PRES_NETO_ROW), fml(`K${TOTAL_ROW}`));
  set(ws, c('I', PRES_NETO_ROW), txt('valo C/iva'));
  set(ws, c('J', PRES_NETO_ROW), txt('Presupuesto licitación neto'));
  set(ws, c('K', PRES_NETO_ROW), fml(`F${PRES_IVA_ROW}/1.19`));
  set(ws, c('D', PRES_IVA_ROW), txt('Presupuesto iva incluido'));
  set(ws, c('F', PRES_IVA_ROW), num(presupuesto || 0));

  // Venta / IVA / Utilidad / Margen
  set(ws, c('H', VENTA_ROW), fml(`K${VENTA_ROW}*1.19`));
  set(ws, c('I', VENTA_ROW), txt('Total venta C/iva'));
  set(ws, c('J', VENTA_ROW), txt('Total neto venta'));
  set(ws, c('K', VENTA_ROW), fml(`K${TOTAL_ROW}`));
  set(ws, c('M', VENTA_ROW), txt('Total neto venta'));
  set(ws, c('N', VENTA_ROW), fml(`K${TOTAL_ROW}`));

  set(ws, c('H', IVA_ROW), fml(`K${VENTA_ROW}*19%`));
  set(ws, c('I', IVA_ROW), txt('venta iva'));
  set(ws, c('J', IVA_ROW), txt('Total costo neto'));
  set(ws, c('K', IVA_ROW), fml(`H${TOTAL_ROW}`));
  set(ws, c('M', IVA_ROW), txt('Total costo REAL'));
  set(ws, c('N', IVA_ROW), fml(`M${TOTAL_ROW}`));

  set(ws, c('J', UTIL_ROW), txt('Utilidad total neta'));
  set(ws, c('K', UTIL_ROW), fml(`K${VENTA_ROW}-K${IVA_ROW}`));
  set(ws, c('M', UTIL_ROW), txt('Utilidad neta REAL'));
  set(ws, c('N', UTIL_ROW), fml(`N${VENTA_ROW}-N${IVA_ROW}`));

  set(ws, c('J', MARGEN_ROW), txt('% Margen'));
  set(ws, c('K', MARGEN_ROW), { t: 'n', f: `1-(K${IVA_ROW}/K${VENTA_ROW})`, z: '0.0%' });
  set(ws, c('M', MARGEN_ROW), txt('% Margen'));
  set(ws, c('N', MARGEN_ROW), { t: 'n', f: `1-(M${IVA_ROW}/M${VENTA_ROW})`, z: '0.0%' });

  set(ws, c('J', DIST_ROW), txt('% distancia del tope'));
  set(ws, c('K', DIST_ROW), { t: 'n', f: `1-(K${VENTA_ROW}/K${PRES_NETO_ROW})`, z: '0.0%' });
  set(ws, c('M', DIST_ROW), txt('% de Variación'));
  set(ws, c('N', DIST_ROW), fml(`N${TOTAL_ROW}`));

  ws['!ref'] = `A1:V${DIST_ROW}`;
  ws['!cols'] = [
    { wch: 6 }, { wch: 52 }, { wch: 10 }, { wch: 14 }, { wch: 10 },
    { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 20 },
    { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 10 },
  ];

  // Metadata para AUDITORIA
  (ws as any).__meta = { ITEM_START, N, sheetName };
  return ws;
}

// ─── Hoja AUDITORIA ──────────────────────────────────────────────────────────

function crearHojaAuditoria(
  costeoSheets: Array<{ ws: XLSX.WorkSheet; sheetName: string }>,
): XLSX.WorkSheet {
  const wa: XLSX.WorkSheet = {};

  set(wa, 'F1', txt('Producto y proveedor - DATOS PARA ORDEN DE COMPRA'));

  const hdrs: [string, string][] = [
    ['A','ITEM'],['B','Detalle'],['C','Cantidad '],['D','Costo unitario REAL'],
    ['E','Costo total neto REAL'],['F','Marca'],['G','Modelo'],['H','Procedencia'],
    ['I','Razón social proveedor'],['J','Rut proveedor'],['K','Dirección proveedor'],
    ['L','Vendedor'],['M','Fono contacto'],['N','Mail'],['O','Plazo de entrega'],
    ['P','Número de OC'],['Q','Factura de compra'],['R','Link 1'],['S','Link 2'],
  ];
  hdrs.forEach(([col, label]) => set(wa, c(col, 2), txt(label)));

  let auditRow = 3;
  for (const { ws, sheetName } of costeoSheets) {
    const meta = (ws as any).__meta;
    if (!meta) continue;
    const { ITEM_START, N } = meta;
    for (let i = 0; i < N; i++) {
      const cr = ITEM_START + i;
      set(wa, c('A', auditRow), fml(`'${sheetName}'!A${cr}`));
      set(wa, c('B', auditRow), fml(`'${sheetName}'!B${cr}`));
      set(wa, c('C', auditRow), fml(`'${sheetName}'!E${cr}`));
      set(wa, c('D', auditRow), fml(`'${sheetName}'!L${cr}`));
      set(wa, c('E', auditRow), fml(`'${sheetName}'!M${cr}`));
      set(wa, c('R', auditRow), fml(`'${sheetName}'!S${cr}`));
      set(wa, c('S', auditRow), fml(`'${sheetName}'!T${cr}`));
      auditRow++;
    }
  }

  wa['!ref'] = `A1:S${Math.max(auditRow, 3)}`;
  wa['!cols'] = [
    { wch: 6 }, { wch: 50 }, { wch: 10 }, { wch: 16 }, { wch: 16 },
    { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 14 },
    { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 14 },
    { wch: 12 }, { wch: 16 }, { wch: 40 }, { wch: 40 },
  ];
  return wa;
}

// ─── Función principal ────────────────────────────────────────────────────────

export function generarCosteoExcel(d: DatosCosteo): Buffer {
  const wb = XLSX.utils.book_new();
  const pres = d.presupuesto_bruto ?? 0;

  const lineasOrdenadas = [...d.lineas.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, items]) => items.length > 0);

  const costeoSheets: Array<{ ws: XLSX.WorkSheet; sheetName: string }> = [];

  if (lineasOrdenadas.length <= 1) {
    const items = lineasOrdenadas[0]?.[1] ?? [];
    const ws = crearHojaCosteo(items, pres, 'Costeo');
    XLSX.utils.book_append_sheet(wb, ws, 'Costeo');
    costeoSheets.push({ ws, sheetName: 'Costeo' });
  } else {
    for (const [numLinea, items] of lineasOrdenadas) {
      const sheetName = `LINEA${numLinea}`;
      const ws = crearHojaCosteo(items, Math.round(pres / lineasOrdenadas.length), sheetName);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      costeoSheets.push({ ws, sheetName });
    }
  }

  XLSX.utils.book_append_sheet(wb, crearHojaAuditoria(costeoSheets), 'AUDITORIA');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// ─── Adaptador ViabilidadIAResult → DatosCosteo ──────────────────────────────

export function adaptarViabilidadACosteo(
  codigo: string,
  informe: ViabilidadIAResult,
): DatosCosteo {
  const manifiesto = Array.isArray(informe.manifiesto_productos)
    ? informe.manifiesto_productos : [];

  const lineas = new Map<number, ManifiestoLinea[]>();
  for (const p of manifiesto) {
    const nLinea = Number(p.linea) || 1;
    if (!lineas.has(nLinea)) lineas.set(nLinea, []);
    lineas.get(nLinea)!.push(p);
  }

  return {
    codigo,
    nombre: informe.meta?.nombre || '',
    organismo: informe.meta?.organismo || '',
    presupuesto_bruto: informe.presupuesto?.bruto ?? null,
    lineas,
  };
}
