// Etapas del pipeline de negocios — igual a LicitaLAB
// Usado en /negocios y /negocios/[id]

export interface EstadoPipeline {
  id:    string;
  label: string;
  color: string;      // hex
}

export const ESTADOS_PIPELINE: EstadoPipeline[] = [
  { id: '1ASIGNADO',     label: 'ASIGNADO',      color: '#4F63D2' },
  { id: '2CARPETA_OK',   label: 'CARPETA OK',    color: '#D97706' },
  { id: '3EN_PROCESO',   label: 'EN PROCESO',    color: '#9333EA' },
  { id: '4ANEXOS',       label: 'ANEXOS',        color: '#EA580C' },
  { id: '5ANEXO_LISTO',  label: 'ANEXO LISTO',   color: '#0D9488' },
  { id: '6VISADO',       label: 'VISADO',        color: '#0369A1' },
  { id: '7POSTULADO_JV', label: 'POSTULADO',     color: '#B45309' },
  { id: '7POSTULADO_CG', label: 'POSTULADO',     color: '#92400E' },
  { id: 'DESCARTADA',    label: 'DESCARTADA',    color: '#DC2626' },
  { id: 'ADJ_JV',        label: 'ADJUDICADA',    color: '#16A34A' },
  { id: 'ADJ_CG',        label: 'ADJUDICADA',    color: '#15803D' },
  { id: '8POSIBLE_ADJ',  label: 'POSIBLE ADJ',   color: '#6366F1' },
  { id: '9PERDIDA',      label: 'PERDIDA',       color: '#9F1239' },
];

export function getEstadoPipeline(id: string | null | undefined): EstadoPipeline | null {
  if (!id) return null;
  return ESTADOS_PIPELINE.find(e => e.id === id) ?? null;
}
