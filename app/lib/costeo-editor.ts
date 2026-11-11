// app/lib/costeo-editor.ts
// COSTEO EN EL SISTEMA — el costeo se edita como una planilla dentro del negocio (pestaña
// "Costeo", arriba del Auditor Técnico), sin bajar un Excel, llenarlo aparte y volver a subirlo.
//
// Reusa la MISMA estructura que ya arma generar-costeo.ts para el Excel (adaptarViabilidadACosteo:
// una hoja "Costeo" en suma_alzada, o una hoja por línea/categoría) y las MISMAS fórmulas que trae
// la plantilla real (tabla-costeo-v3.xlsx, hoja "Costeo", columnas F→K — ver la cabecera de
// generar-costeo.ts):
//   G (Costo unitario neto)        = F / 1.19            (F = "VALOR C/ IVA", precio de mercado)
//   H (Costo total neto)           = E * G                (E = cantidad)
//   I (Precio unitario venta)      = G * (1 + margen)      margen fijo de la plantilla: 27%
//   J (Precio unitario s/decimales)= TRUNC(I, 0)           es lo que de verdad se oferta en MP
//   K (Precio total neto)          = J * E
// Acá el margen es UN número editable para todo el costeo, y ese global es el que manda salvo que
// se lo pise más adentro: una hoja puede tener el suyo (GrupoEditorCosteo.margenVenta) y una FILA
// también (FilaEditorCosteo.margenVenta) — cascada fila → hoja → global. Es literal lo que hace el
// Excel del asistente, donde el multiplicador va escrito en cada celda y puede cambiar de una fila
// a la otra. Nunca se le pide al usuario tipear el precio de venta a mano: se deriva del costo.
//
// Misma forma de fila que consume motor-comercial.ts (FilaCosteo) — así las 4 alertas del Motor
// Comercial y el auto-precarga del checklist no distinguen si el costeo vino de un .xlsx subido o
// de acá.
import type { DatosCosteo, ModalidadCosteo } from '@/app/lib/generar-costeo';
import { itemsPrecioDeCosteo, type FilaCosteo, type ItemCosteoPrecio } from '@/app/lib/motor-comercial';
import { tieneRespaldoLink, entradaComparativoDeFilas, type EntradaComparativo } from '@/app/lib/costeo-comparativo';
import { numeroDeLinea } from '@/app/lib/auditor-tecnico-core';
import pool from '@/app/lib/db';

import {
  MARGEN_VENTA_DEFECTO, uid, normDesc, mismoProducto, casiIgual, mismoProductoEnSuLinea,
  paresReescritos, palabrasDeProducto, fusionarConViabilidad, filaTrabajada,
  filasQueViabilidadYaNoTrae, quitarFilasQueViabilidadYaNoTrae,
  type FilaEditorCosteo, type GrupoEditorCosteo, type EstadoCosteoEditor,
} from '@/app/lib/costeo-editor-fusion';
// Re-exportados: el resto del código los importa desde aquí desde siempre.
export { MARGEN_VENTA_DEFECTO, fusionarConViabilidad, filasQueViabilidadYaNoTrae, quitarFilasQueViabilidadYaNoTrae };
export type { FilaEditorCosteo, GrupoEditorCosteo, EstadoCosteoEditor };




/** Recargo con el que se vende UNA fila: el suyo si lo tiene, si no el de su hoja, si no el del
 *  costeo completo. Cascada de tres niveles — el global es el que manda salvo que alguien haya
 *  puesto un número a mano más adentro (ver FilaEditorCosteo.margenVenta). */
export function margenDeFila(
  fila: { margenVenta?: number | null },
  grupo: { margenVenta?: number | null },
  general: number,
): number {
  if (Number.isFinite(fila.margenVenta as number)) return fila.margenVenta as number;
  if (Number.isFinite(grupo.margenVenta as number)) return grupo.margenVenta as number;
  return Number.isFinite(general) ? general : MARGEN_VENTA_DEFECTO;
}

/** Las 4 columnas que se calculan solas — MISMA cadena de fórmulas que la plantilla real
 *  (F→G→H→I→J→K). null en cascada si falta el dato de entrada (F o cantidad), igual que Excel. */
export function calcularFormulas(f: FilaEditorCosteo, margenVenta: number) {
  const costoUnitario = f.valorConIva != null ? f.valorConIva / 1.19 : null;
  const costoTotal = f.cantidad != null && costoUnitario != null ? f.cantidad * costoUnitario : null;
  const precioUnitario = costoUnitario != null ? costoUnitario * (1 + margenVenta / 100) : null;
  const precioUnitarioSinDecimales = precioUnitario != null ? Math.trunc(precioUnitario) : null;
  const precioTotal = f.cantidad != null && precioUnitarioSinDecimales != null ? f.cantidad * precioUnitarioSinDecimales : null;
  return { costoUnitario, costoTotal, precioUnitario, precioUnitarioSinDecimales, precioTotal };
}

/** Primera carga: arma la planilla editable desde el manifiesto de viabilidad — mismos grupos que
 *  arma generar-costeo.ts (global o por línea/categoría, según lo que diga el informe). El precio
 *  de mercado (F) queda en blanco: se completa acá (a mano, o pegando el link donde se cotizó) y
 *  todo lo demás se deriva solo. */
export function datosCosteoAEditor(datos: DatosCosteo): EstadoCosteoEditor {
  const grupos: GrupoEditorCosteo[] = datos.grupos
    .filter(g => g.items.length > 0)
    .map(g => {
      const m = /^LINEA(\d+)$/i.exec(g.nombre.trim());
      return {
        nombre: g.nombre,
        linea: m ? Number(m[1]) : null,
        ofertamos: true,
        filas: g.items.map((it, i) => ({
          id: uid(),
          item: i + 1,
          lineaReal: numeroDeLinea((it as any).linea) ?? null,
          detalle: [it.descripcion, it.modelo].filter(Boolean).join(' - '),
          unidad: (it.unidad_medida || '').trim() || 'UN',
          skuProveedor: '',
          cantidad: it.cantidad ?? null,
          valorConIva: null,
          costoRealUnitario: null,
          link1: '', link2: '', link3: '',
        })),
      };
    });
  return { modalidad: datos.modalidad, margenVenta: MARGEN_VENTA_DEFECTO, grupos };
}


/** Al re-analizar, corrige NOMBRE y CANTIDAD de las filas que ya están cuando el documento cambió —
 *  decisión del dueño (28-oct-2026, 3712-74-LP26: «al re-analizar el costeo se debería actualizar
 *  solo»). Solo se pisa lo que vino del documento y nadie tocó: la fila tiene todavía el valor que
 *  traía el informe ANTERIOR (`anterior`). Un detalle complementado a mano (`detalleBase`) cambia solo
 *  su parte original. Diferencias de forma («&quot;», coma/punto) se corrigen siempre. Nunca toca
 *  precio, links, SKU, costo real, recargo ni filas de Compras o costos adicionales. */
export function corregirDesdeViabilidad(
  actual: EstadoCosteoEditor,
  nuevo: EstadoCosteoEditor,
  anterior: EstadoCosteoEditor | null,
): { estado: EstadoCosteoEditor; corregidos: number } {
  const frescas = nuevo.grupos.flatMap(g => g.filas).filter(f => f.detalle?.trim());
  const viejas = anterior?.grupos.flatMap(g => g.filas) ?? [];
  const reescritos = paresReescritos(actual, frescas);
  let corregidos = 0;
  const grupos = actual.grupos.map(g => ({
    ...g,
    filas: g.filas.map(f => {
      if (f.esCostoAdicional || f.agregadoPorCompras || !f.detalle?.trim()) return f;
      const original = f.detalleBase ?? f.detalle;
      // Nombre reescrito: se toma el nuevo solo si la fila aún tiene el nombre del informe anterior.
      const fresca = mismoProductoEnSuLinea(frescas, original, f.lineaReal) ?? reescritos.get(f);
      if (!fresca) return f;
      // El nombre EXACTO del informe anterior manda: un nombre cortado («MONTURA DE PRUEBA DE») calza por prefijo con
      // varias filas y volvía ambiguo el cruce, y la fila con el nombre viejo («…pediátrica $1.100.000») no se corregía.
      const vieja = viejas.find(x => x.detalle === original) ?? mismoProductoEnSuLinea(viejas, original, f.lineaReal);
      const out = { ...f };
      if (fresca.detalle !== original && (normDesc(fresca.detalle) === normDesc(original) || vieja?.detalle === original || (f.detalleBase == null && casiIgual(original, fresca.detalle))
        // Fila SIN trabajo y sin complemento a mano cuyo nombre es el mismo producto con algo pegado
        // («…pediátrica $1.100.000»: el presupuesto de la línea leído como parte del nombre): nadie
        // escribió ese texto, se deja el del documento.
        || (f.detalleBase == null && !filaTrabajada(f) && mismoProducto(original, fresca.detalle)))) {
        if (f.detalleBase == null) out.detalle = fresca.detalle;
        else if (f.detalle.startsWith(f.detalleBase)) { out.detalle = fresca.detalle + f.detalle.slice(f.detalleBase.length); out.detalleBase = fresca.detalle; }
      }
      if (fresca.cantidad != null && fresca.cantidad !== f.cantidad && (f.cantidad == null || vieja?.cantidad === f.cantidad)) out.cantidad = fresca.cantidad;
      if (out.detalle === f.detalle && out.cantidad === f.cantidad) return f;
      corregidos++;
      return out;
    }),
  }));
  return { estado: { ...actual, grupos }, corregidos };
}

/** Al re-analizar, deja las filas de cada hoja en el orden del documento (el de `nuevo`, que sale del
 *  anexo económico) — decisión del dueño (28-oct-2026, 2446-307-LE26: los ítems que agregaba el
 *  re-análisis quedaban al final). Una fila que no viene del documento (agregada a mano, de Compras,
 *  costo adicional) sigue pegada detrás de la fila que hoy tiene antes. Solo cambia el orden y el
 *  número de ítem; nunca el contenido. */
export function ordenarComoViabilidad(
  actual: EstadoCosteoEditor,
  nuevo: EstadoCosteoEditor,
): { estado: EstadoCosteoEditor; reordenados: number } {
  const frescas = nuevo.grupos.flatMap(g => g.filas).filter(f => f.detalle?.trim());
  const reescritos = paresReescritos(actual, frescas);
  let reordenados = 0;
  const grupos = actual.grupos.map(g => {
    const usadas = new Set<number>();
    let previa = -1;
    const conPos = g.filas.map((f, i) => {
      const k = f.esCostoAdicional || f.agregadoPorCompras || !f.detalle?.trim() ? -1
        : frescas.findIndex((x, j) => !usadas.has(j) && (mismoProducto(x.detalle, f.detalleBase ?? f.detalle) || reescritos.get(f) === x));
      if (k >= 0) { usadas.add(k); previa = k; }
      return { f, pos: k >= 0 ? k : previa, i };
    });
    const ordenadas = [...conPos].sort((a, b) => a.pos - b.pos || a.i - b.i);
    if (ordenadas.every((x, i) => x.i === i)) return g;
    reordenados += ordenadas.filter((x, i) => x.i !== i).length;
    return { ...g, filas: ordenadas.map((x, i) => ({ ...x.f, item: i + 1 })) };
  });
  return { estado: { ...actual, grupos }, reordenados };
}


/** Reparte TODAS las filas del costeo (sin importar en qué hoja estén hoy) en una hoja por línea
 *  REAL — usa `lineaReal` de cada fila, no el nombre de su hoja de origen. Las filas sin línea
 *  conocida (agregadas a mano, sin match con el manifiesto) quedan juntas en "Sin línea".
 *
 *  Para cuando el análisis clasificó la licitación como global pero las bases en realidad arman
 *  canastas/líneas independientes con total propio (caso real 03-sep-2026, 1271359-92-LE26: 2
 *  "CANASTA N°" con su propio total en el Formulario de Oferta Económica, aunque el informe decía
 *  modalidad "suma_alzada"). Es una corrección MANUAL, acotada a este costeo — no toca la
 *  modalidad guardada en el informe de viabilidad ni el checklist del Auditor Técnico. */
/** Baja el recargo propio de una hoja a cada una de sus filas que no tenga uno. Se usa al
 *  separar/unir hojas: si no, mover una fila de hoja le cambia el precio en silencio (la hoja de
 *  destino vende con otro recargo). Con el margen por fila esa decisión ya se puede conservar. */
function fijarMargenEnFilas(g: GrupoEditorCosteo): FilaEditorCosteo[] {
  if (!Number.isFinite(g.margenVenta as number)) return g.filas;
  return g.filas.map(f => Number.isFinite(f.margenVenta as number) ? f : { ...f, margenVenta: g.margenVenta as number });
}

export function separarPorLinea(estado: EstadoCosteoEditor): EstadoCosteoEditor {
  const porLinea = new Map<number, GrupoEditorCosteo>();
  const sinLinea: FilaEditorCosteo[] = [];
  for (const g of estado.grupos) {
    for (const f of fijarMargenEnFilas(g)) {
      if (f.lineaReal == null) { sinLinea.push(f); continue; }
      if (!porLinea.has(f.lineaReal)) porLinea.set(f.lineaReal, { nombre: `Línea ${f.lineaReal}`, linea: f.lineaReal, ofertamos: true, filas: [] });
      porLinea.get(f.lineaReal)!.filas.push(f);
    }
  }
  const grupos = [...porLinea.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, g]) => ({ ...g, filas: g.filas.map((f, i) => ({ ...f, item: i + 1 })) }));
  if (sinLinea.length) grupos.push({ nombre: 'Sin línea', linea: null, ofertamos: true, filas: sinLinea.map((f, i) => ({ ...f, item: i + 1 })) });
  return { ...estado, modalidad: 'por_linea', grupos: grupos.length ? grupos : estado.grupos };
}

/** Reverso de separarPorLinea: junta todas las hojas en una sola. Las filas de hojas marcadas
 *  "no ofertamos" NO se traen de vuelta — es la misma decisión que dejarlas fuera, no un accidente
 *  al unir. */
export function unirEnUnaHoja(estado: EstadoCosteoEditor): EstadoCosteoEditor {
  const filas = estado.grupos.filter(g => g.ofertamos).flatMap(fijarMargenEnFilas).map((f, i) => ({ ...f, item: i + 1 }));
  return { ...estado, modalidad: 'suma_alzada', grupos: [{ nombre: 'Costeo', linea: null, ofertamos: true, filas }] };
}

/** ¿Esta fila ya está cotizada? Tiene precio de mercado cargado, así que su precio de venta sale
 *  de algún lado concreto y ese lado tiene que quedar anotado. */
function estaCotizada(f: FilaEditorCosteo): boolean {
  return f.valorConIva != null;
}

/** El link del producto es OBLIGATORIO en toda fila cotizada (decisión del usuario, 04-sep-2026):
 *  sin él, el precio con el que se oferta no tiene respaldo — nadie puede volver a revisarlo, ni
 *  comparar contra lo que después se pagó de verdad, ni generar la ficha técnica del producto (que
 *  se arma justamente desde el primer link). Sirve cualquiera de los tres (Link 1/2/3).
 *
 *  Solo se exige a las filas COTIZADAS: una fila recién traída del manifiesto de viabilidad
 *  (descripción y cantidad, sin precio todavía) se sigue pudiendo guardar, para no obligar a
 *  cotizar el costeo entero de una sentada antes de poder guardar nada.
 *
 *  Las hojas apagadas (`ofertamos: false`) quedan fuera: no se ofertan, no necesitan respaldo.
 *  Devuelve las filas que faltan, ya descritas para el mensaje de error. */
export function filasSinLink(estado: EstadoCosteoEditor): { hoja: string; item: number; detalle: string }[] {
  const faltan: { hoja: string; item: number; detalle: string }[] = [];
  for (const g of estado.grupos || []) {
    if (g.ofertamos === false) continue;
    for (const f of g.filas || []) {
      if (f.agregadoPorCompras || f.esCostoAdicional) continue; // gasto extra / costo adicional: no se oferta, no necesita respaldo de precio
      if (!estaCotizada(f)) continue;
      if (tieneRespaldoLink(f.link1)) continue;
      faltan.push({ hoja: g.nombre, item: f.item, detalle: (f.detalle || '').trim() || `fila ${f.item}` });
    }
  }
  return faltan;
}

/** Convierte el estado editable a FilaCosteo[] — MISMA forma que produce parsearCosteo() al leer
 *  un .xlsx subido — para reusar sin cambios calcularAlertasMotorComercial/totalesDeCosteo/el
 *  auto-precarga del checklist. Costo y precio se recalculan acá con calcularFormulas, nunca se
 *  confía en una cuenta que venga hecha del cliente. */
export function editorAFilasCosteo(estado: EstadoCosteoEditor): FilaCosteo[] {
  const margenGeneral = Number.isFinite(estado.margenVenta) ? estado.margenVenta : MARGEN_VENTA_DEFECTO;
  const filas: FilaCosteo[] = [];
  for (const g of estado.grupos || []) {
    if (g.ofertamos === false) continue; // línea/canasta que se decidió no ofertar — fuera del todo
    // Cada hoja puede vender con su propio recargo (así lo hace el Excel del comercial)…
    for (const f of g.filas || []) {
      // Los ítems que agrega Compras son gasto extra (flete, horas extra, un imprevisto), no parte de
      // lo ofertado: fuera del Motor Comercial, del Anexo Económico y de "Productos y cobertura".
      if (f.agregadoPorCompras || f.esCostoAdicional) continue;
      const sinDatos = !f.detalle?.trim() && f.cantidad == null && f.valorConIva == null;
      if (sinDatos) continue;
      // …y cada fila puede tener el suyo propio dentro de la hoja (caso 1114-12-LE26).
      const { costoUnitario, costoTotal, precioUnitarioSinDecimales, precioTotal } = calcularFormulas(f, margenDeFila(f, g, margenGeneral));
      filas.push({
        hoja: g.nombre, fila: f.item,
        item: f.item, detalle: f.detalle?.trim() || null,
        // La línea real de la fila manda sobre la de la hoja — necesario en suma_alzada, donde
        // una sola hoja mezcla varias líneas (g.linea siempre null ahí). En por_linea coinciden.
        lineaPublicada: f.lineaReal ?? g.linea,
        unidad: f.unidad?.trim() || null,
        cantidadOriginal: f.cantidad ?? null,
        costoUnitarioNeto: costoUnitario,
        costoTotalNeto: costoTotal,
        precioUnitarioSinDecimales,
        precioTotalNeto: precioTotal,
      });
    }
  }
  return filas;
}

/** Comparativo (venta / estimado / real) de TODO el costeo, sumando solo las hojas que se ofertan.
 *  Misma regla que el cuadro del editor: los ítems agregados por Compras no entran a venta ni a
 *  estimado, solo a gastos adicionales. `gastosExternos` = gastos registrados fuera del costeo. */
export function entradaComparativoDeEstado(
  estado: EstadoCosteoEditor, presupuestoNeto: number | null = null, gastosExternos = 0,
): EntradaComparativo {
  const margenGeneral = Number.isFinite(estado.margenVenta) ? estado.margenVenta : MARGEN_VENTA_DEFECTO;
  const filas = (estado.grupos || []).filter(g => g.ofertamos !== false).flatMap(g =>
    (g.filas || []).map(f => {
      const { costoTotal, precioTotal } = calcularFormulas(f, margenDeFila(f, g, margenGeneral));
      return {
        esExtra: !!f.agregadoPorCompras,
        soloCosto: !!f.esCostoAdicional,
        tieneDatos: !!f.detalle?.trim() || f.cantidad != null || f.valorConIva != null || (!!f.esCostoAdicional && f.costoAdicionalNeto != null),
        venta: f.esCostoAdicional ? 0 : (precioTotal ?? 0), costoEstimado: f.esCostoAdicional ? (f.costoAdicionalNeto ?? 0) : (costoTotal ?? 0),
        cantidad: f.cantidad ?? null, costoRealUnitario: f.costoRealUnitario ?? null,
      };
    }));
  return entradaComparativoDeFilas(filas, presupuestoNeto, gastosExternos);
}

// ── Puente hacia el Anexo Creator, fuente PRIMARIA (el costeo VIVO de la app) ────────────────
// obtenerItemsCosteoParaAnexo (anexos-datos.ts) hoy solo mira checklist_comercial_costeo.archivo_url
// (NULL a propósito cuando origen='editor', ver project_costeo_sync_checklist_precio_manual_sep2026)
// y, si falla, un .xlsx suelto en Documentos Propios — nunca lee el editor en sí. Esta función es
// ese tercer camino, y debe intentarse PRIMERO: es el costeo que el asesor edita en la pestaña
// "Costeo" del negocio, la fuente que el usuario pidió usar en vez de un documento generado.
// Mismo query que estadoGuardado() en app/api/negocios/[id]/comercial/costeo-editor/route.ts —
// replicado acá porque esa función vive acoplada a una ruta API, no a una lib importable.
export async function obtenerItemsCosteoDelEditor(codigo: string): Promise<ItemCosteoPrecio[]> {
  try {
    const [negocios] = await pool.query(
      `SELECT id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE ORDER BY id DESC LIMIT 1`,
      [codigo],
    ) as any;
    const negocioId = (negocios as any[])[0]?.id;
    if (!negocioId) return [];

    const [rows] = await pool.query(
      `SELECT modalidad, datos_json FROM negocio_costeo_editor WHERE negocio_id = ? LIMIT 1`,
      [negocioId],
    ) as any;
    const row = (rows as any[])[0];
    if (!row) return [];

    const datos = typeof row.datos_json === 'string' ? JSON.parse(row.datos_json) : row.datos_json;
    const grupos = (datos?.grupos || []).map((g: any) => ({ ...g, ofertamos: g.ofertamos !== false }));
    const estado: EstadoCosteoEditor = {
      modalidad: row.modalidad,
      margenVenta: Number(datos?.margenVenta) || MARGEN_VENTA_DEFECTO,
      grupos,
    };
    return itemsPrecioDeCosteo(editorAFilasCosteo(estado));
  } catch (e) {
    console.error('[costeo-editor] no se pudo leer el costeo del editor para el anexo:', String(e).slice(0, 200));
    return [];
  }
}

// ── Importar un Excel de costeo al costeo digital ───────────────────────────────────────────────
// El costeo llenado a mano en Excel (Cantidad / Costo unit. neto / Precio unit. venta / Link 1-3) pasa al editor SIN tipear.
// Reglas (las de siempre: nunca inventar ni pisar lo que alguien ya cargó):
//   · Solo rellena lo VACÍO de una fila que ya existe (valor c/IVA, cantidad, links). Nada de lo ya escrito se toca.
//   · El Excel guarda el costo NETO; el editor guarda el valor CON IVA → valorConIva = round(neto × 1,19).
//   · Una fila del Excel que no calza con ninguna del editor NO se agrega sola: queda en `sinPareja` para que lo decida una
//     persona (única excepción: si el editor no tiene ninguna fila todavía, se crean todas).
//   · El recargo (precio venta / costo − 1) se adopta como recargo global SOLO si todas las filas del Excel traen el mismo y el
//     editor todavía no tiene ningún precio cargado; si no, se informa y no se cambia.
export interface FilaExcelImport {
  hoja: string; fila: number; detalle: string | null; unidad: string | null; cantidad: number | null;
  costoNeto: number | null; precioVenta: number | null; links: string[]; lineaPublicada: number | null;
}
export interface ResultadoImportExcel {
  estado: EstadoCosteoEditor; rellenadas: number; creadas: number; sinPareja: string[];
  recargoExcel: number | null; recargoAdoptado: boolean;
}

/** Qué parte de las palabras del nombre más corto aparece en el otro (1 = el corto está contenido por completo). 0 si hay muy pocas palabras para fiarse. */
export function similitudProducto(a: string, b: string): number {
  const A = palabrasDeProducto(a), B = palabrasDeProducto(b);
  const [corto, largo] = A.size <= B.size ? [A, B] : [B, A];
  if (corto.size < 3) return 0;
  let comunes = 0;
  for (const w of corto) if (largo.has(w)) comunes++;
  return comunes / corto.size;
}

export function fusionarDesdeExcel(actual: EstadoCosteoEditor, excel: FilaExcelImport[]): ResultadoImportExcel {
  const estado: EstadoCosteoEditor = JSON.parse(JSON.stringify(actual));
  // Solo cuentan las filas que traen algo para importar (un costo o un link): las notas, los fletes sin costo unitario y los títulos
  // de sección que suele tener una planilla no son ítems del costeo.
  const util = excel.filter(e => (e.costoNeto ?? 0) > 0 || e.links.length > 0);
  const filasEditor = estado.grupos.filter(g => g.ofertamos !== false).flatMap(g => g.filas);
  const ivaDe = (neto: number | null) => (neto != null && neto > 0 ? Math.round(neto * 1.19) : null);

  // Recargo implícito del Excel (solo filas que traen costo Y precio).
  const recargos = util.filter(e => (e.costoNeto ?? 0) > 0 && (e.precioVenta ?? 0) > 0)
    .map(e => Math.round(((e.precioVenta as number) / (e.costoNeto as number) - 1) * 1000) / 10);
  const uniforme = recargos.length > 0 && recargos.every(r => Math.abs(r - recargos[0]) <= 0.3);
  const recargoExcel = uniforme ? recargos[0] : null;
  const sinPreciosAntes = !filasEditor.some(f => f.valorConIva != null && f.valorConIva > 0);

  const usadas = new Set<string>();
  let rellenadas = 0, creadas = 0;
  const sinPareja: string[] = [];

  const rellenar = (f: FilaEditorCosteo, e: FilaExcelImport): boolean => {
    let cambio = false;
    const iva = ivaDe(e.costoNeto);
    if (f.valorConIva == null && iva != null) { f.valorConIva = iva; cambio = true; }
    if (f.cantidad == null && e.cantidad != null) { f.cantidad = e.cantidad; cambio = true; }
    const libres = (['link1', 'link2', 'link3'] as const).filter(k => !f[k]?.trim());
    const nuevos = e.links.map(l => l.trim()).filter(l => l && ![f.link1, f.link2, f.link3].includes(l));
    libres.forEach((k, i) => { if (nuevos[i]) { f[k] = nuevos[i]; cambio = true; } });
    return cambio;
  };

  if (filasEditor.length === 0) {
    // Editor vacío: se crean todas las filas útiles del Excel en una hoja "Costeo".
    const filas: FilaEditorCosteo[] = util.filter(e => e.detalle?.trim()).map((e, i) => ({
      id: Math.random().toString(36).slice(2, 10), item: i + 1, lineaReal: e.lineaPublicada ?? null, detalle: e.detalle!.trim(),
      unidad: e.unidad?.trim() || 'UN', skuProveedor: '', cantidad: e.cantidad, valorConIva: ivaDe(e.costoNeto), costoRealUnitario: null,
      link1: e.links[0] || '', link2: e.links[1] || '', link3: e.links[2] || '',
    }));
    if (filas.length) estado.grupos = [{ nombre: 'Costeo', linea: null, ofertamos: true, filas }];
    creadas = filas.length;
  } else {
    util.forEach((e, idxExcel) => {
      const nombre = e.detalle?.trim() || '';
      // 1) por nombre (uno es el comienzo del otro); 2) por palabras en común, solo si hay UNA candidata claramente mejor
      //    (las planillas antiguas pegan "Especificación: …" al nombre); 3) por posición + misma cantidad, cuando el nombre no sirve.
      // Si más de una fila del costeo calza por nombre, solo vale la que es IGUAL; si no, no se adivina cuál.
      const porNombre = nombre ? filasEditor.filter(f => !usadas.has(f.id) && mismoProducto(f.detalle, nombre)) : [];
      const ambiguo = porNombre.length > 1 && !porNombre.some(f => normDesc(f.detalle) === normDesc(nombre));
      let destino = ambiguo ? undefined : porNombre.length === 1 ? porNombre[0] : porNombre.find(f => normDesc(f.detalle) === normDesc(nombre));
      if (!destino && nombre && !ambiguo) {
        const ranking = filasEditor.filter(f => !usadas.has(f.id)).map(f => ({ f, s: similitudProducto(f.detalle, nombre) })).sort((a, b) => b.s - a.s);
        if (ranking[0] && ranking[0].s >= 0.8 && (!ranking[1] || ranking[0].s - ranking[1].s >= 0.15)) destino = ranking[0].f;
      }
      if (!destino) {
        const cand = filasEditor[idxExcel];
        if (cand && !usadas.has(cand.id) && e.cantidad != null && cand.cantidad === e.cantidad && (!nombre || !cand.detalle.trim())) destino = cand;
      }
      if (!destino) { sinPareja.push(nombre ? nombre.split('\n')[0].slice(0, 70) : `fila ${e.fila} de ${e.hoja}`); return; }
      usadas.add(destino.id);
      if (rellenar(destino, e)) rellenadas++;
    });
  }

  let recargoAdoptado = false;
  if (recargoExcel != null && sinPreciosAntes && Math.abs(recargoExcel - estado.margenVenta) > 0.05) { estado.margenVenta = recargoExcel; recargoAdoptado = true; }
  return { estado, rellenadas, creadas, sinPareja, recargoExcel, recargoAdoptado };
}

/** Lo que cambió entre dos versiones guardadas del costeo, en frases legibles — para el registro de
 *  cambios del editor («quién modificó qué»). Las filas se emparejan por `id` (se guarda en
 *  datos_json, así que sobrevive entre guardados). Sin versión previa = primer guardado. */
export function resumenCambiosCosteo(antes: EstadoCosteoEditor | null, despues: EstadoCosteoEditor, max = 80): string[] {
  if (!antes) return [`Primer guardado del costeo (${despues.grupos.length} hoja(s), ${despues.grupos.reduce((n, g) => n + g.filas.length, 0)} ítem(s))`];
  const out: string[] = [];
  const pesos = (n: number | null | undefined) => n == null ? 'vacío' : `$${Math.round(n).toLocaleString('es-CL')}`;
  const num = (n: number | null | undefined, suf = '') => n == null ? 'vacío' : `${String(n).replace('.', ',')}${suf}`;
  const txt = (s: string | null | undefined) => (s || '').trim() ? `"${(s || '').trim().slice(0, 60)}"` : 'vacío';
  const nombre = (f: FilaEditorCosteo) => `"${(f.detalle || `ítem ${f.item}`).slice(0, 50)}"`;
  // Qué traía un ítem recién agregado o eliminado (cantidad, precio, costo adicional).
  const datosDe = (f: FilaEditorCosteo) => {
    const d: string[] = [];
    if (f.esCostoAdicional) d.push(`costo adicional ${pesos(f.costoAdicionalNeto)}`);
    else {
      if (f.cantidad != null) d.push(`cantidad ${num(f.cantidad)}`);
      if (f.valorConIva != null) d.push(`valor c/IVA ${pesos(f.valorConIva)}`);
    }
    return d.length ? ` (${d.join(', ')})` : '';
  };
  const linksCambiados = (a: FilaEditorCosteo, f: FilaEditorCosteo) => {
    const ks = (['link1', 'link2', 'link3'] as const).filter(k => (a[k] || '').trim() !== (f[k] || '').trim());
    return ks.length ? `${ks.map(k => `link ${k.slice(-1)} ${!(a[k] || '').trim() ? 'agregado' : !(f[k] || '').trim() ? 'quitado' : 'cambiado'}`).join(', ')}` : '';
  };

  if (antes.margenVenta !== despues.margenVenta) out.push(`Recargo general: ${num(antes.margenVenta, '%')} → ${num(despues.margenVenta, '%')}`);
  if (antes.modalidad !== despues.modalidad) out.push(`Estructura: ${antes.modalidad} → ${despues.modalidad}`);

  const hojasAntes = new Map(antes.grupos.map(g => [g.nombre, g]));
  const hojasDespues = new Set(despues.grupos.map(g => g.nombre));
  for (const g of despues.grupos) {
    const a = hojasAntes.get(g.nombre);
    if (!a) { out.push(`Nueva hoja ${g.nombre} (${g.filas.length} ítem(s))`); continue; }
    if (a.ofertamos !== g.ofertamos) out.push(`Hoja ${g.nombre}: ${g.ofertamos ? 'se vuelve a ofertar' : 'no se oferta'}`);
    if ((a.margenVenta ?? null) !== (g.margenVenta ?? null)) out.push(`Hoja ${g.nombre}: recargo ${num(a.margenVenta, '%')} → ${num(g.margenVenta, '%')}`);
    if ((a.presupuestoNeto ?? null) !== (g.presupuestoNeto ?? null)) out.push(`Hoja ${g.nombre}: presupuesto ${pesos(a.presupuestoNeto)} → ${pesos(g.presupuestoNeto)}`);
  }
  for (const a of antes.grupos) if (!hojasDespues.has(a.nombre)) out.push(`Hoja ${a.nombre} eliminada o unida con otra (${a.filas.length} ítem(s))`);

  const filasAntes = new Map(antes.grupos.flatMap(g => g.filas).map(f => [f.id, f]));
  // Hoja de cada fila: un cambio de hoja cambia el recargo que se le aplica (2827-102-LE26, 28-oct-2026: el
  // re-análisis movió una fila a una hoja con recargo 0 % y el registro no lo dijo).
  const hojaAntes = new Map(antes.grupos.flatMap(g => g.filas.map(f => [f.id, g.nombre] as const)));
  const idsDespues = new Set<string>();
  for (const g of despues.grupos) for (const f of g.filas) {
    idsDespues.add(f.id);
    const a = filasAntes.get(f.id);
    if (!a) { out.push(`Agregó el ítem ${nombre(f)}${datosDe(f)} en ${g.nombre}`); continue; }
    const campos: string[] = [];
    if (hojaAntes.get(f.id) !== g.nombre) campos.push(`hoja ${hojaAntes.get(f.id)} → ${g.nombre}`);
    if ((a.lineaReal ?? null) !== (f.lineaReal ?? null)) campos.push(`línea ${num(a.lineaReal)} → ${num(f.lineaReal)}`);
    if ((a.detalle || '') !== (f.detalle || '')) campos.push(`detalle ${txt(a.detalle)} → ${txt(f.detalle)}`);
    if ((a.complemento || '') !== (f.complemento || '')) campos.push(`complemento ${txt(a.complemento)} → ${txt(f.complemento)}`);
    if ((a.unidad || '') !== (f.unidad || '')) campos.push(`unidad ${txt(a.unidad)} → ${txt(f.unidad)}`);
    if ((a.skuProveedor || '') !== (f.skuProveedor || '')) campos.push(`proveedor ${txt(a.skuProveedor)} → ${txt(f.skuProveedor)}`);
    if ((a.cantidad ?? null) !== (f.cantidad ?? null)) campos.push(`cantidad ${num(a.cantidad)} → ${num(f.cantidad)}`);
    if ((a.valorConIva ?? null) !== (f.valorConIva ?? null)) campos.push(`valor c/IVA ${pesos(a.valorConIva)} → ${pesos(f.valorConIva)}`);
    if (!!a.esCostoAdicional !== !!f.esCostoAdicional) campos.push(f.esCostoAdicional ? 'pasó a costo adicional' : 'dejó de ser costo adicional');
    if ((a.costoAdicionalNeto ?? null) !== (f.costoAdicionalNeto ?? null)) campos.push(`costo adicional ${pesos(a.costoAdicionalNeto)} → ${pesos(f.costoAdicionalNeto)}`);
    if ((a.margenVenta ?? null) !== (f.margenVenta ?? null)) campos.push(`recargo ${num(a.margenVenta, '%')} → ${num(f.margenVenta, '%')}`);
    if ((a.costoRealUnitario ?? null) !== (f.costoRealUnitario ?? null)) campos.push(`costo real ${pesos(a.costoRealUnitario)} → ${pesos(f.costoRealUnitario)}`);
    const links = linksCambiados(a, f);
    if (links) campos.push(links);
    if ((a.imagenUrl || '') !== (f.imagenUrl || '')) campos.push(!(a.imagenUrl || '') ? 'imagen agregada' : !(f.imagenUrl || '') ? 'imagen quitada' : 'imagen cambiada');
    if (campos.length) out.push(`${nombre(f)}: ${campos.join(' · ')}`);
  }
  for (const [id, a] of filasAntes) if (!idsDespues.has(id)) out.push(`Eliminó el ítem ${nombre(a)}${datosDe(a)} de ${hojaAntes.get(id)}`);

  // Orden: ítems que siguen en la misma hoja pero cambiaron de posición.
  for (const g of despues.grupos) {
    const previa = hojasAntes.get(g.nombre);
    if (!previa) continue;
    const ids = new Set(previa.filas.map(f => f.id));
    const ahora = g.filas.map(f => f.id).filter(id => ids.has(id));
    const antesIds = new Set(ahora);
    const antiguo = previa.filas.map(f => f.id).filter(id => antesIds.has(id));
    if (ahora.some((id, i) => id !== antiguo[i])) out.push(`Hoja ${g.nombre}: cambió el orden de los ítems`);
  }

  if (!out.length) return ['Guardó sin cambios en los ítems'];
  return out.length > max ? [...out.slice(0, max), `… y ${out.length - max} cambio(s) más`] : out;
}
