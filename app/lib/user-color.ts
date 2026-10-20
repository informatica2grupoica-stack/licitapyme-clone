// Color e iniciales por usuario, CONSISTENTES en toda la plataforma (chips de carga,
// tarjetas de negocios, KPIs de descarte, vista de análisis, dashboards…). Un mismo
// usuario (por email o id) siempre obtiene el mismo color, para poder seguirlo de un
// vistazo entre pantallas.

export const USER_COLORS = [
  '#0d9488', '#d97706', '#0891b2', '#16a34a', '#e11d48', '#475569',
  '#ea580c', '#65a30d', '#be185d', '#78716c', '#0f766e', '#b45309',
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
