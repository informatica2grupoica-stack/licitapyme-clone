// app/lib/exportar-fechas.ts
// Formato de fecha/hora para las EXPORTACIONES a Excel (radar, negocios, postuladas).
//
// POR QUÉ EXISTE (18-ago-2026, pedido del usuario): las tres exportaciones escribían la fecha con
// `toLocaleString('es-CL')`, que produce un solo texto con todo junto ("18-08-2026 13:00:00").
// Eso tiene dos problemas concretos para quien trabaja el Excel:
//   1. Fecha y hora en la MISMA celda: no se puede filtrar por día sin partir la columna a mano.
//   2. Es TEXTO en formato d-m-a, así que al ordenar la columna Excel las mezcla ("9-08" queda
//      después de "18-08" porque compara carácter a carácter). Las licitaciones que cierran el
//      mismo día quedaban desparramadas por toda la planilla.
//
// La solución es separar en dos columnas y escribir la fecha como FECHA REAL de Excel, mostrada
// día-mes-año (dd-mm-aaaa, pedido del usuario 1-oct-2026): al ser una fecha de verdad (no texto)
// Excel la ordena y filtra cronológicamente aunque se vea con el día primero.
//
// TODO en hora de Chile (America/Santiago), igual que el resto del sistema: un cierre a las 13:00
// de Santiago tiene que leerse 13:00 en la planilla, no 17:00 UTC.

const ZONA_CHILE = 'America/Santiago';

/** Formato con que Excel MUESTRA las fechas: día-mes-año. Lo aplica `hojaDeFilas`. */
export const FORMATO_FECHA_EXCEL = 'dd-mm-yyyy';

export interface FechaHoraExport {
  /** Fecha real de Excel (día calendario de Chile, a medianoche); '' si no hay dato. */
  fecha: Date | '';
  /** "13:00" — 24 horas, sin segundos (nadie filtra por segundo). */
  hora: string;
  /** "2026-08-18" — ISO, solo para ORDENAR las filas antes de escribir (no va a la planilla). */
  iso: string;
}

const VACIO: FechaHoraExport = { fecha: '', hora: '', iso: '' };

/**
 * Parte una fecha en columnas listas para Excel, en hora de Chile.
 * Devuelve vacíos si el valor es nulo o no es una fecha válida — nunca "Invalid Date",
 * que es lo que aparecía en la planilla cuando el dato venía vacío.
 */
export function fechaHoraParaExcel(valor: string | Date | null | undefined): FechaHoraExport {
  if (!valor) return VACIO;
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return VACIO;

  // `en-CA` da directamente el formato ISO (YYYY-MM-DD) respetando la zona horaria pedida, sin
  // tener que recomponer la fecha a mano (que es donde se cuelan los errores de UTC ±1 día).
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_CHILE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const hora = new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA_CHILE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  const [a, m, dia] = iso.split('-').map(Number);
  // Medianoche LOCAL del día de Chile: SheetJS convierte las fechas en hora local, así el día
  // que se ve en Excel es el mismo que el de Chile sin corrimientos de ±1 día.
  return { fecha: new Date(a, m - 1, dia), hora, iso };
}

/** Solo la fecha (celda de fecha de Excel) — atajo para columnas sin hora. */
export const fechaParaExcel = (v: string | Date | null | undefined) => fechaHoraParaExcel(v).fecha;

/**
 * Hoja lista para escribir: las celdas con `Date` salen como fecha de Excel con formato dd-mm-aaaa.
 * Se escribe el NÚMERO de serie de Excel (días desde 1899-12-30) y no una fecha ISO de SheetJS, que
 * Excel lee de forma poco fiable y que se corre un día según la zona horaria de quien abre el archivo.
 */
export function hojaDeFilas(XLSX: typeof import('xlsx'), filas: Record<string, unknown>[]) {
  const aSerie = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
  const ws = XLSX.utils.json_to_sheet(filas.map(f => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) o[k] = v instanceof Date ? aSerie(v) : v;
    return o;
  }));
  // Mismo orden de columnas que arma json_to_sheet: claves por orden de primera aparición.
  const columnas = Array.from(new Set(filas.flatMap(f => Object.keys(f))));
  filas.forEach((f, r) => columnas.forEach((k, c) => {
    if (!(f[k] instanceof Date)) return;
    const celda = ws[XLSX.utils.encode_cell({ r: r + 1, c })];
    if (celda) celda.z = FORMATO_FECHA_EXCEL;
  }));
  return ws;
}

/**
 * Ordena por una fecha ISO (`iso` de `fechaHoraParaExcel`), de la más próxima a la más lejana, de
 * modo que todas las del mismo día queden juntas. Las SIN fecha van al final: son las que no tienen
 * plazo publicado, y arriba solo estorbarían.
 *
 * Se ordena antes de escribir el Excel (y no se deja al usuario) porque "que las del 13 estén
 * juntas" es justo el pedido: abrir la planilla y ver los cierres agrupados por día sin tocar nada.
 */
export function ordenarPorFecha<T>(filas: T[], clave: (f: T) => string, horaClave?: (f: T) => string): T[] {
  return [...filas].sort((a, b) => {
    const fa = clave(a), fb = clave(b);
    if (!fa && !fb) return 0;
    if (!fa) return 1;
    if (!fb) return -1;
    if (fa !== fb) return fa < fb ? -1 : 1;
    // Mismo día: se desempata por hora, así el bloque del día queda además en orden.
    const ha = horaClave?.(a) ?? '', hb = horaClave?.(b) ?? '';
    return ha === hb ? 0 : ha < hb ? -1 : 1;
  });
}
