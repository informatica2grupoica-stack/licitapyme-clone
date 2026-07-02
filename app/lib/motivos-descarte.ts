// Catálogo de motivos de descarte de un negocio/licitación.
// El motivo se guarda como texto en negocios.descarte_motivo con el formato
// "<motivo> — <comentario>" para no requerir migración de esquema.

export const MOTIVOS_DESCARTE = [
  'No cumplimos requisitos técnicos',
  'No cumplimos experiencia exigida',
  'Garantías / fianzas inviables',
  'Plazo insuficiente para preparar la oferta',
  'Monto muy bajo / no rentable',
  'Fuera de nuestro rubro',
  'Región o logística inviable',
  'Competencia muy fuerte / poca probabilidad',
  'Se venció el plazo sin postular',
  'Otro',
] as const;

export type MotivoDescarte = (typeof MOTIVOS_DESCARTE)[number];

// Compone el texto final que se persiste: motivo del catálogo + comentario libre.
export function componerMotivo(motivo: string, comentario: string): string {
  const c = comentario.trim();
  return c ? `${motivo} — ${c}` : motivo;
}
