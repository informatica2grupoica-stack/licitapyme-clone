// Catálogo de motivos de descarte de un negocio/licitación, SEPARADO POR NIVEL (ficha §3.1/§3.2).
// El motivo se guarda como texto en negocios.descarte_motivo con el formato
// "<motivo> — <comentario>" para no requerir migración de esquema. El NIVEL no se persiste
// como columna: se deriva del estado en que ocurrió el descarte (ver dashboard/analitica).

// Nivel 1 — descarte del analista recién asignada (ASIGNADO → DESCARTADA): razones verificables
// sin cotizar ni costear.
export const MOTIVOS_NIVEL_1 = [
  'No cumplimos requisitos técnicos',
  'No cumplimos experiencia exigida',
  'Garantías o fianzas inviables',
  'Fuera de nuestro rubro',
  'Mercado saturado',
  'Otro',
] as const;

// Nivel 2 — descarte tras el análisis técnico/costeo (EN_PROCESO → DESCARTADA).
export const MOTIVOS_NIVEL_2 = [
  'No rentable',
  'Producto no homologable',
  'Por línea - no rentable',
  'Otro',
] as const;

// Error de Gestión — descarte en etapas avanzadas (ANEXOS / ANEXO_LISTO / VISADO). Solo el EM.
export const MOTIVOS_ERROR_GESTION = [
  'Error de costeo',
  'Error de análisis',
  'Error en documentación',
  'Otro error',
] as const;

// Compat: catálogo plano (unión) para contextos que no dependen del estado (p.ej. el modal de
// cierre vencido / "se venció el plazo sin postular").
export const MOTIVOS_DESCARTE = [
  ...MOTIVOS_NIVEL_1,
  ...MOTIVOS_NIVEL_2.filter(m => m !== 'Otro'),
  'Se venció el plazo sin postular',
] as const;

export type MotivoDescarte = string;
export type NivelDescarte = 'N1' | 'N2' | 'error_gestion';

// Nivel de descarte según el estado interno en que se descarta (ficha §3.2).
export function nivelPorEstado(estado: string | null | undefined): NivelDescarte {
  const e = (estado || '').toUpperCase();
  if (['ANEXOS', 'ANEXO_LISTO', 'VISADO'].includes(e)) return 'error_gestion';
  if (e === 'EN_PROCESO') return 'N2';
  return 'N1'; // ASIGNADO (o cualquier otro previo)
}

// Motivos que corresponden mostrar para el estado actual (nunca los diez juntos).
export function motivosParaEstado(estado: string | null | undefined): readonly string[] {
  const nv = nivelPorEstado(estado);
  return nv === 'error_gestion' ? MOTIVOS_ERROR_GESTION : nv === 'N2' ? MOTIVOS_NIVEL_2 : MOTIVOS_NIVEL_1;
}

export const NIVEL_LABEL: Record<NivelDescarte, string> = {
  N1: 'Nivel 1 · recién asignada',
  N2: 'Nivel 2 · tras análisis técnico',
  error_gestion: 'Error de gestión · etapa avanzada',
};

// Compone el texto final que se persiste: motivo del catálogo + comentario libre.
export function componerMotivo(motivo: string, comentario: string): string {
  const c = comentario.trim();
  return c ? `${motivo} — ${c}` : motivo;
}
