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
// La solución es separar en dos columnas y escribir la fecha en ISO (YYYY-MM-DD): ordenada
// alfabéticamente ES el orden cronológico, así que agrupar por día funciona con el orden y el
// filtro nativos de Excel, sin fórmulas.
//
// TODO en hora de Chile (America/Santiago), igual que el resto del sistema: un cierre a las 13:00
// de Santiago tiene que leerse 13:00 en la planilla, no 17:00 UTC.

const ZONA_CHILE = 'America/Santiago';

export interface FechaHoraExport {
  /** "2026-08-18" — ISO, para que el orden alfabético sea el cronológico. */
  fecha: string;
  /** "13:00" — 24 horas, sin segundos (nadie filtra por segundo). */
  hora: string;
}

const VACIO: FechaHoraExport = { fecha: '', hora: '' };

/**
 * Parte una fecha en dos columnas listas para Excel, en hora de Chile.
 * Devuelve strings vacíos si el valor es nulo o no es una fecha válida — nunca "Invalid Date",
 * que es lo que aparecía en la planilla cuando el dato venía vacío.
 */
export function fechaHoraParaExcel(valor: string | Date | null | undefined): FechaHoraExport {
  if (!valor) return VACIO;
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return VACIO;

  // `en-CA` da directamente el formato ISO (YYYY-MM-DD) respetando la zona horaria pedida, sin
  // tener que recomponer la fecha a mano (que es donde se cuelan los errores de UTC ±1 día).
  const fecha = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_CHILE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const hora = new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA_CHILE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  return { fecha, hora };
}

/**
 * Ordena las filas por una columna de fecha ISO, de la más próxima a la más lejana, de modo que
 * todas las del mismo día queden juntas. Las filas SIN fecha van al final: son las que no tienen
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
