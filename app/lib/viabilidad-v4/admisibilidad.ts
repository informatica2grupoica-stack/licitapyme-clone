// app/lib/viabilidad-v4/admisibilidad.ts
// P6 · ADMISIBILIDAD (antes "Riesgos") — solo lo que deja la oferta fuera, en campos uniformes
// (qué, cuánto, cuándo, cómo, consecuencia, cita), contado por el CÓDIGO (Arica: "1 bloqueante"
// mostrando dos). Más:
//  · Barrido de consecuencias: cada oración de las bases con una frase de consecuencia
//    ("inadmisible", "quedará fuera"…) que el modelo no cubrió aparece como "Posible causal sin
//    analizar" en ámbar (Arica: rubro compatible; Transductor: muestras en 3 días hábiles).
//  · P2: la exclusión por CONTRATO DE SUMINISTRO la decide el código con las señales del modelo.
//  · P10: filtro de obviedades sobre acciones y advertencias (catálogo editable).

import { normFrase, type ConfigViabilidadV4 } from '@/app/lib/viabilidad-v4/config';

export interface RequisitoAdm {
  que?: string; cuanto?: string; cuando?: string; como?: string; consecuencia?: string; cita?: any;
  origen?: 'modelo' | 'sistema';
}

export interface CausalSinAnalizar {
  frase_consecuencia: string;
  oracion: string;
  cita: { documento: string; numeral: string; frase: string };
}

/** Oraciones de los documentos que contienen una frase de consecuencia. */
function oracionesConConsecuencia(docs: { nombre: string; texto: string }[], frases: string[]): Array<{ doc: string; oracion: string; frase: string }> {
  const out: Array<{ doc: string; oracion: string; frase: string }> = [];
  const fr = frases.map(f => ({ f, n: ` ${normFrase(f)} ` }));
  for (const d of docs) {
    if (!d.texto) continue;
    const oraciones = d.texto.replace(/\[\[P[ÁA]GINA[^\]]*\]\]/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      .split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ0-9•\-–(])/);
    for (const o of oraciones) {
      if (o.length < 25) continue;
      const n = ` ${normFrase(o)} `;
      const hit = fr.find(x => n.includes(x.n));
      if (hit) out.push({ doc: d.nombre, oracion: o.trim().slice(0, 400), frase: hit.f });
    }
  }
  return out;
}

/** Palabras con contenido de un texto (para ver si el modelo ya cubrió esa causal). */
const contenido = (s: string) => new Set(normFrase(s).split(' ').filter(w => w.length >= 5));

/**
 * Barrido de consecuencias (V-26): devuelve las oraciones con frase de consecuencia que NINGÚN
 * requisito del modelo cubre (por solape de palabras con su frase citada, su "qué" o su
 * consecuencia). Tope de 25 para no inundar la pantalla.
 */
export function barridoConsecuencias(
  docs: { nombre: string; texto: string }[],
  requisitos: RequisitoAdm[],
  cfg: ConfigViabilidadV4,
): CausalSinAnalizar[] {
  const cubiertos = requisitos.map(r => contenido(`${r.que || ''} ${r.consecuencia || ''} ${r.cita?.frase || ''}`));
  const vistos = new Set<string>();
  const out: CausalSinAnalizar[] = [];
  for (const h of oracionesConConsecuencia(docs, cfg.frases_consecuencia)) {
    const clave = normFrase(h.oracion).slice(0, 160);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    const pal = contenido(h.oracion);
    const cubierto = cubiertos.some(c => {
      if (!c.size || !pal.size) return false;
      let inter = 0; for (const w of pal) if (c.has(w)) inter++;
      return inter / Math.min(pal.size, c.size) >= 0.5;
    });
    if (cubierto) continue;
    out.push({ frase_consecuencia: h.frase, oracion: h.oracion, cita: { documento: h.doc, numeral: '', frase: h.oracion.slice(0, 300) } });
    if (out.length >= 25) break;
  }
  return out;
}

// ─── P2 · Contrato de suministro ──────────────────────────────────────────────────────────
export interface SenalSuministro { tipo?: string; cita?: any }

/**
 * Decide la exclusión por CONTRATO DE SUMINISTRO. Señal decisiva: VIGENCIA_CON_PEDIDOS o
 * HASTA_AGOTAR_MONTO con su frase verificada (y no desmentida por el chequeo semántico).
 * "Cantidades referenciales" sola NO excluye (se reporta en el campo ± de cada ítem).
 * Sin excepción RM (decisión de CA, 02-10-2026).
 */
export function decidirSuministro(senales: SenalSuministro[] | unknown): { excluido: boolean; senal: SenalSuministro | null } {
  const arr: SenalSuministro[] = Array.isArray(senales) ? senales : [];
  const decisiva = arr.find(s => {
    const t = String(s?.tipo || '').toUpperCase();
    if (t !== 'VIGENCIA_CON_PEDIDOS' && t !== 'HASTA_AGOTAR_MONTO') return false;
    if (!s.cita?.frase || s.cita?.verificada === false) return false;
    return s.cita?.semantica !== 'NO' && s.cita?.semantica !== 'PARCIAL';
  });
  return { excluido: !!decisiva, senal: decisiva ?? null };
}

/** Detector en código de señales de suministro, por si el modelo no las reportó. */
export function detectarSenalesSuministro(docs: { nombre: string; texto: string }[]): Array<{ tipo: string; cita: { documento: string; numeral: string; frase: string } }> {
  const res: Array<[string, RegExp]> = [
    ['HASTA_AGOTAR_MONTO', /hasta\s+(?:agotar|completar|enterar)\s+(?:el\s+|los\s+)?(?:presupuesto|monto|fondos)[^.\n]{0,120}/i],
    ['VIGENCIA_CON_PEDIDOS', /(?:vigencia|duraci[oó]n)\s+(?:del\s+contrato\s+)?(?:ser[aá]\s+)?de\s+\d{1,2}\s+(?:meses|años)[^.]{0,250}?(?:[oó]rdenes?\s+de\s+compra|pedidos?)\s+(?:seg[uú]n|de\s+acuerdo\s+a|conforme\s+a)\s+(?:los\s+|las\s+)?(?:requerimientos?|necesidades?)/i],
  ];
  const out: Array<{ tipo: string; cita: { documento: string; numeral: string; frase: string } }> = [];
  for (const [tipo, re] of res) {
    for (const d of docs) {
      const m = d.texto?.match(re);
      if (m) { out.push({ tipo, cita: { documento: d.nombre, numeral: '', frase: m[0].replace(/\s+/g, ' ').trim().slice(0, 300) } }); break; }
    }
  }
  return out;
}

// ─── P10 · Filtro de obviedades ───────────────────────────────────────────────────────────
export function esObviedad(texto: unknown, cfg: ConfigViabilidadV4): boolean {
  const t = ` ${normFrase(texto)} `;
  return cfg.obviedades.some(o => t.includes(` ${normFrase(o)} `));
}

// ─── Firma ────────────────────────────────────────────────────────────────────────────────
export const FIRMA_VISTA: Record<string, { icono: string; titulo: string; accion: string; grave: boolean }> = {
  ESCANEADA_BASTA:           { icono: '🟢', titulo: 'Basta firma escaneada', accion: 'Pega la imagen de la firma.', grave: false },
  MANO_Y_ESCANEO:            { icono: '🟡', titulo: 'Firma a mano y escanea', accion: 'Imprime, firma a mano y escanea.', grave: false },
  ORIGINAL_NOTARIAL:         { icono: '🔴', titulo: 'Original o notarial', accion: 'Requiere gestión presencial.', grave: true },
  FIRMA_ELECTRONICA_AVANZADA:{ icono: '🔴', titulo: 'Firma electrónica avanzada', accion: 'Requiere token de firma electrónica avanzada.', grave: true },
};
