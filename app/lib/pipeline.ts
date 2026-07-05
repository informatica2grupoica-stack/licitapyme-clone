// Etapas del pipeline de negocios — igual a LicitaLAB
// Usado en /negocios y /negocios/[id]

export interface EstadoPipeline {
  id:    string;
  label: string;
  color: string;      // hex
}

export const ESTADOS_PIPELINE: EstadoPipeline[] = [
  { id: '1ASIGNADO',     label: 'ASIGNADO',      color: '#4F63D2' },
  { id: '3EN_PROCESO',   label: 'EN PROCESO',    color: '#9333EA' },
  { id: '4ANEXOS',       label: 'ANEXOS',        color: '#EA580C' },
  { id: '5ANEXO_LISTO',  label: 'ANEXO LISTO',   color: '#0D9488' },
  { id: '6VISADO',       label: 'VISADO',        color: '#0369A1' },
  { id: '7POSTULADO_JV', label: 'POSTULADA',     color: '#B45309' }, // único POSTULADA (dedup)
  { id: 'DESCARTADA',    label: 'DESCARTADA',    color: '#DC2626' },
  { id: 'ADJ_JV',        label: 'ADJUDICADA',    color: '#16A34A' }, // único ADJUDICADA (dedup)
  { id: '8POSIBLE_ADJ',  label: 'POSIBLE ADJ',   color: '#6366F1' },
  { id: '9PERDIDA',      label: 'PERDIDA',       color: '#9F1239' },
];

// Estados LEGADO: ya NO se ofrecen en el selector, pero AÚN pueden existir en la BD
// (registros antiguos). Se mantienen resolubles para que esos negocios sigan mostrando su
// etiqueta correctamente SIN necesidad de migrar datos. NO agregar aquí estados nuevos.
const ESTADOS_LEGADO: EstadoPipeline[] = [
  { id: '2CARPETA_OK',   label: 'CARPETA OK',  color: '#D97706' },
  { id: '7POSTULADO_CG', label: 'POSTULADA',   color: '#B45309' },
  { id: 'ADJ_CG',        label: 'ADJUDICADA',  color: '#16A34A' },
];

export function getEstadoPipeline(id: string | null | undefined): EstadoPipeline | null {
  if (!id) return null;
  return ESTADOS_PIPELINE.find(e => e.id === id)
      ?? ESTADOS_LEGADO.find(e => e.id === id)
      ?? null;
}
