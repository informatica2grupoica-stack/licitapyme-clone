// app/lib/opciones-empresa-core.ts
// Opciones de funcionamiento de cada empresa (migration-200), parte pura: la usan el servidor y las dos pantallas donde se cambian
// (Mi empresa, para el admin de la empresa, y la ficha de /admin/clientes, para LICITANK). Regla del dueño: nada por empresa en el código.

/** Cuándo el Auditor pide aprobación: 'auto' = solo si la empresa tiene más de un usuario; 'siempre'; 'nunca'. */
export type ModoAprobacion = 'auto' | 'siempre' | 'nunca';
export const MODOS_APROBACION: { id: ModoAprobacion; titulo: string; ayuda: string }[] = [
  { id: 'auto', titulo: 'Automático (recomendado)', ayuda: 'Se pide aprobación solo si la empresa tiene más de un usuario. Si trabaja solo el admin, no hay aprobaciones.' },
  { id: 'siempre', titulo: 'Siempre', ayuda: 'Toda opción del Auditor pasa por aprobación de un admin o de quien tenga ese permiso.' },
  { id: 'nunca', titulo: 'Nunca', ayuda: 'Las opciones firmadas quedan aprobadas al instante, sin que nadie más las revise.' },
];

export interface OpcionesEmpresa { aprobaciones_auditor: ModoAprobacion }
export const OPCIONES_POR_DEFECTO: OpcionesEmpresa = { aprobaciones_auditor: 'auto' };

export const esModoAprobacion = (v: unknown): v is ModoAprobacion => v === 'auto' || v === 'siempre' || v === 'nunca';

/** Lee `clientes.config_json` (objeto o texto) y completa lo que falte con los valores por defecto. Nunca lanza. */
export function normalizarOpciones(raw: unknown): OpcionesEmpresa {
  let o: unknown = raw;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { o = null; } }
  const m = (o as { aprobaciones_auditor?: unknown } | null)?.aprobaciones_auditor;
  return { aprobaciones_auditor: esModoAprobacion(m) ? m : OPCIONES_POR_DEFECTO.aprobaciones_auditor };
}

/** ¿El Auditor de esa empresa pide aprobación? Grupo ICA (cliente 1) siempre conserva su flujo. */
export function aprobacionRequerida(modo: ModoAprobacion, usuariosActivos: number, clienteId: number): boolean {
  if (clienteId === 1) return true;
  if (modo === 'siempre') return true;
  if (modo === 'nunca') return false;
  return usuariosActivos > 1;
}
