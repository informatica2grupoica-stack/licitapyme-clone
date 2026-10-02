// app/lib/validar-entrada.ts
// Validaciones mínimas de entradas que terminan en una KEY de R2 o en una consulta por código.

/** Código de licitación usable como prefijo de key: sin separadores de ruta ni `..`, sin control, ≤ 64. */
export function codigoLicitacionSeguro(codigo: unknown): codigo is string {
  return typeof codigo === 'string'
    && codigo.length > 0 && codigo.length <= 64
    && !/[\/\x00-\x1f]/.test(codigo)
    && !codigo.includes('..');
}

/** Tope por archivo subido (bytes). Los documentos de bases/anexos rara vez pasan de unas decenas de MB. */
export const MAX_BYTES_DOCUMENTO = 250 * 1024 * 1024;
