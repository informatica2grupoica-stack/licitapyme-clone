// app/lib/numeros.ts
// Bug real (10-sep-2026): un precio tipeado en formato chileno ("6.745.621", con puntos de miles)
// pasado directo a `Number()` da NaN — JS no entiende un número con más de un punto. Ese NaN, sin
// nadie filtrándolo, llegaba crudo hasta una consulta SQL parametrizada; mysql2 escapa NaN como el
// texto SIN COMILLAS "NaN" (no como número), y MySQL lo interpreta como el nombre de una columna
// inexistente → "Unknown column 'NaN' in field list". El fix real es nunca dejar que un NaN llegue
// tan lejos: se parsea el formato chileno explícitamente, y si de verdad no es un número, se
// devuelve null (nunca NaN) — mismo criterio que el resto del proyecto: no inventar datos.
export function parsearMontoCL(texto: unknown): number | null {
  if (texto == null) return null;
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : null;
  const limpio = String(texto).trim().replace(/\./g, '').replace(',', '.');
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Saca el número de días de un texto libre de plazo de entrega ("30 días hábiles", "29 dias
 *  habiles", "2 a 3 semanas"). Bug real (10-sep-2026): el formulario de cotizaciones solo pide
 *  este texto, nunca un campo numérico separado — así que `compras_cotizacion.plazo_entrega_dias`
 *  quedaba SIEMPRE null, y el escenario "Más rápido" (que ordena candidatos por ese campo) no tenía
 *  con qué comparar: todos empataban en el mismo valor por defecto y el desempate quedaba en manos
 *  del orden de llegada, no de quién entrega antes de verdad — por eso "Más rápido" coincidía con
 *  los demás escenarios sin razón real. Si el texto dice "semanas" se convierte a días (× 7); si
 *  no hay ningún número, devuelve null — no se inventa un plazo que el documento no dice. */
export function parsearDiasDeTexto(texto: unknown): number | null {
  if (texto == null) return null;
  const t = String(texto).toLowerCase();
  const m = t.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return /semana/.test(t) ? n * 7 : n;
}
