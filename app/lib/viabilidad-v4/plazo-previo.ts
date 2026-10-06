// app/lib/viabilidad-v4/plazo-previo.ts
// P3 · PLAZO PREVIO — tiempo administrativo entre la adjudicación y el inicio del plazo de entrega.
//
// El modelo entrega los cinco hitos en su unidad ORIGINAL ("24 horas", "10 días hábiles"); el
// código los SUMA siempre, en orden fijo y sin excepción:
//   garantía de fiel cumplimiento → firma del contrato (proveedor) → firma/tramitación del
//   contrato (organismo) → emisión de la OC → aceptación de la OC
// más el desfase del inicio del plazo de entrega cuando las bases lo fijan.
// Nada se infiere: un hito NO_INDICADO suma 0 y el total pasa a decir "al menos N días". La regla
// "aceptación de OC: 5 días corridos (Ley de Compras)" del prompt anterior NO existe en la ley y se
// eliminó (especificación 1, §10).
//
// Antes: la ventana de importación, "cadena larga/corta" y el factor 7/5 del modelo (Arica: 6 días
// con un solo hito de 24 h). Todo eso se retiró.

import type { ConfigViabilidadV4 } from '@/app/lib/viabilidad-v4/config';

export const HITOS_ORDEN = [
  'GARANTIA_FIEL_CUMPLIMIENTO',
  'FIRMA_CONTRATO_PROVEEDOR',
  'FIRMA_CONTRATO_ORGANISMO',
  'EMISION_OC',
  'ACEPTACION_OC',
] as const;
export type HitoClave = typeof HITOS_ORDEN[number];

export const HITO_LABEL: Record<HitoClave, string> = {
  GARANTIA_FIEL_CUMPLIMIENTO: 'Garantía de fiel cumplimiento',
  FIRMA_CONTRATO_PROVEEDOR: 'Firma del contrato (nosotros)',
  FIRMA_CONTRATO_ORGANISMO: 'Firma o tramitación del contrato (organismo)',
  EMISION_OC: 'Emisión de la orden de compra',
  ACEPTACION_OC: 'Aceptación de la orden de compra',
};

export const NOTA_ACEPTACION_OC = 'Si no aceptas, el organismo puede pedir el rechazo de la OC, que queda firme 24 horas después de solicitado (Políticas y Condiciones de Uso de ChileCompra, Res. 292-B de 2025), y puede readjudicar (art. 58, D661). Acepta la OC el mismo día.';

export type UnidadPlazo = 'HORAS' | 'DIAS_HABILES' | 'DIAS_CORRIDOS' | 'DIAS_SIN_TIPO' | 'DESCONOCIDA';

/** Interpreta la unidad tal cual la escribieron las bases. */
export function interpretarUnidad(u: unknown): UnidadPlazo {
  const s = String(u ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!s.trim()) return 'DESCONOCIDA';
  if (/hora|\bh\b|hrs?\b/.test(s)) return 'HORAS';
  if (/habil/.test(s)) return 'DIAS_HABILES';
  if (/corrid|calendario|naturales/.test(s)) return 'DIAS_CORRIDOS';
  if (/dia/.test(s)) return 'DIAS_SIN_TIPO';
  return 'DESCONOCIDA';
}

/** Número del plazo (acepta 10, "10", "diez" no — sin número no hay plazo). */
export function numeroPlazo(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) && x >= 0 ? x : null;
  const m = String(x ?? '').replace(',', '.').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// ─── Calendario ────────────────────────────────────────────────────────────────────────────
const iso = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

export function feriadosPara(cfg: ConfigViabilidadV4, region?: string | null): Set<string> {
  const s = new Set(cfg.feriados);
  const r = String(region ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [nombre, dias] of Object.entries(cfg.feriados_regionales || {})) {
    if (r && r.includes(nombre)) for (const d of dias) s.add(d);
  }
  return s;
}

const esHabil = (d: Date, feriados: Set<string>) => {
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6 && !feriados.has(iso(d));
};

/** Avanza `n` días hábiles desde `desde` (excluido) y devuelve la fecha de término. */
export function sumarHabiles(desde: Date, n: number, feriados: Set<string>): Date {
  const d = new Date(desde.getTime());
  let restantes = Math.ceil(n);
  while (restantes > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (esHabil(d, feriados)) restantes--;
  }
  return d;
}

const diasEntre = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

// ─── Detector de negación (garantías y contrato) ────────────────────────────────────────────
// Transductor HCSBA: "no se exigirá garantía de Fiel Cumplimiento" generó una cadena larga falsa
// porque el regex de antes no miraba negaciones.
// La negación va ANTES del objeto ("no se exigirá garantía…") o el objeto lleva "no aplica" pegado
// ("Garantía de fiel cumplimiento: NO APLICA"). Un "no aplica" suelto antes del objeto NO cuenta:
// "no aplica a los contratos de suministro" habla de otra cosa.
const NEG = String.raw`(?:no\s+se\s+(?:exigir[aá]n?|requerir[aá]n?|solicitar[aá]n?|pedir[aá]n?|suscribir[aá]n?|firmar[aá]n?)|se\s+exime\s+(?:de\s+)?(?:la\s+|el\s+)?(?:presentaci[oó]n\s+de\s+(?:la\s+)?)?)`;
const OBJ: Record<'seriedad' | 'fiel_cumplimiento' | 'contrato', string> = {
  seriedad: String.raw`garant[ií]a\s+(?:de\s+)?seriedad`,
  fiel_cumplimiento: String.raw`garant[ií]a\s+(?:de\s+|por\s+)?fiel\s+cumplimiento`,
  contrato: String.raw`(?:suscripci[oó]n|firma)\s+(?:de(?:l)?\s+|un\s+)?contrato`,
};

export interface NegacionDetectada { frase: string; documento: string }

/** Busca frases que DESCARTAN la garantía de seriedad, la de fiel cumplimiento o el contrato. */
export function detectarNegaciones(docs: { nombre: string; texto: string }[]): Partial<Record<'seriedad' | 'fiel_cumplimiento' | 'contrato', NegacionDetectada>> {
  const out: Partial<Record<'seriedad' | 'fiel_cumplimiento' | 'contrato', NegacionDetectada>> = {};
  for (const [clave, obj] of Object.entries(OBJ) as ['seriedad' | 'fiel_cumplimiento' | 'contrato', string][]) {
    const res = [
      new RegExp(`${NEG}[^.\\n]{0,25}?${obj}`, 'i'),                       // "no se exigirá garantía de fiel cumplimiento"
      new RegExp(`${obj}[^.]{0,40}?(?:[:\\-–]|\\s)\\s*(?:no\\s+aplica|no\\s+se\\s+exige|no\\s+se\\s+exigir[aá])\\b`, 'i'), // "Garantía de fiel cumplimiento: NO APLICA"
    ];
    for (const d of docs) {
      if (!d.texto) continue;
      for (const re of res) {
        const m = d.texto.match(re);
        if (m) { out[clave] = { frase: m[0].replace(/\s+/g, ' ').trim(), documento: d.nombre }; break; }
      }
      if (out[clave]) break;
    }
  }
  return out;
}

// ─── Cálculo del plazo previo ───────────────────────────────────────────────────────────────
export interface HitoInforme {
  hito?: string; estado?: string; plazo?: unknown; unidad_original?: string; desde?: string; cita?: any;
  // agregados por el código
  dias_corridos?: number; unidad_interpretada?: UnidadPlazo; corregido_por_negacion?: string;
  // El trámite corre DENTRO del plazo de otro hito (la garantía se entrega para firmar el contrato): no suma.
  simultaneo_con?: string;
}

export interface PlazoPrevioCalculado {
  total_dias_corridos: number;
  al_menos: boolean;
  desglose: Array<{ hito: HitoClave; estado: string; texto_original: string; dias_corridos: number; unidad_ambigua?: boolean; simultaneo_con?: string }>;
  fechas_estimadas: Array<{ hito: string; desde: string; hasta: string }>;
  fecha_base: string;
  fecha_base_origen: string;
  avisos: string[];
}

/** Ordena/completa los cinco hitos del informe (los que falten quedan NO_INDICADO). */
export function normalizarHitos(hitos: unknown): HitoInforme[] {
  const arr: HitoInforme[] = Array.isArray(hitos) ? hitos.filter(h => h && typeof h === 'object') as HitoInforme[] : [];
  return HITOS_ORDEN.map(clave => {
    const h = arr.find(x => String(x.hito || '').toUpperCase() === clave);
    return h ?? { hito: clave, estado: 'NO_INDICADO', plazo: null, unidad_original: '', desde: '', cita: { documento: '', numeral: '', frase: '' } };
  });
}

/**
 * Suma los hitos en orden fijo a partir de `fechaBase` (adjudicación estimada). Muta cada hito
 * agregando `dias_corridos` y devuelve el total. `desfase` = inicio del plazo de entrega.
 */
export function calcularPlazoPrevio(
  hitos: HitoInforme[],
  desfase: { cantidad?: unknown; unidad?: unknown } | null | undefined,
  fechaBase: Date,
  fechaBaseOrigen: string,
  feriados: Set<string>,
): PlazoPrevioCalculado {
  let cursor = new Date(Date.UTC(fechaBase.getUTCFullYear(), fechaBase.getUTCMonth(), fechaBase.getUTCDate()));
  const inicio = new Date(cursor.getTime());
  let alMenos = false;
  const desglose: PlazoPrevioCalculado['desglose'] = [];
  const fechas: PlazoPrevioCalculado['fechas_estimadas'] = [];
  const avisos: string[] = [];

  const avanzar = (n: number, unidad: UnidadPlazo): number => {
    const antes = new Date(cursor.getTime());
    if (unidad === 'HORAS') cursor.setUTCDate(cursor.getUTCDate() + Math.ceil(n / 24));
    else if (unidad === 'DIAS_HABILES') cursor = sumarHabiles(cursor, n, feriados);
    else cursor.setUTCDate(cursor.getUTCDate() + Math.ceil(n));
    return diasEntre(antes, cursor);
  };

  for (const h of hitos) {
    const clave = String(h.hito || '').toUpperCase() as HitoClave;
    const estado = String(h.estado || 'NO_INDICADO').toUpperCase();
    const n = numeroPlazo(h.plazo);
    const unidad = interpretarUnidad(h.unidad_original);
    h.unidad_interpretada = unidad;
    let dias = 0;
    let ambigua = false;
    const simultaneo = estado === 'EXISTE' && n == null && HITOS_ORDEN.includes(String(h.simultaneo_con || '').toUpperCase() as HitoClave) ? String(h.simultaneo_con).toUpperCase() as HitoClave : null;
    if (simultaneo) {
      // sin avanzar el cursor: su plazo ya está contado en el otro hito
    } else if (estado === 'EXISTE' && n != null && unidad !== 'DESCONOCIDA') {
      if (unidad === 'DIAS_SIN_TIPO') { ambigua = true; avisos.push(`${HITO_LABEL[clave] ?? clave}: las bases dicen "${h.unidad_original}" sin indicar hábiles o corridos; se sumó como días corridos.`); }
      const desde = new Date(cursor.getTime());
      dias = avanzar(n, unidad);
      fechas.push({ hito: clave, desde: iso(desde), hasta: iso(cursor) });
    } else if (estado === 'EXISTE') {
      alMenos = true;   // existe pero sin plazo legible: no se inventa
    } else if (estado === 'NO_INDICADO') {
      alMenos = true;
    }
    h.dias_corridos = dias;
    desglose.push({
      hito: clave, estado,
      texto_original: simultaneo ? `Junto con: ${HITO_LABEL[simultaneo]}` : estado === 'EXISTE' ? `${n ?? '?'} ${h.unidad_original || ''}`.trim() : estado === 'NO_EXISTE' ? 'No se exige' : 'No indicado en las bases',
      dias_corridos: dias,
      ...(ambigua ? { unidad_ambigua: true } : {}),
      ...(simultaneo ? { simultaneo_con: simultaneo } : {}),
    });
  }

  const nDesfase = numeroPlazo(desfase?.cantidad);
  const uDesfase = interpretarUnidad(desfase?.unidad);
  if (nDesfase != null && nDesfase > 0 && uDesfase !== 'DESCONOCIDA') {
    const desde = new Date(cursor.getTime());
    avanzar(nDesfase, uDesfase === 'DIAS_SIN_TIPO' ? 'DIAS_CORRIDOS' : uDesfase);
    fechas.push({ hito: 'INICIO_PLAZO_ENTREGA', desde: iso(desde), hasta: iso(cursor) });
  }

  return {
    total_dias_corridos: diasEntre(inicio, cursor),
    al_menos: alMenos,
    desglose,
    fechas_estimadas: fechas,
    fecha_base: iso(inicio),
    fecha_base_origen: fechaBaseOrigen,
    avisos,
  };
}
