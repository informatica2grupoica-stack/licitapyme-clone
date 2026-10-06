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

// ─── Visita técnica y muestras ────────────────────────────────────────────────────────────
// El modelo las reporta en requisitos_admisibilidad.visita_tecnica / .muestras; si no las vio, este
// detector las busca en el texto. Una visita obligatoria o unas muestras exigidas dejan la oferta
// fuera si se omiten: se vuelven requisito de admisibilidad (origen "sistema").
export type EstadoVisita = 'OBLIGATORIA' | 'VOLUNTARIA' | 'EXISTE' | 'NO_EXISTE' | 'NO_INDICADO';
export type EstadoMuestras = 'EXIGE' | 'NO_EXIGE' | 'NO_INDICADO';
type CitaSimple = { documento: string; numeral: string; frase: string };

const RE_VISITA = /visita\s+(?:t[eé]cnica|a\s+terreno|en\s+terreno|al?\s+(?:lugar|establecimiento|recinto|inmueble|sitio)|a\s+(?:las\s+)?(?:dependencias|instalaciones))|visita\s+obligatoria|inspecci[oó]n\s+(?:t[eé]cnica\s+)?(?:presencial|del\s+lugar|en\s+terreno)/i;
const RE_MUESTRA = /\b(?:muestras|(?:una|la|cada|dicha|su|de)\s+muestra|prototipos?)\b/i;
const RE_MUESTRA_ACCION = /(?:present|entreg|remit|envi|acompa|adjunt|exig|requier|solicit)[\wáéíóúñ]*\s+(?:[\wáéíóúñ]+\s+){0,6}muestras?|muestras?\s+(?:deber|ser[aá]n?\s|debe)|(?:presentaci[oó]n|entrega|env[ií]o)\s+de\s+(?:las\s+)?muestras/i;
const RE_MUESTRA_RUIDO = /no\s+est[eé]n\s+disponibles\s+en\s+formato|per[ií]odo\s+de\s+evaluaci[oó]n,?\s+los\s+oferentes|contacto\s+con\s+la\s+entidad|cuando\s+(?:estas?|[eé]stas?|ellas?|las\s+bases)\s+(?:hayan|soliciten|lo\s+exijan)|en\s+caso\s+(?:de\s+)?que\s+(?:las\s+bases|se\s+soliciten)/i;

function oracionesQue(docs: { nombre: string; texto: string }[], re: RegExp): Array<{ doc: string; oracion: string }> {
  const out: Array<{ doc: string; oracion: string }> = [];
  for (const d of docs) {
    if (!d.texto) continue;
    const oraciones = d.texto.replace(/\[\[P[ÁA]GINA[^\]]*\]\]/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      .split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ0-9•\-–(])/);
    for (const o of oraciones) if (o.length >= 20 && re.test(o)) out.push({ doc: d.nombre, oracion: o.trim().slice(0, 400) });
  }
  return out;
}

export function detectarVisitaTecnica(docs: { nombre: string; texto: string }[]): { estado: EstadoVisita; cita: CitaSimple } | null {
  const hits = oracionesQue(docs, RE_VISITA);
  if (!hits.length) return null;
  const mk = (h: { doc: string; oracion: string }, estado: EstadoVisita) => ({ estado, cita: { documento: h.doc, numeral: '', frase: h.oracion.slice(0, 300) } });
  const obligatoria = hits.find(h => /obligatori|indispensable|(?:inadmisible|quedar[aá]s+fuera|excluyente)[^.]{0,100}visita|visita[^.]{0,100}(?:inadmisible|quedar[aá]s+fuera|excluyente)|requisito\s+(?:de\s+)?(?:admisibilidad|participar)|deber[aá]n?\s+(?:asistir|realizar|efectuar)/i.test(h.oracion) && !/\bno\s+(?:ser[aá]|es|se\s+exigir[aá])\s+obligatori|voluntari/i.test(h.oracion));
  if (obligatoria) return mk(obligatoria, 'OBLIGATORIA');
  const negada = hits.find(h => /\bno\s+(?:se\s+)?(?:realizar[aá]|exigir[aá]|considera|contempla|habr[aá]|requiere|efectuar[aá])\s+(?:[\wáéíóúñ]+\s+){0,3}visita|sin\s+visita|\bno\s+(?:habr[aá]|hay)\s+visita/i.test(h.oracion));
  if (negada) return mk(negada, 'NO_EXISTE');
  const voluntaria = hits.find(h => /voluntari|facultativ|opcional|\bno\s+(?:ser[aá]|es)\s+obligatori/i.test(h.oracion));
  if (voluntaria) return mk(voluntaria, 'VOLUNTARIA');
  return mk(hits[0], 'EXISTE');
}

export function detectarMuestras(docs: { nombre: string; texto: string }[]): { estado: EstadoMuestras; cita: CitaSimple } | null {
  const hits = oracionesQue(docs, RE_MUESTRA).filter(h => RE_MUESTRA_ACCION.test(h.oracion) && !RE_MUESTRA_RUIDO.test(h.oracion));
  if (!hits.length) return null;
  const negada = hits.find(h => /\bno\s+(?:se\s+)?(?:exigir[aá]n?|requerir[aá]n?|solicitar[aá]n?|deber[aá]n?\s+presentar)\s+(?:[\wáéíóúñ]+\s+){0,3}muestras?|sin\s+muestras?|muestras?\s*:?\s*no\s+(?:se\s+)?(?:requiere|exige|aplica|solicita)/i.test(h.oracion));
  if (negada) return { estado: 'NO_EXIGE', cita: { documento: negada.doc, numeral: '', frase: negada.oracion.slice(0, 300) } };
  return { estado: 'EXIGE', cita: { documento: hits[0].doc, numeral: '', frase: hits[0].oracion.slice(0, 300) } };
}

/**
 * Deja visita técnica y muestras en `adm` con estado definitivo: respeta lo que reportó el modelo
 * cuando tiene estado y cita; si dijo NO_INDICADO (o nada) pero el texto sí lo menciona, manda el
 * detector (origen "detector"). Devuelve los requisitos de admisibilidad que corresponde agregar.
 */
export function consolidarVisitaYMuestras(
  adm: any,
  docs: { nombre: string; texto: string }[],
  localizar: (c: CitaSimple) => any,
): Array<{ que: string; cuando?: string; consecuencia: string; cita: any }> {
  const nuevos: Array<{ que: string; cuando?: string; consecuencia: string; cita: any }> = [];
  const sinEstado = (e: unknown) => { const s = String(e || '').toUpperCase(); return !s || s === 'NO_INDICADO'; };

  const v = adm.visita_tecnica && typeof adm.visita_tecnica === 'object' ? adm.visita_tecnica : (adm.visita_tecnica = {});
  if (sinEstado(v.estado)) {
    const d = detectarVisitaTecnica(docs);
    if (d) { v.estado = d.estado; v.cita = localizar({ ...d.cita }); v.origen = 'detector'; }
    else v.estado = 'NO_INDICADO';
  }
  v.estado = String(v.estado).toUpperCase();
  const m = adm.muestras && typeof adm.muestras === 'object' ? adm.muestras : (adm.muestras = {});
  if (sinEstado(m.estado)) {
    const d = detectarMuestras(docs);
    if (d) { m.estado = d.estado; m.cita = localizar({ ...d.cita }); m.origen = 'detector'; }
    else m.estado = 'NO_INDICADO';
  }
  m.estado = String(m.estado).toUpperCase();
  if (!Array.isArray(adm.otras_exigencias_presenciales)) adm.otras_exigencias_presenciales = [];
  if (!Array.isArray(adm.condiciones_comerciales)) adm.condiciones_comerciales = [];

  const yaCubierto = (re: RegExp) => (Array.isArray(adm.requisitos) ? adm.requisitos : []).some((r: any) => re.test(`${r?.que || ''} ${r?.consecuencia || ''}`));
  if (v.estado === 'OBLIGATORIA' && !yaCubierto(/visita|inspecci[oó]n/i)) {
    nuevos.push({ que: 'Asistir a la visita técnica obligatoria', cuando: v.fecha_hora || undefined, consecuencia: v.consecuencia || 'sin asistir, la oferta queda fuera', cita: v.cita });
  }
  if (m.estado === 'EXIGE' && !yaCubierto(/muestra|prototipo/i)) {
    nuevos.push({ que: 'Entregar muestras de los productos', cuando: m.cuando || undefined, consecuencia: m.consecuencia || 'sin las muestras en la forma y plazo exigidos, la oferta queda fuera', cita: m.cita });
  }
  return nuevos;
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
