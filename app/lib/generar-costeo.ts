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
import { esFilaNoProducto } from '@/app/lib/planilla-costeo-parser';
import { desplegarItemsDesdeCaracteristicas } from '@/app/lib/manifiesto-desde-caracteristicas';

export type ModalidadCosteo = 'suma_alzada' | 'por_linea' | 'por_categoria';

export interface GrupoCosteo { nombre: string; items: ManifiestoLinea[] }

// Precio de mercado de un ítem (viene del buscador Serper). Opcional: si no hay precios,
// el costeo se genera igual que antes (columnas de precio vacías).
export interface PrecioMercadoItem {
  descripcion: string;                 // para casar con el ítem del manifiesto
  precio_neto: number | null;          // neto (sin IVA) → columna L "Costo unitario REAL"
  precio_iva: number | null;           // con IVA        → columna F "VALOR C/ IVA"
  tienda: string | null;
  link: string | null;
  score: number | null;
  nivel: string | null;                // exacta/alta/parcial/baja/nula
  alerta_unidad?: boolean;             // el resultado parece venir en pack/caja/rollo
  desde_cache?: boolean;
  total?: number;                      // cuántos resultados se encontraron
  alternativas?: Array<{ tienda: string; precio_iva: number; link: string; score: number }>;
}

export interface DatosCosteo {
  codigo: string;
  nombre: string;
  organismo: string;
  presupuesto_bruto: number | null;
  modalidad: ModalidadCosteo;
  grupos: GrupoCosteo[];   // 1 grupo = 1 hoja. suma_alzada → un único grupo con todo.
  precios?: PrecioMercadoItem[];  // precios de mercado por ítem (match por descripción)
}

// Normaliza una descripción para casar ítem ↔ precio (minúsculas, sin acentos, sin dobles espacios).
function normDesc(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// Estructura de la plantilla V3 (medida): hoja "Costeo" con ítems desde la fila 4 (20 filas
// base), totales en la 24 y resumen 25-32; hoja "AUDITORIA" que referencia Costeo!*4..*23.
const HOJA_COSTEO = 'Costeo';
const HOJA_AUDITORIA = 'AUDITORIA';
const FILA_ITEM_1 = 4;     // primera fila de ítems en la hoja de costeo
const FILA_MODELO = 5;     // fila a duplicar al expandir (trae las fórmulas por ítem)
const AUD_ITEM_1 = 3;      // primera fila de ítems en AUDITORIA
const MAX_HOJAS = 50; // tope de hojas por grupo (los grupos sobrantes se acumulan en el último)
const COL_PRESUPUESTO = 'F';   // celda amarilla "Presupuesto iva incluido" (junto a la etiqueta en D)
const OFFSET_PRESUPUESTO = 3;  // filas debajo de la fila de totales (24→27 en la plantilla base)

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
// falta y corrigiendo las referencias de los totales. Devuelve cuántos ítems escribió y en qué
// fila quedó la celda "Presupuesto iva incluido" (se mueve junto con el resto del resumen
// cuando el bloque de ítems se expande más allá de las filas base de la plantilla).
function rellenarCosteo(
  ws: ExcelJS.Worksheet,
  items: ManifiestoLinea[],
  precioDe?: (it: ManifiestoLinea) => PrecioMercadoItem | null,
): { n: number; filaPresupuesto: number } {
  return rellenarHoja(ws, items.length, (r, i) => {
    const it = items[i];
    ws.getCell(`A${r}`).value = i + 1;                                    // ITEM
    ws.getCell(`B${r}`).value = detalleDe(it);                           // Detalle de producto
    ws.getCell(`C${r}`).value = (it.unidad_medida || '').trim() || 'UN'; // Unidad de medida
    ws.getCell(`E${r}`).value = it.cantidad ?? null;                     // Cantidad original

    // Precio de mercado (si lo hay): F = con IVA (alimenta G neto y H total);
    // L = neto REAL (alimenta M total REAL, que es lo que la AUDITORIA suma).
    // Los links del producto encontrado van a las columnas Link 1/2/3 (S/T/V) de la plantilla:
    // Link 1 = mejor match, Link 2/3 = alternativas.
    const p = precioDe?.(it) || null;
    if (p) {
      if (p.precio_iva != null)  ws.getCell(`F${r}`).value = p.precio_iva;   // VALOR C/ IVA
      if (p.precio_neto != null) ws.getCell(`L${r}`).value = p.precio_neto;  // Costo unitario REAL
      if (p.tienda)              ws.getCell(`D${r}`).value = p.tienda;       // Sku de proveedor (tienda)
      if (p.link) ws.getCell(`S${r}`).value = { text: p.link, hyperlink: p.link } as any;   // Link 1
      const alt = p.alternativas || [];
      if (alt[1]?.link) ws.getCell(`T${r}`).value = { text: alt[1].link, hyperlink: alt[1].link } as any; // Link 2
      if (alt[2]?.link) ws.getCell(`V${r}`).value = { text: alt[2].link, hyperlink: alt[2].link } as any; // Link 3
    }
  });
}

// Esqueleto común de rellenarCosteo y del export del costeo digital: expande el bloque de ítems
// a N filas, deja que `escribirFila` llene cada una y corrige las referencias del resumen.
function rellenarHoja(
  ws: ExcelJS.Worksheet,
  N: number,
  escribirFila: (r: number, i: number) => void,
): { n: number; filaPresupuesto: number } {
  if (N === 0) return { n: 0, filaPresupuesto: FILA_ITEM_1 + 20 + OFFSET_PRESUPUESTO };

  const { totalsRow, baseRows } = detectarEstructura(ws);
  let delta = 0;
  if (N > baseRows) {
    delta = N - baseRows;
    ws.duplicateRow(FILA_MODELO, delta, true); // clona la fila modelo (fórmulas + estilo)
    // Las filas clonadas quedan como copias de una fórmula COMPARTIDA cuyo rango (p.ej. G4:G23) no
    // las cubre, y Excel rechaza el archivo ("no se puede abrir"/reparar) — pasaba con >20 ítems.
    // Se reescribe cada celda compartida del bloque como fórmula propia, ya trasladada a su fila.
    for (let r = FILA_ITEM_1; r < FILA_ITEM_1 + N; r++) {
      ws.getRow(r).eachCell(cell => {
        const v = cell.value as any;
        if (v && typeof v === 'object' && (v.sharedFormula || v.shareType === 'shared')) {
          cell.value = { formula: cell.formula } as any;
        }
      });
    }
  }

  for (let i = 0; i < N; i++) escribirFila(FILA_ITEM_1 + i, i);

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
  const baseTotalsRow = totalsRow || (FILA_ITEM_1 + baseRows);
  return { n: N, filaPresupuesto: baseTotalsRow + delta + OFFSET_PRESUPUESTO };
}

// Escribe el presupuesto (CON IVA) en la celda amarilla "Presupuesto iva incluido" de la hoja.
// SIEMPRE se escribe explícitamente (aunque sea null → celda vacía): la plantilla trae un valor
// de ejemplo ($5.000.000) que no debe quedar puesto por accidente en un costeo real.
function escribirPresupuesto(ws: ExcelJS.Worksheet, fila: number, valorConIva: number | null) {
  ws.getCell(`${COL_PRESUPUESTO}${fila}`).value = valorConIva ?? null;
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

// Deja el libro con una hoja de costeo por nombre y AUDITORIA al final. La primera reutiliza la
// hoja "Costeo" de la plantilla (renombrada); las demás la clonan. nombres = null → solo "Costeo".
function hojasDeCosteo(wb: ExcelJS.Workbook, nombres: string[] | null): ExcelJS.Worksheet[] {
  const src = wb.getWorksheet(HOJA_COSTEO) || wb.worksheets[0];
  if (!nombres) return [src];
  // Modelo limpio de la hoja Costeo para clonar los grupos siguientes.
  const baseModel = JSON.parse(JSON.stringify(src.model));
  // Sacar AUDITORIA y recrearla AL FINAL (pestañas queden grupo1..n | AUDITORIA).
  const au = wb.getWorksheet(HOJA_AUDITORIA);
  const audModel = au ? JSON.parse(JSON.stringify(au.model)) : null;
  if (au) wb.removeWorksheet(au.id);

  const usados = new Set<string>([HOJA_AUDITORIA.toLowerCase()]);
  const hojas = nombres.map((raw, k) => {
    const nombre = nombreHojaValido(raw, usados, `HOJA${k + 1}`);
    if (k === 0) { src.name = nombre; return src; }
    const ws = wb.addWorksheet(nombre);
    const m = JSON.parse(JSON.stringify(baseModel));
    m.name = nombre;
    ws.model = m;
    ws.name = nombre;
    return ws;
  });

  // Recrear AUDITORIA al final, con su estilo original.
  if (audModel) {
    const au2 = wb.addWorksheet(HOJA_AUDITORIA);
    const m = JSON.parse(JSON.stringify(audModel));
    m.name = HOJA_AUDITORIA;
    au2.model = m;
    au2.name = HOJA_AUDITORIA;
  }
  return hojas;
}

// ─── Función principal ────────────────────────────────────────────────────────

export async function generarCosteoExcel(d: DatosCosteo): Promise<Buffer> {
  const wb = await cargarPlantilla();

  const grupos = d.grupos.filter(g => g.items.length > 0);
  const refs: Array<{ hoja: string; fila: number }> = [];
  const itemsOrden: ManifiestoLinea[] = []; // ítems en el mismo orden que refs (para la hoja de precios)

  // Lookup de precios por descripción (match exacto y normalizado).
  const precioLookup = new Map<string, PrecioMercadoItem>();
  for (const p of (d.precios || [])) {
    if (p?.descripcion) precioLookup.set(normDesc(p.descripcion), p);
  }
  const precioDe = precioLookup.size
    ? (it: ManifiestoLinea) => precioLookup.get(normDesc(it.descripcion)) || null
    : undefined;

  // MULTI-HOJA (por_categoria / por_linea): una hoja por grupo, clonando "Costeo".
  // Cada hoja trae su propio subtotal; AUDITORIA suma todas → total único.
  const multiHoja = (d.modalidad === 'por_categoria' || d.modalidad === 'por_linea') && grupos.length > 1;

  if (multiHoja) {
    // Agrupar respetando el tope de hojas (los grupos sobrantes se acumulan en el último).
    const acotados: GrupoCosteo[] = [];
    grupos.forEach((g, idx) => {
      if (idx < MAX_HOJAS) acotados.push({ nombre: g.nombre, items: [...g.items] });
      else {
        console.warn(`[costeo] grupo "${g.nombre}": supera el tope de ${MAX_HOJAS} hojas; se acumula en la última.`);
        acotados[MAX_HOJAS - 1].items.push(...g.items);
      }
    });

    // por_linea usa LINEAn; por_categoria usa el nombre de la categoría saneado.
    const hojas = hojasDeCosteo(wb, acotados.map((g, k) => d.modalidad === 'por_linea' ? `LINEA${k + 1}` : g.nombre));
    acotados.forEach((g, k) => {
      const ws = hojas[k];
      const { filaPresupuesto } = rellenarCosteo(ws, g.items, precioDe);
      // por_linea: manda el presupuesto DE ESA línea si las bases lo especifican (mismo valor
      // en todos los ítems del grupo, ver ManifiestoLinea.presupuesto_linea); si no está
      // especificado, se usa el presupuesto global de la licitación como mejor aproximación.
      const presupuestoLinea = d.modalidad === 'por_linea'
        ? g.items.map(it => it.presupuesto_linea).find((v): v is number => v != null && v > 0) ?? null
        : null;
      escribirPresupuesto(ws, filaPresupuesto, presupuestoLinea ?? d.presupuesto_bruto ?? null);
      g.items.forEach((it, i) => { refs.push({ hoja: ws.name, fila: FILA_ITEM_1 + i }); itemsOrden.push(it); });
    });
  } else {
    // suma_alzada (o una sola categoría/línea): TODOS los ítems en la hoja "Costeo".
    const [ws] = hojasDeCosteo(wb, null);
    const todos = grupos.flatMap(g => g.items);
    const { filaPresupuesto } = rellenarCosteo(ws, todos, precioDe);
    escribirPresupuesto(ws, filaPresupuesto, d.presupuesto_bruto ?? null);
    todos.forEach((it, i) => { refs.push({ hoja: ws.name, fila: FILA_ITEM_1 + i }); itemsOrden.push(it); });
  }

  reconstruirAuditoria(wb, refs);

  // Hoja auditable de precios de mercado (solo si se cotizó).
  if (precioLookup.size) agregarHojaPreciosMercado(wb, itemsOrden, precioDe!);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ─── Export del costeo DIGITAL (el que se edita en pantalla) ─────────────────
// Mismo libro que generarCosteoExcel —misma plantilla V3, mismas hojas (Costeo o una por
// línea/categoría), mismo resumen y misma AUDITORIA— pero con lo que el usuario ya cargó en el
// editor: proveedor, valor c/IVA, recargo de cada fila, costo REAL y links. Las columnas
// calculadas siguen siendo las fórmulas de la plantilla; solo el multiplicador de "Precio unitario
// venta" (I) se escribe fila por fila, igual que en el Excel del asistente.

export interface FilaExportCosteo {
  detalle: string;
  unidad: string;
  sku: string;
  cantidad: number | null;
  valorConIva: number | null;
  recargo: number;                     // % sobre el costo → I = G × (1 + recargo/100)
  costoRealUnitario: number | null;
  costoAdicionalNeto: number | null;   // costo adicional a mano: va directo en H (sin cantidad ni precio)
  links: string[];                     // Link 1/2/3
}

export interface HojaExportCosteo {
  nombre: string;
  presupuestoConIva: number | null;
  filas: FilaExportCosteo[];
}

export async function generarCosteoExcelDesdeEditor(hojasIn: HojaExportCosteo[], multiHoja: boolean): Promise<Buffer> {
  const wb = await cargarPlantilla();
  const hojasDatos = hojasIn.filter(h => h.filas.length > 0);
  const multi = multiHoja && hojasDatos.length > 1;
  const datos: HojaExportCosteo[] = multi ? hojasDatos : [{
    nombre: HOJA_COSTEO,
    filas: hojasDatos.flatMap(h => h.filas),
    // Una sola hoja: su tope; si se juntaron varias, la suma de los que se conocen.
    presupuestoConIva: hojasDatos.length === 1 ? hojasDatos[0].presupuestoConIva
      : hojasDatos.reduce<number | null>((s, h) => h.presupuestoConIva != null ? (s ?? 0) + h.presupuestoConIva : s, null),
  }];
  const hojas = hojasDeCosteo(wb, multi ? datos.map(h => h.nombre) : null);
  const refs: Array<{ hoja: string; fila: number }> = [];

  datos.forEach((h, k) => {
    const ws = hojas[k];
    const { filaPresupuesto } = rellenarHoja(ws, h.filas.length, (r, i) => {
      const f = h.filas[i];
      ws.getCell(`A${r}`).value = i + 1;
      ws.getCell(`B${r}`).value = f.detalle;
      ws.getCell(`C${r}`).value = f.unidad || 'UN';
      ws.getCell(`D${r}`).value = f.sku || null;
      ws.getCell(`E${r}`).value = f.cantidad;
      ws.getCell(`F${r}`).value = f.valorConIva;
      ws.getCell(`L${r}`).value = f.costoRealUnitario;
      ['S', 'T', 'V'].forEach((col, j) => {
        const l = f.links[j];
        if (l) ws.getCell(`${col}${r}`).value = { text: l, hyperlink: l } as any;
      });
    });
    // H e I vienen como fórmulas compartidas desde la fila 4: pisar una sola celda deja huérfanas
    // a las demás, así que se reescribe el bloque entero. H lleva el costo adicional a mano donde lo
    // hay (en vez de E×G) e I el recargo de cada fila (las sobrantes quedan con el de la hoja).
    const { totalsRow } = detectarEstructura(ws);
    const recargoHoja = h.filas[0]?.recargo ?? 0;
    for (let r = FILA_ITEM_1; r < totalsRow; r++) {
      const f = h.filas[r - FILA_ITEM_1];
      ws.getCell(`H${r}`).value = f?.costoAdicionalNeto != null ? f.costoAdicionalNeto : { formula: `E${r}*G${r}` } as any;
      const recargo = f?.recargo ?? recargoHoja;
      ws.getCell(`I${r}`).value = { formula: `G${r}*${+(1 + recargo / 100).toFixed(6)}` } as any;
    }
    escribirPresupuesto(ws, filaPresupuesto, h.presupuestoConIva);
    h.filas.forEach((_, i) => refs.push({ hoja: ws.name, fila: FILA_ITEM_1 + i }));
  });

  reconstruirAuditoria(wb, refs);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ─── Hoja "PRECIOS MERCADO" ───────────────────────────────────────────────────
// Lista, por ítem, el mejor match del buscador + alternativas y señales para auditar
// (score, nivel de concordancia, alerta de unidad, tienda, link). No lleva fórmulas: es
// una hoja de respaldo para revisar/corregir los precios que se volcaron al costeo.
function agregarHojaPreciosMercado(
  wb: ExcelJS.Workbook,
  items: ManifiestoLinea[],
  precioDe: (it: ManifiestoLinea) => PrecioMercadoItem | null,
) {
  const ws = wb.addWorksheet('PRECIOS MERCADO');
  const cols = [
    { header: '#', width: 5 },
    { header: 'Ítem (descripción)', width: 46 },
    { header: 'Unidad', width: 10 },
    { header: 'Cantidad', width: 10 },
    { header: 'Mejor tienda', width: 20 },
    { header: 'Precio neto', width: 13 },
    { header: 'Precio c/IVA', width: 13 },
    { header: 'Match %', width: 9 },
    { header: 'Concordancia', width: 14 },
    { header: '⚠ Unidad', width: 10 },
    { header: 'Fuente', width: 9 },
    { header: 'Link', width: 50 },
    { header: 'Alternativas (tienda · c/IVA · match%)', width: 60 },
  ];
  ws.columns = cols.map(c => ({ width: c.width }));
  const head = ws.getRow(1);
  cols.forEach((c, i) => { head.getCell(i + 1).value = c.header; });
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

  items.forEach((it, idx) => {
    const p = precioDe(it);
    const alt = (p?.alternativas || [])
      .slice(0, 4)
      .map(a => `${a.tienda} · $${(a.precio_iva || 0).toLocaleString('es-CL')} · ${a.score}%`)
      .join('  |  ');
    const row = ws.getRow(idx + 2);
    row.getCell(1).value = idx + 1;
    row.getCell(2).value = detalleDe(it);
    row.getCell(3).value = (it.unidad_medida || '').trim() || 'UN';
    row.getCell(4).value = it.cantidad ?? null;
    row.getCell(5).value = p?.tienda || (p ? '—' : 'sin resultados');
    row.getCell(6).value = p?.precio_neto ?? null;
    row.getCell(7).value = p?.precio_iva ?? null;
    row.getCell(8).value = p?.score ?? null;
    row.getCell(9).value = p?.nivel || '';
    row.getCell(10).value = p?.alerta_unidad ? 'REVISAR' : '';
    row.getCell(11).value = p?.desde_cache ? 'caché' : (p ? 'web' : '');
    if (p?.link) row.getCell(12).value = { text: p.link.slice(0, 120), hyperlink: p.link };
    row.getCell(13).value = alt;
    // Resaltar baja confianza / alerta de unidad para que salten a la vista.
    const bajo = (p?.score ?? 100) < 60 || p?.alerta_unidad;
    if (bajo) {
      for (let c = 1; c <= 13; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
      }
    }
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: `M${items.length + 1}` };
}

// ─── Adaptador ViabilidadIAResult → DatosCosteo ──────────────────────────────

export function adaptarViabilidadACosteo(
  codigo: string,
  informe: ViabilidadIAResult,
): DatosCosteo {
  // ÚLTIMA BARRERA antes del Excel: filas de la tabla de CRITERIOS DE EVALUACIÓN que se colaron
  // en el manifiesto como si fueran productos (ver esFilaNoProducto).
  //
  // BUG REAL (17-ago-2026, caso 2345-128-LP26): el filtro se había puesto SOLO en el análisis
  // (analizarViabilidadIAV3, que es quien ESCRIBE el manifiesto). Pero regenerar el costeo NO
  // vuelve a analizar: POST /api/documentos/generar-costeo lee el manifiesto YA GUARDADO en
  // viabilidad_licitacion y arma el Excel de nuevo. Ese camino no pasaba por el filtro, así que
  // un informe viejo con los 30 ítems inflados seguía produciendo un Excel con los 30 —
  // indistinguible de "el fix no funcionó" desde la vista del usuario.
  //
  // Filtrar ACÁ (y no solo en el análisis) cubre TODOS los caminos que terminan en un Excel, hoy
  // y los que se agreguen después: el manifiesto guardado puede quedar sucio, pero el costeo que
  // se entrega ya no. Por eso el filtro vive en planilla-costeo-parser.ts (módulo puro): así lo
  // pueden usar tanto el análisis como este adaptador, sin importación circular.
  const manifiestoCrudo = Array.isArray(informe.manifiesto_productos)
    ? informe.manifiesto_productos : [];
  const descartados = manifiestoCrudo.filter(p => esFilaNoProducto(p?.descripcion || ''));
  let manifiesto = descartados.length
    ? manifiestoCrudo.filter(p => !esFilaNoProducto(p?.descripcion || ''))
    : manifiestoCrudo;
  if (descartados.length) {
    console.warn(`[costeo] ${codigo}: ${descartados.length}/${manifiestoCrudo.length} fila(s) del manifiesto guardado NO son productos (rótulos de formulario / tabla de criterios) — se excluyen del Excel:`,
      descartados.slice(0, 6).map(d => `"${String(d.descripcion).slice(0, 50)}"`).join(', '));
  }

  // FALLBACK CUANDO EL MANIFIESTO QUEDA VACÍO (25-ago-2026, caso 2981-225-LE26: sus 16 filas eran
  // 16/16 rótulos de anexos). Sin esto el Excel saldría EN BLANCO — que para el usuario es peor que
  // el bug original, porque no hay nada que corregir a mano. El listado del LLM (`productos.items`)
  // sigue vivo en el informe y en estos casos es justamente el correcto: el manifiesto lo había
  // pisado el parser. Se mapea con los MISMOS alias de campo que usa el análisis, para que el Excel
  // salga idéntico venga del shape que venga.
  const itemsLLMGuardados: any[] = Array.isArray((informe as any).productos?.items) ? (informe as any).productos.items
    : Array.isArray((informe as any).costeo?.items) ? (informe as any).costeo.items : [];
  // Mismo mapeo (alias de campo del análisis) para los dos rescates de abajo.
  const desdeItemLLM = (it: any) => ({
    linea: Number(String(it?.linea ?? 1).replace(/\D/g, '')) || 1,
    categoria: it?.categoria ?? null,
    descripcion: String(it?.nombre || it?.descripcion_exacta || it?.descripcion || '').trim(),
    modelo: String(it?.marca_modelo_referencia || it?.marca_modelo || '').trim(),
    cantidad: Number(it?.cantidad) || null,
    unidad_medida: String(it?.unidad_medida || '').trim(),
    unidad_inferida: !!it?.unidad_inferida,
    presupuesto_linea: Number(it?.presupuesto_linea) || null,
    tipo: String(it?.clasificacion || it?.tipo || 'generico'),
    ruta: String(it?.ruta || ''),
  });

  // RESCATE DEL MANIFIESTO COLAPSADO (30-sep-2026, 3477-80-LE26): informe guardado antes del fix en
  // el análisis, con un ítem genérico por línea (cantidad 0) y los productos reales como texto en
  // `caracteristicas` de `productos.items`. Regenerar el costeo no re-analiza, así que se despliegan
  // acá también. Solo si NINGÚN ítem del manifiesto trae cantidad (un manifiesto sano no se toca).
  if (manifiesto.length && manifiesto.every(m => !m.cantidad)) {
    const desplegados = desplegarItemsDesdeCaracteristicas(itemsLLMGuardados);
    if (desplegados) {
      console.warn(`[costeo] ${codigo}: manifiesto colapsado (${manifiesto.length} ítems sin cantidad) — se despliegan ${desplegados.length} productos desde productos.items[].caracteristicas.`);
      manifiesto = desplegados.map(desdeItemLLM).filter(it => it.descripcion && !esFilaNoProducto(it.descripcion)) as typeof manifiesto;
    }
  }

  if (!manifiesto.length && descartados.length) {
    const itemsLLM = itemsLLMGuardados;
    const rescatados = itemsLLM
      .map((it: any) => ({
        linea: Number(String(it?.linea ?? 1).replace(/\D/g, '')) || 1,
        categoria: it?.categoria ?? null,
        descripcion: String(it?.nombre || it?.descripcion_exacta || it?.descripcion || '').trim(),
        modelo: String(it?.marca_modelo_referencia || it?.marca_modelo || '').trim(),
        cantidad: Number(it?.cantidad) || null,
        unidad_medida: String(it?.unidad_medida || '').trim(),
        unidad_inferida: !!it?.unidad_inferida,
        presupuesto_linea: Number(it?.presupuesto_linea) || null,
        tipo: String(it?.clasificacion || it?.tipo || 'generico'),
        ruta: String(it?.ruta || ''),
      }))
      .filter(it => it.descripcion && !esFilaNoProducto(it.descripcion));
    if (rescatados.length) {
      console.warn(`[costeo] ${codigo}: el manifiesto quedó VACÍO tras el filtro (era 100% rótulos) — se cae a los ${rescatados.length} ítem(s) de productos.items del informe.`);
      manifiesto = rescatados as typeof manifiesto;
    } else {
      console.error(`[costeo] ${codigo}: manifiesto vacío tras el filtro y sin productos.items de respaldo — el Excel saldrá sin ítems.`);
    }
  }

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
    // La decisión de adjudicación de la v4 manda: GLOBAL («ofertar la totalidad») = una sola hoja,
    // aunque `modalidad.tipo` (campo heredado) quedara en por_linea tras un re-análisis (1090-17-LE26).
    const adjGlobal = String((informe as any).adjudicacion?.resultado || '').toUpperCase() === 'GLOBAL';
    if (tipoAdj === 'por_linea' && lineasOrden.length >= 2 && !adjGlobal) {
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
