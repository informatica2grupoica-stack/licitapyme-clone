// app/lib/compras-reloj-sugerido.ts
// RELOJ DE ENTREGA SUGERIDO — decisión PURA (sin BD) para poder probarla.
// El reloj se fijaba 100 % a mano (hito en texto libre, fecha y días) aunque el sistema ya conoce los tres
// datos: la fecha en que se aceptó la orden de compra, el plazo de entrega ofertado y si es hábil o corrido.
// Esto los junta en una sugerencia que el encargado confirma con un clic (la spec §15.1 exige validación
// manual: la sugerencia NUNCA fija el reloj sola).

export type PlazoTipoSug = 'HABILES' | 'CORRIDOS';

export interface RelojSugerido {
  hitoInicio: string;
  fechaInicio: string;          // YYYY-MM-DD
  plazoDias: number;
  plazoTipo: PlazoTipoSug;
  /** De dónde sale la fecha de inicio. */
  origenFecha: 'aceptacion_oc' | 'emision_oc';
  /** true si el texto del plazo no decía "hábiles" ni "corridos" (se asumió corridos: confirmarlo). */
  tipoInferido: boolean;
  /** Texto del plazo tal cual, para que el encargado vea de dónde salió. */
  plazoTexto: string;
}

/** "15 Días hábiles", "45 días corridos — entrega en bodega", "30 dias" → días y tipo. null si no hay número de días. */
export function interpretarPlazoOfertado(texto: string | null | undefined): { dias: number; tipo: PlazoTipoSug; inferido: boolean } | null {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(/(\d{1,3})\s*(?:\(\s*\d+\s*\)\s*)?d[ií]as?/i);
  if (!m) return null;
  const dias = Number(m[1]);
  if (!Number.isFinite(dias) || dias <= 0) return null;
  const habil = /h[aá]bil/i.test(t);
  const corrido = /corrid|calendario|naturales/i.test(t);
  return { dias, tipo: habil && !corrido ? 'HABILES' : 'CORRIDOS', inferido: !habil && !corrido };
}

const ymd = (s: string | null | undefined): string | null => {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** Junta fecha de OC + plazo ofertado. null si falta alguno de los dos (no se inventa nada). */
export function sugerirReloj(e: { aceptadaAt: string | null; emitidaAt: string | null; plazoOfertadoTexto: string | null; hitoInicioTexto?: string | null }): RelojSugerido | null {
  const plazo = interpretarPlazoOfertado(e.plazoOfertadoTexto);
  if (!plazo) return null;
  const acept = ymd(e.aceptadaAt);
  const emit = ymd(e.emitidaAt);
  const fecha = acept ?? emit;
  if (!fecha) return null;
  const hito = (e.hitoInicioTexto || '').trim();
  return {
    hitoInicio: hito || (acept ? 'Aceptación de la orden de compra' : 'Emisión de la orden de compra'),
    fechaInicio: fecha,
    plazoDias: plazo.dias,
    plazoTipo: plazo.tipo,
    origenFecha: acept ? 'aceptacion_oc' : 'emision_oc',
    tipoInferido: plazo.inferido,
    plazoTexto: String(e.plazoOfertadoTexto).replace(/\s+/g, ' ').trim(),
  };
}
