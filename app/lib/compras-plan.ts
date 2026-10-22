// app/lib/compras-plan.ts
// PLANIFICACIÓN DEL GANTT DE COMPRAS — decisión PURA (sin red ni BD, apta para cliente y servidor).
// El Gantt tiene tres fases y una línea padre:
//   PRE_OC   desde la adjudicación hasta que llega/se acepta la OC
//   POST_OC  desde que llega la OC (hitos administrativos y de compra)
//   ENTREGA  dentro del plazo de entrega
// Cada tarea del catálogo trae un ANCLA (de qué hito cuelga) y un desfase/duración en HORAS, así
// que los tramos se calculan solos cuando el hito existe y quedan sin fecha (nunca inventada)
// mientras no exista.
//
// El plazo de entrega corre desde un hito que dicen las BASES (`hitoInicioPlazo`): la adjudicación,
// la llegada de la OC o su aceptación, a veces con un desfase ("+1 día hábil siguiente"). Si las
// bases no lo aclaran, el inicio queda "por validar". Los días HÁBILES saltan fines de semana y
// feriados de Chile (los de la configuración de viabilidad v4).
//
// Mientras la OC llegó pero aún no se acepta, el inicio se PROYECTA suponiendo que se acepta el
// último día permitido (`inicioProyectado`): la fecha de entrega es entonces el peor caso, y se
// corre sola apenas se registre la aceptación real.
import { CONFIG_V4_DEFAULT } from './viabilidad-v4/config';

export type FaseTarea = 'PRE_OC' | 'POST_OC' | 'ENTREGA';
export type AnclaTarea = 'ADJUDICACION' | 'LIMITE_OC' | 'OC' | 'OC_ACEPTADA' | 'INICIO_PLAZO' | 'FIN_PLAZO';
export type InicioPlazoTipo = 'ADJUDICACION' | 'OC_EMITIDA' | 'OC_ACEPTADA';
export type TipoDias = 'HABILES' | 'CORRIDOS';

export const TOPE_LEGAL_ACEPTACION_OC_DIAS = 5;
/** Ventana nominal de la fase de entrega: las tareas de ENTREGA se definen en las 168 h previas al fin
 *  y se encogen proporcionalmente si el plazo real es más corto. */
const VENTANA_ENTREGA_NOMINAL_HORAS = 168;

const FERIADOS = new Set(CONFIG_V4_DEFAULT.feriados);

export interface EntradaAnclas {
  ganadoAt: string;                      // 'YYYY-MM-DD' o 'YYYY-MM-DD HH:mm:ss'
  ocEmitidaAt: string | null;
  ocAceptadaAt: string | null;
  hitoInicioPlazo: string | null;        // texto del informe: «desde cuándo corre el plazo»
  plazoEntregaDias: number | null;
  plazoEntregaTipo?: TipoDias;           // por defecto CORRIDOS
  plazoAceptacionOCDias: number | null;
  plazoAceptacionTipo?: TipoDias;        // por defecto CORRIDOS
  entregaOficialAt: string | null;       // Reloj de Entrega fijado (con prórroga aplicada)
}

export interface HitosGantt {
  adjudicacion: string;
  ocLimite: string;                      // último día para aceptar la OC (fin de ese día)
  ocLimiteEstimado: boolean;
  ocEmitida: string | null;              // llegó la OC (si solo hay aceptación, esa fecha)
  ocAceptada: string | null;
  ocAceptadaProyectada: string | null;   // OC llegó y falta aceptarla: se supone el último día
  inicioPlazoTipo: InicioPlazoTipo | null;   // null = las bases no lo dicen: por validar
  inicioPlazo: string | null;
  inicioProyectado: boolean;             // el inicio sale de una aceptación supuesta, no real
  entrega: string | null;                // fin del día de entrega
  entregaOficial: boolean;
  plazoEntregaDias: number | null;
}

export interface CfgPlanTarea {
  ancla: AnclaTarea | null;
  desfaseHoras: number | null;
  duracionHoras: number | null;
  plazoAt: string | null;                // plazo guardado en la tarea (solo vale con ancla ADJUDICACION)
}

const MS_HORA = 3_600_000;
const MS_DIA = 24 * MS_HORA;

function parsear(s: string): number {
  const [f, h] = String(s).replace('T', ' ').slice(0, 19).split(' ');
  const [y, mo, d] = f.split('-').map(Number);
  const [hh, mi, se] = (h || '00:00:00').split(':').map(Number);
  return Date.UTC(y, (mo || 1) - 1, d || 1, hh || 0, mi || 0, se || 0);
}

function formatear(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const sumarHoras = (s: string, h: number) => formatear(parsear(s) + h * MS_HORA);
const inicioDelDia = (s: string) => formatear(Math.floor(parsear(s) / MS_DIA) * MS_DIA);
const finDelDia = (s: string) => formatear(Math.floor(parsear(s) / MS_DIA) * MS_DIA + MS_DIA - 60_000);

function esHabil(ms: number): boolean {
  const d = new Date(ms);
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6 && !FERIADOS.has(formatear(ms).slice(0, 10));
}

/** Suma `n` días a una fecha conservando la hora. Hábiles: salta fines de semana y feriados de Chile. */
export function sumarDias(s: string, n: number, tipo: TipoDias): string {
  if (tipo === 'CORRIDOS') return sumarHoras(s, 24 * n);
  let ms = parsear(s);
  let restantes = Math.ceil(n);
  while (restantes > 0) {
    ms += MS_DIA;
    if (esHabil(ms)) restantes--;
  }
  return formatear(ms);
}

/** Desde qué hito corre el plazo de entrega, leído del texto de las bases. null = no se puede saber. */
export function inicioPlazoDeBases(hito: string | null): InicioPlazoTipo | null {
  if (!hito) return null;
  const t = hito.toLowerCase();
  if (/aceptaci/.test(t)) return 'OC_ACEPTADA';
  if (/orden de compra|\boc\b|notificaci|emisi|recepci/.test(t)) return 'OC_EMITIDA';
  if (/adjudicaci/.test(t)) return 'ADJUDICACION';
  return null;
}

/** Desfase del hito de inicio, ej. «aceptación de la orden de compra (+1 día hábil siguiente)». */
export function desfaseDeBases(hito: string | null): { n: number; tipo: TipoDias } | null {
  if (!hito) return null;
  // «desde el día quinto hábil de la emisión de la OC», «5° día hábil…»: ordinal + hábil = desfase.
  const ORD: Record<string, number> = { primer: 1, primero: 1, segundo: 2, tercer: 3, tercero: 3, cuarto: 4, quinto: 5, sexto: 6, septimo: 7, séptimo: 7, octavo: 8, noveno: 9, decimo: 10, décimo: 10 };
  const o = /(primer[o]?|segundo|tercer[o]?|cuarto|quinto|sexto|s[eé]ptimo|octavo|noveno|d[eé]cimo|\d{1,2})\s*[°ºo]?\s*(?:d[ií]as?\s+)?h[aá]bil(?:es)?/i.exec(hito);
  if (o && !/\+\s*\d/.test(hito)) {
    const n = ORD[o[1].toLowerCase()] ?? Number(o[1]);
    if (Number.isFinite(n) && n > 0) return { n, tipo: 'HABILES' };
  }
  const m = /\+\s*(\d+)\s*d[ií]as?\s*(h[aá]bil|corrid)?/i.exec(hito);
  if (!m) return null;
  return { n: Number(m[1]), tipo: /h[aá]bil/i.test(m[2] || hito.slice(m.index, m.index + 40)) ? 'HABILES' : 'CORRIDOS' };
}

export function calcularHitosGantt(e: EntradaAnclas): HitosGantt {
  const adjudicacion = formatear(parsear(e.ganadoAt));
  const ocAceptada = e.ocAceptadaAt ? formatear(parsear(e.ocAceptadaAt)) : null;
  const ocEmitida = e.ocEmitidaAt ? formatear(parsear(e.ocEmitidaAt)) : ocAceptada;

  // Último día para aceptar la OC: se cuenta desde que llegó (o desde la adjudicación si aún no llega).
  const diasAceptacion = e.plazoAceptacionOCDias ?? TOPE_LEGAL_ACEPTACION_OC_DIAS;
  const tipoAceptacion = e.plazoAceptacionOCDias == null ? 'CORRIDOS' : (e.plazoAceptacionTipo ?? 'CORRIDOS');
  const ocLimite = finDelDia(sumarDias(ocEmitida ?? adjudicacion, diasAceptacion, tipoAceptacion));
  const ocAceptadaProyectada = !ocAceptada && ocEmitida ? ocLimite : null;

  const inicioPlazoTipo = inicioPlazoDeBases(e.hitoInicioPlazo);
  const desfase = desfaseDeBases(e.hitoInicioPlazo);
  const disparador = inicioPlazoTipo === 'ADJUDICACION' ? adjudicacion
    : inicioPlazoTipo === 'OC_EMITIDA' ? ocEmitida
    : inicioPlazoTipo === 'OC_ACEPTADA' ? (ocAceptada ?? ocAceptadaProyectada)
    : null;
  const inicioProyectado = inicioPlazoTipo === 'OC_ACEPTADA' && !ocAceptada && !!ocAceptadaProyectada;
  const inicioPlazo = disparador
    ? (desfase ? sumarDias(inicioDelDia(disparador), desfase.n, desfase.tipo) : inicioDelDia(disparador))
    : null;

  // Con desfase ("+1 día hábil siguiente") el primer día del plazo es el propio día de inicio.
  const entregaOficial = !!e.entregaOficialAt;
  const entrega = e.entregaOficialAt ? finDelDia(e.entregaOficialAt)
    : inicioPlazo && e.plazoEntregaDias != null
      ? finDelDia(sumarDias(inicioPlazo, desfase ? Math.max(0, e.plazoEntregaDias - 1) : e.plazoEntregaDias, e.plazoEntregaTipo ?? 'CORRIDOS'))
      : null;
  return {
    adjudicacion, ocLimite, ocLimiteEstimado: e.plazoAceptacionOCDias == null,
    ocEmitida, ocAceptada, ocAceptadaProyectada, inicioPlazoTipo, inicioPlazo, inicioProyectado,
    entrega, entregaOficial, plazoEntregaDias: e.plazoEntregaDias,
  };
}

/** Inicio y fin planificados de una tarea. null = el hito del que cuelga todavía no existe. */
export function planificarTarea(cfg: CfgPlanTarea, h: HitosGantt): { inicio: string | null; fin: string | null } {
  const desfase = cfg.desfaseHoras ?? 0;
  const ancla = cfg.ancla ?? 'ADJUDICACION';

  if (ancla === 'ADJUDICACION') {
    const inicio = sumarHoras(h.adjudicacion, desfase);
    const fin = cfg.plazoAt ? formatear(Math.max(parsear(cfg.plazoAt), parsear(inicio)))
      : cfg.duracionHoras != null ? sumarHoras(inicio, cfg.duracionHoras) : null;
    return { inicio, fin };
  }

  // Aceptar la OC: desde que llega (o desde la adjudicación) hasta el último día que dan las bases.
  if (ancla === 'LIMITE_OC') {
    const inicio = sumarHoras(h.ocEmitida ?? h.adjudicacion, desfase);
    return { inicio, fin: formatear(Math.max(parsear(h.ocLimite), parsear(inicio) + MS_HORA)) };
  }

  const base = ancla === 'OC' ? h.ocEmitida : ancla === 'OC_ACEPTADA' ? h.ocAceptada
    : ancla === 'INICIO_PLAZO' ? h.inicioPlazo : h.entrega;
  if (!base) return { inicio: null, fin: null };

  const dur = cfg.duracionHoras ?? 24;
  if (ancla === 'FIN_PLAZO') {
    const finMs = parsear(base);
    const iniPlazoMs = h.inicioPlazo ? parsear(h.inicioPlazo) : null;
    // Antes del fin del plazo: se definen sobre 168 h y se encogen si el plazo real es más corto.
    const ventana = iniPlazoMs != null ? (finMs - iniPlazoMs) / MS_HORA : VENTANA_ENTREGA_NOMINAL_HORAS;
    const escala = desfase < 0 && ventana > 0 && ventana < VENTANA_ENTREGA_NOMINAL_HORAS ? ventana / VENTANA_ENTREGA_NOMINAL_HORAS : 1;
    let inicioMs = finMs + desfase * escala * MS_HORA;
    if (desfase < 0 && iniPlazoMs != null) inicioMs = Math.max(inicioMs, iniPlazoMs);
    const durMs = dur * escala * MS_HORA;
    const finTarea = desfase < 0 ? Math.min(inicioMs + durMs, finMs) : inicioMs + durMs;
    return { inicio: formatear(inicioMs), fin: formatear(Math.max(finTarea, inicioMs + MS_HORA)) };
  }

  const inicioMs = parsear(base) + desfase * MS_HORA;
  return { inicio: formatear(inicioMs), fin: formatear(inicioMs + dur * MS_HORA) };
}
