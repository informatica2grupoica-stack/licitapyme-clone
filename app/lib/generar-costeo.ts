// app/lib/generar-costeo.ts
// Genera el Excel de costeo a partir de la plantilla REAL del usuario
// (app/lib/plantillas-costeo/tabla-costeo-v3.xlsx), preservando sus colores, fórmulas y la
// hoja AUDITORIA. Solo se RELLENAN los ítems (ITEM, Detalle, Unidad, Cantidad).
//   - suma_alzada  → 1 hoja "Costeo" con todos los ítems.
//   - por_categoria→ una hoja por categoría (FERRETERIA, PINTURA, …) clonando "Costeo".
//   - por_linea    → una hoja por línea (LINEA1, LINEA2, …) clonando "Costeo".
// La hoja AUDITORIA se reconstruye para referenciar todos los ítems de todas las hojas
// (subtotal por hoja + total único que suma todas las hojas).
// Se usa exceljs para no perder fórmulas compartidas ni los estilos/colores del template.

import path from 'path';
import ExcelJS from 'exceljs';
import type { ManifiestoLinea, ViabilidadIAResult } from '@/app/lib/viabilidad-ia';

export type ModalidadCosteo = 'suma_alzada' | 'por_linea' | 'por_categoria';

export interface GrupoCosteo { nombre: string; items: ManifiestoLinea[] }

export interface DatosCosteo {
  codigo: string;
  nombre: string;
  organismo: string;
  presupuesto_bruto: number | null;
  modalidad: ModalidadCosteo;
  grupos: GrupoCosteo[];   // 1 grupo = 1 hoja. suma_alzada → un único grupo con todo.
}

// Estructura de la plantilla V3 (medida): hoja "Costeo" con ítems desde la fila 4 (20 filas
// base), totales en la 24 y resumen 25-32; hoja "AUDITORIA" que referencia Costeo!*4..*23.
const HOJA_COSTEO = 'Costeo';
const HOJA_AUDITORIA = 'AUDITORIA';
const FILA_ITEM_1 = 4;     // primera fila de ítems en la hoja de costeo
const FILA_MODELO = 5;     // fila a duplicar al expandir (trae las fórmulas por ítem)
const AUD_ITEM_1 = 3;      // primera fila de ítems en AUDITORIA
const MAX_HOJAS = 50; // tope de hojas por grupo (los grupos sobrantes se acumulan en el último)

// Excel: nombre de hoja ≤31 chars, sin []:*?/\ y único en el libro. Sanitiza la
// categoría (o el fallback) a un nombre válido evitando choques.
function nombreHojaValido(raw: string, usados: Set<string>, fallback: string): string {
  let base = (raw || '').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  if (!base) base = fallback;
  let nombre = base;
  let k = 2;
  while (usados.has(nombre.toLowerCase())) {
    const suf = ` ${k++}`;
    nombre = base.slice(0, 31 - suf.length) + suf;
  }
  usados.add(nombre.toLowerCase());
  return nombre;
}

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

  const grupos = d.grupos.filter(g => g.items.length > 0);
  const refs: Array<{ hoja: string; fila: number }> = [];

  // MULTI-HOJA (por_categoria / por_linea): una hoja por grupo, clonando "Costeo".
  // Cada hoja trae su propio subtotal; AUDITORIA suma todas → total único.
  const multiHoja = (d.modalidad === 'por_categoria' || d.modalidad === 'por_linea') && grupos.length > 1;

  if (multiHoja) {
    const src = wb.getWorksheet(HOJA_COSTEO)!;
    // Modelo limpio de la hoja Costeo para clonar los grupos siguientes.
    const baseModel = JSON.parse(JSON.stringify(src.model));
    // Sacar AUDITORIA y recrearla AL FINAL (pestañas queden grupo1..n | AUDITORIA).
    const au = wb.getWorksheet(HOJA_AUDITORIA);
    const audModel = au ? JSON.parse(JSON.stringify(au.model)) : null;
    if (au) wb.removeWorksheet(au.id);

    // Agrupar respetando el tope de hojas (los grupos sobrantes se acumulan en el último).
    const acotados: GrupoCosteo[] = [];
    grupos.forEach((g, idx) => {
      if (idx < MAX_HOJAS) acotados.push({ nombre: g.nombre, items: [...g.items] });
      else {
        console.warn(`[costeo] grupo "${g.nombre}": supera el tope de ${MAX_HOJAS} hojas; se acumula en la última.`);
        acotados[MAX_HOJAS - 1].items.push(...g.items);
      }
    });

    const usados = new Set<string>([HOJA_AUDITORIA.toLowerCase()]);
    acotados.forEach((g, k) => {
      // por_linea usa LINEAn; por_categoria usa el nombre de la categoría saneado.
      const raw = d.modalidad === 'por_linea' ? `LINEA${k + 1}` : g.nombre;
      const nombre = nombreHojaValido(raw, usados, `HOJA${k + 1}`);
      let ws: ExcelJS.Worksheet;
      if (k === 0) {
        ws = src;            // el primer grupo reutiliza la hoja "Costeo" (renombrada).
        ws.name = nombre;
      } else {
        ws = wb.addWorksheet(nombre);
        const m = JSON.parse(JSON.stringify(baseModel));
        m.name = nombre;
        ws.model = m;
        ws.name = nombre;
      }
      rellenarCosteo(ws, g.items);
      g.items.forEach((_, i) => refs.push({ hoja: nombre, fila: FILA_ITEM_1 + i }));
    });

    // Recrear AUDITORIA al final, con su estilo original.
    if (audModel) {
      const au2 = wb.addWorksheet(HOJA_AUDITORIA);
      const m = JSON.parse(JSON.stringify(audModel));
      m.name = HOJA_AUDITORIA;
      au2.model = m;
      au2.name = HOJA_AUDITORIA;
    }
  } else {
    // suma_alzada (o una sola categoría/línea): TODOS los ítems en la hoja "Costeo".
    const ws = wb.getWorksheet(HOJA_COSTEO) || wb.worksheets[0];
    const todos = grupos.flatMap(g => g.items);
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

  // La ESTRUCTURA del Excel:
  //  1) por_categoria SOLO si el análisis lo marcó (informe.estructura_costeo), que se pone
  //     únicamente cuando el PARSER detectó rubros de producto reales (A/B/C tipo FERRETERIA).
  //     Las categorías que inventa la IA (p.ej. programas PDTI/PRODESAL) NO parten el costeo.
  //  2) si no, y la adjudicación es por_linea con ≥2 líneas → por_linea (1 hoja por línea).
  //  3) si no → suma_alzada (todo en una hoja "Costeo").
  const categoriasOrden: string[] = [];
  for (const p of manifiesto) {
    const c = (p.categoria || '').trim();
    if (c && !categoriasOrden.includes(c)) categoriasOrden.push(c);
  }
  const tipoAdj = String(informe.modalidad?.tipo || '').toLowerCase();
  const esPorCategoria = informe.estructura_costeo === 'por_categoria' && categoriasOrden.length >= 2;

  let modalidad: ModalidadCosteo;
  let grupos: GrupoCosteo[];

  if (esPorCategoria) {
    modalidad = 'por_categoria';
    const porCat = new Map<string, ManifiestoLinea[]>(categoriasOrden.map(c => [c, []]));
    const sinCat: ManifiestoLinea[] = [];
    for (const p of manifiesto) {
      const c = (p.categoria || '').trim();
      if (c && porCat.has(c)) porCat.get(c)!.push(p);
      else sinCat.push(p);
    }
    grupos = categoriasOrden.map(c => ({ nombre: c, items: porCat.get(c)! }));
    if (sinCat.length) grupos.push({ nombre: 'OTROS', items: sinCat });
  } else {
    const lineas = new Map<number, ManifiestoLinea[]>();
    for (const p of manifiesto) {
      const nLinea = Number(p.linea) || 1;
      if (!lineas.has(nLinea)) lineas.set(nLinea, []);
      lineas.get(nLinea)!.push(p);
    }
    const lineasOrden = [...lineas.entries()].sort((a, b) => a[0] - b[0]);
    if (tipoAdj === 'por_linea' && lineasOrden.length >= 2) {
      modalidad = 'por_linea';
      grupos = lineasOrden.map(([n, items]) => ({ nombre: `LINEA${n}`, items }));
    } else {
      modalidad = 'suma_alzada';
      grupos = [{ nombre: HOJA_COSTEO, items: manifiesto }];
    }
  }

  return {
    codigo,
    nombre: informe.meta?.nombre || '',
    organismo: informe.meta?.organismo || '',
    presupuesto_bruto: informe.presupuesto?.bruto ?? null,
    modalidad,
    grupos,
  };
}
