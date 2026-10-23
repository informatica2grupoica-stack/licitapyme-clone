// app/lib/viabilidad-v4/multa.ts
// P7 · MULTA POR ATRASO — el modelo extrae los componentes; el CÓDIGO calcula.
//
// Antes el modelo calculaba los pesos por día con una UTM inyectada (y caía a $69.000 fijo si
// faltaba la variable): el Transductor confundió UF con UTM (+70 %) y Arica mandó a Fase 3 el 1 %
// de $52M. Ahora: valor + unidad + base + periodo + tope salen de las bases; los pesos los calcula
// esta función sobre el presupuesto, rotulados "estimado sobre el presupuesto". Si la unidad es UF
// o UTM y no hay valor oficial del día, NO se inventa: se dice "valor oficial no disponible".

export interface MultaAtraso {
  existe?: boolean; valor?: unknown; unidad?: string; base_calculo?: string; periodo?: string;
  tope?: { valor?: unknown; unidad?: string } | null; al_superar_tope?: string; cita?: any;
}

export interface CalculoMulta {
  pesos_dia_estimado: number | null;
  tope_estimado: number | null;
  base_usada: 'bruto' | 'neto' | null;
  monto_base: number | null;
  valor_uf_utm: number | null;
  fecha_valor: string | null;
  fuente_valor: string | null;
  nota: string;
}

export interface IndicadorDia { valor: number; fecha: string; fuente: string }

const num = (x: unknown): number | null => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  // "0,1%" → 0.1 · "1.500" (miles) → 1500 · "2,5 UF" → 2.5
  const s = String(x ?? '').trim();
  const m = s.match(/\d[\d.]*(?:,\d+)?|\d+(?:\.\d+)?/);
  if (!m) return null;
  let t = m[0];
  if (/,\d+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const unidadDe = (u: unknown): 'PORCENTAJE' | 'UF' | 'UTM' | 'PESOS' | null => {
  const s = String(u ?? '').toUpperCase();
  if (/PORC|%/.test(s)) return 'PORCENTAJE';
  if (/\bUF\b|UNIDAD(?:ES)? DE FOMENTO/.test(s)) return 'UF';
  if (/\bUTM\b|UNIDAD(?:ES)? TRIBUTARIA/.test(s)) return 'UTM';
  if (/PESO|\$|CLP/.test(s)) return 'PESOS';
  return null;
};

/**
 * @param presupuesto bruto (con IVA) y neto del total. La base es el bruto salvo que la base de
 *   cálculo diga "neto" (Arica: 1 % de $52M IVA incl. = $520.000/día; Cholchol: 0,1 % del total).
 * @param indicador valor oficial del día de la UF o la UTM, solo si la unidad lo necesita.
 */
export function calcularMulta(
  atraso: MultaAtraso | null | undefined,
  presupuesto: { bruto: number | null; neto: number | null },
  indicador: IndicadorDia | null,
): CalculoMulta | null {
  if (!atraso || atraso.existe === false) return null;
  const valor = num(atraso.valor);
  const unidad = unidadDe(atraso.unidad) ?? unidadDe(atraso.valor);
  const base = /neto|sin\s+iva/i.test(String(atraso.base_calculo || '')) ? 'neto' : 'bruto';
  const monto = base === 'neto' ? (presupuesto.neto ?? null) : (presupuesto.bruto ?? presupuesto.neto ?? null);
  const out: CalculoMulta = {
    pesos_dia_estimado: null, tope_estimado: null, base_usada: monto != null ? base : null, monto_base: monto,
    valor_uf_utm: null, fecha_valor: null, fuente_valor: null, nota: 'estimado sobre el presupuesto',
  };
  if (valor == null || !unidad) { out.nota = 'faltan el valor o la unidad de la multa en las bases'; return out; }

  if (unidad === 'PORCENTAJE') {
    if (monto == null) { out.nota = 'sin presupuesto publicado: no se puede estimar en pesos'; return out; }
    out.pesos_dia_estimado = Math.round(monto * valor / 100);
  } else if (unidad === 'PESOS') {
    out.pesos_dia_estimado = Math.round(valor);
  } else {
    if (!indicador) { out.nota = `valor oficial de la ${unidad} no disponible`; return out; }
    out.valor_uf_utm = indicador.valor; out.fecha_valor = indicador.fecha; out.fuente_valor = indicador.fuente;
    out.pesos_dia_estimado = Math.round(valor * indicador.valor);
  }
  if (/l[ií]nea/i.test(String(atraso.base_calculo || ''))) out.nota = 'estimado sobre el presupuesto total; si se aplica solo a la línea atrasada, es menor';

  // Tope: en días (tope × multa diaria), en % (del monto base) o en UF/UTM/pesos.
  const tv = num(atraso.tope?.valor);
  const tu = String(atraso.tope?.unidad || atraso.tope?.valor || '');
  if (tv != null) {
    if (/d[ií]a/i.test(tu)) out.tope_estimado = out.pesos_dia_estimado != null ? out.pesos_dia_estimado * tv : null;
    else {
      const u = unidadDe(tu);
      if (u === 'PORCENTAJE' && monto != null) out.tope_estimado = Math.round(monto * tv / 100);
      else if (u === 'PESOS') out.tope_estimado = Math.round(tv);
      else if ((u === 'UF' || u === 'UTM') && indicador && u === unidad) out.tope_estimado = Math.round(tv * indicador.valor);
    }
  }
  return out;
}

/** ¿La multa necesita UF o UTM para calcularse? (para pedir solo el indicador que corresponde). */
export function indicadorNecesario(atraso: MultaAtraso | null | undefined): 'UF' | 'UTM' | null {
  const u = unidadDe(atraso?.unidad) ?? unidadDe(atraso?.valor);
  return u === 'UF' || u === 'UTM' ? u : null;
}
