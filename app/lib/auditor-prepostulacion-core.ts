// app/lib/auditor-prepostulacion-core.ts
// PRE-POSTULACIÓN — la parte que decide el CÓDIGO. Puro (sin base de datos ni red), para poder probarlo entero.
// Spec: docs/ESPECIFICACION_AUDITOR_v1.md §2 y §11.4 · docs/RESERVA_PREPOSTULACION_Bloque_TecAdm_y_Certificado.md.
//
// Tres cosas salen de aquí:
//   1. CERTIFICADO DE ADMISIBILIDAD: la lista única de TODAS las causales que pueden dejarnos fuera, por línea, con su estado
//      (CUMPLIDA / NO_CUMPLIDA / PENDIENTE), su fuente y la ruta para cerrarla. Se arma de la verificación técnica de la
//      opción APROBADA, consumiendo la segunda pasada de rojos que ya corrió en la pasada final del AUDITOR.
//   2. BLOQUE TÉCNICO-ADMINISTRATIVO: los compromisos nuestros, precargados como cumplidos; cada uno se confirma a mano.
//   3. EL CANDADO: junta lo anterior con el avance (¿toda línea ofertada tiene su opción aprobada?) y dice si se pueden
//      generar los anexos, con cada causal y su ruta de desbloqueo (nunca "bloqueado" a secas).
import type { FilaTecnica, ResultadoTecnico } from '@/app/lib/auditor-tecnico-v2-core';
import type { ResultadoAvance } from '@/app/lib/auditor-opciones-core';

// ── 1. Certificado de admisibilidad ──────────────────────────────────────────────────────────────
export type EstadoCausal = 'CUMPLIDA' | 'NO_CUMPLIDA' | 'PENDIENTE';
/** RIESGO / POR_AFINAR vienen del verificador técnico; SEGUNDA_PASADA = está declarado CUMPLE pero nadie volvió al documento original. */
export type MotivoPendienteCausal = 'RIESGO' | 'POR_AFINAR' | 'SEGUNDA_PASADA' | 'SIN_VERIFICAR';

export interface CausalCertificado {
  linea: number; filaId: string; opcionId: number; item: number | null;
  causal: string; fuente: string; criticidadSospechosa: boolean;
  estado: EstadoCausal; motivoPendiente: MotivoPendienteCausal | null; rutaCierre: string;
  /** Dónde se leyó el dato (la cita de la ficha), para poder señalar el ítem exacto. */
  evidencia: string;
}

/** Lo mínimo que necesita el certificado de cada línea del panel del AUDITOR. */
export interface LineaParaCertificado {
  filaId: string; item: number; detalle: string; noOfertada: boolean;
  aprobada: { id: number; marca: string | null; modelo: string | null; via: 'liviana' | 'completa'; tecnicoEstado: string; resultado: ResultadoTecnico | null; segundaPasadaAt: string | null } | null;
}

export interface LineaCertificado {
  filaId: string; linea: number; detalle: string; producto: string | null; opcionId: number | null;
  sinOpcion: boolean; causales: CausalCertificado[];
  cumplidas: number; noCumplidas: number; pendientes: number;
  /** Opciones cuyos 🔴 están declarados CUMPLE sin segunda pasada: hay que correrla (o repetirla si algo cambió). */
  requiereSegundaPasada: boolean;
}

export interface Certificado {
  lineas: LineaCertificado[];
  total: number; cumplidas: number; noCumplidas: number; pendientes: number;
  /** ¿No queda ninguna causal abierta? (Las líneas sin opción aprobada las cubre el avance, no el certificado.) */
  limpio: boolean;
}

function causalDeFila(f: FilaTecnica, base: Pick<CausalCertificado, 'linea' | 'filaId' | 'opcionId'>): CausalCertificado {
  const evidencia = f.partes.map(p => p.citaOriginal || p.fuenteFicha).filter(Boolean).join(' | ').slice(0, 300);
  const comun = { ...base, item: f.n, causal: f.requeridoTexto, fuente: f.fuenteBases, criticidadSospechosa: f.criticidadSospechosa, evidencia };
  if (f.veredicto === 'NO_CUMPLE') return { ...comun, estado: 'NO_CUMPLIDA', motivoPendiente: null, rutaCierre: f.rutaCierre };
  // Cerrada = veredicto de cumplimiento, sin habilitación pendiente y con criticidad clasificada. Un 🔴 cerrado además necesita la
  // segunda pasada: sin ella el CUMPLE es la palabra de una sola lectura (Prompt 4 v2.0, Parte IX).
  if (f.cerrada && (f.reverificado || f.criticidad !== 'INADMISIBLE')) return { ...comun, estado: 'CUMPLIDA', motivoPendiente: null, rutaCierre: '' };
  if (f.cerrada) return { ...comun, estado: 'PENDIENTE', motivoPendiente: 'SEGUNDA_PASADA', rutaCierre: 'Correr la segunda pasada: relee el documento original y reconfirma este dato.' };
  return { ...comun, estado: 'PENDIENTE', motivoPendiente: f.motivoPendiente ?? 'RIESGO', rutaCierre: f.rutaCierre || 'Cerrarlo en la verificación técnica de la opción.' };
}

/** Certificado de admisibilidad: por cada línea OFERTADA con opción aprobada, todas las causales rojas (INADMISIBLE + las de criticidad
 *  sospechosa, que ya llegan tratadas como INADMISIBLE + SIN_CLASIFICAR). Las líneas NO OFERTADA quedan fuera. */
export function armarCertificado(lineas: LineaParaCertificado[]): Certificado {
  const out: LineaCertificado[] = [];
  for (const l of lineas) {
    if (l.noOfertada) continue;
    const a = l.aprobada;
    const vacia = { filaId: l.filaId, linea: l.item, detalle: l.detalle, cumplidas: 0, noCumplidas: 0, pendientes: 0, requiereSegundaPasada: false };
    if (!a) { out.push({ ...vacia, producto: null, opcionId: null, sinOpcion: true, causales: [] }); continue; }
    const producto = [a.marca, a.modelo].filter(Boolean).join(' ') || null;
    const base = { linea: l.item, filaId: l.filaId, opcionId: a.id };
    const causales: CausalCertificado[] = [];
    if (a.resultado) {
      for (const f of a.resultado.filas) if (f.rojo) causales.push(causalDeFila(f, base));
    } else if (a.via === 'completa' && a.tecnicoEstado === 'NO_CORRIDO') {
      // Una opción de vía completa aprobada sin verificación técnica no tiene cómo probar nada: no se da por limpia.
      causales.push({ ...base, item: null, causal: 'La verificación técnica de la opción no se ha corrido', fuente: 'Verificador técnico (Prompt 4)', criticidadSospechosa: false,
        estado: 'PENDIENTE', motivoPendiente: 'SIN_VERIFICAR', rutaCierre: 'Correr la verificación técnica de la opción en el Auditor.', evidencia: '' });
    }
    out.push({
      ...vacia, producto, opcionId: a.id, sinOpcion: false, causales,
      cumplidas: causales.filter(c => c.estado === 'CUMPLIDA').length,
      noCumplidas: causales.filter(c => c.estado === 'NO_CUMPLIDA').length,
      pendientes: causales.filter(c => c.estado === 'PENDIENTE').length,
      requiereSegundaPasada: causales.some(c => c.motivoPendiente === 'SEGUNDA_PASADA'),
    });
  }
  const total = out.reduce((n, l) => n + l.causales.length, 0);
  const cumplidas = out.reduce((n, l) => n + l.cumplidas, 0), noCumplidas = out.reduce((n, l) => n + l.noCumplidas, 0), pendientes = out.reduce((n, l) => n + l.pendientes, 0);
  return { lineas: out, total, cumplidas, noCumplidas, pendientes, limpio: noCumplidas === 0 && pendientes === 0 };
}

// ── 2. Bloque técnico-administrativo ─────────────────────────────────────────────────────────────
export type OrigenItem = 'ia' | 'costo_asociado' | 'manual';

export interface ItemPrePost {
  id: number; filaId: string | null; origen: OrigenItem; materia: string;
  exigeBaseLiteral: string; fuenteBases: string; seCompromete: string; cuantificacion: string; criticidad: string;
  costoAsociadoId: number | null;
  confirmado: boolean; confirmadoPorNombre: string | null; confirmadoAt: string | null;
  noAplica: boolean; nota: string | null;
  /** Solo origen 'costo_asociado': lo que dice el costeo hoy sobre este compromiso. */
  costo: { anulado: boolean; montoEstimado: number | null } | null;
}

/** Un ítem que vino de un costo asociado ANULADO ya no es un compromiso nuestro: sale del bloque (el asistente lo anuló con comentario). */
export const itemVigente = (i: ItemPrePost): boolean => !(i.origen === 'costo_asociado' && i.costo?.anulado);
export const itemAbierto = (i: ItemPrePost): boolean => itemVigente(i) && !i.confirmado && !i.noAplica;

/** Clave estable de un compromiso: el mismo compromiso detectado de nuevo (otra corrida de la IA) no se duplica ni pierde su confirmación. */
export function claveDeCompromiso(filaId: string | null, materia: string, exigeBaseLiteral: string): string {
  const n = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 400);
  return `${filaId || '-'}|${n(materia)}|${n(exigeBaseLiteral)}`;
}

// ── Compromisos repetidos ─────────────────────────────────────────────────────────────────────
export const MATERIA_LABEL: Record<string, string> = {
  capacitacion: 'Capacitación', despacho: 'Despacho', plazo: 'Plazo', instalacion: 'Instalación', postventa: 'Postventa', garantia: 'Garantía',
  garantia_extendida: 'Garantía extendida', mantencion: 'Mantención', repuestos: 'Repuestos', documentacion: 'Documentación', otro: 'Otro',
};
export const materiaLegible = (m: string): string => MATERIA_LABEL[m] || m.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

const PALABRAS_VACIAS = new Set(['para', 'como', 'desde', 'hasta', 'sobre', 'entre', 'esta', 'este', 'esto', 'esos', 'esas', 'segun', 'donde', 'cuando', 'ser', 'sera', 'debe', 'deben', 'con', 'del', 'los', 'las', 'una', 'uno', 'por', 'que']);
const palabrasDe = (t: string) => new Set(t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 3 && !PALABRAS_VACIAS.has(w)));
const similitud = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n++; return n / (a.size + b.size - n); };

export interface CompromisoParaAgrupar { id: number; filaId: string | null; materia: string; texto: string; /** menor = se prefiere conservarlo (p. ej. el que ya está confirmado) */ prioridad: number }
/** El mismo compromiso detectado varias veces (una por cada corrida del comparador sobre cada opción) con el texto apenas distinto: se queda UNO por grupo.
 *  Mismo ámbito (línea o general) y misma materia, y textos de las bases con bastantes palabras en común (30 %; 50 % si la materia es «otro»). */
export function repetidosDeCompromisos(xs: CompromisoParaAgrupar[]): Array<{ queda: number; sobran: number[] }> {
  const grupos: Array<{ k: string; items: Array<CompromisoParaAgrupar & { w: Set<string> }> }> = [];
  for (const x of [...xs].sort((a, b) => a.prioridad - b.prioridad || a.id - b.id)) {
    const w = palabrasDe(x.texto), k = `${x.filaId ?? ''}|${x.materia}`;
    const umbral = x.materia === 'otro' ? 0.5 : 0.3;   // «otro» mezcla cosas distintas (póliza, seriedad…): ahí se exige más parecido
    const g = grupos.find(g => g.k === k && g.items.some(y => similitud(w, y.w) >= umbral));
    if (g) g.items.push({ ...x, w }); else grupos.push({ k, items: [{ ...x, w }] });
  }
  return grupos.filter(g => g.items.length > 1).map(g => ({ queda: g.items[0].id, sobran: g.items.slice(1).map(i => i.id) }));
}

// ── 3. El candado ────────────────────────────────────────────────────────────────────────────────
export interface CausalPrePost { codigo: string; descripcion: string; rutaDesbloqueo: string }
export interface AlertaPrePost { nivel: 'rojo' | 'amarillo' | 'info'; texto: string; /** cuántas veces se repite el mismo aviso (se muestra una sola vez) */ veces?: number }

export interface EntradaCandado {
  avance: ResultadoAvance;
  certificado: Certificado;
  items: ItemPrePost[];
  /** Líneas ofertadas con opción aprobada cuyo bloque técnico-administrativo todavía no se revisó (número de ítem del costeo). */
  lineasSinRevisar: number[];
}
export interface ResultadoCandado {
  puedeGenerarAnexos: boolean;
  causales: CausalPrePost[];
  alertas: AlertaPrePost[];
  resumen: { confirmados: number; abiertos: number; noAplica: number; total: number };
}

const plural = (n: number, s: string, p: string) => (n === 1 ? s : p);

export function evaluarCandado(e: EntradaCandado): ResultadoCandado {
  const causales: CausalPrePost[] = [], alertas: AlertaPrePost[] = [];
  const vigentes = e.items.filter(itemVigente);
  const abiertos = vigentes.filter(itemAbierto);

  // 1. Toda línea ofertada con su opción aprobada (o NO OFERTADA con motivo). Lo decide evaluarAvance (spec §11.4).
  if (!e.avance.puede) causales.push({
    codigo: 'PREPOST_LINEAS_SIN_APROBAR', descripcion: e.avance.mensaje,
    rutaDesbloqueo: 'Volver al Auditor: aprobar la opción de cada línea ofertada, o marcarla como NO OFERTADA con su motivo.',
  });

  // 2. Certificado de admisibilidad sin causales abiertas.
  const cert = e.certificado;
  if (cert.noCumplidas > 0) causales.push({
    codigo: 'PREPOST_CERTIFICADO_NO_CUMPLE', descripcion: `${cert.noCumplidas} ${plural(cert.noCumplidas, 'causal de inadmisibilidad NO CUMPLE', 'causales de inadmisibilidad NO CUMPLEN')}`,
    rutaDesbloqueo: 'Cambiar el producto de esa línea (vuelve al Auditor) o pedir al proveedor la ficha del modelo que sí cumple.',
  });
  if (cert.pendientes > 0) causales.push({
    codigo: 'PREPOST_CERTIFICADO_PENDIENTE', descripcion: `${cert.pendientes} ${plural(cert.pendientes, 'causal de inadmisibilidad pendiente', 'causales de inadmisibilidad pendientes')} en el certificado de admisibilidad`,
    rutaDesbloqueo: 'Cerrar cada causal con la ruta que indica el certificado (confirmar con el proveedor, correr la segunda pasada o habilitar el dato el Encargado de Mercado Público).',
  });

  // 3. Bloque técnico-administrativo: revisado en todas las líneas y confirmado ítem por ítem.
  if (e.lineasSinRevisar.length) causales.push({
    codigo: 'PREPOST_TECADM_SIN_REVISAR', descripcion: `El bloque técnico-administrativo no se ha revisado en ${plural(e.lineasSinRevisar.length, 'la línea', 'las líneas')} ${e.lineasSinRevisar.join(', ')}`,
    rutaDesbloqueo: 'Apretar «Revisar compromisos» en Pre-postulación para que se armen los ítems a confirmar.',
  });
  if (abiertos.length) causales.push({
    codigo: 'PREPOST_TECADM_SIN_CONFIRMAR', descripcion: `${abiertos.length} ${plural(abiertos.length, 'compromiso técnico-administrativo sin confirmar', 'compromisos técnico-administrativos sin confirmar')}`,
    rutaDesbloqueo: 'Confirmar cada compromiso en Pre-postulación (o marcarlo «No aplica» con su motivo).',
  });

  // Avisos que no bloquean.
  for (const i of vigentes) {
    if (i.origen === 'costo_asociado' && i.costo && i.costo.montoEstimado == null)
      alertas.push({ nivel: 'amarillo', texto: `«${materiaLegible(i.materia)}» tiene costo pero nadie lo estimó en el costeo: el margen real está sobreestimado hasta que se estime.` });
    if (i.cuantificacion && /no cuantificado/i.test(i.cuantificacion))
      alertas.push({ nivel: 'info', texto: `«${materiaLegible(i.materia)}»: las bases no cuantifican el compromiso. Comprométete solo a lo que exigen, sin agregar más (estricta sujeción a las bases).` });
  }
  if (cert.lineas.some(l => l.requiereSegundaPasada))
    alertas.push({ nivel: 'amarillo', texto: 'Hay exigencias que pueden dejarnos fuera declaradas CUMPLE sin segunda pasada: el certificado las deja pendientes hasta releer el documento original.' });

  // El mismo aviso no se repite: se muestra una vez con «×N».
  const unicas = new Map<string, AlertaPrePost>();
  for (const a of alertas) { const u = unicas.get(a.texto); if (u) u.veces = (u.veces ?? 1) + 1; else unicas.set(a.texto, { ...a }); }
  alertas.splice(0, alertas.length, ...unicas.values());

  return {
    puedeGenerarAnexos: causales.length === 0, causales, alertas,
    resumen: { confirmados: vigentes.filter(i => i.confirmado).length, abiertos: abiertos.length, noAplica: vigentes.filter(i => i.noAplica).length, total: vigentes.length },
  };
}

/** Frase corta para el botón «Generar» de los anexos cuando el candado está cerrado. */
export function motivoCandado(r: ResultadoCandado): string {
  return `PRE-POSTULACIÓN: ${r.causales.length} ${plural(r.causales.length, 'pendiente', 'pendientes')} antes de generar anexos — ${r.causales.map(c => c.descripcion).join('; ')}.`;
}
