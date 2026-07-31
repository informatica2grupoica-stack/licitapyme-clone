// app/lib/anexos-totales-seccion.ts
// Calcula, a partir de lo YA resuelto en las tablas de ítems de un anexo (cantidad × precio
// unitario por fila, el precio resuelto por el costeo — ver anexos-precios-ia.ts), el total de
// cada sección — y lo cruza contra una "tabla resumen" que pide exactamente ese total por
// sección (patrón real, 1738-18-LE26: "LÍNEA | MONTO TOTAL OFERTADO | PLAZO..."). General por
// diseño: no conoce la palabra "LÍNEA" — cruza por texto EXACTO entre el título que precede a
// cada tabla de ítems (ver tituloDeTabla) y la etiqueta de fila de la tabla resumen, sea cual
// sea el rótulo real que use la licitación ("LOTE N", "ÍTEM N", lo que sea).
//
// Nunca escribe un total PARCIAL: si algún ítem de la sección quedó sin precio resuelto, la
// sección completa se deja pendiente (ver TotalSeccion.completo) — un total que parece completo
// pero le falta un ítem es peor que uno visiblemente vacío.
import type { TablaCruda } from '@/app/lib/anexos-detectar';
import type { Parrafo } from '@/app/lib/anexos-docx';

export interface TituloCercano { texto: string; indice: number }

// Encabezados como "LÍNEA 1: LETRERO DE OBRAS" NUNCA llegan a `descartadosComoTitulo` (el
// clasificador de títulos de resolverCandidatosCelda): un párrafo corto seguido de uno vacío que
// precede directamente a una tabla se descarta ANTES, por `blancoPrecedeTabla` en
// anexos-detectar.ts (a propósito — evita ofrecerlo como si fuera un campo a rellenar). Por eso
// se buscan acá, directo sobre los párrafos del documento: cualquier párrafo con texto, corto,
// que NO es parte de ninguna tabla, y cuyo siguiente párrafo es vacío o ya el arranque de una
// tabla — la misma forma que un encabezado de sección real, sea cual sea su rótulo.
const LARGO_MAX_ENCABEZADO = 100;

export function encabezadosLibres(parrafos: Parrafo[], indicesEnTablas: Set<number>): TituloCercano[] {
  const out: TituloCercano[] = [];
  parrafos.forEach((p, i) => {
    if (p.vacio || !p.texto || p.texto.length > LARGO_MAX_ENCABEZADO || indicesEnTablas.has(p.indice)) return;
    const siguiente = parrafos[i + 1];
    if (siguiente && !siguiente.vacio && !indicesEnTablas.has(siguiente.indice)) return; // sigue texto normal, no es un heading
    out.push({ texto: p.texto, indice: p.indice });
  });
  return out;
}

// El título de una tabla de ítems ("LÍNEA 1: LETRERO DE OBRAS") es un párrafo SUELTO, fuera de la
// tabla — nunca su fila de encabezado. Es el heading más cercano HACIA ATRÁS, dentro de una
// distancia corta (visto en el documento real: 1-2 párrafos antes de la fila de encabezado, a
// veces con una línea en blanco entre medio) — más lejos que eso ya pertenece a otra sección.
const DISTANCIA_MAX_TITULO = 6;

export function tituloDeTabla(indicePrimero: number | null, titulos: TituloCercano[]): TituloCercano | null {
  if (indicePrimero == null) return null;
  let mejor: TituloCercano | null = null;
  for (const t of titulos) {
    if (t.indice >= indicePrimero || indicePrimero - t.indice > DISTANCIA_MAX_TITULO) continue;
    if (!mejor || t.indice > mejor.indice) mejor = t;
  }
  return mejor;
}

function indiceColumna(header: string[], patron: RegExp): number {
  return header.findIndex(h => patron.test(h.trim()));
}

function normalizar(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface TotalSeccion { titulo: string; total: number; completo: boolean }

// Solo mira tablas con columnas de CANTIDAD y PRECIO (unitario) — las de ítems, nunca cualquier
// tabla de 3+ columnas del documento (una tabla de especificaciones técnicas sin precio, por
// ejemplo, no aporta nada acá).
export function calcularTotalesPorSeccion(
  tablasCrudo: TablaCruda[], titulos: TituloCercano[], valorResuelto: (indiceGlobal: number) => number | null,
): TotalSeccion[] {
  const totales: TotalSeccion[] = [];
  for (const t of tablasCrudo) {
    if (t.filas.length < 2) continue;
    const header = t.filas[0].celdas.map(c => c.texto);
    const iCantidad = indiceColumna(header, /^cantidad$/i);
    const iPrecio = indiceColumna(header, /^precio(\s+unitario)?$/i);
    if (iCantidad < 0 || iPrecio < 0) continue;
    const titulo = tituloDeTabla(t.indicePrimero, titulos);
    if (!titulo) continue; // sin título asociado no hay con qué cruzar la tabla resumen

    let total = 0;
    let completo = true;
    let filasConDato = 0;
    for (const fila of t.filas.slice(1)) {
      const celdaCantidad = fila.celdas[iCantidad];
      const celdaPrecio = fila.celdas[iPrecio];
      if (!celdaCantidad || !celdaPrecio) continue;
      const cantidad = Number(String(celdaCantidad.texto).trim().replace(',', '.'));
      if (!Number.isFinite(cantidad) || cantidad <= 0) continue; // fila decorativa (subtítulo repetido dentro de la tabla)
      filasConDato++;
      const precio = celdaPrecio.indiceGlobal != null ? valorResuelto(celdaPrecio.indiceGlobal) : null;
      if (precio == null) { completo = false; continue; } // un ítem sin precio invalida el total de TODA la sección
      total += cantidad * precio;
    }
    if (filasConDato > 0) totales.push({ titulo: titulo.texto, total, completo });
  }
  return totales;
}

export interface RellenoTotal {
  paraId: string; indiceGlobal: number | null; valor: string;
  // true: la celda no está técnicamente vacía (trae un prefijo fijo, ej. "$") — el valor se
  // AGREGA al final del mismo párrafo. false: celda realmente vacía, se llena como cualquier otra.
  anexar: boolean;
}

// Cruza los totales calculados contra una tabla resumen (columna MONTO/TOTAL + una fila cuya
// etiqueta calza EXACTO con el título de otra tabla) y arma dónde escribir cada uno.
export function resolverTablaResumen(tablasCrudo: TablaCruda[], totales: TotalSeccion[]): RellenoTotal[] {
  if (totales.length === 0) return [];
  const porTitulo = new Map(totales.map(t => [normalizar(t.titulo), t]));
  const out: RellenoTotal[] = [];
  for (const t of tablasCrudo) {
    if (t.filas.length < 2) continue;
    const header = t.filas[0].celdas.map(c => c.texto);
    const iMonto = indiceColumna(header, /monto|total/i);
    if (iMonto < 0) continue;
    for (const fila of t.filas.slice(1)) {
      const etiquetaFila = fila.celdas.find(c => porTitulo.has(normalizar(c.texto)));
      if (!etiquetaFila) continue;
      const info = porTitulo.get(normalizar(etiquetaFila.texto))!;
      if (!info.completo) continue; // total parcial: mejor dejarlo vacío que escribir un número engañoso
      const celdaMonto = fila.celdas[iMonto];
      if (!celdaMonto?.ultimoParaId) continue; // celda sin párrafo identificable — no hay dónde escribir
      out.push({
        paraId: celdaMonto.ultimoParaId,
        indiceGlobal: celdaMonto.indiceGlobal,
        valor: new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(info.total),
        anexar: celdaMonto.indiceGlobal == null,
      });
    }
  }
  return out;
}
