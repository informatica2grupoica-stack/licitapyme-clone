// Etapas del pipeline de negocios — igual a LicitaLAB
// Usado en /negocios y /negocios/[id]
//
// CONVENCIÓN (buenas prácticas): el `id` es una CLAVE ESTABLE de máquina en
// UPPER_SNAKE_CASE, SIN prefijo numérico y SIN espacios. El `label` es el único
// texto visible (puede llevar espacios). Nunca comparar/guardar por el label:
// siempre por el id. La columna negocios.estado_pipeline guarda el id.

export interface EstadoPipeline {
  id:    string;
  label: string;
  color: string;      // hex
}

export const ESTADOS_PIPELINE: EstadoPipeline[] = [
  { id: 'ASIGNADO',     label: 'ASIGNADO',    color: '#4F63D2' },
  { id: 'EN_PROCESO',   label: 'EN PROCESO',  color: '#9333EA' },
  { id: 'ANEXOS',       label: 'ANEXOS',      color: '#EA580C' },
  { id: 'ANEXO_LISTO',  label: 'ANEXO LISTO', color: '#0D9488' },
  { id: 'VISADO',       label: 'VISADO',      color: '#0369A1' },
  { id: 'POSTULADA',    label: 'POSTULADA',   color: '#B45309' },
  { id: 'DESCARTADA',   label: 'DESCARTADA',  color: '#DC2626' },
  { id: 'ADJUDICADA',   label: 'ADJUDICADA',  color: '#16A34A' },
  { id: 'POSIBLE_ADJ',  label: 'POSIBLE ADJ', color: '#6366F1' },
  { id: 'PERDIDA',      label: 'PERDIDA',     color: '#9F1239' },
];

// ALIAS LEGADO: mapeo de los ids ANTIGUOS (con prefijo numérico / sufijos _JV/_CG)
// a la clave nueva. Los datos de la BD ya se migraron (ver docs/migration-38-...),
// pero se mantiene el alias como red de seguridad: si algún registro histórico o
// metadata (ej. historial_eventos) aún trae un id viejo, sigue resolviéndose bien.
// NO agregar ids nuevos aquí: los estados vigentes van en ESTADOS_PIPELINE.
const ALIAS_LEGADO: Record<string, string> = {
  '1ASIGNADO':     'ASIGNADO',
  '2CARPETA_OK':   'ASIGNADO',   // "CARPETA OK" quedó fusionado en ASIGNADO
  '3EN_PROCESO':   'EN_PROCESO',
  '4ANEXOS':       'ANEXOS',
  '5ANEXO_LISTO':  'ANEXO_LISTO',
  '6VISADO':       'VISADO',
  '7POSTULADO_JV': 'POSTULADA',
  '7POSTULADO_CG': 'POSTULADA',
  'ADJ_JV':        'ADJUDICADA',
  'ADJ_CG':        'ADJUDICADA',
  '8POSIBLE_ADJ':  'POSIBLE_ADJ',
  '9PERDIDA':      'PERDIDA',
};

// Clave por DEFECTO cuando un negocio no tiene estado_pipeline.
export const ESTADO_DEFECTO = 'ASIGNADO';

// Normaliza cualquier id (nuevo o legado) a la clave vigente.
export function normalizarEstado(id: string | null | undefined): string {
  if (!id) return ESTADO_DEFECTO;
  return ALIAS_LEGADO[id] ?? id;
}

export function getEstadoPipeline(id: string | null | undefined): EstadoPipeline | null {
  if (!id) return null;
  const key = ALIAS_LEGADO[id] ?? id;
  return ESTADOS_PIPELINE.find(e => e.id === key) ?? null;
}
