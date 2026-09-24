// app/lib/auditor-comparador-core.ts
// PARTE PURA del COMPARADOR DE FICHAS (PROMPT 4 v1.0) — sin IA, sin DB, importable desde Client
// Components. Aquí viven las reglas que el prompt pide y que NO se dejan a la palabra del modelo:
//
//   · lo que la IA devuelve se pasa por `procesarItemComparador` antes de guardarse — un CUMPLE sin
//     cita de los dos lados, sin dato real o apoyado en una declaración sin respaldo se baja a
//     "sin veredicto"; CUALITATIVO nunca se compara; una equivalencia normativa nunca se cierra
//     sola; un emparejamiento no literal queda esperando confirmación humana; CUMPLE CON
//     COMPLEMENTO solo existe en los dos casos que el prompt permite.
//   · SOBRECUMPLE, la alerta de sobredimensionamiento, el certificado de admisibilidad, los
//     bloqueos y el mensaje al proveedor se CALCULAN por código a partir de las filas (decisión del
//     prompt, nota 0.3: el veredicto global lo calcula el sistema, no la aritmética del modelo).
import {
  endurecerVeredicto, combinarConCalculo, numeroApareceEnTexto, resumenLinea,
  type TipoRequisitoTecnico, type VeredictoTecnico, type VeredictoCaracteristica, type ResumenLinea,
} from '@/app/lib/auditor-tecnico-core';

// ─── Vocabulario del prompt ─────────────────────────────────────────────────────────────────────
export type TipoRequisitoP4 = TipoRequisitoTecnico;   // PISO | TECHO | EXACTO | RANGO | CUALITATIVO | NORMATIVO
export type CriticidadP4 = 'INADMISIBLE' | 'PUNTAJE' | 'COMPROMISO' | 'SIN_CLASIFICAR';
export type OrigenDato = 'FICHA' | 'CONFIRMACION_INFORMAL' | 'DECLARADO' | 'CONTRADICE_FICHA' | 'HEREDADO' | 'NO_LEGIBLE';
export type Habilitacion = 'no' | 'EM' | 'CA';
export type AmbitoRequisito = 'tecnico' | 'administrativo';

export const ORIGENES: OrigenDato[] = ['FICHA', 'CONFIRMACION_INFORMAL', 'DECLARADO', 'CONTRADICE_FICHA', 'HEREDADO', 'NO_LEGIBLE'];
const TIPOS_NUMERICOS: TipoRequisitoP4[] = ['PISO', 'TECHO', 'EXACTO', 'RANGO'];
export const esTipoNumerico = (t: string) => (TIPOS_NUMERICOS as string[]).includes(t);

/** La criticidad de la línea del checklist (ADMISIBILIDAD_DURA / PUNTAJE_CONDICIONANTE / INFORMATIVO)
 *  hacia el vocabulario del prompt. "Si un requisito llega SIN criticidad NO lo marques COMPROMISO
 *  por defecto": cualquier otro valor queda SIN_CLASIFICAR, que bloquea. */
export function criticidadP4(criticidadLinea: string | null | undefined): CriticidadP4 {
  switch (String(criticidadLinea || '').toUpperCase()) {
    case 'ADMISIBILIDAD_DURA': case 'INADMISIBLE': return 'INADMISIBLE';
    case 'PUNTAJE_CONDICIONANTE': case 'PUNTAJE': return 'PUNTAJE';
    case 'INFORMATIVO': case 'COMPROMISO': return 'COMPROMISO';
    default: return 'SIN_CLASIFICAR';
  }
}

// ─── Lo que se guarda por característica (columna analisis_json) ────────────────────────────────
export interface AyudaItem {
  diagnostico: string;
  hipotesis_causa: string[];
  pregunta_proveedor: string;
  veredicto_equivalencia: string;
  ruta: 'SALVABLE' | 'INSALVABLE' | null;
  accion_concreta: string;
}

/** Algo que la IA propone y SOLO un humano cierra: emparejamiento de conceptos con otro nombre, o
 *  equivalencia entre normas. `confirmado`: null = pendiente, true = aceptada, false = rechazada. */
export interface Propuesta {
  tipo: 'emparejamiento' | 'equivalencia_normativa';
  parametro_bases: string;
  parametro_ficha: string;
  razon: string;
  /** Organismo/documento/URL que respalda una equivalencia normativa. Sin esto no se propone. */
  fuente_equivalencia?: string;
  veredicto_propuesto: 'CUMPLE' | 'NO_CUMPLE' | 'CUMPLE_CON_COMPLEMENTO' | null;
  confirmado: boolean | null;
}

export interface ComplementoP4 { tipo: 'declarativo' | 'accesorio'; descripcion: string; cotizado: boolean; respaldo: string }
export interface ConflictoFuentes { existe: boolean; versiones: Array<{ documento: string; valor: string; cita: string }> }

export interface AnalisisCaracteristica {
  ambito?: AmbitoRequisito;
  materia?: string;
  fuente_bases?: string;
  fuente_ficha?: string;
  puntaje_en_riesgo?: string;
  origen_dato?: OrigenDato;
  respaldo_adjunto?: string;
  requiere_habilitacion?: Habilitacion;
  habilitado?: { por: string; at: string };
  factor_conversion?: string;
  emparejamiento_literal?: boolean;
  propuesta?: Propuesta;
  sobrecumple?: boolean;
  sobrecumple_detalle?: string;
  complemento?: ComplementoP4;
  ayuda?: AyudaItem;
  conflicto_fuentes?: ConflictoFuentes;
  reverificado?: boolean;
  rectificacion?: string;
  /** Lo que el sistema corrigió sobre lo que dijo la IA (guardarraíles) — para que se vea. */
  notas_sistema?: string[];
  /** Compromisos técnico-administrativos: qué exige la base y qué nos comprometemos (= lo exigido). */
  admin?: { se_compromete: string; check_confirmado: boolean };
}

export function parseAnalisis(raw: unknown): AnalisisCaracteristica {
  if (!raw) return {};
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return o && typeof o === 'object' ? (o as AnalisisCaracteristica) : {};
  } catch { return {}; }
}

// ─── Parte VIII: ¿es técnico o técnico-administrativo? ──────────────────────────────────────────
// Regla de corte del prompt: si para responder hay que mirar la FICHA → técnico; si hay que mirar
// lo que NOSOTROS nos comprometemos a hacer → técnico-administrativo. Red de seguridad por texto
// para filas anteriores al comparador (no traen `ambito`) y por si el clasificador no lo devolvió.
const MATERIAS_ADMIN: Array<[string, RegExp]> = [
  ['capacitacion', /capacitaci|entrenamiento del personal|induccion/],
  ['despacho', /despacho|flete|transporte hasta|entrega en (?:las )?dependencias|puesta en (?:el )?lugar/],
  ['plazo', /plazo de entrega|plazo de despacho|dias (?:corridos|habiles) (?:de|para) (?:la )?entrega/],
  ['instalacion', /instalaci|puesta en marcha|puesta en servicio|montaje en sitio/],
  ['postventa', /post ?venta|servicio tecnico|soporte tecnico|asistencia tecnica/],
  ['garantia', /garanti/],
  ['mantencion', /mantenci|mantenimiento (?:preventivo|correctivo)/],
  ['repuestos', /repuestos?/],
  ['documentacion', /manual(?:es)? (?:de|en|del)|documentaci[oó]n de entrega|instructivo/],
];

const sinTildes = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function materiaAdministrativa(texto: string): string | null {
  const t = sinTildes(texto);
  for (const [materia, re] of MATERIAS_ADMIN) if (re.test(t)) return materia;
  return null;
}

/** Ámbito de una fila: lo que quedó guardado manda; si no, el texto (una "garantía de 24 meses" es
 *  administrativa; una "certificación del equipo" NO — es atributo del equipo, va técnico normativo). */
export function ambitoDe(fila: { descripcion: string; valor_requerido_texto?: string | null; tipo?: string }, analisis: AnalisisCaracteristica): AmbitoRequisito {
  if (analisis.ambito) return analisis.ambito;
  if (fila.tipo === 'NORMATIVO') return 'tecnico';
  return materiaAdministrativa(`${fila.descripcion} ${fila.valor_requerido_texto || ''}`) ? 'administrativo' : 'tecnico';
}

// ─── Fila de característica tal como la lee la ruta ─────────────────────────────────────────────
export interface FilaComparador {
  id: number;
  producto_index?: number;
  descripcion: string;
  tipo: string;
  valor_requerido_texto: string | null;
  valor_requerido_numero: number | null;
  valor_requerido_numero_max: number | null;
  unidad_requerida: string | null;
  valor_ofertado_texto?: string | null;
  valor_ofertado_numero?: number | null;
  unidad_ofertada_original?: string | null;
  valor_convertido_numero?: number | null;
  veredicto: string | null;
  pendiente_confirmacion_proveedor?: boolean;
  fundamento_documento?: string | null;
  fundamento_cita?: string | null;
  origen?: string;
  respuesta_manual?: boolean;
  corregido_at?: string | null;
  adjunto_url?: string | null;
  analisis: AnalisisCaracteristica;
  /** Criticidad heredada de la línea, ya en vocabulario del prompt. */
  criticidad: CriticidadP4;
}

// ─── Lo que devuelve la IA por ítem (PARTE X, items[]) ──────────────────────────────────────────
export interface ItemCrudoIA {
  n?: number | string;
  veredicto?: string | null;
  ofertado_valor?: string | number | null;
  ofertado_unidad_original?: string | null;
  factor_conversion?: string | null;
  fuente_bases?: string | null;
  fuente_ficha?: string | null;
  origen_dato?: string | null;
  respaldo_adjunto?: string | null;
  puntaje_en_riesgo?: string | null;
  emparejamiento_literal?: boolean | null;
  emparejamiento_propuesto?: { parametro_bases?: string; parametro_ficha?: string; razon?: string; fuente_equivalencia?: string } | null;
  complemento?: Partial<ComplementoP4> | null;
  ayuda?: Partial<AyudaItem> | null;
  conflicto_fuentes?: { existe?: boolean; versiones?: Array<{ documento?: string; valor?: string; cita?: string }> } | null;
}

export interface ResultadoItem {
  columnas: {
    valor_ofertado_texto: string | null;
    valor_ofertado_numero: number | null;
    unidad_ofertada_original: string | null;
    valor_convertido_numero: number | null;
    veredicto: VeredictoTecnico | null;
    pendiente: boolean;
    fundamento_documento: string | null;
    fundamento_cita: string | null;
  };
  analisis: AnalisisCaracteristica;
}

const str = (v: unknown, max = 500): string => (v == null ? '' : String(v)).trim().slice(0, max);
const veredictoDe = (v: unknown): VeredictoTecnico | null => {
  const s = String(v || '').toUpperCase().replace(/\s+/g, '_');
  return s === 'CUMPLE' || s === 'NO_CUMPLE' || s === 'CUMPLE_CON_COMPLEMENTO' ? s : null;
};

/** "1,5" / "1.5" / "1.700" → número. Solo si el texto ES un número (con unidad opcional suelta). */
function numeroDeTexto(txt: string): number | null {
  const m = txt.trim().match(/^[-+]?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Normas: "ISO 9001:2015" → "iso90012015"; la exigida "ISO 9001" está contenida en la declarada.
const RE_NORMA = /\b([A-Za-z]{2,6})[\s.\-/]*(\d[\d.\-:/]*)/g;
export function normasDe(texto: string): string[] {
  const out: string[] = [];
  for (const m of String(texto || '').matchAll(RE_NORMA)) {
    const clave = `${m[1]}${m[2]}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clave.length >= 4) out.push(clave);
  }
  return out;
}
const planoNorma = (s: string) => sinTildes(s).replace(/[^a-z0-9]/g, '');

function ayudaNormalizada(a: Partial<AyudaItem> | null | undefined): AyudaItem | undefined {
  if (!a) return undefined;
  const ruta = String(a.ruta || '').toUpperCase();
  return {
    diagnostico: str(a.diagnostico, 600),
    hipotesis_causa: (Array.isArray(a.hipotesis_causa) ? a.hipotesis_causa : []).map(h => str(h, 300)).filter(Boolean).slice(0, 4),
    pregunta_proveedor: str(a.pregunta_proveedor, 700),
    veredicto_equivalencia: str(a.veredicto_equivalencia, 600),
    ruta: ruta === 'SALVABLE' || ruta === 'INSALVABLE' ? ruta : null,
    accion_concreta: str(a.accion_concreta, 400),
  };
}

/** Los campos de ayuda que faltan — "ninguno es opcional". */
export function ayudaFaltante(a: AyudaItem | undefined): string[] {
  if (!a) return ['diagnóstico', 'hipótesis de causa', 'pregunta al proveedor', 'veredicto de equivalencia', 'ruta'];
  const f: string[] = [];
  if (!a.diagnostico) f.push('diagnóstico');
  if (!a.hipotesis_causa.length) f.push('hipótesis de causa');
  if (!a.pregunta_proveedor) f.push('pregunta al proveedor');
  if (!a.veredicto_equivalencia) f.push('veredicto de equivalencia');
  if (!a.ruta) f.push('ruta (salvable / insalvable)');
  return f;
}

/**
 * Pasa lo que dijo la IA por las reglas del prompt. `fichaTexto` es el texto real de la(s)
 * ficha(s) contra las que se comparó: el valor que la IA dice haber leído tiene que existir ahí.
 * Solo empuja hacia "no sé" (SIN VEREDICTO); nunca inventa un veredicto.
 */
export function procesarItemComparador(fila: FilaComparador, crudo: ItemCrudoIA, fichaTexto: string): ResultadoItem {
  const notas: string[] = [];
  const tipo = fila.tipo as TipoRequisitoP4;
  const numerico = esTipoNumerico(tipo);

  const origenIA = String(crudo.origen_dato || '').toUpperCase() as OrigenDato;
  const origen: OrigenDato = ORIGENES.includes(origenIA) ? origenIA : 'FICHA';
  const respaldo = str(crudo.respaldo_adjunto, 300);
  const ofertadoTexto = str(crudo.ofertado_valor, 900) || null;
  const unidadOfertada = str(crudo.ofertado_unidad_original, 40) || null;
  const ofertadoNumero = numerico && ofertadoTexto ? numeroDeTexto(ofertadoTexto) : null;

  let veredicto = veredictoDe(crudo.veredicto);
  let convertido: number | null = null;
  let propuesta: Propuesta | undefined;

  // ── Numéricos: el valor tiene que estar en la ficha; la comparación la decide el número ─────────
  if (numerico) {
    const cruda: VeredictoCaracteristica = {
      valorOfertadoTexto: ofertadoTexto, valorOfertadoNumero: ofertadoNumero, unidadOfertadaOriginal: unidadOfertada,
      valorConvertidoNumero: null, veredicto, pendienteConfirmacionProveedor: !veredicto,
      fundamentoDocumento: null, fundamentoCita: str(crudo.fuente_ficha, 500) || null, confianza: 0,
    };
    const dura = endurecerVeredicto({
      descripcion: fila.descripcion, tipo: tipo as TipoRequisitoTecnico,
      valorRequeridoTexto: fila.valor_requerido_texto, unidadRequerida: fila.unidad_requerida,
    }, cruda, fichaTexto);
    if (dura.veredicto !== veredicto && veredicto) notas.push(dura.fundamentoCita?.startsWith('⚠') ? dura.fundamentoCita.slice(0, 220) : 'El valor no se pudo verificar contra el texto de la ficha.');
    const comb = combinarConCalculo({
      tipo: tipo as TipoRequisitoTecnico, valorRequeridoNumero: fila.valor_requerido_numero,
      valorRequeridoNumeroMax: fila.valor_requerido_numero_max, unidadRequerida: fila.unidad_requerida,
    }, { veredicto: dura.veredicto, valorOfertadoNumero: dura.valorOfertadoNumero, unidadOfertadaOriginal: unidadOfertada });
    if (comb.nota) notas.push(comb.nota);
    if (comb.veredicto !== dura.veredicto && dura.veredicto) notas.push(`La comparación numérica (${comb.veredicto ?? 'sin resultado'}) prevaleció sobre lo que dijo la IA (${dura.veredicto}).`);
    veredicto = comb.veredicto;
    convertido = comb.valorConvertidoNumero;
  }

  // ── CUALITATIVO: no se compara, se DECLARA ───────────────────────────────────────────────────────
  if (tipo === 'CUALITATIVO' && veredicto) {
    notas.push('Requisito CUALITATIVO: no se da por cumplido por "sonar razonable". Va a declaración humana con respaldo.');
    veredicto = null;
  }

  // ── NORMATIVO: igual = CUMPLE; distinta = se PROPONE la equivalencia, nunca se cierra ──────────
  if (tipo === 'NORMATIVO') {
    const exigidas = normasDe(`${fila.valor_requerido_texto || ''} ${fila.descripcion}`);
    const declaradaPlano = planoNorma(ofertadoTexto || '');
    const fichaPlano = planoNorma(fichaTexto);
    const literal = !!ofertadoTexto && exigidas.length > 0 && exigidas.every(n => declaradaPlano.includes(n) && fichaPlano.includes(n));
    if (!ofertadoTexto) {
      if (veredicto) notas.push('Norma exigida sin ninguna norma declarada en la ficha: sin veredicto.');
      veredicto = null;
    } else if (literal) {
      veredicto = veredicto === 'NO_CUMPLE' ? null : 'CUMPLE';
      if (veredicto === null) notas.push('La IA dijo NO CUMPLE pero la norma exigida figura literalmente en la ficha: se pide revisión.');
    } else if (veredicto) {
      const p = crudo.emparejamiento_propuesto;
      const fuente = str(p?.fuente_equivalencia, 400);
      if (fuente) {
        propuesta = {
          tipo: 'equivalencia_normativa', parametro_bases: str(p?.parametro_bases || fila.valor_requerido_texto || fila.descripcion, 300),
          parametro_ficha: str(p?.parametro_ficha || ofertadoTexto, 300), razon: str(p?.razon, 500),
          fuente_equivalencia: fuente, veredicto_propuesto: veredicto === 'NO_CUMPLE' ? 'NO_CUMPLE' : 'CUMPLE', confirmado: null,
        };
        notas.push('Norma distinta a la exigida: equivalencia PROPUESTA con fuente; la confirma una persona.');
      } else {
        notas.push('Norma distinta a la exigida y sin fuente verificable de equivalencia: no se propone; queda sin veredicto.');
      }
      veredicto = null;
    }
  }

  // ── Emparejamiento de conceptos no literal: nunca escondido dentro de un CUMPLE ────────────────
  if (!propuesta && crudo.emparejamiento_literal === false && veredicto) {
    const p = crudo.emparejamiento_propuesto;
    propuesta = {
      tipo: 'emparejamiento', parametro_bases: str(p?.parametro_bases || fila.descripcion, 300),
      parametro_ficha: str(p?.parametro_ficha, 300), razon: str(p?.razon, 500),
      veredicto_propuesto: veredicto, confirmado: null,
    };
    if (!propuesta.parametro_ficha) notas.push('La IA no declaró qué parámetro de la ficha interpretó como equivalente: hay que indicarlo al confirmar.');
    veredicto = null;
  }

  // ── Origen del dato y respaldo ──────────────────────────────────────────────────────────────────
  if (veredicto && (origen === 'DECLARADO' || origen === 'CONTRADICE_FICHA') && !respaldo) {
    notas.push(`Dato ${origen} sin respaldo adjunto: el asistente nunca declara sin respaldo. Sin veredicto.`);
    veredicto = null;
  }
  if (veredicto && origen === 'NO_LEGIBLE') {
    notas.push('El dato no se pudo leer: no puede sostener un veredicto.');
    veredicto = null;
  }

  // ── CUMPLE CON COMPLEMENTO: solo (a) compromiso declarativo o (b) accesorio cotizado/respaldado ─
  let complemento: ComplementoP4 | undefined;
  if (crudo.complemento && (crudo.complemento.tipo === 'declarativo' || crudo.complemento.tipo === 'accesorio')) {
    complemento = {
      tipo: crudo.complemento.tipo, descripcion: str(crudo.complemento.descripcion, 300),
      cotizado: !!crudo.complemento.cotizado, respaldo: str(crudo.complemento.respaldo, 300),
    };
  }
  if (veredicto === 'CUMPLE_CON_COMPLEMENTO') {
    const declarativoOk = complemento?.tipo === 'declarativo' && !numerico;
    const accesorioOk = complemento?.tipo === 'accesorio' && (complemento.cotizado || !!complemento.respaldo);
    if (!declarativoOk && !accesorioOk) {
      notas.push(complemento?.tipo === 'accesorio'
        ? 'Complemento sin cotización ni respaldo: no existe. Sin veredicto.'
        : 'CUMPLE CON COMPLEMENTO no procede para una característica física del equipo (un papel no cambia la ficha). Sin veredicto.');
      veredicto = null;
    }
  }

  // ── Conflicto entre fichas: no se elige, se levanta ─────────────────────────────────────────────
  let conflicto: ConflictoFuentes | undefined;
  const cf = crudo.conflicto_fuentes;
  if (cf?.existe && Array.isArray(cf.versiones) && cf.versiones.length >= 2) {
    conflicto = { existe: true, versiones: cf.versiones.map(v => ({ documento: str(v?.documento, 200), valor: str(v?.valor, 200), cita: str(v?.cita, 300) })) };
    if (veredicto) notas.push('Dos fichas dicen cosas distintas de esta característica: no se elige, se levanta el conflicto.');
    veredicto = null;
  }

  // ── Cita en los DOS lados ───────────────────────────────────────────────────────────────────────
  const fuenteBases = str(crudo.fuente_bases, 300) || fila.analisis.fuente_bases || '';
  const fuenteFicha = str(crudo.fuente_ficha, 400);
  if (veredicto && (!fuenteBases || (!fuenteFicha && !(origen === 'DECLARADO' && respaldo)))) {
    notas.push('Sin cita de los dos lados (bases y ficha) el ítem no está auditado. Sin veredicto.');
    veredicto = null;
  }

  // ── SOBRECUMPLE: solo medible, solo con dato real de la ficha, calculado por código ────────────
  let sobrecumple = false; let sobrecumpleDetalle = '';
  const req = fila.valor_requerido_numero;
  const ofer = convertido ?? ofertadoNumero;
  if (veredicto === 'CUMPLE' && origen === 'FICHA' && req != null && ofer != null && (tipo === 'PISO' || tipo === 'TECHO')) {
    const supera = tipo === 'PISO' ? ofer > req + 1e-9 : ofer < req - 1e-9;
    if (supera) {
      const u = fila.unidad_requerida ? ` ${fila.unidad_requerida}` : '';
      const dif = Math.round(Math.abs(ofer - req) * 10000) / 10000;
      sobrecumple = true;
      sobrecumpleDetalle = `exigido ${req}${u}, ofertado ${Math.round(ofer * 10000) / 10000}${u}, diferencia ${dif}${u}`;
    }
  }

  // ── Ayuda: cinco campos por cada ítem que no quedó cerrado como CUMPLE ─────────────────────────
  let ayuda = ayudaNormalizada(crudo.ayuda);
  const noCerrado = veredicto !== 'CUMPLE';
  if (noCerrado) {
    if (!ayuda?.diagnostico && notas.length) ayuda = { ...(ayuda || ayudaNormalizada({})!), diagnostico: notas[0].slice(0, 600) };
    const falta = ayudaFaltante(ayuda);
    if (falta.length) notas.push(`Ayuda incompleta (falta: ${falta.join(', ')}). Volver a comparar o completarla a mano.`);
  }

  const noLeido = origen === 'NO_LEGIBLE';
  const analisis: AnalisisCaracteristica = {
    ...fila.analisis,
    fuente_bases: fuenteBases || undefined,
    fuente_ficha: fuenteFicha || undefined,
    puntaje_en_riesgo: fila.criticidad === 'PUNTAJE' ? (str(crudo.puntaje_en_riesgo, 200) || undefined) : undefined,
    origen_dato: origen,
    respaldo_adjunto: respaldo || undefined,
    requiere_habilitacion: origen === 'CONFIRMACION_INFORMAL' || origen === 'DECLARADO' || origen === 'CONTRADICE_FICHA' ? 'EM' : 'no',
    habilitado: undefined,
    factor_conversion: str(crudo.factor_conversion, 120) || undefined,
    emparejamiento_literal: crudo.emparejamiento_literal !== false,
    propuesta, sobrecumple, sobrecumple_detalle: sobrecumpleDetalle || undefined,
    complemento, ayuda: noCerrado ? ayuda : undefined, conflicto_fuentes: conflicto,
    reverificado: false, rectificacion: undefined,
    notas_sistema: notas.length ? notas : undefined,
  };

  return {
    columnas: {
      valor_ofertado_texto: ofertadoTexto,
      valor_ofertado_numero: ofertadoNumero,
      unidad_ofertada_original: unidadOfertada,
      valor_convertido_numero: convertido,
      veredicto,
      pendiente: veredicto == null || noLeido,
      fundamento_documento: fuenteFicha ? fuenteFicha.slice(0, 300) : null,
      fundamento_cita: (fuenteFicha || notas[0] || null)?.slice(0, 500) ?? null,
    },
    analisis,
  };
}

// ─── Reverificación de rojos (PARTE IX) ─────────────────────────────────────────────────────────
export interface ReverificacionCruda {
  n?: number | string;
  confirmado?: boolean | null;
  valor_releido?: string | number | null;
  unidad_releida?: string | null;
  cita?: string | null;
  rectificacion?: string | null;
}

/**
 * Segunda pasada independiente sobre un CUMPLE de criticidad INADMISIBLE. La IA relee el valor SIN
 * ver el que había dicho antes; acá se compara: si no coincide, o si el valor releído no aparece
 * en la ficha, o si con el valor releído ya no cumple, se RECTIFICA. Devuelve null si se confirma.
 */
export function evaluarReverificacion(fila: FilaComparador, r: ReverificacionCruda, fichaTexto: string): { confirmado: boolean; motivo: string } {
  const releidoTxt = str(r.valor_releido, 300);
  if (r.confirmado === false) return { confirmado: false, motivo: str(r.rectificacion, 400) || 'En la segunda lectura el dato no aparece donde se dijo.' };
  if (!releidoTxt) return { confirmado: false, motivo: 'La segunda lectura no pudo reconfirmar el valor.' };
  if (esTipoNumerico(fila.tipo)) {
    const releido = numeroDeTexto(releidoTxt);
    if (releido == null) return { confirmado: false, motivo: `La segunda lectura no dio un valor numérico (“${releidoTxt}”).` };
    if (!numeroApareceEnTexto(fichaTexto, releido)) return { confirmado: false, motivo: `El valor releído (${releido}) no aparece en el texto de la ficha.` };
    const det = combinarConCalculo({
      tipo: fila.tipo as TipoRequisitoTecnico, valorRequeridoNumero: fila.valor_requerido_numero,
      valorRequeridoNumeroMax: fila.valor_requerido_numero_max, unidadRequerida: fila.unidad_requerida,
    }, { veredicto: 'CUMPLE', valorOfertadoNumero: releido, unidadOfertadaOriginal: str(r.unidad_releida, 40) || fila.unidad_ofertada_original || null });
    if (det.veredicto !== 'CUMPLE') return { confirmado: false, motivo: `Con el valor releído (${releido}${r.unidad_releida ? ` ${r.unidad_releida}` : ''}) ya no cumple.` };
    const previo = fila.valor_convertido_numero ?? fila.valor_ofertado_numero;
    const comparado = det.valorConvertidoNumero ?? releido;
    if (previo != null && Math.abs(previo - comparado) > Math.abs(previo) * 1e-6 + 1e-9)
      return { confirmado: false, motivo: `La primera lectura decía ${previo} y la segunda ${comparado}: no coinciden.` };
  }
  if (fila.tipo === 'NORMATIVO') {
    const exigidas = normasDe(`${fila.valor_requerido_texto || ''} ${fila.descripcion}`);
    const releida = planoNorma(releidoTxt);
    if (!exigidas.length || !exigidas.every(n => releida.includes(n) && planoNorma(fichaTexto).includes(n)))
      return { confirmado: false, motivo: `La norma releída (“${releidoTxt}”) no coincide con la exigida o no figura en la ficha.` };
  }
  return { confirmado: true, motivo: str(r.cita, 300) };
}

// ─── Estado por ítem, alerta, resumen ───────────────────────────────────────────────────────────
/** ¿La fila queda cerrada como CUMPLE de verdad? Un CUMPLE que espera habilitación, reverificación
 *  o un respaldo que falta NO cuenta como cerrado. */
export function estadoDeFila(f: FilaComparador): 'CUMPLIDA' | 'NO_CUMPLIDA' | 'PENDIENTE' {
  const a = f.analisis;
  if (ambitoDe(f, a) === 'administrativo') return a.admin?.check_confirmado || (f.respuesta_manual && f.veredicto === 'CUMPLE') ? 'CUMPLIDA' : 'PENDIENTE';
  if (f.veredicto === 'NO_CUMPLE') return 'NO_CUMPLIDA';
  if (a.propuesta && a.propuesta.confirmado == null) return 'PENDIENTE';
  if (a.conflicto_fuentes?.existe) return 'PENDIENTE';
  if (f.veredicto === 'CUMPLE_CON_COMPLEMENTO') return a.complemento && (a.complemento.cotizado || a.complemento.respaldo) ? 'CUMPLIDA' : 'PENDIENTE';
  if (f.veredicto !== 'CUMPLE' || f.pendiente_confirmacion_proveedor) return 'PENDIENTE';
  // Respuesta contestada a mano sobre un requisito técnico: sin respaldo no cierra (salvo corrección del asesor).
  if (f.respuesta_manual && !f.adjunto_url && !f.corregido_at) return 'PENDIENTE';
  if ((a.requiere_habilitacion === 'EM' || a.requiere_habilitacion === 'CA') && !a.habilitado) return 'PENDIENTE';
  if (f.criticidad === 'INADMISIBLE' && a.origen_dato && f.origen === 'ficha' && !f.respuesta_manual && !a.reverificado) return 'PENDIENTE';
  return 'CUMPLIDA';
}

export interface AlertaSobredimensionamiento { activa: boolean; sobrecumplen: number; medibles: number; mensaje: string }

/** Si el 50% o más de las características medibles sobrecumplen, puede que sea un modelo más caro. */
export function alertaSobredimensionamiento(filas: FilaComparador[]): AlertaSobredimensionamiento {
  const medibles = filas.filter(f => ambitoDe(f, f.analisis) === 'tecnico' && (f.tipo === 'PISO' || f.tipo === 'TECHO')
    && f.veredicto != null && (f.valor_convertido_numero ?? f.valor_ofertado_numero) != null);
  const sobre = medibles.filter(f => f.analisis.sobrecumple).length;
  const activa = medibles.length > 0 && sobre / medibles.length >= 0.5;
  return {
    activa, sobrecumplen: sobre, medibles: medibles.length,
    mensaje: activa ? `OJO: ${sobre} de ${medibles.length} características sobrecumplen. Puede que estemos cotizando un modelo más caro del necesario — verifica si es el modelo correcto.` : '',
  };
}

export interface ResumenComparador extends ResumenLinea { sobrecumplen: number; porConfirmar: number }

/** Veredicto global de la línea calculado por código (nota 0.3 del prompt), sobre lo técnico. */
export function resumenComparador(filas: FilaComparador[]): ResumenComparador {
  const tec = filas.filter(f => ambitoDe(f, f.analisis) === 'tecnico');
  const base = resumenLinea(tec.map(f => ({ veredicto: f.veredicto, pendiente_confirmacion_proveedor: !!f.pendiente_confirmacion_proveedor })));
  return {
    ...base,
    sobrecumplen: tec.filter(f => f.analisis.sobrecumple).length,
    porConfirmar: tec.filter(f => f.analisis.propuesta?.confirmado == null && !!f.analisis.propuesta).length,
  };
}

// ─── Certificado de admisibilidad y bloqueos (PARTE IX) ─────────────────────────────────────────
export interface CausalAdmisibilidad {
  caracteristica_id: number; causal: string; fuente: string;
  estado: 'CUMPLIDA' | 'NO_CUMPLIDA' | 'PENDIENTE'; ruta_cierre: string;
}

/** Qué falta para cerrar una fila — siempre una ruta, nunca "no cumple" a secas. */
export function rutaDeCierre(f: FilaComparador): string {
  const a = f.analisis;
  if (ambitoDe(f, a) === 'administrativo') return 'Marcar el check de confirmación de este compromiso.';
  if (f.veredicto === 'NO_CUMPLE') return a.ayuda?.accion_concreta || (a.ayuda?.ruta === 'INSALVABLE' ? 'Insalvable con esta ficha: volver a la búsqueda de producto.' : 'Pedir al proveedor la ficha del modelo/versión correcta.');
  if (a.propuesta && a.propuesta.confirmado == null) return a.propuesta.tipo === 'equivalencia_normativa' ? 'Confirmar (o rechazar) la equivalencia normativa propuesta.' : 'Confirmar (o rechazar) el emparejamiento propuesto.';
  if (a.conflicto_fuentes?.existe) return 'Decidir cuál ficha manda: hoy dos documentos dicen cosas distintas.';
  if (f.tipo === 'CUALITATIVO') return 'Declarar el atributo con respaldo adjunto.';
  if (f.veredicto === 'CUMPLE_CON_COMPLEMENTO') return 'Cotizar el complemento o adjuntar el respaldo del proveedor.';
  if (f.respuesta_manual && !f.adjunto_url && !f.corregido_at) return 'Adjuntar el respaldo de lo declarado.';
  if ((a.requiere_habilitacion === 'EM' || a.requiere_habilitacion === 'CA') && !a.habilitado && f.veredicto === 'CUMPLE') return 'El Encargado de Mercado Público debe habilitar este dato (no viene de una ficha formal).';
  if (f.veredicto === 'CUMPLE' && f.criticidad === 'INADMISIBLE' && a.origen_dato && !a.reverificado) return 'Reverificar (segunda lectura de los ítems críticos).';
  if (f.criticidad === 'SIN_CLASIFICAR') return 'Clasificar la criticidad del requisito.';
  return a.ayuda?.accion_concreta || 'Pedir el dato al proveedor (ver la pregunta redactada).';
}

/** Lista única con TODAS las causales de inadmisibilidad de la línea (más los requisitos sin
 *  clasificar, que bloquean igual). Es lo que consume el bloqueo previo a la postulación. */
export function certificadoAdmisibilidad(filas: FilaComparador[]): CausalAdmisibilidad[] {
  return filas
    .filter(f => f.criticidad === 'INADMISIBLE' || f.criticidad === 'SIN_CLASIFICAR')
    .map(f => {
      const estado = f.criticidad === 'SIN_CLASIFICAR' && estadoDeFila(f) === 'CUMPLIDA' ? 'PENDIENTE' : estadoDeFila(f);
      return {
        caracteristica_id: f.id,
        causal: f.descripcion + (f.valor_requerido_texto && !f.descripcion.includes(f.valor_requerido_texto) ? ` — ${f.valor_requerido_texto}` : ''),
        fuente: f.analisis.fuente_bases || 'Bases técnicas',
        estado, ruta_cierre: estado === 'CUMPLIDA' ? '' : rutaDeCierre(f),
      };
    })
    .sort((a, b) => ({ NO_CUMPLIDA: 0, PENDIENTE: 1, CUMPLIDA: 2 }[a.estado] - { NO_CUMPLIDA: 0, PENDIENTE: 1, CUMPLIDA: 2 }[b.estado]));
}

export interface BloqueoP4 { tipo: string; detalle: string; item_ref: string; ruta_desbloqueo: string }

export function bloqueosDeLinea(filas: FilaComparador[], extra: { asignacionesSinConfirmar: number; lineaSinFicha: boolean }): BloqueoP4[] {
  const out: BloqueoP4[] = [];
  if (extra.lineaSinFicha) out.push({ tipo: 'LINEA_SIN_FICHA', detalle: 'La línea no tiene ninguna ficha: no se puede comparar.', item_ref: '', ruta_desbloqueo: 'Arrastrar la ficha del producto a esta línea.' });
  if (extra.asignacionesSinConfirmar > 0) out.push({ tipo: 'ASIGNACION_SIN_CONFIRMAR', detalle: `${extra.asignacionesSinConfirmar} catálogo(s) con varios modelos sin elegir cuál se ofrece`, item_ref: '', ruta_desbloqueo: 'Confirmar el modelo que se ajusta a la línea.' });
  for (const f of filas) {
    const est = estadoDeFila(f);
    if (est === 'CUMPLIDA') continue;
    const admin = ambitoDe(f, f.analisis) === 'administrativo';
    out.push({
      tipo: est === 'NO_CUMPLIDA' ? 'NO_CUMPLE' : admin ? 'CHECK_SIN_MARCAR' : f.analisis.propuesta?.confirmado == null && f.analisis.propuesta ? 'PROPUESTA_SIN_CONFIRMAR'
        : f.analisis.conflicto_fuentes?.existe ? 'CONFLICTO_DE_FUENTES' : 'PENDIENTE',
      detalle: f.descripcion, item_ref: `${f.id}`, ruta_desbloqueo: rutaDeCierre(f),
    });
  }
  return out;
}

// ─── Inventario (PARTE III): deduplicación por código ───────────────────────────────────────────
export interface FichaInventariada {
  archivo: string; url: string;
  tipo: string; marca: string; modelos: string[]; tipo_equipo: string;
  idioma_original: string; traducido: boolean;
  emisor: string; proveedor: string; formalidad: string;
  legibilidad: 'completa' | 'parcial' | 'nula'; no_legible_detalle: string;
  duplicado_de: string | null;
  corresponde_licitacion: boolean; motivo_no_corresponde: string;
  /** Catálogo de familia: qué modelos propone la IA para la línea, en orden de ajuste. NO ELIGE. */
  candidatos: Array<{ modelo: string; razon: string }>;
  /** Largo del texto leído: sirve para decir cuál duplicado es "el más completo". */
  largo_texto: number;
}

const claveModelo = (f: FichaInventariada) => planoNorma(`${f.marca}${f.modelos[0] || ''}`);

/** Dos archivos del mismo modelo se agrupan: el más completo queda como principal. */
export function marcarDuplicados(fichas: FichaInventariada[]): FichaInventariada[] {
  const porClave = new Map<string, FichaInventariada[]>();
  for (const f of fichas) {
    if (!f.modelos.length || !f.marca) continue;
    const k = claveModelo(f);
    if (k.length < 4) continue;
    if (!porClave.has(k)) porClave.set(k, []);
    porClave.get(k)!.push(f);
  }
  const out = fichas.map(f => ({ ...f, duplicado_de: null as string | null }));
  for (const grupo of porClave.values()) {
    if (grupo.length < 2) continue;
    const principal = grupo.reduce((a, b) => (b.largo_texto > a.largo_texto ? b : a));
    for (const g of grupo) if (g.archivo !== principal.archivo) out.find(o => o.archivo === g.archivo)!.duplicado_de = principal.archivo;
  }
  return out;
}

// ─── Mapa ficha ↔ línea (PARTE IV) ──────────────────────────────────────────────────────────────
export interface AsignacionFicha { archivo: string; url: string; modelo_propuesto: string; razon: string; confirmado_por_humano: boolean }

/**
 * Propone el mapa. Una ficha de UN modelo, soltada por una persona sobre esta línea, queda
 * confirmada (la asignación la hizo el humano al soltarla). Un catálogo con VARIOS modelos NO se
 * cierra solo: se propone el primer candidato y espera a que un humano lo confirme.
 * `elegidos`: modelo confirmado por una persona, por nombre de archivo.
 */
export function proponerAsignacion(
  fichas: FichaInventariada[], elegidos: Record<string, string> = {},
): { mapa: AsignacionFicha[]; sinAsignar: Array<{ archivo: string; motivo: string }> } {
  const mapa: AsignacionFicha[] = []; const sinAsignar: Array<{ archivo: string; motivo: string }> = [];
  for (const f of fichas) {
    if (f.legibilidad === 'nula') { sinAsignar.push({ archivo: f.archivo, motivo: f.no_legible_detalle || 'No se pudo leer el archivo.' }); continue; }
    if (!f.corresponde_licitacion || f.tipo === 'irrelevante') { sinAsignar.push({ archivo: f.archivo, motivo: `NO CORRESPONDE: ${f.motivo_no_corresponde || 'no guarda relación con la línea (¿error de carga?)'}` }); continue; }
    const varios = f.modelos.length > 1;
    const elegido = elegidos[f.archivo];
    if (varios && !elegido) {
      const c = f.candidatos[0];
      mapa.push({ archivo: f.archivo, url: f.url, modelo_propuesto: c?.modelo || '', razon: c?.razon || 'Catálogo con varios modelos: elige cuál se ofrece.', confirmado_por_humano: false });
    } else {
      mapa.push({ archivo: f.archivo, url: f.url, modelo_propuesto: elegido || f.modelos[0] || '', razon: varios ? 'Modelo elegido por una persona.' : 'Ficha soltada por una persona sobre esta línea.', confirmado_por_humano: true });
    }
  }
  return { mapa, sinAsignar };
}

// ─── Mensaje al proveedor (PARTE VII): uno por producto, agrupado por proveedor ─────────────────
export interface MensajeProveedor { proveedor: string; productos_incluidos: string[]; mensaje: string }
export interface PreguntaPendiente { proveedor: string; producto: string; pregunta: string }

/** Agrupa las preguntas de los ítems pendientes en UN mensaje por proveedor, en español, breve. */
export function mensajesPorProveedor(preguntas: PreguntaPendiente[]): MensajeProveedor[] {
  const porProveedor = new Map<string, Map<string, string[]>>();
  for (const p of preguntas) {
    if (!p.pregunta.trim()) continue;
    const prov = p.proveedor || 'Proveedor sin identificar';
    if (!porProveedor.has(prov)) porProveedor.set(prov, new Map());
    const prods = porProveedor.get(prov)!;
    if (!prods.has(p.producto)) prods.set(p.producto, []);
    if (!prods.get(p.producto)!.includes(p.pregunta)) prods.get(p.producto)!.push(p.pregunta);
  }
  return Array.from(porProveedor.entries()).map(([proveedor, prods]) => {
    const bloques = Array.from(prods.entries()).map(([producto, qs]) =>
      `${producto}:\n${qs.map((q, i) => `${i + 1}. ${q}`).join('\n')}`);
    return {
      proveedor, productos_incluidos: Array.from(prods.keys()),
      mensaje: `Hola, para cerrar la cotización necesitamos confirmar por escrito lo siguiente:\n\n${bloques.join('\n\n')}\n\nQuedamos atentos, gracias.`,
    };
  });
}
