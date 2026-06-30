// app/lib/generar-costeo.ts
// Genera el Excel de costeo a partir de la plantilla REAL del usuario
// (app/lib/plantillas-costeo/tabla-costeo-v3.xlsx), preservando sus colores, fórmulas y la
// hoja AUDITORIA. Solo se RELLENAN los ítems (ITEM, Detalle, Unidad, Cantidad).
//   - modalidad suma_alzada → 1 hoja "Costeo" con todos los ítems.
//   - modalidad por_linea   → una hoja por línea (LINEA1, LINEA2, …) clonando "Costeo".
// La hoja AUDITORIA se reconstruye para referenciar todos los ítems de todas las hojas.
// Se usa exceljs para no perder fórmulas compartidas ni los estilos/colores del template.

import path from 'path';
import ExcelJS from 'exceljs';
import type { ManifiestoLinea, ViabilidadIAResult } from '@/app/lib/viabilidad-ia';

export type ModalidadCosteo = 'suma_alzada' | 'por_linea';

export interface DatosCosteo {
  codigo: string;
  nombre: string;
  organismo: string;
  presupuesto_bruto: number | null;
  modalidad: ModalidadCosteo;
  lineas: Map<number, ManifiestoLinea[]>;
}

// Estructura de la plantilla V3 (medida): hoja "Costeo" con ítems desde la fila 4 (20 filas
// base), totales en la 24 y resumen 25-32; hoja "AUDITORIA" que referencia Costeo!*4..*23.
const HOJA_COSTEO = 'Costeo';
const HOJA_AUDITORIA = 'AUDITORIA';
const FILA_ITEM_1 = 4;     // primera fila de ítems en la hoja de costeo
const FILA_MODELO = 5;     // fila a duplicar al expandir (trae las fórmulas por ítem)
const AUD_ITEM_1 = 3;      // primera fila de ítems en AUDITORIA
const MAX_HOJAS_LINEA = 50; // tope de hojas LINEA (las líneas sobrantes se acumulan en la última)

// Detalle = descripción + modelo. La unidad va en su PROPIA columna (C), no aquí.
function detalleDe(it: ManifiestoLinea): string {
  return [it.descripcion, it.modelo].filter(Boolean).join(' - ');
}

// Detecta la fila de totales (la que trae SUM(/AVERAGE() en alguna columna numérica) y
// cuántas filas base de ítems hay. Robusto si la plantilla cambia de tamaño.
function detectarEstructura(ws: ExcelJS.Worksheet): { totalsRow: number; baseRows: number } {
  let totalsRow = 0;
  for (let r = FILA_ITEM_1 + 1; r <= 2000 && !totalsRow; r++) {
    for (let c = 5; c <= 14; c++) {
      const v = ws.getCell(r, c).value as any;
      if (v && typeof v === 'object' && v.formula && /SUM\(|AVERAGE\(/i.test(v.formula)) { totalsRow = r; break; }
    }
  }
  const baseRows = totalsRow ? totalsRow - FILA_ITEM_1 : 20;
  return { totalsRow, baseRows };
}

// Desplaza las referencias de fila de una fórmula: toda referencia a una fila > pivot se
// corre +delta (lo mismo que hace Excel al insertar `delta` filas tras la fila `pivot`).
function desplazarReferencias(formula: string, pivot: number, delta: number): string {
  return formula.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g, (m, col, abs, row) => {
    const n = parseInt(row, 10);
    return n > pivot ? `${col}${abs}${n + delta}` : m;
  });
}

// Rellena una hoja de costeo (Costeo o LINEAn) con sus ítems, expandiendo el bloque si hace
// falta y corrigiendo las referencias de los totales. Devuelve cuántos ítems escribió.
function rellenarCosteo(ws: ExcelJS.Worksheet, items: ManifiestoLinea[]): number {
  const N = items.length;
  if (N === 0) return 0;

  const { totalsRow, baseRows } = detectarEstructura(ws);
  let delta = 0;
  if (N > baseRows) {
    delta = N - baseRows;
    ws.duplicateRow(FILA_MODELO, delta, true); // clona la fila modelo (fórmulas + estilo)
  }

  items.forEach((it, i) => {
    const r = FILA_ITEM_1 + i;
    ws.getCell(`A${r}`).value = i + 1;                                    // ITEM
    ws.getCell(`B${r}`).value = detalleDe(it);                           // Detalle de producto
    ws.getCell(`C${r}`).value = (it.unidad_medida || '').trim() || 'UN'; // Unidad de medida
    ws.getCell(`E${r}`).value = it.cantidad ?? null;                     // Cantidad original
  });

  // Si hay MENOS ítems que filas base, limpiar los placeholders sobrantes ("Producto N")
  // para que no aparezcan filas dummy entre los ítems reales y los totales.
  if (delta === 0 && totalsRow) {
    for (let r = FILA_ITEM_1 + N; r < totalsRow; r++) {
      for (const col of ['A', 'B', 'C', 'E']) ws.getCell(`${col}${r}`).value = null;
    }
  }

  // Tras expandir, el bloque de totales/resumen se desplazó `delta` filas y sus fórmulas
  // siguen apuntando a las filas viejas → corregir todas sus referencias.
  if (delta > 0 && totalsRow) {
    const desde = totalsRow + delta;
    for (let r = desde; r <= desde + 40; r++) {
      for (let c = 1; c <= 16; c++) {
        const cell = ws.getCell(r, c);
        const v = cell.value as any;
        if (v && typeof v === 'object' && v.formula && !v.sharedFormula) {
          cell.value = { formula: desplazarReferencias(v.formula, FILA_MODELO, delta) } as any;
        }
      }
    }
  }
  return N;
}

// Reconstruye la hoja AUDITORIA para que referencie, en orden, TODOS los ítems escritos en
// las hojas de costeo. `refs` = lista {hoja, fila} de cada ítem (en orden de aparición).
function reconstruirAuditoria(wb: ExcelJS.Workbook, refs: Array<{ hoja: string; fila: number }>) {
  const au = wb.getWorksheet(HOJA_AUDITORIA);
  if (!au) return;

  // Filas base de AUDITORIA (las que ya traen fórmula en A).
  let baseEnd = AUD_ITEM_1 - 1;
  for (let r = AUD_ITEM_1; r <= 2000; r++) {
    const v = au.getCell(r, 1).value as any;
    if (v && typeof v === 'object' && v.formula) baseEnd = r;
  }
  const baseRows = baseEnd - AUD_ITEM_1 + 1;

  if (refs.length > baseRows && baseRows > 0) {
    au.duplicateRow(AUD_ITEM_1 + 1, refs.length - baseRows, true); // clona una fila de auditoría
  }

  refs.forEach(({ hoja, fila }, i) => {
    const r = AUD_ITEM_1 + i;
    const q = /[^A-Za-z0-9_]/.test(hoja) ? `'${hoja}'` : hoja;
    au.getCell(`A${r}`).value = { formula: `${q}!A${fila}` } as any;  // ITEM
    au.getCell(`B${r}`).value = { formula: `${q}!B${fila}` } as any;  // Detalle
    au.getCell(`C${r}`).value = { formula: `${q}!E${fila}` } as any;  // Cantidad
    au.getCell(`D${r}`).value = { formula: `${q}!L${fila}` } as any;  // Costo unitario REAL
    au.getCell(`E${r}`).value = { formula: `${q}!M${fila}` } as any;  // Costo total neto REAL
  });

  // Limpiar filas de auditoría sobrantes (si la base tenía más que los ítems reales).
  for (let r = AUD_ITEM_1 + refs.length; r <= baseEnd; r++) {
    for (const col of ['A', 'B', 'C', 'D', 'E']) au.getCell(`${col}${r}`).value = null;
  }
}

async function cargarPlantilla(): Promise<ExcelJS.Workbook> {
  const ruta = path.join(process.cwd(), 'app', 'lib', 'plantillas-costeo', 'tabla-costeo-v3.xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(ruta);
  return wb;
}

// ─── Función principal ────────────────────────────────────────────────────────

export async function generarCosteoExcel(d: DatosCosteo): Promise<Buffer> {
  const wb = await cargarPlantilla();

  const lineasOrdenadas = [...d.lineas.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, items]) => items.length > 0);

  const refs: Array<{ hoja: string; fila: number }> = [];

  if (d.modalidad === 'por_linea' && lineasOrdenadas.length > 1) {
    const src = wb.getWorksheet(HOJA_COSTEO)!;
    // Modelo limpio de la hoja Costeo para clonar las líneas siguientes.
    const baseModel = JSON.parse(JSON.stringify(src.model));
    // Sacar AUDITORIA y recrearla AL FINAL (para que las pestañas queden LINEA1..n | AUDITORIA).
    const au = wb.getWorksheet(HOJA_AUDITORIA);
    const audModel = au ? JSON.parse(JSON.stringify(au.model)) : null;
    if (au) wb.removeWorksheet(au.id);

    // Agrupar líneas respetando el tope de hojas (las sobrantes se acumulan en la última).
    const grupos: ManifiestoLinea[][] = [];
    lineasOrdenadas.forEach(([numLinea, items], idx) => {
      if (idx < MAX_HOJAS_LINEA) grupos.push([...items]);
      else {
        console.warn(`[costeo] línea ${numLinea}: supera el tope de ${MAX_HOJAS_LINEA} hojas; se acumula en LINEA${MAX_HOJAS_LINEA}.`);
        grupos[MAX_HOJAS_LINEA - 1].push(...items);
      }
    });

    grupos.forEach((items, k) => {
      const nombre = `LINEA${k + 1}`;
      let ws: ExcelJS.Worksheet;
      if (k === 0) {
        // La primera línea reutiliza la hoja "Costeo" (renombrada).
        ws = src;
        ws.name = nombre;
      } else {
        ws = wb.addWorksheet(nombre);
        const m = JSON.parse(JSON.stringify(baseModel));
        m.name = nombre;
        ws.model = m;
        ws.name = nombre;
      }
      rellenarCosteo(ws, items);
      items.forEach((_, i) => refs.push({ hoja: nombre, fila: FILA_ITEM_1 + i }));
    });
  } else {
    // suma_alzada (o por_linea de una sola línea): TODOS los ítems en la hoja "Costeo".
    const ws = wb.getWorksheet(HOJA_COSTEO) || wb.worksheets[0];
    const todos = lineasOrdenadas.flatMap(([, items]) => items);
    rellenarCosteo(ws, todos);
    todos.forEach((_, i) => refs.push({ hoja: ws.name, fila: FILA_ITEM_1 + i }));
  }

  reconstruirAuditoria(wb, refs);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
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

  // La modalidad manda qué estructura se usa. Por defecto suma_alzada.
  const tipo = String(informe.modalidad?.tipo || '').toLowerCase();
  const modalidad: ModalidadCosteo = tipo === 'por_linea' ? 'por_linea' : 'suma_alzada';

  return {
    codigo,
    nombre: informe.meta?.nombre || '',
    organismo: informe.meta?.organismo || '',
    presupuesto_bruto: informe.presupuesto?.bruto ?? null,
    modalidad,
    lineas,
  };
}
