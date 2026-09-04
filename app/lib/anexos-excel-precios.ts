// app/lib/anexos-excel-precios.ts
// Motor de auto-relleno de precios para el anexo económico cuando viene como .xlsx del organismo
// (formulario de oferta económica). Hermano de anexos-precios-ia.ts (el mismo problema para
// .docx) — a propósito NO comparte código de I/O con él: cada formato tiene su propio motor,
// solo se reusa lo que es PURO texto (esCandidatoDePrecioUnitario, matchearPreciosConIA).
//
// Caso real que motiva esto (2446-249-LE26, "2-_FORMULARIO_OFERTA_ECONÓMICA.xlsx"): encabezado
// N° | Producto | Cantidad | Valor Unitario Neto | Valor Total Neto, cantidad ya puesta por el
// organismo, columna de Total ya con fórmula (=E9*D9) — solo falta el precio unitario. Misma
// política que el motor de Word: NUNCA autocompletar cantidad ni total cruzando con el costeo
// (no hay certeza de que la cantidad del anexo sea la del costeo), solo el precio unitario.
import ExcelJS from 'exceljs';
import { esCandidatoDePrecioUnitario } from '@/app/lib/anexos-precios-columnas';
import { matchearPreciosConIA } from '@/app/lib/anexos-precios-ia';
import { resolverCamposSueltosConAuditor, type DatosAuditorAnexo } from '@/app/lib/anexos-auditor-fuente';
import type { ItemCosteoPrecio } from '@/app/lib/motor-comercial';

const RE_COLUMNA_PRODUCTO = /producto|descripci[oó]n|detalle|[ií]tem/i;
const RE_COLUMNA_TOTAL = /total/i; // "Valor Total Neto" — nunca calza con esCandidatoDePrecioUnitario (excluye "total")
// Vocabulario de pie ACOTADO a Excel — no se reusa el de anexos-totales-seccion.ts, que opera
// sobre TablaCruda de OOXML (párrafos/celdas de Word), no sobre celdas de una hoja de cálculo.
const RE_FIN_TABLA_EXCEL = /sumatoria|subtotal|total\s+neto|total\s+bruto|^iva\b/i;
// Filas de PIE, cada una por su propio rótulo — se evalúan en este orden (más específico primero)
// para que "Sumatoria Total Neto" no se confunda con "Total Bruto" ni con "IVA".
const RE_PIE_BRUTO = /total\s+bruto/i;
const RE_PIE_IVA = /\biva\b/i;
const RE_PIE_SUMATORIA = /sumatoria|subtotal|total\s+neto/i;
// "Plazo de entrega de los productos: _____ día (s) hábil(es)." — mismo patrón que ya usa el
// motor de Word vía resolverCamposSueltosConAuditor (anexos-auditor-fuente.ts), el blanco es una
// corrida de 2+ guiones bajos dentro del texto de una celda suelta (no una tabla).
const RE_PLAZO_ENTREGA = /plazo.*entrega/i;
const RE_BLANCO_SUBRAYADO = /_{2,}/;
const FILAS_A_MIRAR_ENCABEZADO = 30;
const FILAS_A_MIRAR_PIE = 15;
const MAX_FILAS_TABLA = 500; // tope de seguridad: una tabla de precios real nunca llega a esto

function letraColumna(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) { const r = (x - 1) % 26; s = String.fromCharCode(65 + r) + s; x = Math.floor((x - 1) / 26); }
  return s;
}

// Una celda de fórmula ya calculada trae { formula, result }; un valor trae el primitivo directo
// — mismo desenvolvimiento que usa motor-comercial.ts (parsearCosteo) para no duplicar el criterio.
function esFormula(v: unknown): boolean {
  return typeof v === 'object' && v !== null && 'formula' in (v as any);
}
function textoCelda(v: unknown): string {
  if (v == null) return '';
  const raw = esFormula(v) ? (v as any).result : v;
  if (raw && typeof raw === 'object' && 'richText' in (raw as any)) {
    return (raw as any).richText.map((t: any) => t.text).join('').trim();
  }
  return String(raw).trim();
}
function numeroCelda(v: unknown): number | null {
  if (v == null) return null;
  const raw = esFormula(v) ? (v as any).result : v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export interface FilaTablaExcel { fila: number; texto: string }

export interface TablaDetectada {
  hoja: string;
  filaFinTabla: number; // exclusiva: primera fila que NO es de ítem (pie o vacía)
  colProducto: number;
  colPrecioUnitario: number;
  colCantidad: number | null;
  colTotal: number | null;
  encabezadoPrecio: string; // texto literal de la columna, p.ej. "Valor Unitario Neto"
  filas: FilaTablaExcel[];
}

/**
 * Detecta la tabla de precios de una hoja: la fila de encabezado (una columna que pide precio
 * unitario + una columna de producto/descripción) y el rango de filas de ítems que sigue.
 *
 * El encabezado puede venir DUPLICADO (caso real: filas 7 y 8 idénticas) — sin lógica especial:
 * mientras la fila siguiente también parezca encabezado, se sigue bajando y se usa la ÚLTIMA
 * candidata como referencia (es la más cercana a los datos reales).
 */
export function detectarTablaPrecios(ws: ExcelJS.Worksheet): TablaDetectada | null {
  const maxCol = Math.min(ws.columnCount || 0, 30);
  const maxFilaEncabezado = Math.min(ws.rowCount || 0, FILAS_A_MIRAR_ENCABEZADO);

  let filaEncabezado = 0;
  let colProducto = 0;
  let colPrecioUnitario = 0;
  let colCantidad = 0;
  let colTotal = 0;
  let encabezadoPrecio = '';

  for (let r = 1; r <= maxFilaEncabezado; r++) {
    let cProducto = 0, cPrecio = 0, cCantidad = 0, cTotal = 0, textoPrecio = '';
    for (let c = 1; c <= maxCol; c++) {
      const h = textoCelda(ws.getCell(r, c).value);
      if (!h) continue;
      if (!cProducto && RE_COLUMNA_PRODUCTO.test(h)) cProducto = c;
      if (!cCantidad && /^cantidad/i.test(h)) cCantidad = c;
      if (!cPrecio && esCandidatoDePrecioUnitario(`x — ${h}`)) { cPrecio = c; textoPrecio = h; }
      else if (!cTotal && RE_COLUMNA_TOTAL.test(h)) cTotal = c;
    }
    if (cProducto && cPrecio) {
      // Encabezado válido en esta fila: la guardamos y seguimos mirando por si se repite abajo
      // (encabezado duplicado) — nos quedamos con la más profunda.
      filaEncabezado = r; colProducto = cProducto; colPrecioUnitario = cPrecio; colCantidad = cCantidad; colTotal = cTotal;
      encabezadoPrecio = textoPrecio;
    } else if (filaEncabezado) {
      break; // ya habíamos encontrado un encabezado y esta fila no repite el patrón: paramos acá
    }
  }
  if (!filaEncabezado) return null;

  const filas: FilaTablaExcel[] = [];
  let filaFinTabla = filaEncabezado + 1;
  for (let r = filaEncabezado + 1; r <= filaEncabezado + MAX_FILAS_TABLA; r++) {
    const filaCompleta = ws.getRow(r);
    let hayContenido = false;
    for (let c = 1; c <= maxCol; c++) {
      if (textoCelda(filaCompleta.getCell(c).value)) { hayContenido = true; break; }
    }
    if (!hayContenido) { filaFinTabla = r; break; }

    const textoProducto = textoCelda(ws.getCell(r, colProducto).value);
    let esFinPorPalabraDePie = false;
    for (let c = 1; c <= maxCol; c++) {
      if (RE_FIN_TABLA_EXCEL.test(textoCelda(ws.getCell(r, c).value))) { esFinPorPalabraDePie = true; break; }
    }
    if (!textoProducto || esFinPorPalabraDePie) { filaFinTabla = r; break; }

    filas.push({ fila: r, texto: textoProducto });
    filaFinTabla = r + 1;
  }
  if (!filas.length) return null;

  return {
    hoja: ws.name, filaFinTabla, colProducto, colPrecioUnitario,
    colCantidad: colCantidad || null, colTotal: colTotal || null, encabezadoPrecio, filas,
  };
}

export interface FilaPie { fila: number; texto: string }
export interface PieDetectado {
  sumatoria: FilaPie | null;
  iva: (FilaPie & { pct: number }) | null;
  bruto: FilaPie | null;
}

/**
 * Busca, en las filas que siguen a la tabla de ítems, el bloque de pie (Sumatoria/IVA/Total
 * Bruto) — SOLO en la columna de rótulos (misma columna que colPrecioUnitario, donde "Sumatoria
 * Total Neto"/"IVA (19%)"/"Valor Total Bruto" ya aparecieron en el caso real). Se evalúa en orden
 * BRUTO → IVA → SUMATORIA (más específico primero) para que un rótulo no se confunda con otro.
 */
export function detectarPie(ws: ExcelJS.Worksheet, tabla: TablaDetectada): PieDetectado {
  const pie: PieDetectado = { sumatoria: null, iva: null, bruto: null };
  for (let r = tabla.filaFinTabla; r < tabla.filaFinTabla + FILAS_A_MIRAR_PIE; r++) {
    const texto = textoCelda(ws.getCell(r, tabla.colPrecioUnitario).value);
    if (!texto) continue;
    if (!pie.bruto && RE_PIE_BRUTO.test(texto)) { pie.bruto = { fila: r, texto }; continue; }
    if (!pie.iva && RE_PIE_IVA.test(texto)) {
      const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(texto);
      if (m) pie.iva = { fila: r, texto, pct: Number(m[1].replace(',', '.')) };
      continue;
    }
    if (!pie.sumatoria && RE_PIE_SUMATORIA.test(texto)) { pie.sumatoria = { fila: r, texto }; continue; }
  }
  return pie;
}

/**
 * Corrige las fórmulas del pie para que sean aritméticamente consistentes ENTRE ELLAS — nunca
 * inventa un total, solo enlaza bien lo que el propio documento ya declara (Sumatoria = SUMA de la
 * columna Total de los ítems; IVA = Sumatoria × su propio %, leído del rótulo; Bruto = Sumatoria +
 * IVA). Se sobrescribe SIEMPRE que la fila y la columna existan, sin intentar adivinar si la
 * fórmula original ya estaba bien — mismo principio que costeo-comparativo.ts ("se implementó lo
 * que querían decir, no lo que dicen").
 *
 * BUG REAL (2446-249-LE26): la plantilla del organismo traía "Valor Total Bruto" = "=F9+F13" (el
 * total de la PRIMERA fila de ítem + el IVA, no la Sumatoria + el IVA) — con 1 solo ítem nadie lo
 * habría notado, pero con 3 el Total Bruto salía $4.725.509 en vez de $9.866.409. La Nota 2 del
 * propio formulario dice que ese valor "será considerado para la evaluación del criterio precio":
 * un total mal calculado ahí no es un detalle estético, es la oferta.
 */
export function corregirPie(ws: ExcelJS.Worksheet, tabla: TablaDetectada, pie: PieDetectado): void {
  if (!tabla.colTotal || !tabla.filas.length) return;
  const letra = letraColumna(tabla.colTotal);
  const primeraFila = tabla.filas[0].fila;
  const ultimaFila = tabla.filas[tabla.filas.length - 1].fila;

  if (pie.sumatoria) {
    ws.getCell(pie.sumatoria.fila, tabla.colTotal).value = { formula: `SUM(${letra}${primeraFila}:${letra}${ultimaFila})` } as any;
  }
  if (pie.iva && pie.sumatoria) {
    ws.getCell(pie.iva.fila, tabla.colTotal).value = { formula: `${letra}${pie.sumatoria.fila}*${pie.iva.pct}%` } as any;
  }
  if (pie.bruto && pie.sumatoria) {
    const formula = pie.iva
      ? `${letra}${pie.sumatoria.fila}+${letra}${pie.iva.fila}`
      : `${letra}${pie.sumatoria.fila}`;
    ws.getCell(pie.bruto.fila, tabla.colTotal).value = { formula } as any;
  }
}

export interface CampoSueltoExcel { fila: number; col: number; texto: string }

/** Campos de texto sueltos (fuera de la tabla) que el motor sabe resolver contra el Auditor
 *  Técnico — hoy solo "Plazo de entrega". Reusa resolverCamposSueltosConAuditor tal cual (mismo
 *  módulo puro que ya usa el motor de Word), solo cambia dónde se busca la celda y cómo se
 *  reemplaza el blanco (una corrida de guiones bajos dentro del texto, no un marcador de docx). */
export function detectarCamposSueltos(ws: ExcelJS.Worksheet, filaDesde: number): CampoSueltoExcel[] {
  const maxCol = Math.min(ws.columnCount || 0, 30);
  const maxFila = Math.min(ws.rowCount || 0, filaDesde + 40);
  const campos: CampoSueltoExcel[] = [];
  for (let r = filaDesde; r <= maxFila; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const texto = textoCelda(ws.getCell(r, c).value);
      if (texto && RE_PLAZO_ENTREGA.test(texto) && RE_BLANCO_SUBRAYADO.test(texto)) {
        campos.push({ fila: r, col: c, texto });
      }
    }
  }
  return campos;
}

export interface CampoSueltoResuelto extends CampoSueltoExcel { valor: string }

export function matchearCamposSueltos(campos: CampoSueltoExcel[], datosAuditor: DatosAuditorAnexo): CampoSueltoResuelto[] {
  if (!campos.length) return [];
  const matches = resolverCamposSueltosConAuditor(campos.map(c => c.texto), datosAuditor);
  const porTexto = new Map(matches.map(m => [m.etiqueta, m.valor]));
  return campos.flatMap(c => {
    const valor = porTexto.get(c.texto);
    return valor ? [{ ...c, valor }] : [];
  });
}

/** Reemplaza SOLO el blanco (la corrida de guiones bajos) por el valor — conserva el resto del
 *  texto de la celda tal cual (la nota, el "día(s) hábil(es)."). */
export function escribirCamposSueltos(ws: ExcelJS.Worksheet, resueltos: CampoSueltoResuelto[]): void {
  for (const r of resueltos) {
    ws.getCell(r.fila, r.col).value = r.texto.replace(RE_BLANCO_SUBRAYADO, r.valor);
  }
}

export interface CandidatoPrecio { fila: number; texto: string; itemDescripcion: string; precioUnitario: number }

/**
 * Cruza cada fila de la tabla contra los ítems del costeo — reusa matchearPreciosConIA
 * (anexos-precios-ia.ts) TAL CUAL, sin tocarlo: mismo match exacto + guard de palabra compartida +
 * respaldo IA por lotes ya probado en producción para Word. Solo arma las etiquetas en el mismo
 * contrato "<texto> — <columna>" que esa función y esCandidatoDePrecioUnitario ya exigen, y mapea
 * la respuesta de vuelta al número de fila.
 */
export async function matchearPreciosExcel(tabla: TablaDetectada, items: ItemCosteoPrecio[]): Promise<CandidatoPrecio[]> {
  if (!tabla.filas.length || !items.length) return [];

  const porEtiqueta = new Map(tabla.filas.map(f => [`${f.texto} — ${tabla.encabezadoPrecio}`, f]));
  const etiquetas = [...porEtiqueta.keys()];
  const matches = await matchearPreciosConIA(etiquetas, items);

  const out: CandidatoPrecio[] = [];
  for (const m of matches) {
    const fila = porEtiqueta.get(m.etiqueta);
    if (!fila) continue;
    out.push({ fila: fila.fila, texto: fila.texto, itemDescripcion: m.itemDescripcion, precioUnitario: m.precioUnitario });
  }
  return out;
}

export interface ResultadoRellenoExcel {
  completados: number;
  totalEscritoNeto: number | null;
  filasSinMatch: number[];
  pieCorregido: boolean;
}

/**
 * Escribe el precio unitario de cada match en su celda — nunca toca la celda de Total (sigue
 * siendo la fórmula del organismo, ej. =E9*D9, y se recalcula sola al abrir el archivo; mismo
 * principio que generar-costeo.ts: nunca se escribe sobre una celda que ya es fórmula) — y
 * SIEMPRE corrige el pie (Sumatoria/IVA/Total Bruto) para que sea aritméticamente consistente, ver
 * corregirPie. No serializa el buffer: el llamador decide cuándo (puede encadenar más escrituras,
 * ej. escribirCamposSueltos, antes de un solo wb.xlsx.writeBuffer() final).
 */
export function escribirPreciosExcel(wb: ExcelJS.Workbook, tabla: TablaDetectada, matches: CandidatoPrecio[]): ResultadoRellenoExcel {
  const ws = wb.getWorksheet(tabla.hoja);
  if (!ws) throw new Error(`No se encontró la hoja "${tabla.hoja}" al escribir los precios`);

  const porFila = new Map(matches.map(m => [m.fila, m]));
  let totalEscritoNeto = 0;
  let huboMatch = false;
  const filasSinMatch: number[] = [];

  for (const f of tabla.filas) {
    const match = porFila.get(f.fila);
    if (!match) { filasSinMatch.push(f.fila); continue; }
    ws.getCell(f.fila, tabla.colPrecioUnitario).value = match.precioUnitario;
    huboMatch = true;
    const cantidad = tabla.colCantidad ? numeroCelda(ws.getCell(f.fila, tabla.colCantidad).value) : null;
    totalEscritoNeto += (cantidad ?? 1) * match.precioUnitario;
  }

  const pie = detectarPie(ws, tabla);
  const pieCorregido = !!(pie.sumatoria || pie.iva || pie.bruto);
  if (pieCorregido) corregirPie(ws, tabla, pie);

  return { completados: matches.length, totalEscritoNeto: huboMatch ? totalEscritoNeto : null, filasSinMatch, pieCorregido };
}
