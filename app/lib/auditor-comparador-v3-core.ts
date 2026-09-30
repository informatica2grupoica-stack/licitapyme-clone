// app/lib/auditor-comparador-v3-core.ts
// AUDITOR · COMPARADOR TÉCNICO v3.0 — lo que decide el CÓDIGO. Puro (sin base de datos ni red), para poder probarlo entero.
// Spec: docs/PROMPT_4_Comparador_Tecnico_v3_0.md. El modelo entrega, por producto y requisito, UN estado (✅ CUMPLE · 🟩 SOBRECUMPLE · ❌ NO CUMPLE ·
// ❓ FALTA DATO) con el dato ofertado y una cita; todo lo demás lo calcula el código: estado del producto, cuadro, mejor opción, resumen contra el
// presupuesto, tope de 3 preguntas por proveedor y las marcas de revisión. La salida se adapta a `ResultadoTecnico` (el mismo tipo que ya consumen la
// firma, PRE-POSTULACIÓN y el informe) para que nada de lo que funcionaba se rompa.
import { citaExiste } from '@/app/lib/auditor-compras-core';
import { mismoProveedor } from '@/app/lib/auditor-proveedor';
import type { Criticidad, FilaTecnica, ResultadoTecnico, OrigenTec, VeredictoTec } from '@/app/lib/auditor-tecnico-v2-core';

export type EstadoCeldaV3 = 'CUMPLE' | 'SOBRECUMPLE' | 'NO_CUMPLE' | 'FALTA_DATO';
import type { EstadoProductoV3 } from '@/app/lib/auditor-resumen-licitacion';
export type { EstadoProductoV3 };

// ── Lo que devuelve el modelo (esquema del prompt) ───────────────────────────────────────────────
export interface SalidaV3 {
  lineas?: Array<{
    linea?: number | string;
    productos?: Array<{
      producto_id?: string; marca?: string; modelo?: string; proveedor?: string; archivos?: string[];
      celdas?: Array<{ n?: number | string; estado?: string; dato_ofertado?: string; cita?: string }>;
      estado_producto?: string;
      precio?: { valor_documento?: number | string; iva_documento?: string; neto_unitario?: number | string; iva_sin_confirmar?: boolean; otros_precios?: string; despacho_aparte?: string };
      notas?: string[];
    }>;
  }>;
  mensajes_proveedor?: Array<{ proveedor?: string; mensaje?: string }>;
}

// ── Lo que se guarda por opción ──────────────────────────────────────────────────────────────────
export interface RequisitoV3 { n: number; texto: string; fuente: string; criticidad: Criticidad }
export interface CeldaV3 {
  n: number; estado: EstadoCeldaV3; datoOfertado: string; cita: string;
  /** La cita que dio el modelo no figura en los documentos de la opción (se guarda para trazabilidad; no cambia el estado). */
  citaNoVerificada: boolean;
  /** Control mínimo del prompt: un número sin unidad que no calza con lo exigido ("4" lúmenes). Se marca para revisión. */
  revisar: boolean;
  origen: OrigenTec | null;
}
export interface CorridaOpcionV3 {
  opcionId: number; celdas: CeldaV3[]; notas: string[]; preguntas: string[]; sinFicha: boolean;
  asignacion: 'segura' | 'confirmar_linea' | 'no_corresponde';
}
/** Fila de auditor_verificacion_tecnica (resultado_json) de una opción con la v3. */
export interface GuardadaV3 { version: 'v3.0'; requisitos: RequisitoV3[]; opcion: CorridaOpcionV3; motor: string }
export interface Confirmacion { por: string; at: string; motivo?: string }

export interface DocumentoParaV3 { texto: string; tipo: string }
export interface OpcionParaV3 { opcionId: number; marca: string | null; modelo: string | null; proveedor: string | null; proveedorRut: string | null; docs: DocumentoParaV3[] }

const s = (v: unknown, max = 400) => (v == null ? '' : String(v)).trim().slice(0, max);

export function estadoCeldaDe(v: unknown): EstadoCeldaV3 {
  const t = s(v).toUpperCase().replace(/[\s_-]+/g, '');
  if (t.includes('🟩') || t === 'SOBRECUMPLE') return 'SOBRECUMPLE';
  if (t.includes('❌') || t === 'NOCUMPLE') return 'NO_CUMPLE';
  if (t.includes('✅') || t === 'CUMPLE') return 'CUMPLE';
  return 'FALTA_DATO';   // ❓, FALTADATO o cualquier cosa rara: sin evidencia no hay cumplimiento
}

/** Origen del dato según el documento donde está la cita: página web → FICHA_WEB; foto/WhatsApp → informal; el resto → ficha. */
function origenDeDocumento(tipo: string): OrigenTec {
  const t = tipo.toLowerCase();
  if (t.includes('link') || t.includes('web')) return 'FICHA_WEB';
  if (t.includes('informal')) return 'CONFIRMACION_INFORMAL';
  return 'FICHA';
}

const UNIDADES_EN_REQUISITO = /(lum[eé]nes|\blm\b|horas|\bh\b|btu|pulg|["”]|\bw\b|watts?|\bhz\b|\bmp\b|\bmm\b|\bcm\b|\bkg\b|\bdb\b|\bgb\b|\btb\b|\bfps\b|cuadros)/i;
/** "4" como dato de lúmenes o "12" de horas: un número chico y pelado frente a un requisito que habla de una unidad. */
export function numeroSospechoso(dato: string, requisito: string): boolean {
  return /^\d{1,2}([.,]\d+)?$/.test(dato.trim()) && UNIDADES_EN_REQUISITO.test(requisito) && /\d/.test(requisito);
}

// Preguntas que el prompt PROHÍBE (Paso 4): IVA, vigencia, stock, datos de la empresa, colores, adjetivos.
const PREGUNTA_PROHIBIDA = /\b(iva|vigencia|vigente|stock|disponibilidad|plazo|despacho|raz[oó]n social|rut|giro|cuenta|banc|direcci[oó]n|tel[eé]fono|correo|color)\b/i;

function preguntasDeMensaje(texto: string): string[] {
  // Lo normal es una frase «¿…?» por pregunta, aunque vengan en un párrafo con saludo ("Hola, respecto a la cotización 123: ¿nos pueden enviar…? Gracias.").
  const frases = [...texto.matchAll(/¿([^¿?]+)\?/g)].map(m => m[1].trim());
  const sueltas = frases.length ? frases : texto.split('\n').map(l => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim()).filter(l => l.includes('?')).map(l => l.replace(/\?+\s*$/, ''));
  return sueltas.filter(f => f.length > 12).map(f => `¿${f.charAt(0).toUpperCase()}${f.slice(1)}?`);
}

function idDeOpcion(productoId: unknown): number | null {
  const m = s(productoId).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

export const preguntaSinFicha = (marca: string | null, modelo: string | null) =>
  `¿Nos pueden enviar la ficha técnica del fabricante del ${[marca, modelo].filter(Boolean).join(' ') || 'producto cotizado'}?`;

export const MAX_PREGUNTAS_POR_PROVEEDOR = 3;

/** Convierte lo que devolvió el modelo para UNA línea en la corrida de cada opción. Nunca lanza por datos raros: lo que falta queda FALTA_DATO. */
export function parsearSalidaV3(salida: SalidaV3, requisitos: RequisitoV3[], opciones: OpcionParaV3[]): Map<number, CorridaOpcionV3> {
  const linea = (salida.lineas || [])[0];
  const productos = linea?.productos || [];
  const porOpcion = new Map<number, CorridaOpcionV3>();
  const asignacionDe = new Map<number, CorridaOpcionV3['asignacion']>();
  for (const d of (salida as any).documentos || []) for (const p of d?.productos || []) {
    const id = idDeOpcion(p?.producto_id);
    if (id != null && ['segura', 'confirmar_linea', 'no_corresponde'].includes(p?.asignacion)) asignacionDe.set(id, p.asignacion);
  }

  for (const o of opciones) {
    const p = productos.find(x => idDeOpcion(x.producto_id) === o.opcionId);
    const textoOpcion = o.docs.map(d => d.texto).join('\n');
    const celdasModelo = p?.celdas || [];
    const celdas: CeldaV3[] = requisitos.map(r => {
      const c = celdasModelo.find(x => Number(x.n) === r.n);
      if (!c) return { n: r.n, estado: 'FALTA_DATO' as const, datoOfertado: '', cita: '', citaNoVerificada: false, revisar: false, origen: null };
      const cita = s(c.cita, 500), dato = s(c.dato_ofertado, 200), estado = estadoCeldaDe(c.estado);
      const enDocumento = cita ? o.docs.find(d => citaExiste(d.texto, cita)) : undefined;
      return {
        n: r.n, estado, datoOfertado: dato, cita,
        citaNoVerificada: !!cita && !enDocumento && !citaExiste(textoOpcion, cita),
        revisar: estado !== 'FALTA_DATO' && numeroSospechoso(dato, r.texto),
        origen: enDocumento ? origenDeDocumento(enDocumento.tipo) : (estado === 'FALTA_DATO' ? null : origenDeDocumento(o.docs[0]?.tipo || '')),
      };
    });
    const notas = (p?.notas || []).map(n => s(n, 200)).filter(Boolean).slice(0, 3);
    if (!p) notas.unshift('El comparador no devolvió esta opción: vuelve a comparar la línea.');
    const sinFicha = requisitos.length > 0 && (celdas.every(c => c.estado === 'FALTA_DATO') || notas.some(n => /sin ficha/i.test(n)));
    if (sinFicha && !notas.some(n => /sin ficha/i.test(n))) notas.unshift('Sin ficha técnica');
    porOpcion.set(o.opcionId, { opcionId: o.opcionId, celdas, notas: notas.slice(0, 3), preguntas: [], sinFicha, asignacion: asignacionDe.get(o.opcionId) ?? 'segura' });
  }

  // Preguntas: UN mensaje por proveedor, máximo 3, solo técnicas. Van en la primera opción de cada proveedor para que no se repitan.
  const grupos: Array<{ ref: { rut: string | null; nombre: string | null }; opciones: OpcionParaV3[] }> = [];
  for (const o of opciones) {
    const ref = { rut: o.proveedorRut, nombre: o.proveedor };
    const g = grupos.find(x => mismoProveedor(x.ref, ref));
    if (g) g.opciones.push(o); else grupos.push({ ref, opciones: [o] });
  }
  for (const g of grupos) {
    const delModelo = (salida.mensajes_proveedor || []).filter(m => m.proveedor && mismoProveedor(g.ref, { nombre: m.proveedor }))
      .flatMap(m => preguntasDeMensaje(s(m.mensaje, 2000))).filter(q => !PREGUNTA_PROHIBIDA.test(q));
    const fijas = g.opciones.filter(o => porOpcion.get(o.opcionId)?.sinFicha).map(o => preguntaSinFicha(o.marca, o.modelo));
    const hayFichaFaltante = fijas.length > 0;
    // Si un producto no tiene ficha, la ÚNICA pregunta por ese producto es pedirla: se descartan las preguntas sueltas del modelo sobre él.
    const todas = [...new Set([...fijas, ...(hayFichaFaltante ? [] : delModelo)])].slice(0, MAX_PREGUNTAS_POR_PROVEEDOR);
    if (todas.length) porOpcion.get(g.opciones[0].opcionId)!.preguntas = todas;
  }
  return porOpcion;
}

// ── De la corrida guardada al resultado que consume el resto del sistema ─────────────────────────
const RUTA_NO_CUMPLE = 'Cambia de producto, o confirma con el proveedor si la ficha estaba desactualizada.';
const RUTA_FALTA_DATO = 'Confírmalo con un clic («lo confirmo») si sabes que lo cumple, o pregúntale al proveedor.';

export function estadoEfectivo(c: CeldaV3, confirmada: boolean): EstadoCeldaV3 {
  return (c.estado === 'FALTA_DATO' || c.estado === 'NO_CUMPLE') && confirmada ? 'CUMPLE' : c.estado;
}

export function estadoDeProducto(celdas: CeldaV3[], confirmaciones: Map<number, Confirmacion>): EstadoProductoV3 {
  const ef = celdas.map(c => estadoEfectivo(c, confirmaciones.has(c.n)));
  if (ef.includes('NO_CUMPLE')) return 'NO_CUMPLE';
  if (ef.includes('FALTA_DATO')) return 'FALTA_DATO';
  return 'CUMPLE';
}

export function construirResultadoTecnico(g: GuardadaV3, confirmaciones: Map<number, Confirmacion> = new Map()): ResultadoTecnico {
  const o = g.opcion;
  const filas: FilaTecnica[] = g.requisitos.map(r => {
    const c = o.celdas.find(x => x.n === r.n) ?? { n: r.n, estado: 'FALTA_DATO' as const, datoOfertado: '', cita: '', citaNoVerificada: false, revisar: false, origen: null };
    const conf = confirmaciones.get(r.n);
    const ef = estadoEfectivo(c, !!conf);
    const veredicto: VeredictoTec = ef === 'NO_CUMPLE' ? 'NO_CUMPLE' : ef === 'FALTA_DATO' ? 'SIN_VEREDICTO' : 'CUMPLE';
    const cerrada = ef === 'CUMPLE' || ef === 'SOBRECUMPLE';
    const rojo = r.criticidad === 'INADMISIBLE' || r.criticidad === 'SIN_CLASIFICAR';
    const origen = conf ? null : c.origen;
    return {
      n: r.n, requeridoTexto: r.texto, fuenteBases: r.fuente, criticidad: r.criticidad, criticidadSospechosa: false,
      veredicto, resumenPartes: '',
      partes: [{
        parte: '', tipo: '', requeridoValor: '', ofertadoValor: c.datoOfertado, ofertadoConvertido: '', calculo: '', fuenteFicha: '', citaOriginal: c.cita, citaTraduccion: '',
        lecturaCorregida: '', origen: origen ?? 'FICHA', veredicto, motivoSinVeredicto: ef === 'FALTA_DATO' ? 'no_declarado_tras_busqueda' : null,
        sobrecumple: ef === 'SOBRECUMPLE', complemento: null, guardarrailes: [...(c.citaNoVerificada ? ['cita no verificada en el documento'] : []), ...(c.revisar ? ['número sin unidad: revisar'] : [])],
      }],
      origen, habilitacion: 'no', habilitado: false, motivoHabilitacion: null,
      cerrada, motivoPendiente: null, ayuda: null, ayudaIncompleta: false,
      valorCorto: conf ? (c.estado === 'NO_CUMPLE' ? 'corregido a mano' : 'confirmado a mano') : c.datoOfertado, sobrecumple: ef === 'SOBRECUMPLE', rojo,
      rutaCierre: ef === 'NO_CUMPLE' ? RUTA_NO_CUMPLE : ef === 'FALTA_DATO' ? RUTA_FALTA_DATO : '',
      cambio: '', rectificacion: '',
      // v3.0 no tiene segunda pasada: el dato se da por reverificado para que PRE-POSTULACIÓN no la exija.
      reverificado: true,
      confirmada: conf ?? null, revisar: c.revisar, citaNoVerificada: c.citaNoVerificada, estadoCelda: ef,
    };
  });

  const noCumple = filas.filter(f => f.veredicto === 'NO_CUMPLE'), falta = filas.filter(f => f.veredicto === 'SIN_VEREDICTO');
  const estado: ResultadoTecnico['estado'] = filas.length === 0 ? 'SIN_EVALUAR' : noCumple.length ? 'NO_CUMPLE' : falta.length ? 'CON_PENDIENTES' : 'CUMPLE';
  const alertas: ResultadoTecnico['alertas'] = [];
  const revisar = filas.filter(f => f.revisar), sinCita = filas.filter(f => f.citaNoVerificada);
  if (revisar.length) alertas.push({ nivel: 'amarillo', texto: `Revisar el dato ofertado de ${revisar.length === 1 ? 'la fila' : 'las filas'} ${revisar.map(f => f.n).join(', ')}: es un número sin unidad que no calza con lo exigido.` });
  if (sinCita.length) alertas.push({ nivel: 'info', texto: `La cita de ${sinCita.length === 1 ? 'la fila' : 'las filas'} ${sinCita.map(f => f.n).join(', ')} no figura textual en los documentos (queda guardada para el EM).` });
  return {
    filas, estado,
    resumen: {
      total: filas.length, cumple: filas.filter(f => f.veredicto === 'CUMPLE').length, noCumple: noCumple.length, sinVeredicto: falta.length, conComplemento: 0, riesgo: 0, porAfinar: 0,
      rojosAbiertos: filas.filter(f => f.rojo && !f.cerrada).length, requiereEM: 0,
    },
    bloqueos: [
      ...noCumple.map(f => ({ codigo: 'NO_CUMPLE', item: f.n, mensaje: `No cumple: ${f.requeridoTexto}${f.valorCorto ? ` (${f.valorCorto})` : ''}`, salida: RUTA_NO_CUMPLE })),
      ...falta.map(f => ({ codigo: 'FALTA_DATO', item: f.n, mensaje: `Falta dato: ${f.requeridoTexto}`, salida: RUTA_FALTA_DATO })),
    ],
    eventos: [], compromisos: [],
    preguntas: o.preguntas.map(q => ({ n: 0, texto: q, bloquea: true })),
    alertas,
    sobredimensionamiento: { activa: false, sobrecumplen: 0, medibles: 0, mensaje: '' },
    productoOrigen: { activa: false, coinciden: 0, total: 0, mensaje: '' },
    noPudeLeer: [],
    notas: o.notas, sinFicha: o.sinFicha,
  };
}

