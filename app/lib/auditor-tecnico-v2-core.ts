// app/lib/auditor-tecnico-v2-core.ts
// AUDITOR · VERIFICADOR TÉCNICO (PROMPT 4 v2.0) — la parte que decide el CÓDIGO. Puro (sin base de datos ni red).
// Regla del prompt (Parte X, decisión CA 29-09-2026): "el modelo emite el veredicto de cada parte; el CÓDIGO calcula el
// veredicto de la fila (peor parte), el estado técnico de la opción, los bloqueos, las habilitaciones, el resumen de 🔴 y
// las celdas del cuadro comparativo". Además aquí viven los GUARDARRAÍLES: lo que dice el modelo no puede saltarse las
// reglas del prompt (cita de los dos lados, cita literal en el documento, cálculo numérico, complemento sin costear,
// cualitativo sin respaldo, emparejamiento técnico sin confirmar, conflicto de fuentes).
import { citaExiste } from '@/app/lib/auditor-compras-core';
import { combinarConCalculo } from '@/app/lib/auditor-tecnico-core';

export type Criticidad = 'INADMISIBLE' | 'PUNTAJE' | 'COMPROMISO' | 'SIN_CLASIFICAR';
export type VeredictoTec = 'CUMPLE' | 'NO_CUMPLE' | 'CUMPLE_CON_COMPLEMENTO' | 'SIN_VEREDICTO';
export type OrigenTec = 'FICHA' | 'FICHA_WEB' | 'CONFIRMACION_INFORMAL' | 'DECLARADO' | 'CONTRADICE_FICHA' | 'HEREDADO' | 'NO_LEGIBLE';

export interface RequisitoHeredado { n: number; texto: string; fuente: string; criticidad: Criticidad; producto?: string }

// ── Lo que devuelve el modelo (Parte X) ──────────────────────────────────────────────────────────
export interface ParteCruda {
  parte?: string; tipo_requisito?: string; requerido_valor?: string; requerido_unidad?: string;
  ofertado_valor?: string; ofertado_unidad_original?: string; ofertado_valor_convertido?: string; calculo?: string;
  fuente_ficha?: string; cita_original?: string; cita_traduccion?: string; lectura_corregida?: string; origen_dato?: string;
  deduccion?: { aplica?: boolean; cadena?: Array<{ dato?: string; cita?: string }>; conclusion?: string };
  respaldo_adjunto?: string;
  emparejamiento?: { nivel?: string; parametro_bases?: string; parametro_ficha?: string; razon?: string; requiere_confirmacion?: boolean; confirmado?: boolean };
  veredicto?: string; motivo_sin_veredicto?: string | null; sobrecumple?: boolean; sobrecumple_detalle?: string;
  complemento?: { tipo?: string; descripcion?: string; cotizado?: boolean; respaldo?: string };
  conflicto_fuentes?: { existe?: boolean; versiones?: Array<{ extraccion_id?: string; valor?: string; cita?: string }> };
}
export interface AyudaCruda {
  diagnostico?: string; hipotesis_causa?: string[]; pregunta_proveedor?: string; declaracion_propuesta?: string; respaldo_sugerido?: string;
  veredicto_equivalencia?: string; ruta?: string; accion_concreta?: string;
}
export interface ItemCrudo {
  n?: number; requerido_texto?: string; fuente_bases?: string; criticidad?: string; criticidad_sospechosa?: boolean; puntaje_en_riesgo?: string;
  partes?: ParteCruda[]; resumen_partes?: string; cambio_respecto_anterior?: string; motivo_pendiente?: string | null; ayuda?: AyudaCruda | null;
  reverificado?: boolean; rectificacion?: string;
}
export interface CompromisoCrudo { n?: number; materia?: string; exige_base_literal?: string; fuente_bases?: string; cuantificacion?: string; criticidad?: string }
export interface SalidaTecnicaCruda {
  alertas_generales?: {
    contradicciones_bases?: Array<{ item_ref?: string; letra_bases?: string; fuente_bases?: string; veredicto_por_letra?: string; veredicto_por_merito_tecnico?: string; explicacion?: string; pregunta_foro?: string; plazo_foro?: string }>;
    producto_origen?: { activa?: boolean; coinciden?: number; total?: number; mensaje?: string; exigencias_no_coincidentes?: string[] };
    criticidad_sospechosa?: Array<{ item_ref?: string; criticidad_recibida?: string; motivo?: string }>;
    criterios_evaluacion_no_disponibles?: boolean;
    ficha_contradice_web?: Array<{ item_ref?: string; valor_ficha?: string; valor_web?: string; citas?: string }>;
  };
  correspondencia_documentos?: Array<{ extraccion_id?: string; tipo_documento?: string; corresponde_linea?: boolean; corresponde_producto_opcion?: boolean; marca_documento?: string; modelo_documento?: string; requiere_confirmacion_humana?: boolean; origen_base?: string; motivo_no_corresponde?: string }>;
  matriz_tecnica?: ItemCrudo[];
  alerta_sobredimensionamiento?: { activa?: boolean; sobrecumplen?: number; medibles?: number; mensaje?: string };
  compromisos_con_costo?: CompromisoCrudo[];
  eventos?: Array<{ tipo?: string; item_ref?: string; detalle?: string }>;
  no_pude_leer?: Array<{ extraccion_id?: string; que?: string; donde?: string }>;
}

// ── Lo que calcula el código ─────────────────────────────────────────────────────────────────────
export interface ParteEvaluada {
  parte: string; tipo: string; requeridoValor: string; ofertadoValor: string; ofertadoConvertido: string; calculo: string;
  fuenteFicha: string; citaOriginal: string; citaTraduccion: string; lecturaCorregida: string; origen: OrigenTec;
  veredicto: VeredictoTec; motivoSinVeredicto: string | null; sobrecumple: boolean; complemento: ParteCruda['complemento'] | null;
  guardarrailes: string[];
}
export interface AyudaFila {
  diagnostico: string; hipotesisCausa: string[]; preguntaProveedor: string; declaracionPropuesta: string; respaldoSugerido: string;
  veredictoEquivalencia: string; ruta: 'SALVABLE' | 'INSALVABLE' | ''; accionConcreta: string;
}
export interface FilaTecnica {
  n: number; requeridoTexto: string; fuenteBases: string; criticidad: Criticidad; criticidadSospechosa: boolean;
  veredicto: VeredictoTec; resumenPartes: string; partes: ParteEvaluada[]; origen: OrigenTec | null;
  habilitacion: 'no' | 'EM'; habilitado: boolean; motivoHabilitacion: string | null;
  cerrada: boolean; motivoPendiente: 'RIESGO' | 'POR_AFINAR' | null; ayuda: AyudaFila | null; ayudaIncompleta: boolean;
  valorCorto: string; sobrecumple: boolean; rojo: boolean; rutaCierre: string; cambio: string; rectificacion: string; reverificado: boolean;
  /** Solo comparador v3.0 (auditor-comparador-v3-core.ts): ❓ que el asistente cerró con un clic; número sin unidad marcado para revisión; cita que el modelo dio pero no figura en el documento; estado de la celda tal como se ve. */
  confirmada?: { por: string; at: string } | null; revisar?: boolean; citaNoVerificada?: boolean; estadoCelda?: 'CUMPLE' | 'SOBRECUMPLE' | 'NO_CUMPLE' | 'FALTA_DATO';
}
export interface BloqueoTec { codigo: string; item: number | null; mensaje: string; salida: string }
export interface EventoTec { tipo: 'producto_cambiado' | 'complemento_requerido' | 'compromiso_con_costo' | 'ruta_insalvable' | 'sobredimensionamiento'; itemRef: string; detalle: string; /** complemento_requerido: ¿ya está cotizado o respaldado? */ costeado?: boolean }
export interface CompromisoCosto { materia: string; exigeBaseLiteral: string; fuenteBases: string; cuantificacion: string; criticidad: string }
export interface ResultadoTecnico {
  filas: FilaTecnica[];
  estado: 'SIN_EVALUAR' | 'CUMPLE' | 'CON_PENDIENTES' | 'NO_CUMPLE';
  resumen: { total: number; cumple: number; noCumple: number; sinVeredicto: number; conComplemento: number; riesgo: number; porAfinar: number; rojosAbiertos: number; requiereEM: number };
  bloqueos: BloqueoTec[];
  eventos: EventoTec[];
  compromisos: CompromisoCosto[];
  preguntas: Array<{ n: number; texto: string; bloquea: boolean }>;
  alertas: Array<{ nivel: 'rojo' | 'amarillo' | 'info'; texto: string }>;
  sobredimensionamiento: { activa: boolean; sobrecumplen: number; medibles: number; mensaje: string };
  productoOrigen: { activa: boolean; coinciden: number; total: number; mensaje: string };
  noPudeLeer: Array<{ que: string; donde: string }>;
  /** Solo comparador v3.0: notas del producto (máx. 3) y si el producto no tiene ficha técnica. */
  notas?: string[]; sinFicha?: boolean;
}

/** Mínimo de características medibles para que la alerta de sobredimensionamiento (≥ 50%) tenga sentido. */
export const MIN_MEDIBLES_SOBREDIM = 3;
const ORDEN_GRAVEDAD: Record<VeredictoTec, number> = { NO_CUMPLE: 3, SIN_VEREDICTO: 2, CUMPLE_CON_COMPLEMENTO: 1, CUMPLE: 0 };
const CONFIABILIDAD: Record<OrigenTec, number> = { FICHA: 0, HEREDADO: 0, FICHA_WEB: 1, CONFIRMACION_INFORMAL: 2, DECLARADO: 3, CONTRADICE_FICHA: 4, NO_LEGIBLE: 5 };

const s = (v: unknown, max = 600) => (v == null ? '' : String(v)).trim().slice(0, max);
function veredictoDe(v: unknown): VeredictoTec {
  const t = s(v).toUpperCase().replace(/\s+/g, '_');
  return t === 'CUMPLE' || t === 'NO_CUMPLE' || t === 'CUMPLE_CON_COMPLEMENTO' ? t : 'SIN_VEREDICTO';
}
function origenDe(v: unknown): OrigenTec {
  const t = s(v).toUpperCase();
  return (['FICHA', 'FICHA_WEB', 'CONFIRMACION_INFORMAL', 'DECLARADO', 'CONTRADICE_FICHA', 'HEREDADO', 'NO_LEGIBLE'] as string[]).includes(t) ? (t as OrigenTec) : 'FICHA';
}
export function criticidadDe(v: unknown): Criticidad {
  const t = s(v).toUpperCase();
  return t === 'INADMISIBLE' || t === 'PUNTAJE' || t === 'COMPROMISO' ? t : 'SIN_CLASIFICAR';
}

/** Texto entre comillas de una cita ("Ficha p.2, tabla X: 'Conforme a DIN 5032-7'") — lo que hay que encontrar literal en el documento. */
export function textoCitado(cita: string): string | null {
  const m = cita.match(/[«"“'‘]([^«»"”“'’]{8,})[»"”’']/);
  return m ? m[1].trim() : null;
}

const normalizarU = (u: string) => u.toLowerCase().replace(/[\s.]+/g, '');

function numeroSimple(t: string): number | null {
  const m = t.replace(/\s/g, '').match(/^[±+~]?(-?\d+(?:[.,]\d+)?)$/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function evaluarParte(p: ParteCruda, ctx: { textoDocumentos: string; declaradoConRespaldo: boolean }): ParteEvaluada {
  const g: string[] = [];
  let v = veredictoDe(p.veredicto);
  let motivo: string | null = p.motivo_sin_veredicto ? s(p.motivo_sin_veredicto, 60) : null;
  const tipo = s(p.tipo_requisito, 20).toUpperCase() || 'PRESENCIA';
  const origen = origenDe(p.origen_dato);
  const cita = s(p.cita_original);
  const degradar = (aSin: string, nota: string) => { v = 'SIN_VEREDICTO'; motivo = aSin; g.push(nota); };

  // Toda característica cerrada por el modelo trae cita de los DOS lados: sin cita de la ficha no está auditada.
  if ((v === 'CUMPLE' || v === 'NO_CUMPLE') && !cita && origen !== 'HEREDADO' && !ctx.declaradoConRespaldo)
    degradar('sin_cita', 'El veredicto no traía la cita de la ficha: queda sin veredicto (un ítem sin cita de los dos lados no está auditado).');
  // La cita literal tiene que existir en lo leído (PROHIBIDO citar un texto que no figura en el documento).
  if (v === 'CUMPLE' && cita && ctx.textoDocumentos) {
    const q = textoCitado(cita);
    if (q && !citaExiste(ctx.textoDocumentos, q)) degradar('cita_no_verificable', `La cita «${q.slice(0, 60)}» no aparece literalmente en los documentos leídos: no se da por cumplido.`);
  }
  // Comparación numérica determinista: manda el cálculo (misma regla que el comparador v1.1).
  if ((tipo === 'PISO' || tipo === 'TECHO' || tipo === 'EXACTO') && (v === 'CUMPLE' || v === 'NO_CUMPLE')) {
    const req = numeroSimple(s(p.requerido_valor)), of = numeroSimple(s(p.ofertado_valor));
    const uReq = normalizarU(s(p.requerido_unidad)), uOf = normalizarU(s(p.ofertado_unidad_original));
    if (req != null && of != null && uReq === uOf) {
      // Misma unidad textual (incluye %, ±, dB…: magnitudes que la tabla de conversión no conoce): comparación directa.
      const dir: VeredictoTec = tipo === 'PISO' ? (of >= req ? 'CUMPLE' : 'NO_CUMPLE') : tipo === 'TECHO' ? (of <= req ? 'CUMPLE' : 'NO_CUMPLE') : (of === req ? 'CUMPLE' : 'NO_CUMPLE');
      if (dir !== v) { g.push(`El cálculo numérico manda: ${of} ${tipo === 'PISO' ? '≥' : tipo === 'TECHO' ? '≤' : '='} ${req} da ${dir} (el modelo había dicho ${v}).`); v = dir; }
    } else if (req != null && of != null) {
      const c = combinarConCalculo(
        { tipo: tipo as any, valorRequeridoNumero: req, valorRequeridoNumeroMax: null, unidadRequerida: s(p.requerido_unidad) || null },
        { veredicto: v as any, valorOfertadoNumero: of, unidadOfertadaOriginal: s(p.ofertado_unidad_original) || null });
      if (c.nota) degradar('desacuerdo_calculo', c.nota);
      else if (c.veredicto && c.veredicto !== v) { g.push(`El cálculo numérico manda: la comparación da ${c.veredicto} (el modelo había dicho ${v}).`); v = c.veredicto as VeredictoTec; }
    }
  }
  // CUALITATIVO: no se compara, lo declara el asistente con respaldo.
  if (tipo === 'CUALITATIVO' && v === 'CUMPLE' && !ctx.declaradoConRespaldo && !s(p.respaldo_adjunto))
    degradar('cualitativo', 'Un requisito cualitativo no se da por cumplido sin una declaración del asistente con respaldo.');
  // Emparejamiento TÉCNICO: nunca se cierra sin confirmación humana.
  if (p.emparejamiento?.requiere_confirmacion && !p.emparejamiento?.confirmado && (v === 'CUMPLE' || v === 'CUMPLE_CON_COMPLEMENTO'))
    degradar('emparejamiento_por_confirmar', 'El emparejamiento es de nivel TÉCNICO: hay que confirmarlo antes de cerrar el ítem.');
  // CUMPLE CON COMPLEMENTO de accesorio o documento de tercero: solo si está cotizado o con respaldo del proveedor.
  const compTipo = s(p.complemento?.tipo, 30);
  if (v === 'CUMPLE_CON_COMPLEMENTO' && (compTipo === 'accesorio' || compTipo === 'documento_tercero') && !p.complemento?.cotizado && !s(p.complemento?.respaldo))
    degradar('complemento_sin_costear', 'El complemento no está cotizado ni respaldado por el proveedor: no existe todavía.');
  // Conflicto de fuentes: no se elige.
  if (p.conflicto_fuentes?.existe && v !== 'SIN_VEREDICTO') degradar('conflicto_fuentes', 'Dos documentos dicen cosas distintas: hay que decidir cuál manda.');
  // Sin veredicto por "no encontrado": el verificador leyó TODA la extracción (el texto completo de los documentos),
  // así que se considera ya buscado (la búsqueda dirigida del Lector no agregaría nada).
  if (v === 'SIN_VEREDICTO' && motivo === 'no_encontrado_en_extraccion') motivo = 'no_declarado_tras_busqueda';

  return {
    parte: s(p.parte, 300), tipo, requeridoValor: [s(p.requerido_valor, 120), s(p.requerido_unidad, 20)].filter(Boolean).join(' '),
    ofertadoValor: [s(p.ofertado_valor, 120), s(p.ofertado_unidad_original, 20)].filter(Boolean).join(' '),
    ofertadoConvertido: s(p.ofertado_valor_convertido, 80), calculo: s(p.calculo, 400),
    fuenteFicha: s(p.fuente_ficha, 300), citaOriginal: cita, citaTraduccion: s(p.cita_traduccion), lecturaCorregida: s(p.lectura_corregida),
    origen, veredicto: v, motivoSinVeredicto: v === 'SIN_VEREDICTO' ? (motivo || 'no_declarado_tras_busqueda') : null,
    sobrecumple: !!p.sobrecumple && v === 'CUMPLE' && ['PISO', 'TECHO', 'RANGO'].includes(tipo), complemento: p.complemento ?? null, guardarrailes: g,
  };
}

const AYUDA_VACIA: AyudaFila = { diagnostico: '', hipotesisCausa: [], preguntaProveedor: '', declaracionPropuesta: '', respaldoSugerido: '', veredictoEquivalencia: '', ruta: '', accionConcreta: '' };

function rutaCierreDe(f: { veredicto: VeredictoTec; ayuda: AyudaFila | null; partes: ParteEvaluada[]; criticidad: Criticidad; habilitacion: 'no' | 'EM'; habilitado: boolean }): string {
  if (f.ayuda?.accionConcreta) return f.ayuda.accionConcreta;
  const motivos = new Set(f.partes.map(p => p.motivoSinVeredicto));
  if (f.veredicto === 'NO_CUMPLE') return f.ayuda?.ruta === 'INSALVABLE' ? 'Insalvable con este producto: volver a la búsqueda de producto.' : 'Pedir al proveedor la ficha del modelo o versión que sí cumple.';
  if (motivos.has('emparejamiento_por_confirmar')) return 'Confirmar (o rechazar) el emparejamiento propuesto.';
  if (motivos.has('conflicto_fuentes')) return 'Decidir cuál documento manda: hoy dicen cosas distintas.';
  if (motivos.has('cualitativo')) return 'Declarar el atributo con un respaldo adjunto.';
  if (motivos.has('complemento_sin_costear')) return 'Costear el accesorio o documento (o adjuntar el respaldo del proveedor).';
  if (motivos.has('cita_no_verificable') || motivos.has('sin_cita')) return 'Pedir la ficha donde figure el dato, o revisar el documento.';
  if (f.habilitacion === 'EM' && !f.habilitado && f.veredicto !== 'SIN_VEREDICTO') return 'El Encargado de Mercado Público debe habilitar este dato (la fuente no es una ficha formal).';
  return 'Pedir el dato al proveedor (ver la pregunta redactada).';
}

export interface EntradaTecnica {
  requisitos: RequisitoHeredado[];
  salida: SalidaTecnicaCruda;
  /** Todo el texto de los documentos de la opción: sirve para comprobar que las citas existen literalmente. */
  textoDocumentos: string;
  /** Ítems (n) que el EM ya habilitó. */
  habilitados?: Set<number>;
  /** Ítems declarados por el asistente CON respaldo (n → true). Sin respaldo no cuenta. */
  declarados?: Set<number>;
}

export function evaluarTecnico(e: EntradaTecnica): ResultadoTecnico {
  const habilitados = e.habilitados ?? new Set<number>(), declarados = e.declarados ?? new Set<number>();
  const crudos = new Map<number, ItemCrudo>();
  for (const it of e.salida.matriz_tecnica || []) if (Number.isFinite(Number(it?.n))) crudos.set(Number(it.n), it);
  const sospechosas = new Map<number, string>();
  for (const x of e.salida.alertas_generales?.criticidad_sospechosa || []) { const n = Number(x?.item_ref); if (Number.isFinite(n)) sospechosas.set(n, s(x?.motivo, 200)); }

  const filas: FilaTecnica[] = e.requisitos.map(req => {
    const it = crudos.get(req.n);
    const sospechosa = !!(it?.criticidad_sospechosa || sospechosas.has(req.n)) && req.criticidad === 'PUNTAJE';
    const critEf: Criticidad = sospechosa ? 'INADMISIBLE' : req.criticidad;
    const declaradoConRespaldo = declarados.has(req.n);
    const partes = (it?.partes || []).map(p => evaluarParte(p, { textoDocumentos: e.textoDocumentos, declaradoConRespaldo }));
    // Un ítem declarado por el asistente CON respaldo se da por respondido (origen DECLARADO → pasa por el EM).
    if (declaradoConRespaldo) for (const p of partes) if (p.veredicto !== 'NO_CUMPLE') { p.veredicto = 'CUMPLE'; p.origen = 'DECLARADO'; p.motivoSinVeredicto = null; }

    const veredicto: VeredictoTec = partes.length ? partes.map(p => p.veredicto).reduce((a, b) => (ORDEN_GRAVEDAD[b] > ORDEN_GRAVEDAD[a] ? b : a)) : 'SIN_VEREDICTO';
    const partesCumple = partes.filter(p => p.veredicto === 'CUMPLE' || p.veredicto === 'CUMPLE_CON_COMPLEMENTO');
    const origen = partesCumple.length ? partesCumple.map(p => p.origen).reduce((a, b) => (CONFIABILIDAD[b] > CONFIABILIDAD[a] ? b : a)) : (partes[0]?.origen ?? null);

    // Habilitación (la aplica el código): fuente que no es ficha formal → Encargado de Mercado Público.
    let habilitacion: 'no' | 'EM' = 'no', motivoHab: string | null = null;
    if (partesCumple.some(p => ['CONFIRMACION_INFORMAL', 'DECLARADO', 'CONTRADICE_FICHA'].includes(p.origen))) { habilitacion = 'EM'; motivoHab = 'El dato viene de una fuente informal o declarada por el asistente.'; }
    else if (critEf === 'INADMISIBLE' && partesCumple.length && partesCumple.every(p => p.origen === 'FICHA_WEB')) { habilitacion = 'EM'; motivoHab = 'Exigencia que puede dejarnos fuera respaldada solo por la página web (FICHA_WEB).'; }
    else if (critEf === 'INADMISIBLE' && partesCumple.some(p => p.lecturaCorregida && !p.citaOriginal)) { habilitacion = 'EM'; motivoHab = 'Se cerró con una traducción corregida como único sustento.'; }
    const habilitado = habilitacion === 'no' || habilitados.has(req.n);

    const cerrada = (veredicto === 'CUMPLE' || veredicto === 'CUMPLE_CON_COMPLEMENTO') && habilitado && critEf !== 'SIN_CLASIFICAR';
    const abierta = veredicto === 'NO_CUMPLE' || veredicto === 'SIN_VEREDICTO';

    const a = it?.ayuda;
    const ayuda: AyudaFila | null = !cerrada && a ? {
      diagnostico: s(a.diagnostico, 600), hipotesisCausa: (a.hipotesis_causa || []).map(x => s(x, 200)).filter(Boolean).slice(0, 5),
      preguntaProveedor: s(a.pregunta_proveedor, 500), declaracionPropuesta: s(a.declaracion_propuesta, 500), respaldoSugerido: s(a.respaldo_sugerido, 300),
      veredictoEquivalencia: s(a.veredicto_equivalencia, 500), ruta: s(a.ruta).toUpperCase() === 'INSALVABLE' ? 'INSALVABLE' : s(a.ruta).toUpperCase() === 'SALVABLE' ? 'SALVABLE' : '', accionConcreta: s(a.accion_concreta, 500),
    } : null;
    // Ayuda incompleta: solo se evalúa en ítems ABIERTOS (nunca en un CUMPLE).
    const ayudaIncompleta = abierta && (!ayuda || !ayuda.diagnostico || !ayuda.accionConcreta || !ayuda.ruta);

    let motivoPend: 'RIESGO' | 'POR_AFINAR' | null = null;
    if (!cerrada) {
      const declarado = s(it?.motivo_pendiente).toUpperCase().replace(/\s+/g, '_');
      const motivos = new Set(partes.map(p => p.motivoSinVeredicto));
      if (declarado === 'RIESGO' || declarado === 'POR_AFINAR') motivoPend = declarado as any;
      else motivoPend = veredicto === 'NO_CUMPLE' ? 'RIESGO' : (motivos.has('cualitativo') || motivos.has('complemento_sin_costear') || partes.some(p => p.tipo === 'CUALITATIVO')) ? 'POR_AFINAR' : 'RIESGO';
      if (veredicto === 'NO_CUMPLE') motivoPend = 'RIESGO';                      // el producto no cumple: sin arreglo salvo otro modelo
      if (motivos.has('complemento_sin_costear') && veredicto !== 'NO_CUMPLE') motivoPend = 'POR_AFINAR';
      if (habilitacion === 'EM' && !habilitado && veredicto !== 'SIN_VEREDICTO' && veredicto !== 'NO_CUMPLE') motivoPend = 'POR_AFINAR';
    }
    const primera = partes.find(p => p.ofertadoValor) ?? partes[0];
    const fila: FilaTecnica = {
      n: req.n, requeridoTexto: s(it?.requerido_texto) || req.texto, fuenteBases: s(it?.fuente_bases) || req.fuente, criticidad: critEf, criticidadSospechosa: sospechosa,
      veredicto, resumenPartes: s(it?.resumen_partes, 300) || partes.map(p => `${p.parte || 'parte'} ${p.veredicto === 'CUMPLE' ? '✅' : p.veredicto === 'NO_CUMPLE' ? '❌' : p.veredicto === 'CUMPLE_CON_COMPLEMENTO' ? '➕' : '⏳'}`).join(' · '),
      partes, origen, habilitacion, habilitado, motivoHabilitacion: motivoHab, cerrada, motivoPendiente: motivoPend, ayuda, ayudaIncompleta,
      valorCorto: primera?.ofertadoValor || '', sobrecumple: partes.some(p => p.sobrecumple),
      rojo: critEf === 'INADMISIBLE' || critEf === 'SIN_CLASIFICAR', rutaCierre: '', cambio: s(it?.cambio_respecto_anterior, 300),
      rectificacion: s(it?.rectificacion, 400), reverificado: !!it?.reverificado,
    };
    fila.rutaCierre = cerrada ? '' : rutaCierreDe({ veredicto, ayuda: ayuda ?? AYUDA_VACIA, partes, criticidad: critEf, habilitacion, habilitado });
    return fila;
  });

  // ── Bloqueos (los calcula el código; todo con ruta de salida) ──
  const bloqueos: BloqueoTec[] = [];
  for (const f of filas) {
    if (f.cerrada) continue;
    const etiqueta = f.criticidad === 'SIN_CLASIFICAR' ? 'SIN CLASIFICAR' : f.veredicto === 'NO_CUMPLE' ? 'NO CUMPLE' : f.veredicto === 'SIN_VEREDICTO' ? 'SIN VEREDICTO' : 'POR HABILITAR';
    bloqueos.push({
      codigo: f.criticidad === 'SIN_CLASIFICAR' ? 'T_SIN_CLASIFICAR' : f.veredicto === 'NO_CUMPLE' ? 'T_NO_CUMPLE' : f.veredicto === 'SIN_VEREDICTO' ? 'T_SIN_VEREDICTO' : 'T_HABILITACION', item: f.n,
      mensaje: `${etiqueta}${f.rojo ? ' 🔴' : ''} — ${f.requeridoTexto.slice(0, 140)}`, salida: f.criticidad === 'SIN_CLASIFICAR' ? 'Clasificar la criticidad del requisito (nunca se marca COMPROMISO por defecto).' : f.rutaCierre,
    });
  }

  // ── Eventos ──
  const eventos: EventoTec[] = [];
  for (const c of e.salida.correspondencia_documentos || []) if (c.corresponde_producto_opcion === false)
    eventos.push({ tipo: 'producto_cambiado', itemRef: s(c.extraccion_id, 30), detalle: `El documento es de ${[c.marca_documento, c.modelo_documento].filter(Boolean).join(' ') || 'otro producto'}, no del de la opción.` });
  for (const f of filas) for (const p of f.partes) {
    const t = s(p.complemento?.tipo, 30);
    if (p.veredicto !== 'NO_CUMPLE' && (t === 'accesorio' || t === 'documento_tercero') && p.complemento?.descripcion)
      eventos.push({ tipo: 'complemento_requerido', itemRef: String(f.n), detalle: s(p.complemento.descripcion, 200), costeado: !!p.complemento.cotizado || !!s(p.complemento.respaldo) });
  }
  for (const f of filas) if (f.veredicto === 'NO_CUMPLE' && f.rojo && f.ayuda?.ruta === 'INSALVABLE')
    eventos.push({ tipo: 'ruta_insalvable', itemRef: String(f.n), detalle: f.requeridoTexto.slice(0, 200) });

  // ── Sobredimensionamiento: ≥ 50% de las características medibles sobrecumplen ──
  const medibles = filas.filter(f => f.partes.some(p => ['PISO', 'TECHO', 'RANGO'].includes(p.tipo) && p.veredicto === 'CUMPLE' && p.ofertadoValor));
  const sobre = medibles.filter(f => f.sobrecumple).length;
  // Con muy pocas características medibles el 50% no significa nada (1 de 2): se exige un mínimo para alertar.
  const activa = medibles.length >= MIN_MEDIBLES_SOBREDIM && sobre / medibles.length >= 0.5;
  const sobredim = { activa, sobrecumplen: sobre, medibles: medibles.length, mensaje: activa ? `OJO: ${sobre} de ${medibles.length} características sobrecumplen. Puede que estemos cotizando un modelo más caro del necesario — verifica si es el modelo correcto.` : '' };
  if (activa) eventos.push({ tipo: 'sobredimensionamiento', itemRef: '', detalle: sobredim.mensaje });

  // ── Compromisos con costo → línea de COSTO ASOCIADO (sin duplicar) ──
  const compromisos: CompromisoCosto[] = [];
  const vistos = new Set<string>();
  for (const c of e.salida.compromisos_con_costo || []) {
    const lit = s(c.exige_base_literal, 1500);
    if (!lit) continue;
    const k = `${s(c.materia, 40)}|${s(c.cuantificacion, 200)}|${lit}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    compromisos.push({ materia: s(c.materia, 40) || 'otro', exigeBaseLiteral: lit, fuenteBases: s(c.fuente_bases, 300), cuantificacion: s(c.cuantificacion, 300), criticidad: criticidadDe(c.criticidad) });
    eventos.push({ tipo: 'compromiso_con_costo', itemRef: String(c.n ?? ''), detalle: `${s(c.materia, 40)}: ${s(c.cuantificacion, 120) || 'no cuantificado'}` });
  }

  // ── Preguntas al proveedor: solo técnicas, solo de ítems abiertos, nunca de lo cualitativo ──
  const preguntas = filas.filter(f => !f.cerrada && f.ayuda?.preguntaProveedor && !f.partes.some(p => p.tipo === 'CUALITATIVO' && p.veredicto === 'SIN_VEREDICTO'))
    .map(f => ({ n: f.n, texto: f.ayuda!.preguntaProveedor, bloquea: true }));

  // ── Resumen y estado ──
  const resumen = {
    total: filas.length,
    cumple: filas.filter(f => f.veredicto === 'CUMPLE').length, noCumple: filas.filter(f => f.veredicto === 'NO_CUMPLE').length,
    sinVeredicto: filas.filter(f => f.veredicto === 'SIN_VEREDICTO').length, conComplemento: filas.filter(f => f.veredicto === 'CUMPLE_CON_COMPLEMENTO').length,
    riesgo: filas.filter(f => f.motivoPendiente === 'RIESGO').length, porAfinar: filas.filter(f => f.motivoPendiente === 'POR_AFINAR').length,
    rojosAbiertos: filas.filter(f => f.rojo && !f.cerrada).length, requiereEM: filas.filter(f => f.habilitacion === 'EM' && !f.habilitado).length,
  };
  const evaluado = (e.salida.matriz_tecnica || []).length > 0;
  const estado: ResultadoTecnico['estado'] = !evaluado ? 'SIN_EVALUAR' : resumen.noCumple > 0 ? 'NO_CUMPLE' : filas.some(f => !f.cerrada) ? 'CON_PENDIENTES' : 'CUMPLE';

  // ── Alertas generales (arriba de todo) ──
  const alertas: ResultadoTecnico['alertas'] = [];
  for (const c of e.salida.alertas_generales?.contradicciones_bases || [])
    alertas.push({ nivel: 'rojo', texto: `La letra de las bases y el mérito técnico dan veredictos distintos (${s(c.item_ref, 20)}): ${s(c.explicacion, 300)} Manda la letra. Pregunta al foro sugerida: «${s(c.pregunta_foro, 300)}»${c.plazo_foro ? ` (plazo del foro: ${c.plazo_foro})` : ''}.` });
  for (const x of e.salida.alertas_generales?.ficha_contradice_web || [])
    alertas.push({ nivel: 'amarillo', texto: `La ficha contradice a la página web en el ítem ${s(x.item_ref, 20)} (ficha: ${s(x.valor_ficha, 80)}; web: ${s(x.valor_web, 80)}). Prevalece la ficha.` });
  if (sospechosas.size) alertas.push({ nivel: 'amarillo', texto: `${sospechosas.size} exigencia${sospechosas.size === 1 ? '' : 's'} llegó como PUNTAJE sin un criterio que le dé puntos: se trata como INADMISIBLE hasta que el Encargado de Mercado Público la confirme.` });
  if (e.salida.alertas_generales?.criterios_evaluacion_no_disponibles) alertas.push({ nivel: 'info', texto: 'No llegaron los criterios de evaluación: no se puede estimar el puntaje en riesgo (una sola alerta para toda la línea).' });
  if (filas.some(f => f.ayudaIncompleta)) alertas.push({ nivel: 'amarillo', texto: 'Hay ítems abiertos sin la ayuda completa (diagnóstico, ruta y acción): conviene volver a verificar.' });
  for (const f of filas) for (const p of f.partes) for (const g of p.guardarrailes) alertas.push({ nivel: 'info', texto: `Ítem ${f.n}: ${g}` });
  const po = e.salida.alertas_generales?.producto_origen;

  return {
    filas, estado, resumen, bloqueos, eventos, compromisos, preguntas, alertas, sobredimensionamiento: sobredim,
    productoOrigen: { activa: !!po?.activa, coinciden: Number(po?.coinciden) || 0, total: Number(po?.total) || 0, mensaje: s(po?.mensaje, 300) },
    noPudeLeer: (e.salida.no_pude_leer || []).map(x => ({ que: s(x.que, 200), donde: s(x.donde, 200) })).filter(x => x.que),
  };
}
