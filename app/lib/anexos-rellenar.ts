// app/lib/anexos-rellenar.ts
// Frente E.1 — orquestador de alto nivel: junta detección + motor de IA + relleno.
// Expone dos funciones puras (buffer → resultado, sin DB ni R2 — eso vive en anexos-datos.ts):
//
//   analizarAnexoParaUI()  — SOLO LECTURA. Para la pantalla: qué se completaría solo y qué le
//                            falta a un humano (con motivo), con un id ESTABLE por cada
//                            pendiente para que el formulario pueda mandarlo de vuelta en
//                            generarAnexoFinal().
//   generarAnexoFinal()    — aplica el auto-relleno (IA + costeo) MÁS las respuestas del
//                            humano, y devuelve el .docx final.
//
// Como no hay estado entre una llamada HTTP y la otra (analizar y generar son requests
// separados), los ids de los pendientes NO pueden depender del w14:paraId que
// normalizarParaIds() inventa para párrafos que no traían uno — ese id es aleatorio y cambia
// en cada llamada. En cambio, el ÍNDICE de aparición (posición en el documento, calculado por
// simple orden de un regex.matchAll) es determinístico para el mismo documento sin importar
// qué string de paraId le haya tocado esta vez — por eso los ids usan índice, nunca paraId.
//
// Decisión de arquitectura (3-ago-2026): QUÉ valor va en cada casilla lo decide un motor 100%
// IA (ver anexos-ia-motor.ts) — no hay diccionario de regex. Esta capa se limita a juntar los 3
// tipos de candidato detectados (celda, "Etiqueta:" en la misma línea, blanco inline) en una
// sola llamada al motor, y a aplicar por separado lo que NO es "dato de la ficha de empresa":
// precios del Motor Comercial (anexos-precios-ia.ts) y totales por sección
// (anexos-totales-seccion.ts) — eso nunca fue "el diccionario", sigue igual.
import {
  normalizarParaIds, unificarRunsDeMarcadores, rellenarCeldaVacia, rellenarRunPorIndice,
  insertarImagenEnParrafo, rellenarFinDeParrafo, verificarParrafos, abrirDocx, guardarDocx,
  eliminarRespaldoVmlDuplicado, type Parrafo,
} from '@/app/lib/anexos-docx';
import {
  analizarAnexo, extraerTablasCrudo,
  type CandidatoCelda, type CandidatoInline, type TablaCruda, type AvisoNoAplica, type RolFechaTriplete,
} from '@/app/lib/anexos-detectar';
import {
  resolverAnexoConIA, resolverEspecificacionesDesdeBasesConIA,
  type EmpresaCampos, type Resolucion, type AlertaInadmisibilidad,
} from '@/app/lib/anexos-ia-motor';
import { matchearPreciosConIA } from '@/app/lib/anexos-precios-ia';
import { calcularTotalesPorSeccion, calcularTotalesAlPie, resolverTablaResumen, tituloDeTabla, encabezadosLibres, type TituloCercano } from '@/app/lib/anexos-totales-seccion';
import { detectarFormularios, type FormularioDetectado } from '@/app/lib/anexos-dividir';
import { construirDocumentoUI, leerNumeracion, type BloqueUI, type Resuelto } from '@/app/lib/anexos-documento-ui';
import { analizarSeccionesEscaneadas, type SeccionEscaneada } from '@/app/lib/anexos-imagen-escaneada';
import { cargarReglasAprendidasAnexo } from '@/app/lib/anexos-feedback';
import type { ItemCosteoPrecio } from '@/app/lib/motor-comercial';

export type { SeccionEscaneada } from '@/app/lib/anexos-imagen-escaneada';

export type { EmpresaCampos } from '@/app/lib/anexos-ia-motor';

const fmtNumeroCL = (n: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);

export interface CampoCompletado {
  etiqueta: string; campo: string; valor: string; via: 'ia' | 'costeo' | 'bases';
  formulario?: string; // a qué "FORMULARIO N°X" pertenece, para agruparlo igual que los pendientes
  // Índice de párrafo de la celda de origen (candidatosCelda) — no lo usa el modal, solo las
  // herramientas de medición (scripts/anexos-golden.mts) para alinear contra el humano por celda.
  indice?: number;
}
export interface PendienteCelda {
  id: string; etiqueta: string; formulario?: string;
  categoria?: string; motivo?: string;
}
export interface PendienteInline {
  id: string; contexto: string; formulario?: string;
  parrafoCompleto?: string; posEnParrafo?: number; largoBlanco?: number;
  categoria?: string; motivo?: string;
}
export interface SeccionInfo { tipo: string; decision: string; textoEncabezado: string }

// Vista de "tabla real" (ver TablaUI abajo): a diferencia de PendienteCelda (una lista plana de
// "etiqueta: input"), esto reconstruye la tabla del Word tal cual es — todas las columnas, todas
// las filas — para que en pantalla se vea igual que el documento y quede claro a qué celda
// corresponde cada input.
// Un blanco INLINE dentro de una celda con texto propio ("SI ____ NO ____ declaro...", "Plazo de
// entrega" con relleno de puntos al lado) — mismo shape que SegmentoUI en el modal, pero acá vive
// en el backend porque lo arma construirTablaUI, no la réplica de párrafo.
export type SegmentoCeldaUI =
  | { t: 'texto'; v: string }
  | { t: 'auto'; v: string; via: 'ia' | 'costeo' | 'bases'; etiqueta?: string }
  | { t: 'input'; id: string };

export interface CeldaTablaUI {
  texto: string;                                   // texto ya existente en el Word (columna, dato fijo)
  // `etiqueta` — de dónde viene este valor (ver ResolucionMostrada) — viaja hasta el frontend para
  // que el botón "corregir" (ver anexos-feedback.ts) sepa a qué TIPO de casilla enseñarle la regla.
  auto?: { valor: string; via: 'ia' | 'costeo' | 'bases'; etiqueta?: string };   // se completó sola — se muestra el valor, sin input
  input?: { id: string };                          // blanco real pendiente — el mismo id que usa generarAnexoFinal
  // BUG REAL (3713-7-LE26): una celda con texto propio que además trae un blanco INLINE adentro
  // ("SI ____ NO ____ declaro...", "Plazo de entrega ……… días hábiles") nunca calzaba con
  // `indiceGlobal` (la celda no está vacía) — el patrón de tabla la mostraba como texto fijo de
  // solo lectura y el blanco desaparecía de la réplica, aunque el detector SÍ lo hubiera
  // encontrado (blancosInline). Cuando existe, la UI debe pintar ESTO en vez de `texto` plano.
  segmentosInline?: SegmentoCeldaUI[];
}
export interface TablaUI {
  filas: CeldaTablaUI[][]; formulario?: string;
  titulo?: string;
}

// A qué formulario ("FORMULARIO N°X") pertenece un párrafo, si el documento tiene varios
// pegados — mismo detector que usa anexos-dividir.ts para separarlos en archivos.
function formularioDe(indiceParrafo: number, formularios: FormularioDetectado[]): string | undefined {
  return formularios.find(f => indiceParrafo >= f.indiceInicio && indiceParrafo <= f.indiceFin)?.titulo;
}

export interface CampoResuelto {
  c: CandidatoCelda; campo: string; valor: string; via: 'ia' | 'costeo' | 'bases';
  // true si viene de camposConDosPuntos ("Etiqueta:" con el valor en la misma línea) — ese
  // párrafo YA tiene texto (la etiqueta misma), así que se escribe con rellenarFinDeParrafo
  // (agrega al final), nunca con rellenarCeldaVacia (que exige la celda vacía y revienta si no).
  dosPuntos?: boolean;
}

// ── Resolución unificada: celda + "Etiqueta:" + inline en UNA sola llamada al motor ──────────
// Los candidatos de una sección que no corresponde (Persona Natural / UTP, ver
// analisis.indicesSoloManual, detección ESTRUCTURAL — no es "el diccionario") ni siquiera se
// mandan a la IA: van pendientes de una, con motivo fijo, ahorrando la llamada y garantizando
// que nunca se autocompletan por error de juicio del modelo.
const MOTIVO_SOLO_MANUAL = 'Bloque de Persona Natural o UTP — no aplica (esta empresa postula como persona jurídica individual).';

interface ResultadoResolucion {
  matcheados: CampoResuelto[];
  pendientes: CandidatoCelda[];
  pendientesConMotivo: Map<number, { categoria: string; motivo: string }>;
  inlineAuto: { b: CandidatoInline; valor: string; etiqueta: string; via: 'ia' | 'bases' }[];
  inlinePendientes: { b: CandidatoInline; categoria: string; motivo: string }[];
  alertasInadmisibilidad: AlertaInadmisibilidad[];
  checklistPendientes: string[];
}

// Anexo que el documento declara que NO nos corresponde presentar (ver detectarAvisoNoAplica):
// no se llama a la IA y NADA se autocompleta. Todo queda como pendiente editable con el motivo a
// la vista, para que igual se pueda llenar a mano si la situación cambia (ej. sí se postula en UTP,
// que es lo que habilita el interruptor de la pantalla).
function todoPendientePorNoAplicar(
  candidatosCelda: CandidatoCelda[], blancosInline: CandidatoInline[], motivo: string,
): ResultadoResolucion {
  return {
    matcheados: [],
    pendientes: candidatosCelda,
    pendientesConMotivo: new Map(candidatosCelda.map(c => [c.indice, { categoria: 'no_aplica_al_oferente', motivo }])),
    inlineAuto: [],
    inlinePendientes: blancosInline.map(b => ({ b, categoria: 'no_aplica_al_oferente', motivo })),
    alertasInadmisibilidad: [],
    checklistPendientes: [],
  };
}

// Valor de una casilla de fecha partida — ver detectarTripletesFecha en anexos-detectar.ts. Nunca
// pasa por la IA: es siempre la fecha de hoy, en el mismo orden, sin excepción.
function valorTripleteFecha(rol: RolFechaTriplete, empresa: EmpresaCampos): string | null {
  const valor = rol === 'dia' ? empresa.fecha_hoy_dia
    : rol === 'mes_numero' ? empresa.fecha_hoy_mes
    : rol === 'mes_palabra' ? empresa.fecha_hoy_mes_palabra
    : empresa.fecha_hoy_anio;
  return valor && String(valor).trim() ? String(valor) : null;
}

// ¿El motor reconoció que esta casilla pide un dato concreto (de la ficha, de la licitación o de
// la oferta) aunque no haya podido completarlo? Solo esas merecen mostrarse como pendiente cuando
// vienen del patrón 5 — ver el uso más abajo.
const CATEGORIAS_QUE_PIDEN_UN_DATO = new Set([
  'perfil_empresa', 'perfil_representante_legal', 'perfil_contacto', 'perfil_bancario',
  'datos_licitacion', 'especifico_licitacion',
]);
function esPendienteQueSiPideUnDato(res: Resolucion | undefined): boolean {
  return res?.tipo === 'pendiente' && CATEGORIAS_QUE_PIDEN_UN_DATO.has(res.categoria);
}

async function resolverTodo(
  candidatosCelda: CandidatoCelda[],
  camposConDosPuntos: CandidatoCelda[],
  blancosInline: CandidatoInline[],
  empresa: EmpresaCampos,
  soloManual: Set<number> | undefined,
  parrafos: Parrafo[],
  itemsCosteo: ItemCosteoPrecio[] | undefined,
  basesTexto: string | undefined,
  tituloAnexos: string[] | undefined,
  postulaComoUTP: boolean,
  tripletesFecha: Map<string, RolFechaTriplete>,
  alternativasExcluyentes: Set<string>,
): Promise<ResultadoResolucion> {
  const elegibles = candidatosCelda.filter(c => !soloManual?.has(c.indice));
  const soloManualCandidatos = candidatosCelda.filter(c => soloManual?.has(c.indice));
  const indicesDosPuntos = new Set(camposConDosPuntos.map(c => c.indice));

  // Fecha partida en 3 casillas ("Fecha: __/__/__" o "___ de ___ de ___"): la respuesta NUNCA
  // depende del documento (es la fecha de hoy, mismo orden siempre), así que se resuelve acá y
  // esos blancos ni siquiera se le mandan a la IA — bug real corregido (608-156-LP26): con 5
  // ocurrencias casi idénticas del mismo párrafo en un documento, el motor mezclaba el valor del
  // día en la casilla del mes en una de las cinco, y escribía el mes en NÚMERO donde el formato
  // pide la palabra ("agosto"). Si por algo el valor no está disponible (defensivo, no debería
  // pasar: conCamposDerivados siempre los calcula), cae al camino normal — mejor pendiente que nada.
  //
  // Alternativa excluyente en prosa ("___registra..." / "___no registra...", ver
  // detectarAlternativasExcluyentes): tampoco se le manda a la IA — no es un dato de la ficha, es
  // una decisión del oferente, y dejarla a la IA daba un resultado distinto según qué otros
  // candidatos le tocaran de vecinos en el lote (bug real 4999-8-LE26). Va derecho a pendiente.
  const inlineFecha: { b: CandidatoInline; valor: string }[] = [];
  const inlineAlternativa: CandidatoInline[] = [];
  const blancosParaIA: CandidatoInline[] = [];
  for (const b of blancosInline) {
    const rol = tripletesFecha.get(`${b.indiceRun}:${b.posEnTexto}`);
    const valor = rol ? valorTripleteFecha(rol, empresa) : null;
    if (rol && valor) inlineFecha.push({ b, valor });
    else if (alternativasExcluyentes.has(`${b.indiceRun}:${b.posEnTexto}`)) inlineAlternativa.push(b);
    else blancosParaIA.push(b);
  }

  // Reglas del feedback loop (ver anexos-feedback.ts): correcciones que el usuario ya hizo antes
  // sobre casillas parecidas, por TIPO de etiqueta. Resiliente — si falla la consulta, el análisis
  // sigue igual sin reglas (nunca bloquea el relleno).
  const reglasAprendidas = await cargarReglasAprendidasAnexo().catch(() => []);

  const { celda, inline, alertasInadmisibilidad, checklistPendientes } = await resolverAnexoConIA({
    candidatos: [...elegibles, ...camposConDosPuntos],
    blancosInline: blancosParaIA,
    parrafos,
    empresa,
    basesTexto,
    tituloAnexos,
    postulaComoUTP,
    reglasAprendidas,
  });

  const matcheados: CampoResuelto[] = [];
  const pendientes: CandidatoCelda[] = [];
  const pendientesConMotivo = new Map<number, { categoria: string; motivo: string }>();

  for (const c of soloManualCandidatos) {
    pendientes.push(c);
    pendientesConMotivo.set(c.indice, { categoria: 'no_aplica_al_oferente', motivo: MOTIVO_SOLO_MANUAL });
  }

  for (const c of [...elegibles, ...camposConDosPuntos]) {
    const res = celda.get(c.indice);
    // `c.dosPuntos` cubre el caso NUEVO (celda de tabla con solo un prefijo de moneda, "$" — ver
    // detectarCandidatosTabla): a diferencia del patrón 5 clásico (título terminado en ":",
    // indicesDosPuntos), este SÍ debe seguir alimentando `pendientes` si la IA no lo resuelve —
    // por eso el chequeo de abajo sigue siendo solo `indicesDosPuntos`, nunca `c.dosPuntos`.
    if (res?.tipo === 'auto') {
      matcheados.push({ c, campo: res.categoria, valor: res.valor, via: 'ia', dosPuntos: c.dosPuntos || indicesDosPuntos.has(c.indice) });
    } else if (!indicesDosPuntos.has(c.indice) || esPendienteQueSiPideUnDato(res)) {
      // "Etiqueta:" (patrón 5) casi nunca alimenta la lista de pendientes — ver el comentario de
      // detectarCamposConDosPuntos en anexos-detectar.ts: muchos títulos terminan en dos puntos y
      // mostrarlos todos llenaría la pantalla de campos que no existen.
      //
      // La excepción (6-ago-2026) es la que hacía DESAPARECER campos reales: cuando el motor sí
      // reconoció que la casilla pide un dato de la ficha o de la licitación pero no pudo
      // completarlo, descartarla en silencio deja el documento incompleto sin que nadie se entere.
      // Caso real 1227338-6-LE26: de los seis "RUT:" al pie de firma, uno quedó sin resolver y
      // simplemente no existió — ni relleno ni casilla donde escribirlo. Los títulos siguen fuera:
      // esos el motor los clasifica como no_aplica_al_oferente / firma_fecha, que no entran acá.
      // `dosPuntos` viaja con el pendiente para que, si el humano lo escribe, el valor se agregue al
      // FINAL del párrafo ("RUT: 6.736.698-0") en vez de intentar rellenar una celda vacía que no
      // existe — rellenarCeldaVacia revienta si encuentra texto donde esperaba una celda libre.
      pendientes.push(indicesDosPuntos.has(c.indice) ? { ...c, dosPuntos: true } : c);
      if (res?.tipo === 'pendiente') pendientesConMotivo.set(c.indice, { categoria: res.categoria, motivo: res.motivo });
    }
  }

  // Precios del Motor Comercial: no es un dato de la ficha de empresa, sale del .xlsx del
  // costeo (ver anexos-precios-ia.ts) — se cruza sobre lo que el motor dejó pendiente.
  let pendientesTrasPrecio = pendientes;
  if (itemsCosteo && itemsCosteo.length > 0) {
    const matchesPrecio = await matchearPreciosConIA(pendientes.map(c => c.etiqueta), itemsCosteo);
    const mapaPrecio = new Map(matchesPrecio.map(m => [m.etiqueta, m]));
    pendientesTrasPrecio = [];
    for (const c of pendientes) {
      const m = mapaPrecio.get(c.etiqueta);
      if (m) { matcheados.push({ c, campo: 'precio_unitario_costeo', valor: fmtNumeroCL(m.precioUnitario), via: 'costeo' }); pendientesConMotivo.delete(c.indice); }
      else pendientesTrasPrecio.push(c);
    }
  }

  const inlineAuto: { b: CandidatoInline; valor: string; etiqueta: string; via: 'ia' | 'bases' }[] = [];
  const inlinePendientes: { b: CandidatoInline; categoria: string; motivo: string }[] = [];
  for (const { b, valor } of inlineFecha) {
    inlineAuto.push({ b, valor, etiqueta: (b.contexto || '').replace(/\s*:\s*$/, ''), via: 'ia' });
  }
  for (const b of inlineAlternativa) {
    inlinePendientes.push({
      b, categoria: 'decision_del_usuario',
      motivo: 'Hay que marcar cuál de las dos alternativas aplica — es una decisión del oferente, no un dato de la ficha.',
    });
  }
  for (const b of blancosParaIA) {
    const res = inline.get(`${b.indiceRun}:${b.posEnTexto}`);
    if (res?.tipo === 'auto') inlineAuto.push({ b, valor: res.valor, etiqueta: (b.contexto || '').replace(/\s*:\s*$/, ''), via: 'ia' });
    else if (res?.tipo === 'pendiente') inlinePendientes.push({ b, categoria: res.categoria, motivo: res.motivo });
    else inlinePendientes.push({ b, categoria: 'decision_del_usuario', motivo: 'No se pudo clasificar automáticamente esta casilla.' });
  }

  // Segunda oportunidad para lo que quedó pendiente con categoría "especifico_licitacion"
  // (cantidad, plazo, especificación exigida): puede que las BASES lo digan literal, aunque la
  // ficha de empresa no lo tenga (ver resolverEspecificacionesDesdeBasesConIA). Ninguna otra
  // categoría entra acá — firma/tercero/no_aplica/decisión del usuario nunca los responde un
  // texto de bases, así que ni se intenta (ahorra la llamada).
  let pendientesFinal = pendientesTrasPrecio;
  let inlinePendientesFinal = inlinePendientes;
  if (basesTexto && basesTexto.trim()) {
    const celdaEspecifico = pendientesTrasPrecio.filter(c => pendientesConMotivo.get(c.indice)?.categoria === 'especifico_licitacion');
    const inlineEspecifico = inlinePendientes.filter(p => p.categoria === 'especifico_licitacion').map(p => p.b);
    if (celdaEspecifico.length || inlineEspecifico.length) {
      const desdeBases = await resolverEspecificacionesDesdeBasesConIA(celdaEspecifico, inlineEspecifico, parrafos, basesTexto);
      pendientesFinal = [];
      for (const c of pendientesTrasPrecio) {
        const res = desdeBases.celda.get(c.indice);
        if (res?.tipo === 'auto') { matcheados.push({ c, campo: res.categoria, valor: res.valor, via: 'bases' }); pendientesConMotivo.delete(c.indice); }
        else pendientesFinal.push(c);
      }
      inlinePendientesFinal = [];
      for (const p of inlinePendientes) {
        const res = desdeBases.inline.get(`${p.b.indiceRun}:${p.b.posEnTexto}`);
        if (res?.tipo === 'auto') inlineAuto.push({ b: p.b, valor: res.valor, etiqueta: (p.b.contexto || '').replace(/\s*:\s*$/, ''), via: 'bases' });
        else inlinePendientesFinal.push(p);
      }
    }
  }

  return {
    matcheados, pendientes: pendientesFinal, pendientesConMotivo, inlineAuto,
    inlinePendientes: inlinePendientesFinal, alertasInadmisibilidad, checklistPendientes,
  };
}

// ── Totales por sección (LÍNEA/LOTE/ÍTEM...) — ver anexos-totales-seccion.ts ─────────────────
function aplicarTotalesPorSeccion(
  tablasCrudo: TablaCruda[], parrafos: Parrafo[], indicesEnTablas: Set<number>,
  matcheados: CampoResuelto[], pendientes: CandidatoCelda[], respuestas?: Record<string, string>,
): { matcheadosExtra: CampoResuelto[]; pendientesFiltrados: CandidatoCelda[]; anexarDirecto: { paraId: string; valor: string }[]; titulos: TituloCercano[] } {
  const titulos: TituloCercano[] = encabezadosLibres(parrafos, indicesEnTablas);
  const valoresPrecio = new Map(
    matcheados.filter(m => m.via === 'costeo').map(m => [m.c.indice, Number(m.valor.replace(/\./g, '').replace(',', '.'))]),
  );
  const valorResuelto = (i: number): number | null => {
    const deCosteo = valoresPrecio.get(i);
    if (deCosteo != null) return deCosteo;
    const escrito = respuestas?.[`celda:${i}`];
    if (!escrito || !escrito.trim()) return null;
    const n = Number(escrito.replace(/\./g, '').replace(',', '.').trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const totalesSeccion = calcularTotalesPorSeccion(tablasCrudo, titulos, valorResuelto);
  const rellenos = resolverTablaResumen(tablasCrudo, totalesSeccion);

  const matcheadosExtra: CampoResuelto[] = [];

  const anexarDirecto: { paraId: string; valor: string }[] = [];
  const paraIdsResueltos = new Set<string>();

  // TOTAL NETO / IVA / TOTAL IVA INCLUIDO al pie de la MISMA tabla de precios (539119-76-LP26) —
  // ver calcularTotalesAlPie. Son celdas distintas de las de la tabla resumen de abajo, pero la
  // deduplicación por paraId vale igual: una celda se escribe UNA vez o no se escribe.
  for (const r of calcularTotalesAlPie(tablasCrudo, valorResuelto)) {
    paraIdsResueltos.add(r.paraId);
    matcheadosExtra.push({
      c: { etiqueta: r.etiqueta, paraId: r.paraId, indice: r.indiceGlobal },
      campo: 'total_calculado', valor: r.valor, via: 'costeo',
    });
  }

  for (const r of rellenos) {
    if (paraIdsResueltos.has(r.paraId)) continue;
    if (r.anexar) {
      anexarDirecto.push({ paraId: r.paraId, valor: r.valor });
    } else if (r.indiceGlobal != null) {
      paraIdsResueltos.add(r.paraId);
      matcheadosExtra.push({
        c: { etiqueta: 'Monto total de la sección', paraId: r.paraId, indice: r.indiceGlobal },
        campo: 'monto_total_seccion', valor: r.valor, via: 'costeo',
      });
    }
  }
  const pendientesFiltrados = pendientes.filter(c => !paraIdsResueltos.has(c.paraId));
  return { matcheadosExtra, pendientesFiltrados, anexarDirecto, titulos };
}

// Descarga una imagen de identidad de la empresa (firma escaneada o timbre) desde su URL pública
// (R2) y detecta su extensión real por Content-Type. null si falla o no hay nada cargado.
async function descargarFirma(firmaUrl: string): Promise<{ buffer: Buffer; extension: string } | null> {
  try {
    const res = await fetch(firmaUrl);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || '';
    const extension = /png/i.test(contentType) ? 'png'
      : /jpe?g/i.test(contentType) ? 'jpg'
      : (firmaUrl.split('.').pop() || 'png').split('?')[0].toLowerCase();
    return { buffer, extension };
  } catch {
    return null;
  }
}

export interface FirmaInfo {
  detectada: boolean; disponible: boolean;
  // Igual que los dos de arriba pero para el TIMBRE: `timbreDetectado` = alguna leyenda del
  // documento dice "FIRMA Y TIMBRE"; `timbreDisponible` = la ficha de la empresa tiene un timbre
  // cargado. La combinación detectado && !disponible es la que el modal avisa — era exactamente la
  // duda del usuario ("no sé si el timbre lo tengo cargado a la empresa").
  timbreDetectado: boolean; timbreDisponible: boolean;
  // URLs de las imágenes, para que el modal muestre la miniatura de CADA una: el usuario pidió
  // "poder ver cuál de las dos" antes de generar.
  firmaUrl: string | null; timbreUrl: string | null;
  // Un lugar por cada bloque de firma detectado en el documento, con la leyenda real ("FIRMA Y
  // TIMBRE REPRESENTANTE LEGAL") para que se sepa cuál es cuál. El modal manda de vuelta, por cada
  // uno, qué estampar y con qué alineación — ver LugarFirma y las claves `firma:N` / `firmaPos:N`.
  lugares: LugarFirmaUI[];
}

// `id` es el índice de párrafo, igual que el resto de los ids del modal (ver el comentario de
// arriba del archivo sobre por qué NUNCA se usa el paraId, que es aleatorio en cada llamada).
// `porDefecto` lo calcula el BACKEND y la pantalla solo lo muestra — así lo que se ve marcado es
// exactamente lo que va a pasar si el usuario no toca nada, sin que la UI tenga que reimplementar
// la regla (que es justo como se desincronizó la vista previa de los marcadores).
export interface LugarFirmaUI { id: string; contexto: string; pideTimbre: boolean; porDefecto: QueEstampar }

export type QueEstampar = 'ambas' | 'firma' | 'timbre' | 'ninguna';
export type PosicionFirma = 'izquierda' | 'centro' | 'derecha';

// Qué se estampa por defecto en un lugar: lo que la leyenda pide y la empresa tiene. Es la misma
// decisión que tomaba el generador antes de que esto fuera configurable, así que no cambia el
// resultado de nadie que no toque los controles.
function porDefectoEnLugar(pideTimbre: boolean, hayFirma: boolean, hayTimbre: boolean, aplica = true): QueEstampar {
  // Un anexo que el propio documento dice que no debemos presentar no se firma solo. Antes se
  // firmaba y se timbraba igual, y ese era el detalle que hacía parecer un error de relleno lo que
  // en realidad era "este anexo no va" — ver detectarAvisoNoAplica en anexos-detectar.ts.
  if (!aplica) return 'ninguna';
  const timbre = pideTimbre && hayTimbre;
  if (hayFirma && timbre) return 'ambas';
  if (hayFirma) return 'firma';
  if (timbre) return 'timbre';
  return 'ninguna';
}

// Arma la vista de UNA tabla (todas sus filas/columnas, no solo las vacías) — la usan tanto
// `tablas` (lista plana filtrada, para las herramientas de medición) como `tablasPorIndice` (sin
// filtrar, para que la réplica del documento muestre también las tablas que no tienen blancos).
// Arma los segmentos de una celda con blancos INLINE adentro (ver SegmentoCeldaUI) — mismo
// criterio de corte que la réplica de párrafo (construirDocumentoUI): recorre los párrafos de la
// celda EN ORDEN, ubica cada blanco por su posición dentro del párrafo (posEnParrafo/largo, que
// ya calculó detectarBlancosInline) y lo resuelve contra `porBlancoInline` — la MISMA clave
// `${indiceRun}:${posEnTexto}` que usa el resto del pipeline, así nunca puede desalinearse.
// Devuelve null si ninguno de los párrafos de la celda tiene un blanco (caso normal: la celda
// sigue mostrándose como `texto` plano, sin cambiar nada de lo que ya funcionaba).
function segmentosDeCelda(
  indicesParrafos: number[], blancosPorParrafo: Map<number, CandidatoInline[]>,
  porBlancoInline: Map<string, Resuelto>, parrafos: Parrafo[],
): SegmentoCeldaUI[] | null {
  const conBlancos = indicesParrafos.filter(i => (blancosPorParrafo.get(i)?.length ?? 0) > 0);
  if (!conBlancos.length) return null;

  const segmentos: SegmentoCeldaUI[] = [];
  indicesParrafos.forEach((indice, i) => {
    if (i > 0) segmentos.push({ t: 'texto', v: ' ' }); // mismo separador que usaba el texto plano (join(' '))
    const textoParrafo = parrafos[indice]?.texto ?? '';
    const blancos = [...(blancosPorParrafo.get(indice) ?? [])].sort((a, b) => a.posEnParrafo - b.posEnParrafo);
    let cursor = 0;
    for (const b of blancos) {
      const res = porBlancoInline.get(`${b.indiceRun}:${b.posEnTexto}`);
      if (!res) continue; // no debería pasar (todo blanco termina auto o pendiente) — defensivo
      if (b.posEnParrafo > cursor) segmentos.push({ t: 'texto', v: textoParrafo.slice(cursor, b.posEnParrafo) });
      segmentos.push(res.tipo === 'auto' ? { t: 'auto', v: res.valor, via: res.via, etiqueta: res.etiqueta } : { t: 'input', id: res.id });
      cursor = b.posEnParrafo + b.largo;
    }
    if (cursor < textoParrafo.length) segmentos.push({ t: 'texto', v: textoParrafo.slice(cursor) });
  });
  return segmentos;
}

function construirTablaUI(
  t: TablaCruda, formularios: FormularioDetectado[], titulos: TituloCercano[],
  resolucionPorIndice: Map<number, ResolucionMostrada>, rellenosPorParaId: Map<string, { paraId: string; valor: string }>,
  blancosPorParrafo: Map<number, CandidatoInline[]>, porBlancoInline: Map<string, Resuelto>, parrafos: Parrafo[],
): TablaUI {
  return {
    formulario: t.indicePrimero != null ? formularioDe(t.indicePrimero, formularios) : undefined,
    titulo: tituloDeTabla(t.indicePrimero, titulos)?.texto,
    filas: t.filas.map(f => f.celdas.map((c): CeldaTablaUI => {
      const relleno = c.ultimoParaId ? rellenosPorParaId.get(c.ultimoParaId) : undefined;
      if (relleno) return { texto: c.texto, auto: { valor: `${c.texto ? c.texto + ' ' : ''}${relleno.valor}`, via: 'costeo' } };
      if (c.indiceGlobal == null) {
        const segmentosInline = segmentosDeCelda(c.indicesParrafos, blancosPorParrafo, porBlancoInline, parrafos);
        return segmentosInline ? { texto: c.texto, segmentosInline } : { texto: c.texto };
      }
      const res = resolucionPorIndice.get(c.indiceGlobal);
      if (!res) {
        const segmentosInline = segmentosDeCelda(c.indicesParrafos, blancosPorParrafo, porBlancoInline, parrafos);
        return segmentosInline ? { texto: c.texto, segmentosInline } : { texto: c.texto };
      }
      // `c.texto` sigue siendo '' para una celda realmente vacía (sin cambio de comportamiento) —
      // pero conserva el prefijo de moneda ("$") en una celda dosPuntos, que si no desaparecía de
      // la vista aunque el .docx generado sí lo mantuviera (ver detectarCandidatosTabla).
      if (res.tipo === 'auto') return { texto: c.texto, auto: { valor: res.valor, via: res.via, etiqueta: res.etiqueta } };
      return { texto: c.texto, input: { id: res.id } };
    })),
  };
}

export interface AnalisisAnexo {
  completadosAuto: CampoCompletado[];
  pendientesCelda: PendienteCelda[];
  pendientesInline: PendienteInline[];
  tablas: TablaUI[];
  // El documento COMPLETO en orden, listo para dibujarse como una copia del Word en pantalla
  // (ver anexos-documento-ui.ts). Es lo que realmente se muestra: `completadosAuto`/`pendientes*`
  // quedan como resumen/contadores y para las herramientas de medición (scripts/anexos-golden).
  documento: BloqueUI<TablaUI>[];
  secciones: SeccionInfo[];
  firma: FirmaInfo;
  ordenFormularios: string[];
  alertasInadmisibilidad: AlertaInadmisibilidad[];
  checklistPendientes: string[];
  // El propio documento dice que este anexo no nos corresponde (ver detectarAvisoNoAplica). Cuando
  // viene, NADA se autocompletó: la pantalla lo avisa y ofrece el interruptor "sí nos corresponde".
  avisoNoAplica: AvisoNoAplica | null;
  // Secciones pegadas como FOTO/ESCANEO (ver anexos-imagen-escaneada.ts) — nunca se autocompletan
  // (no se puede editar una imagen), pero se le muestra al usuario qué piden y con qué dato de su
  // ficha las llenaría a mano. Vacío si el documento no tiene ninguna imagen sustancial.
  seccionesEscaneadas: SeccionEscaneada[];
}

type ResolucionMostrada =
  | { tipo: 'auto'; etiqueta: string; campo: string; valor: string; via: 'ia' | 'costeo' | 'bases' }
  | { tipo: 'pendiente'; etiqueta: string; id: string };

export async function analizarAnexoParaUI(
  bufferOriginal: Buffer, empresa: EmpresaCampos, itemsCosteo?: ItemCosteoPrecio[], basesTexto?: string,
  // El usuario dijo explícitamente "sí, este anexo nos corresponde" (ej. esta vez SÍ postulamos en
  // UTP) — se ignora el aviso del documento y se autocompleta normal.
  forzarAplica = false,
): Promise<AnalisisAnexo> {
  const { zip, xml: xmlCrudoSinNormalizar } = await abrirDocx(bufferOriginal);
  // eliminarRespaldoVmlDuplicado va PRIMERO, antes que nada más — ver su comentario en
  // anexos-docx.ts. Redefine qué cuenta como "el original" para las DOS rutas por igual, así que
  // xmlCrudo (el que compara verificarParrafos) ya nace sin el duplicado.
  const xmlCrudo = eliminarRespaldoVmlDuplicado(xmlCrudoSinNormalizar);
  // unificarRunsDeMarcadores va SIEMPRE junto a normalizarParaIds y en las DOS rutas (analizar y
  // generar): junta en un solo <w:t> los marcadores "<<NOMBRE …>>" que Word dejó partidos entre
  // runs, sin cambiar el conteo de párrafos ni de runs — ver su comentario en anexos-docx.ts. Si
  // una de las dos rutas se lo saltara, los ids de los pendientes (que son índices de aparición) no
  // calzarían entre el análisis y la generación.
  const { xml: xmlConIds } = normalizarParaIds(xmlCrudo);
  const xmlNormalizado = unificarRunsDeMarcadores(xmlConIds);
  const analisis = analizarAnexo(xmlNormalizado, { postulaComoUTP: forzarAplica });
  const formularios = detectarFormularios(xmlNormalizado);
  const numeracion = await leerNumeracion(zip);

  const tablasCrudo = extraerTablasCrudo(xmlNormalizado);
  const indicesEnTablas = new Set(
    tablasCrudo.flatMap(t => t.filas.flatMap(f => f.celdas.map(c => c.indiceGlobal).filter((i): i is number => i != null))),
  );
  const completadosAuto: CampoCompletado[] = [];
  const resolucionPorIndice = new Map<number, ResolucionMostrada>();

  const avisoNoAplica = forzarAplica ? null : analisis.avisoNoAplica;
  // Las secciones-imagen se analizan EN PARALELO con la resolución normal (extracción+OCR+IA
  // corren aparte, no comparten nada con el resto del pipeline) — ahorra el tiempo de espera de
  // uno detrás del otro. Nunca puede fallar el análisis completo: si algo revienta ahí, el resto
  // del anexo sigue funcionando igual (ver el try/catch adentro de analizarSeccionesEscaneadas).
  const [resolucion, seccionesEscaneadas] = await Promise.all([
    avisoNoAplica
      ? Promise.resolve(todoPendientePorNoAplicar(analisis.candidatosCelda, analisis.blancosInline, avisoNoAplica.motivo))
      : resolverTodo(
        analisis.candidatosCelda, analisis.camposConDosPuntos, analisis.blancosInline,
        empresa, analisis.indicesSoloManual, analisis.parrafos, itemsCosteo, basesTexto,
        formularios.map(f => f.titulo), forzarAplica, analisis.tripletesFecha, analisis.alternativasExcluyentes,
      ),
    analizarSeccionesEscaneadas(zip, xmlNormalizado, empresa).catch(e => {
      console.error('[anexos-rellenar] Falló el análisis de secciones escaneadas, se omite sin bloquear el resto:', String(e).slice(0, 200));
      return [];
    }),
  ]);
  const {
    matcheados, pendientes, pendientesConMotivo, inlineAuto, inlinePendientes,
    alertasInadmisibilidad, checklistPendientes,
  } = resolucion;
  const { matcheadosExtra, pendientesFiltrados, anexarDirecto, titulos }
    = aplicarTotalesPorSeccion(tablasCrudo, analisis.parrafos, indicesEnTablas, matcheados, pendientes);
  const matcheadosTodos = [...matcheados, ...matcheadosExtra];
  for (const m of matcheadosTodos) {
    completadosAuto.push({
      etiqueta: m.c.etiqueta, campo: m.campo, valor: m.valor, via: m.via,
      formulario: formularioDe(m.c.indice, formularios), indice: m.c.indice,
    });
    resolucionPorIndice.set(m.c.indice, { tipo: 'auto', etiqueta: m.c.etiqueta, campo: m.campo, valor: m.valor, via: m.via });
  }

  const pendientesCeldaTodos: PendienteCelda[] = pendientesFiltrados.map(c => {
    const id = `celda:${c.indice}`;
    resolucionPorIndice.set(c.indice, { tipo: 'pendiente', etiqueta: c.etiqueta, id });
    const motivo = pendientesConMotivo.get(c.indice);
    return { id, etiqueta: c.etiqueta, formulario: formularioDe(c.indice, formularios), categoria: motivo?.categoria, motivo: motivo?.motivo };
  });

  // Se arma ACÁ (antes de las tablas) porque construirTablaUI ahora también lo necesita — una
  // celda con texto propio puede traer un blanco inline adentro (ver segmentosDeCelda arriba).
  const porBlancoInline = new Map<string, Resuelto>();
  for (const a of inlineAuto) {
    porBlancoInline.set(`${a.b.indiceRun}:${a.b.posEnTexto}`, { tipo: 'auto', valor: a.valor, via: a.via, etiqueta: a.etiqueta });
  }
  for (const { b } of inlinePendientes) {
    porBlancoInline.set(`${b.indiceRun}:${b.posEnTexto}`, { tipo: 'pendiente', id: `inline:${b.indiceRun}:${b.posEnTexto}` });
  }
  const blancosPorParrafo = new Map<number, CandidatoInline[]>();
  for (const b of analisis.blancosInline) {
    if (!blancosPorParrafo.has(b.indiceParrafo)) blancosPorParrafo.set(b.indiceParrafo, []);
    blancosPorParrafo.get(b.indiceParrafo)!.push(b);
  }

  // Reconstruye cada tabla del Word COMPLETA (todas las celdas, no solo las vacías). `tablasPorIndice`
  // queda SIN filtrar (todas, incluidas las que no tienen ningún blanco) porque la réplica del
  // documento (`documento`, ver más abajo) necesita mostrarlas igual que en el Word aunque no haya
  // nada que llenar en ellas; `tablas` sigue filtrada (solo las que tienen algo por completar) para
  // las herramientas de medición (scripts/anexos-golden) que ya dependían de ese recorte.
  const rellenosPorParaId = new Map(anexarDirecto.map(r => [r.paraId, r]));
  const tablasUI = tablasCrudo.map(t => ({
    t, ui: construirTablaUI(t, formularios, titulos, resolucionPorIndice, rellenosPorParaId, blancosPorParrafo, porBlancoInline, analisis.parrafos),
  }));
  const tablasPorIndice = new Map<number, TablaUI>();
  for (const { t, ui } of tablasUI) {
    if (t.indicePrimero != null) tablasPorIndice.set(t.indicePrimero, ui);
  }
  const tablas: TablaUI[] = tablasUI.map(({ ui }) => ui).filter(t => t.filas.some(f => f.some(c => c.input || c.auto)));

  const pendientesCelda = pendientesCeldaTodos.filter(p => {
    const indice = Number(p.id.split(':')[1]);
    return !indicesEnTablas.has(indice);
  });

  for (const a of inlineAuto) {
    completadosAuto.push({
      etiqueta: a.etiqueta, campo: 'perfil', valor: a.valor, via: a.via,
      formulario: formularioDe(a.b.indiceParrafo, formularios), indice: a.b.indiceParrafo,
    });
  }
  const pendientesInline: PendienteInline[] = inlinePendientes.map(({ b, categoria, motivo }) => ({
    id: `inline:${b.indiceRun}:${b.posEnTexto}`,
    contexto: b.contexto || '(sin contexto)',
    formulario: formularioDe(b.indiceParrafo, formularios),
    parrafoCompleto: b.parrafoCompleto,
    posEnParrafo: b.posEnParrafo,
    largoBlanco: b.largo,
    categoria, motivo,
  }));

  const firma: FirmaInfo = {
    detectada: analisis.lineasFirma.length > 0,
    disponible: !!empresa.firma_url,
    timbreDetectado: analisis.lineasFirma.some(l => l.pideTimbre),
    timbreDisponible: !!empresa.timbre_url,
    firmaUrl: empresa.firma_url || null,
    timbreUrl: empresa.timbre_url || null,
    lugares: analisis.lineasFirma.map(l => ({
      id: `firma:${l.indice}`,
      contexto: l.contexto,
      pideTimbre: !!l.pideTimbre,
      porDefecto: porDefectoEnLugar(!!l.pideTimbre, !!empresa.firma_url, !!empresa.timbre_url, !avisoNoAplica),
    })),
  };
  if (!avisoNoAplica && firma.detectada && firma.disponible) {
    completadosAuto.push({ etiqueta: 'Firma', campo: 'firma_url', valor: '(imagen de la firma guardada)', via: 'ia' });
  }
  if (!avisoNoAplica && firma.timbreDetectado && firma.timbreDisponible) {
    completadosAuto.push({ etiqueta: 'Timbre', campo: 'timbre_url', valor: '(imagen del timbre guardado)', via: 'ia' });
  }

  // Mismo criterio que pendientesCelda unas líneas arriba: lo que ya se muestra DENTRO de una
  // celda de tabla (ver `tablas`, vista réplica) no se repite además en la lista/grilla de "se
  // completó solo" — antes de que las tablas de formulario (DATOS DEL PROPONENTE...) se mostraran
  // como tabla, este filtro no hacía falta porque esos campos NUNCA aparecían en `tablas` (bug
  // corregido en indiceFilaEncabezado); ahora que sí aparecen, sin este filtro cada campo salía
  // duplicado: una vez adentro de la tabla, otra vez como tarjeta suelta más abajo.
  const completadosAutoFinal = completadosAuto.filter(c => c.indice == null || !indicesEnTablas.has(c.indice));

  // La réplica del documento (ver anexos-documento-ui.ts): un `Resuelto` por cada blanco YA
  // resuelto, en las dos formas en que puede estar — por PÁRRAFO (`resolucionPorIndice`, mismo
  // mapa que arma las tablas de arriba) y por BLANCO INLINE (`porBlancoInline`, armado más arriba
  // porque las tablas también lo necesitan). Los índices que caen DENTRO de una tabla no hacen
  // daño acá: `construirDocumentoUI` nunca los consulta porque una tabla se dibuja entera a
  // través de `tablasPorIndice`, no párrafo por párrafo.
  const porParrafo = new Map<number, Resuelto>();
  for (const [indice, res] of resolucionPorIndice) {
    porParrafo.set(indice, res.tipo === 'auto'
      ? { tipo: 'auto', valor: res.valor, via: res.via, etiqueta: res.etiqueta }
      : { tipo: 'pendiente', id: res.id });
  }
  const documento = construirDocumentoUI({
    xml: xmlNormalizado, porParrafo, porBlancoInline, tablasPorIndice, numeracion,
  });

  return {
    completadosAuto: completadosAutoFinal,
    pendientesCelda,
    pendientesInline,
    tablas,
    documento,
    secciones: analisis.secciones.map(s => ({ tipo: s.tipo, decision: s.decision, textoEncabezado: s.textoEncabezado })),
    firma,
    ordenFormularios: formularios.map(f => f.titulo),
    alertasInadmisibilidad,
    checklistPendientes,
    avisoNoAplica,
    seccionesEscaneadas,
  };
}

export interface ResultadoGeneracion {
  buffer: Buffer;
  completados: number;
  respondidos: number;
  integridad: { parrafosIguales: boolean; parrafosAntes: number; parrafosDespues: number };
  // Firma/timbre que DEBÍAN estamparse (la empresa tiene la URL cargada y algún lugar del
  // documento los pedía) pero la descarga desde R2 falló — antes esto se tragaba en silencio y
  // el .docx salía "exitoso" sin la imagen (auditoría ago-2026). Vacío si todo se estampó bien.
  avisos: string[];
}

export async function generarAnexoFinal(
  bufferOriginal: Buffer,
  empresa: EmpresaCampos,
  respuestas: Record<string, string>,
  itemsCosteo?: ItemCosteoPrecio[],
  basesTexto?: string,
): Promise<ResultadoGeneracion> {
  const { zip, xml: xmlCrudoSinNormalizar } = await abrirDocx(bufferOriginal);
  // eliminarRespaldoVmlDuplicado va PRIMERO, antes que nada más — ver su comentario en
  // anexos-docx.ts. Redefine qué cuenta como "el original" para las DOS rutas por igual, así que
  // xmlCrudo (el que compara verificarParrafos más abajo) ya nace sin el duplicado — sin esto,
  // la comparación de integridad marcaría como "perdido" un párrafo que nunca fue contenido real.
  const xmlCrudo = eliminarRespaldoVmlDuplicado(xmlCrudoSinNormalizar);
  // unificarRunsDeMarcadores va SIEMPRE junto a normalizarParaIds y en las DOS rutas (analizar y
  // generar): junta en un solo <w:t> los marcadores "<<NOMBRE …>>" que Word dejó partidos entre
  // runs, sin cambiar el conteo de párrafos ni de runs — ver su comentario en anexos-docx.ts. Si
  // una de las dos rutas se lo saltara, los ids de los pendientes (que son índices de aparición) no
  // calzarían entre el análisis y la generación.
  const { xml: xmlConIds } = normalizarParaIds(xmlCrudo);
  const xmlNormalizado = unificarRunsDeMarcadores(xmlConIds);
  const analisis = analizarAnexo(xmlNormalizado, { postulaComoUTP: respuestas.anexoAplica === '1' });
  const formularios = detectarFormularios(xmlNormalizado);

  // Misma decisión que en el análisis, y por el mismo canal `respuestas`: si el documento avisa
  // que este anexo no nos corresponde, no se autocompleta nada — salvo que el usuario haya marcado
  // en la pantalla que esta vez SÍ corresponde (interruptor "anexoAplica").
  const avisoNoAplica = respuestas.anexoAplica === '1' ? null : analisis.avisoNoAplica;
  const {
    matcheados, pendientes, inlineAuto, inlinePendientes,
  } = avisoNoAplica
    ? todoPendientePorNoAplicar(analisis.candidatosCelda, analisis.blancosInline, avisoNoAplica.motivo)
    : await resolverTodo(
      analisis.candidatosCelda, analisis.camposConDosPuntos, analisis.blancosInline,
      empresa, analisis.indicesSoloManual, analisis.parrafos, itemsCosteo, basesTexto,
      formularios.map(f => f.titulo), respuestas.anexoAplica === '1', analisis.tripletesFecha, analisis.alternativasExcluyentes,
    );

  let xml = xmlNormalizado;
  let respondidos = 0;
  const avisos: string[] = [];

  // 1) Blancos inline PRIMERO — mismo orden y misma razón que antes: este paso solo EDITA texto
  //    de runs que ya existían, nunca agrega/quita un <w:t>, así que el índice de aparición no
  //    se corre para el paso 2.
  let completadosInline = 0;
  const porRun = new Map<number, { pos: number; largo: number; valor: string }[]>();
  const anotar = (b: CandidatoInline, valor: string) => {
    if (!porRun.has(b.indiceRun)) porRun.set(b.indiceRun, []);
    porRun.get(b.indiceRun)!.push({ pos: b.posEnTexto, largo: b.largo, valor });
  };
  for (const a of inlineAuto) {
    anotar(a.b, a.valor);
    completadosInline++;
  }
  for (const { b } of inlinePendientes) {
    const respuesta = respuestas[`inline:${b.indiceRun}:${b.posEnTexto}`];
    if (!respuesta || !respuesta.trim()) continue;
    anotar(b, respuesta.trim());
    respondidos++;
  }
  for (const [indiceRun, ediciones] of porRun) {
    xml = rellenarRunPorIndice(xml, indiceRun, ediciones);
  }

  // 2) Celdas de tabla: IA → costeo → lo que escribió el humano.
  let completados = completadosInline;
  const tablasCrudo = extraerTablasCrudo(xmlNormalizado);
  const indicesEnTablasGen = new Set(
    tablasCrudo.flatMap(t => t.filas.flatMap(f => f.celdas.map(c => c.indiceGlobal).filter((i): i is number => i != null))),
  );
  const { matcheadosExtra, pendientesFiltrados, anexarDirecto } = aplicarTotalesPorSeccion(tablasCrudo, analisis.parrafos, indicesEnTablasGen, matcheados, pendientes, respuestas);
  for (const m of [...matcheados, ...matcheadosExtra]) {
    // "Etiqueta:" (patrón 5) NO es una celda vacía — el párrafo ya trae la etiqueta como texto,
    // así que el valor se agrega al FINAL de ese mismo párrafo, nunca reemplazando/exigiendo que
    // esté vacío (rellenarCeldaVacia revienta si encuentra texto donde esperaba una celda libre).
    xml = m.dosPuntos ? rellenarFinDeParrafo(xml, m.c.paraId, m.valor) : rellenarCeldaVacia(xml, m.c.paraId, m.valor);
    completados++;
  }
  for (const c of pendientesFiltrados) {
    const respuesta = respuestas[`celda:${c.indice}`];
    if (respuesta && respuesta.trim()) {
      // Una celda con prefijo de moneda ("$") ya tiene texto — rellenarCeldaVacia revienta ahí.
      xml = c.dosPuntos ? rellenarFinDeParrafo(xml, c.paraId, respuesta.trim()) : rellenarCeldaVacia(xml, c.paraId, respuesta.trim());
      respondidos++;
    }
  }
  for (const a of anexarDirecto) {
    xml = rellenarFinDeParrafo(xml, a.paraId, a.valor);
    completados++;
  }

  // 3) Línea de firma: inserta la IMAGEN real si la empresa tiene una firma escaneada cargada, y
  //    el TIMBRE al lado cuando la leyenda lo pide ("FIRMA Y TIMBRE REPRESENTANTE LEGAL", que es
  //    como viene redactado en la mayoría de los anexos de servicios de salud) y la ficha lo tiene.
  //    El timbre va con `conservar: true` para que se sume a la firma en vez de reemplazarla.
  //    Qué va en CADA lugar lo decide el usuario desde el modal (claves `firma:N` y `firmaPos:N`
  //    dentro de `respuestas`, el mismo canal que las casillas de texto). Sin elección explícita se
  //    aplica el mismo criterio automático de siempre — ver porDefectoEnLugar.
  if (analisis.lineasFirma.length > 0) {
    const decisiones = analisis.lineasFirma.map(linea => {
      const elegido = respuestas[`firma:${linea.indice}`] as QueEstampar | undefined;
      const que: QueEstampar = elegido && ['ambas', 'firma', 'timbre', 'ninguna'].includes(elegido)
        ? elegido
        : porDefectoEnLugar(!!linea.pideTimbre, !!empresa.firma_url, !!empresa.timbre_url, !avisoNoAplica);
      const pos = respuestas[`firmaPos:${linea.indice}`] as PosicionFirma | undefined;
      return {
        linea, que,
        alineacion: pos && ['izquierda', 'centro', 'derecha'].includes(pos) ? pos : undefined,
      };
    });

    // Las imágenes se bajan UNA vez, y solo si alguna decisión las va a usar.
    const usaFirma = decisiones.some(d => d.que === 'ambas' || d.que === 'firma');
    const usaTimbre = decisiones.some(d => d.que === 'ambas' || d.que === 'timbre');
    const firma = usaFirma && empresa.firma_url ? await descargarFirma(empresa.firma_url) : null;
    const timbre = usaTimbre && empresa.timbre_url ? await descargarFirma(empresa.timbre_url) : null;
    // La empresa SÍ tenía la URL cargada y algún lugar la necesitaba: si `descargarFirma` volvió
    // null igual, no fue "no aplica", fue que la descarga falló (red, R2 caído, etc.) — eso hay
    // que decirlo, no dejar que el .docx salga "exitoso" sin la imagen.
    if (usaFirma && empresa.firma_url && !firma) avisos.push('No se pudo descargar la firma guardada — el documento se generó SIN firma.');
    if (usaTimbre && empresa.timbre_url && !timbre) avisos.push('No se pudo descargar el timbre guardado — el documento se generó SIN timbre.');

    for (const { linea, que, alineacion } of decisiones) {
      if (que === 'ninguna') continue;
      // La PRIMERA imagen que entra al párrafo es la que limpia la raya; la segunda se suma con
      // `conservar` para no borrarla. Si solo va el timbre, entonces es él el que entra primero.
      // `linea.sinRaya` (patrón 5, "Etiqueta:" sola — ver analizarAnexo) fuerza `conservar` desde
      // la PRIMERA imagen: no hay ninguna raya que limpiar, así que nunca se debe borrar nada del
      // párrafo (la etiqueta "FIRMA REPRESENTANTE LEGAL:" tiene que sobrevivir intacta).
      let primera = true;
      if (firma && (que === 'ambas' || que === 'firma')) {
        xml = await insertarImagenEnParrafo(zip, xml, linea.paraId, firma.buffer, firma.extension, { etiqueta: 'firma', alineacion, conservar: !!linea.sinRaya });
        primera = false;
      }
      if (timbre && (que === 'ambas' || que === 'timbre')) {
        xml = await insertarImagenEnParrafo(
          zip, xml, linea.paraId, timbre.buffer, timbre.extension,
          { etiqueta: 'timbre', anchoCm: 2.8, conservar: !primera || !!linea.sinRaya, alineacion },
        );
      }
    }
  }

  const integridad = verificarParrafos(xmlCrudo, xml);
  const buffer = await guardarDocx(zip, xml);

  return { buffer, completados, respondidos, integridad, avisos };
}
