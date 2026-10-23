// app/lib/viabilidad-v4/saneo.ts
// SANEO de lo que devuelve el modelo (módulo PURO, sin BD ni IA). El modelo EXTRAE y el código DECIDE:
// lo que el modelo escribe de más o de menos no se toma por cierto. Hallazgos reales (1057448-45-LP26,
// 5-oct-2026): "0" escrito como puntaje mínimo en 7 criterios (el código lo leía como un mínimo real),
// citas con trozos unidos por "…" (esas ya las acepta el localizador si cada trozo existe), y respuestas del
// modelo liviano con varios de estos defectos juntos.

/** "0", "0 puntos", "0%" → el modelo escribe esto cuando las bases NO fijan mínimo. */
export const esCero = (v: unknown): boolean => /^\s*0+(?:[.,]0+)?\s*(?:puntos?|pts?|%)?\s*$/i.test(String(v ?? ''));

/** Separador de trozos dentro de una frase citada: "...", "…", "[...]", "[…]". */
const RE_ELIPSIS = /\s*(?:\[\s*(?:\.{3}|…)\s*\]|\.{3,}|…)\s*/;

/** Trozos de una frase unida con puntos suspensivos (≥ 2 trozos de ≥ 3 palabras cada uno), o [] si no aplica. */
export function trozosDeFrase(frase: string): string[] {
  const partes = String(frase || '').split(RE_ELIPSIS).map(p => p.trim()).filter(Boolean);
  if (partes.length < 2) return [];
  return partes.every(p => p.split(/\s+/).length >= 3) ? partes : [];
}

/**
 * Señales de que un GRUPO de la respuesta del modelo salió de mala calidad (H-20 de la auditoría: el
 * respaldo solo se activaba por error o timeout, no por una respuesta válida pero pobre). Si hay
 * problemas, el análisis repite ESE grupo una vez con un modelo mayor. Solo señales baratas y seguras.
 */
export function problemasCalidadGrupo(nombre: string, valor: any, reparado = false): string[] {
  const out: string[] = [];
  if (!valor || typeof valor !== 'object') return out;
  if (reparado) out.push('el JSON llegó cortado y se reparó');
  if (nombre === 'admisibilidad_criterios') {
    const crit = valor.criterios_evaluacion;
    const ceros = (esCero(crit?.puntaje_minimo_total?.valor) ? 1 : 0)
      + (Array.isArray(crit?.criterios) ? crit.criterios.filter((c: any) => esCero(c?.puntaje_minimo?.valor)).length : 0);
    if (ceros >= 3) out.push(`${ceros} puntajes mínimos escritos como 0`);
    if (crit && Array.isArray(crit.criterios) && crit.criterios.length === 0 && crit.fuente_datos !== 'incompleto') out.push('criterios de evaluación vacíos');
  }
  if (nombre === 'decisiones') {
    const p = valor.presupuesto;
    if (p && (p.caracter === 'EXCLUYENTE' || p.caracter === 'REFERENCIAL') && !String(p.cita?.frase || '').trim()) out.push('carácter del presupuesto sin cita');
  }
  return out;
}
