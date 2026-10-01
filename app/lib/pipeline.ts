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

// 23-jul-2026: el id 'ADJUDICADA' se mantiene (clave estable, ya usada en toda la BD y el código
// — ver procesar-postuladas.ts), pero el LABEL pasa a 'GANADA'. Este estado SOLO lo pone el cron
// cuando el acta de Mercado Público confirma que GANAMOS (adj.ganamos === true); si se adjudicó a
// terceros el cron pone 'PERDIDA'. O sea el dato siempre significó "ganamos" — el texto "Adjudicada"
// era ambiguo (¿adjudicada a nosotros o a un tercero?) y generaba confusión en Análisis de licitación.
export const ESTADOS_PIPELINE: EstadoPipeline[] = [
  { id: 'ASIGNADO',     label: 'ASIGNADO',    color: '#4F63D2' },
  { id: 'EN_PROCESO',   label: 'EN PROCESO',  color: '#9333EA' },
  // 30-sep-2026: la etapa ANEXOS pasa a llamarse PRE-POSTULACIÓN (spec del AUDITOR unificado, §2): ahí se arman los anexos, se confirma el bloque
  // técnico-administrativo y se cierra el certificado de admisibilidad. Mismo criterio que GANADA: la CLAVE ('ANEXOS') no cambia —está en la BD, en
  // los permisos de alerta y en los filtros—; solo el texto visible.
  { id: 'ANEXOS',       label: 'PRE-POSTULACIÓN', color: '#EA580C' },
  { id: 'ANEXO_LISTO',  label: 'ANEXO LISTO', color: '#0D9488' },
  { id: 'VISADO',       label: 'VISADO',      color: '#0369A1' },
  { id: 'POSTULADA',    label: 'POSTULADA',   color: '#B45309' },
  { id: 'DESCARTADA',   label: 'DESCARTADA',  color: '#DC2626' },
  { id: 'ADJUDICADA',   label: 'GANADA',      color: '#16A34A' },
  { id: 'POSIBLE_ADJ',  label: 'POSIBLE ADJ', color: '#6366F1' },
  { id: 'PERDIDA',      label: 'PERDIDA',     color: '#9F1239' },
  // 1-oct-2026: MP revocó (REVOCADA) o declaró desierta (DESIERTA) una licitación en la que ya habíamos postulado. NO es una
  // pérdida contra un competidor, así que va aparte: fuera de Postuladas y de los KPIs/análisis (no entra
  // en ningún UNIVERSO_POSTULADA) pero visible en Negocios. La pone el cron (procesar-postuladas.ts).
  { id: 'REVOCADA',     label: 'REVOCADA',    color: '#64748B' },
  { id: 'DESIERTA',     label: 'DESIERTA',    color: '#78716C' },
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

// Inverso de ALIAS_LEGADO: dado un id VIGENTE, todos los ids (vigente + legados) que representan
// el mismo estado en la BD. Para usar en un `WHERE estado_pipeline IN (...)` — las queries SQL no
// pueden pasar por normalizarEstado() fila a fila, así que amplían la comparación en vez de
// angostarla (auditoría ago-2026: varias queries comparaban solo contra el id vigente y un
// registro legado quedaba invisible sin error, no por decisión, por descuido).
export function idsEquivalentes(idVigente: string): string[] {
  const legados = Object.entries(ALIAS_LEGADO)
    .filter(([, nuevo]) => nuevo === idVigente)
    .map(([viejo]) => viejo);
  return [idVigente, ...legados];
}

// ¿El negocio está en el estado "ganado" (label GANADA, id vigente ADJUDICADA)? Es la puerta de
// entrada al Módulo de Compras (spec §3.1: "solo las líneas efectivamente adjudicadas"). Vive acá
// (no en app/lib/compras.ts, que importa `pool` y no es seguro para un componente cliente) porque
// pipeline.ts no tiene ninguna dependencia de servidor.
export function esGanado(id: string | null | undefined): boolean {
  return normalizarEstado(id) === 'ADJUDICADA';
}

// Pestañas Resultado/Competencia/Preguntas del menú del negocio: SIEMPRE abiertas, sin depender
// del estado (pedido explícito del usuario, 29-sep-2026: "que nunca esté bloqueado por los
// estados" — la apertura se puede revisar antes de que se adjudique). Se mantiene la función y su
// nombre por los llamadores existentes, por si vuelve a hacer falta condicionarlas.
export function tieneResultado(_id: string | null | undefined): boolean {
  return true;
}

export function getEstadoPipeline(id: string | null | undefined): EstadoPipeline | null {
  if (!id) return null;
  const key = ALIAS_LEGADO[id] ?? id;
  return ESTADOS_PIPELINE.find(e => e.id === key) ?? null;
}

// ─── Bloqueo de retroceso para NO-admin (23-jul-2026) ─────────────────────────────
// Pedido del dueño: los asistentes solo pueden AVANZAR en el pipeline — no pueden retroceder
// ni "corregir" una etapa que ya pusieron (evita que alguien tape un cambio de opinión o un
// error sin que quede a la vista de un admin). El admin no tiene esta restricción.
//
// DESCARTADA queda FUERA del orden numérico y se trata aparte: descartar sigue disponible
// SIEMPRE para cualquiera (es una acción distinta, con motivo obligatorio — no un retroceso),
// pero SALIR de Descartada (reactivar) sí requiere admin, porque eso es deshacer una decisión.
//
// ADJUDICADA/PERDIDA quedan al mismo nivel (7): son los dos resultados posibles después de
// Postulada/Posible adjudicación, no un paso uno-antes-del-otro.
const ORDEN_PIPELINE: Record<string, number> = {
  ASIGNADO: 0, EN_PROCESO: 1, ANEXOS: 2, ANEXO_LISTO: 3, VISADO: 4,
  POSTULADA: 5, POSIBLE_ADJ: 6, ADJUDICADA: 7, PERDIDA: 7, REVOCADA: 7, DESIERTA: 7,
};

export interface ChequeoCambioEstado { permitido: boolean; motivo?: string }

/** ¿Puede este usuario cambiar el negocio de `actual` a `nuevo`? Admin: siempre sí. */
export function puedeCambiarEstadoPipeline(
  actual: string | null | undefined,
  nuevo: string | null | undefined,
  esAdmin: boolean,
): ChequeoCambioEstado {
  if (esAdmin) return { permitido: true };

  const actualN = normalizarEstado(actual);
  const nuevoN = nuevo ? normalizarEstado(nuevo) : null;

  if (nuevoN === 'DESCARTADA') return { permitido: true }; // descartar: siempre disponible

  if (actualN === 'DESCARTADA') {
    return { permitido: false, motivo: 'Solo un administrador puede sacar una licitación de "Descartada".' };
  }

  const ordenActual = ORDEN_PIPELINE[actualN] ?? 0;
  const ordenNuevo = nuevoN ? (ORDEN_PIPELINE[nuevoN] ?? -1) : -1; // sin estado (quitar etiqueta) = retroceso
  if (ordenNuevo < ordenActual) {
    return { permitido: false, motivo: 'Solo un administrador puede retroceder o quitar una etapa ya puesta.' };
  }
  return { permitido: true };
}
