// app/lib/motor-comercial.ts
// MOTOR COMERCIAL (Auditor Técnico, Fase 4, spec §7) — parsea el costeo real que el asistente
// subió como prueba de que cotizó el proyecto, y calcula las 4 alertas obligatorias (§7.4).
//
// Lee la MISMA plantilla que genera app/lib/generar-costeo.ts (TABLA_DE_COSTEO_V3): hoja
// "Costeo" (suma_alzada) o una hoja por línea/categoría (LINEA1, LINEA2…), ítems desde la fila
// 4. Columnas (letra → índice, spec §7.2):
//   A=ITEM  B=Detalle  C=Unidad  D=Sku proveedor  E=Cantidad original
//   F=VALOR C/IVA  G=Costo unitario neto  H=Costo total neto
//   I=Precio unitario venta  J=Precio unitario sin decimales  K=Precio total neto
//   L=Costo unitario REAL  M=Costo total neto REAL  (sección Compras, se llena después)
// La hoja "AUDITORIA" se ignora: es un espejo con fórmulas, no datos propios.
import ExcelJS from 'exceljs';

const FILA_ITEM_1 = 4;
const COL = { item: 1, detalle: 2, unidad: 3, cantidad: 5, costoUnitario: 7, costoTotal: 8, precioUnitario: 10, precioTotal: 11 };

export interface FilaCosteo {
  hoja: string; fila: number;
  item: number | null; detalle: string | null; unidad: string | null;
  cantidadOriginal: number | null;
  costoUnitarioNeto: number | null; costoTotalNeto: number | null;
  precioUnitarioSinDecimales: number | null; precioTotalNeto: number | null;
}

// Una celda de fórmula ya calculada trae { formula, result }; una celda de valor trae el
// primitivo directo. Ambas casuísticas conviven según cómo se guardó el Excel.
function num(v: unknown): number | null {
  if (v == null) return null;
  const raw = (typeof v === 'object' && v !== null && 'result' in (v as any)) ? (v as any).result : v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function texto(v: unknown): string | null {
  if (v == null) return null;
  const raw = (typeof v === 'object' && v !== null && 'result' in (v as any)) ? (v as any).result : v;
  const s = String(raw).trim();
  return s || null;
}

/** Parsea el .xlsx subido: todas las hojas salvo AUDITORIA, desde la fila 4 hasta la primera
 *  fila sin ITEM ni Detalle (fin del bloque de ítems de esa hoja). */
export async function parsearCosteo(buffer: Buffer): Promise<FilaCosteo[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const filas: FilaCosteo[] = [];

  wb.eachSheet(ws => {
    if (ws.name.trim().toUpperCase() === 'AUDITORIA') return;
    for (let r = FILA_ITEM_1; r <= 5000; r++) {
      const item = num(ws.getCell(r, COL.item).value);
      const detalle = texto(ws.getCell(r, COL.detalle).value);
      if (item == null && !detalle) break;   // fin del bloque de ítems de esta hoja
      filas.push({
        hoja: ws.name, fila: r, item, detalle,
        unidad: texto(ws.getCell(r, COL.unidad).value),
        cantidadOriginal: num(ws.getCell(r, COL.cantidad).value),
        costoUnitarioNeto: num(ws.getCell(r, COL.costoUnitario).value),
        costoTotalNeto: num(ws.getCell(r, COL.costoTotal).value),
        precioUnitarioSinDecimales: num(ws.getCell(r, COL.precioUnitario).value),
        precioTotalNeto: num(ws.getCell(r, COL.precioTotal).value),
      });
    }
  });
  return filas;
}

export interface AlertaMotorComercial { codigo: string; descripcion: string; detalle: string }

// Mismo criterio de normalización de unidad que auditor-tecnico-core.ts (alias es/plural/tildes),
// pero acá solo para COMPARAR igualdad textual, no para convertir — el motor comercial no
// convierte unidades, solo detecta que costeo y línea publicada dicen algo distinto.
function normUnidad(u: string | null): string {
  return (u || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/s$/, '');
}

const fmtCLP = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

/**
 * Las 4 alertas obligatorias del motor comercial (spec §7.4). Tolerancia CERO en la
 * discordancia costeo↔anexo (spec §7.3: "no existe rango por redondeo, para eso está la
 * columna sin decimales") — cualquier diferencia, por mínima que sea, alerta.
 */
export function calcularAlertasMotorComercial(args: {
  filas: FilaCosteo[];
  totalAnexoEconomico: number | null;
  presupuestoPublicado: number | null;
  lineasPublicadas: Array<{ linea: number; cantidad: number | null; unidad: string | null }>;
}): AlertaMotorComercial[] {
  const alertas: AlertaMotorComercial[] = [];
  const totalCosteo = args.filas.reduce((s, f) => s + (f.precioTotalNeto ?? 0), 0);
  const totalCosto = args.filas.reduce((s, f) => s + (f.costoTotalNeto ?? 0), 0);

  if (args.totalAnexoEconomico != null && Math.round((args.totalAnexoEconomico - totalCosteo) * 100) !== 0) {
    alertas.push({
      codigo: 'DISCORDANCIA_COSTEO_ANEXO',
      descripcion: 'Discordancia de información',
      detalle: `El anexo económico dice ${fmtCLP(args.totalAnexoEconomico)} pero el costeo suma ${fmtCLP(totalCosteo)}. Hay diferencias entre lo costeado y lo ofertado.`,
    });
  }

  const bajoCosto = args.filas.filter(f => f.precioTotalNeto != null && f.costoTotalNeto != null && f.precioTotalNeto < f.costoTotalNeto);
  if (bajoCosto.length > 0) {
    alertas.push({
      codigo: 'VENTA_BAJO_COSTO',
      descripcion: 'Venta bajo costo',
      detalle: `Ítem(s) ${bajoCosto.map(f => f.item ?? '?').join(', ')} del costeo tienen precio de venta por debajo del costo.`,
    });
  }

  if (args.presupuestoPublicado != null && Math.round((totalCosteo - args.presupuestoPublicado) * 100) > 0) {
    alertas.push({
      codigo: 'SOBRE_PRESUPUESTO',
      descripcion: 'Sobre presupuesto',
      detalle: `El total ofertado (${fmtCLP(totalCosteo)}) supera el presupuesto publicado (${fmtCLP(args.presupuestoPublicado)}).`,
    });
  }

  if (args.lineasPublicadas.length > 0) {
    const porLinea = new Map(args.lineasPublicadas.map(l => [l.linea, l]));
    const descuadres: number[] = [];
    for (const f of args.filas) {
      if (f.item == null) continue;
      const pub = porLinea.get(f.item);
      if (!pub) continue;
      const cantidadDistinta = pub.cantidad != null && f.cantidadOriginal != null && Number(pub.cantidad) !== Number(f.cantidadOriginal);
      const unidadDistinta = !!pub.unidad && !!f.unidad && normUnidad(pub.unidad) !== normUnidad(f.unidad);
      if (cantidadDistinta || unidadDistinta) descuadres.push(f.item);
    }
    if (descuadres.length > 0) {
      alertas.push({
        codigo: 'ERROR_DE_ORIGEN',
        descripcion: 'Error de origen',
        detalle: `Línea(s) ${descuadres.join(', ')}: la cantidad o unidad del costeo no coincide con la línea publicada. Se levanta antes de generar cualquier documento.`,
      });
    }
  }

  return alertas;
}

export function totalesDeCosteo(filas: FilaCosteo[]): { totalCostoNeto: number; totalPrecioNeto: number } {
  return {
    totalCostoNeto: filas.reduce((s, f) => s + (f.costoTotalNeto ?? 0), 0),
    totalPrecioNeto: filas.reduce((s, f) => s + (f.precioTotalNeto ?? 0), 0),
  };
}
