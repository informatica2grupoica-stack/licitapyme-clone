// app/lib/viabilidad-v4/lectura-dirigida.ts
// LECTURA DIRIGIDA de multas por atraso y plazos previos (hitos), en una segunda pasada CHICA.
//
// POR QUÉ (1057536-136-LE26, 06-oct-2026): el análisis principal lee ~75.000 tokens de bases de una
// vez y el modelo barato es inconsistente de una corrida a otra con estos datos, que están perdidos
// en medio de 170.000 caracteres: una corrida dijo "no hay multa" teniendo una tabla de 0,3/0,5/0,8 %
// diario (punto 21.1); la siguiente sí la vio pero dejó los hitos "no indicado" con la frase correcta
// citada ("15 días hábiles", "48 horas") → plazo previo 0 días; y la primera sumó 90 días de
// VIGENCIA de la garantía como si fueran un trámite previo (111 días en vez de ~21).
// Esta pasada junta SOLO los pasajes que hablan de multas, garantía de fiel cumplimiento, firma de
// contrato y aceptación de la OC (unos pocos miles de caracteres), le pregunta lo mismo al modelo con
// reglas explícitas y solo CORRIGE lo que la primera pasada dejó vacío o contradictorio. Toda frase
// nueva debe existir literal en las bases (LocalizadorCitas.verificada), si no se descarta.
// No inventa nada: si no encuentra el dato, el informe queda como estaba.
import { numeroPlazo, interpretarUnidad, HITOS_ORDEN, type HitoClave } from '@/app/lib/viabilidad-v4/plazo-previo';

export interface DocDirigido { nombre: string; categoria?: string | null; texto: string }
export interface Pasaje { doc: string; texto: string }

const MAX_CHARS = 16_000;
const ANTES = 3, DESPUES = 28;

const RE_MULTA = /\bmultas?\b/i;
const RE_MULTA_ATRASO = /atraso|retraso|demora|plazo de entrega|incumplimiento/i;
const RE_GARANTIA = /garant[ií]a\s+(?:de\s+|por\s+)?(?:fiel|oportuno)/i;
const RE_CONTRATO = /(?:suscripci[oó]n|firma)\s+(?:del?\s+|un\s+)?contrato|plazo\s+(?:para\s+)?(?:la\s+)?firma\s+de\s+contrato/i;
const RE_OC = /[oó]rden\s+de\s+compra/i;
const RE_OC_PLAZO = /acept|emisi[oó]n|emitir|env[ií]o|notific/i;
const RE_PLAZO_NUM = /\d+\s*(?:\(\s*\d+\s*\)\s*)?(?:d[ií]as?|horas?|hrs?)\b|(?:cinco|diez|quince|veinte|treinta|cuarenta)\b[^.\n]{0,25}(?:d[ií]as?|horas?)/i;
const RE_MULTA_NUM = /%|\bUF\b|\bUTM\b|\$\s*\d|pesos|diari[oa]/i;

/** Pasajes (ventanas de líneas) que mencionan multas por atraso o los hitos del plazo previo. */
export function extraerPasajesPlazosMultas(docs: DocDirigido[]): Pasaje[] {
  const out: { doc: string; texto: string; prio: number }[] = [];
  for (const d of docs) {
    // la planilla de costeo propia no es una fuente de las bases
    if (!d.texto || /^COSTEO_/i.test(d.nombre) || /DOCUMENTOS_PROPIOS/i.test(d.categoria || '')) continue;
    const lineas = d.texto.split(/\r?\n/);
    const marcas: { i: number; prio: number }[] = [];
    lineas.forEach((l, i) => {
      if (RE_MULTA.test(l)) marcas.push({ i, prio: 0 });
      else if (RE_GARANTIA.test(l)) marcas.push({ i, prio: 1 });
      else if (RE_CONTRATO.test(l)) marcas.push({ i, prio: 1 });
      else if (RE_OC.test(l) && RE_OC_PLAZO.test(l)) marcas.push({ i, prio: 2 });
    });
    // une ventanas que se pisan
    let ini = -1, fin = -1, prio = 9;
    const volcar = () => {
      if (ini < 0) return;
      const texto = lineas.slice(ini, fin + 1).join('\n').trim();
      const sirve = prio === 0 ? RE_MULTA_ATRASO.test(texto) && RE_MULTA_NUM.test(texto) : RE_PLAZO_NUM.test(texto);
      if (sirve) out.push({ doc: d.nombre, texto, prio });
      ini = -1; prio = 9;
    };
    for (const m of marcas) {
      const a = Math.max(0, m.i - ANTES), b = Math.min(lineas.length - 1, m.i + DESPUES);
      if (ini >= 0 && a <= fin + 1) { fin = Math.max(fin, b); prio = Math.min(prio, m.prio); }
      else { volcar(); ini = a; fin = b; prio = m.prio; }
    }
    volcar();
  }
  out.sort((a, b) => a.prio - b.prio);
  const res: Pasaje[] = [];
  let usado = 0;
  for (const p of out) {
    if (usado + p.texto.length > MAX_CHARS) {
      const resto = MAX_CHARS - usado;
      if (resto > 1_500) res.push({ doc: p.doc, texto: p.texto.slice(0, resto) });
      break;
    }
    res.push({ doc: p.doc, texto: p.texto }); usado += p.texto.length;
  }
  return res;
}

export const SYSTEM_LECTURA_DIRIGIDA = `Eres un lector de bases de licitación chilenas (Mercado Público). Recibes SOLO pasajes de las bases, cada uno con su documento. Extrae dos cosas y responde SOLO con JSON.

1) MULTA POR ATRASO EN LA ENTREGA ("multa_atraso"). Si en los pasajes hay una multa por atraso/incumplimiento del plazo de entrega con un valor (porcentaje, UF, UTM o pesos), existe=true: no digas que no existe si hay una tabla o escala de multas. Las tablas pueden venir partidas por saltos de página o con las columnas en líneas separadas: léelas completas. Si hay escala por tramos (0,3 % / 0,5 % / 0,8 % diario), en "valor" pon el primer tramo y el rango, tal cual ("0,3% diario del día 1 al 5; 0,5% del 6 al 11; 0,8% del 12 al 30"). Solo la multa por atraso en la entrega (no la de servicio técnico ni otras).
   { "existe":true|false, "valor":"", "unidad":"PORCENTAJE|UF|UTM|PESOS", "base_calculo":"", "periodo":"DIA_HABIL|DIA_CORRIDO", "tope":{"valor":"","unidad":""}, "al_superar_tope":"", "cita":{"documento":"","numeral":"","frase":""} }

2) HITOS DEL PLAZO PREVIO ("hitos"): el tiempo administrativo DESPUÉS de la adjudicación y ANTES de que empiece el plazo de entrega. Exactamente estos cinco, en este orden:
   GARANTIA_FIEL_CUMPLIMIENTO · FIRMA_CONTRATO_PROVEEDOR · FIRMA_CONTRATO_ORGANISMO · EMISION_OC · ACEPTACION_OC
   Cada uno: { "hito":"", "estado":"EXISTE|NO_EXISTE|NO_INDICADO", "plazo":<número o null>, "unidad_original":"horas|días hábiles|días corridos|días", "desde":"evento desde el que corre", "simultaneo_con":"", "cita":{"documento":"","numeral":"","frase":""} }
   REGLAS:
   - "plazo" y "unidad_original" TAL CUAL las bases ("15 días hábiles" → plazo 15, "días hábiles"; "48 horas" → 48, "horas"). Si la frase trae un plazo, el estado es EXISTE: nunca NO_INDICADO con una frase que dice el plazo.
   - GARANTIA_FIEL_CUMPLIMIENTO es el plazo para ENTREGAR/ACOMPAÑAR la garantía. La VIGENCIA de la garantía ("vigencia 90 días adicionales a la garantía técnica", "vigente hasta 60 días después de…") NO es un plazo previo: ignórala. Si las bases dicen que la garantía se entrega para suscribir el contrato o dentro del mismo plazo de la firma del contrato, pon "simultaneo_con":"FIRMA_CONTRATO_PROVEEDOR" y deja el plazo de la firma en el hito del contrato (no repitas el plazo en la garantía: plazo null).
   - FIRMA_CONTRATO_PROVEEDOR: plazo para que el proveedor firme el contrato desde la notificación de la adjudicación.
   - FIRMA_CONTRATO_ORGANISMO: tiempo que toma al organismo firmar/tramitar su parte, solo si las bases lo fijan.
   - EMISION_OC: plazo en que el organismo emite la orden de compra, solo si lo fijan.
   - ACEPTACION_OC: plazo que tiene el proveedor para ACEPTAR la orden de compra ("aceptada dentro de 48 horas").
   - NO_EXISTE solo si las bases lo descartan expresamente ("no se exigirá garantía"). Si el pasaje no dice nada de ese hito: NO_INDICADO, plazo null, cita con frase vacía.
   - "frase" es copia TEXTUAL de 5 a 30 palabras de los pasajes, sin corregir ni resumir. Sin frase textual el dato no sirve. No inventes.

Responde: { "multa_atraso": {...}, "hitos": [ {...}, {...}, {...}, {...}, {...} ] }`;

export function promptUsuarioLecturaDirigida(pasajes: Pasaje[]): string {
  return pasajes.map(p => `### DOCUMENTO: ${p.doc}\n${p.texto}`).join('\n\n')
    + '\n\nPregunta: entrega la multa por atraso y los cinco hitos del plazo previo según las reglas.';
}

// ─── Reparación determinista (sin IA) ─────────────────────────────────────────────────────────
const NUM_PALABRA: Record<string, number> = { cinco: 5, diez: 10, quince: 15, veinte: 20, treinta: 30 };

/** Plazo escrito en una frase ("15 días hábiles", "quince (15) días hábiles", "48 horas"). */
export function plazoEnFrase(frase: string): { plazo: number; unidad: string } | null {
  const f = String(frase || '').replace(/\s+/g, ' ');
  const m = f.match(/(\d+)\s*(?:\(\s*\d+\s*\)\s*)?(d[ií]as?\s+h[aá]biles(?:\s+administrativos)?|d[ií]as?\s+corridos|d[ií]as?\s+calendario|d[ií]as?|horas?|hrs?)\b/i)
    || f.match(/\b(cinco|diez|quince|veinte|treinta)\s*(?:\(\s*\d+\s*\)\s*)?(d[ií]as?\s+h[aá]biles(?:\s+administrativos)?|d[ií]as?\s+corridos|d[ií]as?|horas?)\b/i);
  if (!m) return null;
  const plazo = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_PALABRA[m[1].toLowerCase()];
  if (!plazo) return null;
  const u = m[2].toLowerCase();
  const unidad = /h[aá]bil/.test(u) ? 'días hábiles' : /corrid|calendario/.test(u) ? 'días corridos' : /hora|hrs?/.test(u) ? 'horas' : 'días';
  return { plazo, unidad };
}

const EXIGE_ENTREGA: Record<string, RegExp> = {
  FIRMA_CONTRATO_PROVEEDOR: RE_CONTRATO,
  ACEPTACION_OC: /acept/i,
};

export interface ResultadoLectura {
  reparados: string[];       // qué se corrigió (para el log y el informe)
  avisos: string[];
}

type Localizar = (cita: any) => any;

/** Aplica la salida de la pasada dirigida (o, sin ella, la reparación por frase) sobre el informe. */
export function aplicarLecturaDirigida(
  p3: any,
  hitos: any[],
  salida: any | null,
  localizar: Localizar,
): ResultadoLectura {
  const reparados: string[] = [];
  const avisos: string[] = [];

  // ── multa ──
  const mul = p3.multas && typeof p3.multas === 'object' ? p3.multas : (p3.multas = {});
  const atraso = mul.atraso && typeof mul.atraso === 'object' ? mul.atraso : (mul.atraso = {});
  const nueva = salida?.multa_atraso;
  const multaVacia = atraso.existe !== true || !String(atraso.valor || '').trim();
  const numeros = (x: unknown) => (String(x ?? '').replace(',', '.').match(/\d+(?:\.\d+)?/g) || []).join('|');
  if (nueva && nueva.existe === true && String(nueva.valor || '').trim()) {
    // La lectura dirigida ve ~16.000 caracteres en vez de ~300.000: cuando difiere de la primera, manda
    // ella (si su frase existe literal). El valor de la primera pasada queda guardado.
    const difiere = !multaVacia && numeros(nueva.valor) !== '' && numeros(atraso.valor) !== numeros(nueva.valor)
      && !numeros(nueva.valor).startsWith(numeros(atraso.valor)) && !numeros(atraso.valor).startsWith(numeros(nueva.valor));
    if (multaVacia || difiere) {
      const cita = localizar({ ...(nueva.cita || {}) });
      if (cita?.verificada) {
        mul.atraso = { ...nueva, existe: true, cita, corregido_por_lectura_dirigida: multaVacia ? (atraso.existe === false ? 'decia que no existe' : 'sin valor') : `valor distinto en la primera pasada: ${atraso.valor}` };
        reparados.push(`multa por atraso: ${nueva.valor}${multaVacia ? '' : ` (antes ${atraso.valor})`}`);
      } else avisos.push('La pasada dirigida vio una multa pero su frase no está literal en las bases: no se usó.');
    }
  }

  // ── hitos ──
  const nuevos: any[] = Array.isArray(salida?.hitos) ? salida.hitos : [];
  for (const clave of HITOS_ORDEN as readonly HitoClave[]) {
    const h = hitos.find(x => String(x.hito).toUpperCase() === clave);
    if (!h) continue;
    const estado = String(h.estado || 'NO_INDICADO').toUpperCase();
    if (estado === 'NO_EXISTE') continue;               // lo descartó una negación expresa
    const frase0 = String(h.cita?.frase || '');
    const sinPlazo = numeroPlazo(h.plazo) == null || interpretarUnidad(h.unidad_original) === 'DESCONOCIDA';
    // Vigencia de la garantía tomada como trámite previo (ej. "vigencia 90 días adicionales…").
    const esVigencia = clave === 'GARANTIA_FIEL_CUMPLIMIENTO' && /vigencia|vigente/i.test(frase0) && !/entreg|present|acompa|dentro de/i.test(frase0);
    const n = nuevos.find(x => String(x?.hito).toUpperCase() === clave);

    let aplicado = false;
    const simultN = n && HITOS_ORDEN.includes(String(n.simultaneo_con).toUpperCase() as HitoClave) && String(n.simultaneo_con).toUpperCase() !== clave ? String(n.simultaneo_con).toUpperCase() : '';
    const nEstadoRaw = n ? (simultN ? 'EXISTE' : String(n.estado).toUpperCase()) : 'NO_INDICADO'; // "junto con X" es un trámite que existe aunque el modelo lo marque no indicado
    const difierePlazo = !!n && nEstadoRaw === 'EXISTE' && !simultN && !sinPlazo
      && (numeroPlazo(n.plazo) !== numeroPlazo(h.plazo) || interpretarUnidad(n.unidad_original) !== interpretarUnidad(h.unidad_original));
    if (n && nEstadoRaw !== 'NO_INDICADO' && (sinPlazo || estado !== 'EXISTE' || esVigencia || simultN || difierePlazo)) {
      const nEstado = nEstadoRaw;
      const nPlazo = numeroPlazo(n.plazo);
      const nUnidad = interpretarUnidad(n.unidad_original);
      const simult = simultN;
      const cita = String(n.cita?.frase || '').trim() ? localizar({ ...(n.cita || {}) }) : null;
      const citaOk = !!cita?.verificada;
      if (nEstado === 'EXISTE' && citaOk && ((nPlazo != null && nUnidad !== 'DESCONOCIDA') || simult)) {
        const antes = esVigencia ? 'tomaba la vigencia de la garantía' : difierePlazo ? `decía ${h.plazo} ${h.unidad_original}` : estado;
        Object.assign(h, { estado: 'EXISTE', plazo: simult ? null : nPlazo, unidad_original: simult ? '' : n.unidad_original, desde: n.desde || h.desde, cita,
          ...(simult ? { simultaneo_con: simult } : {}), corregido_por_lectura_dirigida: antes });
        reparados.push(`${clave}: ${simult ? `junto con ${simult}` : `${nPlazo} ${n.unidad_original}`}`);
        aplicado = true;
      }
    }
    // Respaldo sin IA: la propia frase citada trae el plazo y el primer análisis lo dejó vacío.
    if (!aplicado && estado !== 'EXISTE' && EXIGE_ENTREGA[clave] && h.cita?.verificada !== false && EXIGE_ENTREGA[clave].test(frase0)) {
      const p = plazoEnFrase(frase0);
      if (p) {
        Object.assign(h, { estado: 'EXISTE', plazo: p.plazo, unidad_original: p.unidad, corregido_por_lectura_dirigida: 'plazo leído de la frase citada' });
        reparados.push(`${clave}: ${p.plazo} ${p.unidad} (de la frase citada)`);
      }
    }
  }
  return { reparados, avisos };
}

/** ¿Vale la pena la segunda pasada? Solo si la primera dejó algo vacío o dudoso. */
export function necesitaLecturaDirigida(p3: any, hitos: any[]): string[] {
  const motivos: string[] = [];
  const a = p3?.multas?.atraso;
  if (!a || a.existe !== true || !String(a.valor || '').trim()) motivos.push('multa por atraso sin valor');
  for (const h of hitos) {
    const estado = String(h.estado || 'NO_INDICADO').toUpperCase();
    if (estado === 'NO_EXISTE') continue;
    const frase = String(h.cita?.frase || '');
    if (estado === 'EXISTE' && (numeroPlazo(h.plazo) == null || interpretarUnidad(h.unidad_original) === 'DESCONOCIDA') && !h.simultaneo_con) motivos.push(`${h.hito} existe sin plazo`);
    else if (estado === 'NO_INDICADO' && frase && plazoEnFrase(frase)) motivos.push(`${h.hito} con plazo en su frase pero "no indicado"`);
    else if (h.hito === 'GARANTIA_FIEL_CUMPLIMIENTO' && /vigencia|vigente/i.test(frase) && !/entreg|present|acompa/i.test(frase)) motivos.push('garantía: parece vigencia, no plazo de entrega');
    else if (estado === 'NO_INDICADO') motivos.push(`${h.hito} no indicado`);
  }
  return motivos;
}
