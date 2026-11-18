// app/lib/etapas-core.ts
// Etapas de avance PROPIAS de cada empresa (migration-199). Parte pura, sin BD: la usan el servidor, la UI y pipeline.ts.
// Una etapa propia siempre «equivale» a una etapa base del sistema (`base`): negocios.estado_pipeline guarda la base, así que alertas,
// KPIs, cron y resultados siguen funcionando igual. La clave de una etapa propia es `E<id>` y viaja por las mismas rutas que un id de etapa.

export interface EtapaPropia { id: number; nombre: string; color: string; base: string; orden: number }

/** Etapas del sistema a las que se puede «equivaler». Ganada, Perdida, Revocada y Desierta las pone el cron según Mercado Público;
 *  Descartada exige motivo: esas siguen siendo solo del sistema. */
export const BASES_ETAPA: { id: string; label: string; ayuda: string }[] = [
  { id: 'ASIGNADO',    label: 'Asignado',        ayuda: 'Recién tomada por alguien del equipo' },
  { id: 'EN_PROCESO',  label: 'En proceso',      ayuda: 'Se está revisando o trabajando' },
  { id: 'ANEXOS',      label: 'Pre-postulación', ayuda: 'Se arman los anexos y la oferta' },
  { id: 'ANEXO_LISTO', label: 'Anexo listo',     ayuda: 'Los anexos están terminados' },
  { id: 'VISADO',      label: 'Visado',          ayuda: 'Revisada y aprobada para postular' },
  { id: 'POSTULADA',   label: 'Postulada',       ayuda: 'Ya se postuló en Mercado Público' },
  { id: 'POSIBLE_ADJ', label: 'Posible adj.',    ayuda: 'Hay opción real de adjudicación' },
];
export const COLORES_ETAPA = ['#4F63D2', '#9333EA', '#EA580C', '#0D9488', '#0369A1', '#B45309', '#16A34A', '#DB2777', '#475569', '#CA8A04'];
export const MAX_ETAPAS_POR_EMPRESA = 20;

export const claveEtapa = (id: number) => `E${id}`;
export const esClaveEtapa = (k: unknown): k is string => typeof k === 'string' && /^E\d+$/.test(k);
export const idDeClave = (k: string) => Number(k.slice(1));

/** null = válida; si no, el motivo en español. */
export function validarEtapa(e: { nombre?: unknown; color?: unknown; base?: unknown }): string | null {
  const nombre = String(e.nombre ?? '').trim();
  if (nombre.length < 2) return 'Ponle un nombre a la etapa (mínimo 2 letras).';
  if (nombre.length > 40) return 'El nombre es muy largo (máximo 40 caracteres).';
  if (!/^#[0-9a-fA-F]{6}$/.test(String(e.color ?? ''))) return 'Elige un color.';
  if (!BASES_ETAPA.some(b => b.id === e.base)) return 'Elige a qué etapa del sistema equivale.';
  return null;
}
