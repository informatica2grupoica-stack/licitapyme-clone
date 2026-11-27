// app/lib/compras-reloj-sugerido.ts
// Lee el plazo de entrega ofertado tal como viene escrito. Decisión PURA (sin BD).
// El nombre del archivo viene del reloj de entrega, que se sacó el 2026-11-27.

export type PlazoTipoSug = 'HABILES' | 'CORRIDOS';

/** "15 Días hábiles", "45 días corridos — entrega en bodega", "30 dias" → días y tipo. null si no hay número de días. */
export function interpretarPlazoOfertado(texto: string | null | undefined): { dias: number; tipo: PlazoTipoSug; inferido: boolean } | null {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  // «2 días hábiles», pero también «2 hábiles» / «2 corridos» sin la palabra «días» (así sale en 1145-64-LE26).
  const m = t.match(/(\d{1,3})\s*(?:\(\s*\d+\s*\)\s*)?(?:d[ií]as?|h[aá]biles?|corridos?)/i);
  if (!m) return null;
  const dias = Number(m[1]);
  if (!Number.isFinite(dias) || dias <= 0) return null;
  const habil = /h[aá]bil/i.test(t);
  const corrido = /corrid|calendario|naturales/i.test(t);
  return { dias, tipo: habil && !corrido ? 'HABILES' : 'CORRIDOS', inferido: !habil && !corrido };
}
