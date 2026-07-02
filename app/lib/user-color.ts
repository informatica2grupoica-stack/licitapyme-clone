// Color e iniciales por usuario, CONSISTENTES en toda la plataforma (chips de carga,
// tarjetas de negocios, KPIs de descarte, vista de análisis, dashboards…). Un mismo
// usuario (por email o id) siempre obtiene el mismo color, para poder seguirlo de un
// vistazo entre pantallas.

export const USER_COLORS = [
  '#6366f1', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#ec4899', '#14b8a6', '#3b82f6', '#a855f7', '#f97316', '#84cc16',
];

// Color estable a partir de una semilla (preferir email; sirve id como fallback).
export function colorUsuario(seed: string | number | null | undefined): string {
  const s = String(seed ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return USER_COLORS[h % USER_COLORS.length];
}

// Iniciales (2 letras) a partir de nombre o email.
export function inicialesUsuario(nombre?: string | null, email?: string | null): string {
  const base = (nombre || email || '?').trim();
  const parts = base.split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}
