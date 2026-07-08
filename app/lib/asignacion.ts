// Semáforo de "frescura" de un negocio asignado: cuántos días lleva SIN que cambie su
// estado (proxy = updated_at, que se refresca en cada cambio de pipeline/edición).
// Regla (definida con el dueño): 0-1 día = verde, 2 días = amarillo, 3+ días = rojo.
//
// También calcula la antigüedad de la asignación (created_at) para mostrar "asignada hace…".

export interface SemaforoRevision {
  dias: number;                       // días completos desde la última actividad
  nivel: 'verde' | 'amarillo' | 'rojo';
  color: string;                      // hex del punto/acento
  bg: string;                         // clase Tailwind de fondo
  text: string;                       // clase Tailwind de texto
  etiqueta: string;                   // "Hoy" | "1 día" | "N días"
}

// Días completos transcurridos entre `desde` y ahora (>= 0).
export function diasDesde(desde: string | Date | null | undefined, ahora: Date = new Date()): number | null {
  if (!desde) return null;
  const t = typeof desde === 'string' ? new Date(desde).getTime() : desde.getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((ahora.getTime() - t) / 86_400_000));
}

export function semaforoRevision(updatedAt: string | Date | null | undefined, ahora: Date = new Date()): SemaforoRevision | null {
  const dias = diasDesde(updatedAt, ahora);
  if (dias == null) return null;

  let nivel: SemaforoRevision['nivel'];
  let color: string, bg: string, text: string;
  if (dias <= 1)      { nivel = 'verde';    color = '#16A34A'; bg = 'bg-emerald-50'; text = 'text-emerald-700'; }
  else if (dias === 2){ nivel = 'amarillo'; color = '#D97706'; bg = 'bg-amber-50';   text = 'text-amber-700'; }
  else                { nivel = 'rojo';     color = '#DC2626'; bg = 'bg-red-50';     text = 'text-red-700'; }

  const etiqueta = dias === 0 ? 'Hoy' : dias === 1 ? '1 día' : `${dias} días`;
  return { dias, nivel, color, bg, text, etiqueta };
}
