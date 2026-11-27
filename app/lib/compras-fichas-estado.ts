// Estado de un PRODUCTO en «Fichas técnicas» de Compras cuando tiene uno o varios modelos con ficha.
// Basta con que UN modelo cumpla (los otros son alternativas, regla del dueño 27-nov-2026). «No cumple» solo si no cumple ninguno.
export type EstadoProductoFichas = 'CUMPLE' | 'CON_PENDIENTES' | 'NO_CUMPLE' | 'NO_CORRIDO';

/** `estados`: el estado técnico de cada modelo con ficha de ese producto. null = ninguno tiene ficha. */
export function estadoDeProductoConFichas(estados: string[]): EstadoProductoFichas | null {
  if (!estados.length) return null;
  if (estados.includes('CUMPLE')) return 'CUMPLE';
  if (estados.includes('CON_PENDIENTES')) return 'CON_PENDIENTES';
  if (estados.every(e => e === 'NO_CUMPLE')) return 'NO_CUMPLE';
  return 'NO_CORRIDO';   // queda alguno sin comparar: todavía puede cumplir
}
