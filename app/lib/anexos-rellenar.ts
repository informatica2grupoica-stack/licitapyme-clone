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
  normalizarParaIds, rellenarCeldaVacia, rellenarRunPorIndice, insertarImagenEnParrafo,
  rellenarFinDeParrafo, verificarParrafos, abrirDocx, guardarDocx, type Parrafo,
} from '@/app/lib/anexos-docx';
import { analizarAnexo, extraerTablasCrudo, type CandidatoCelda, type CandidatoInline, type TablaCruda } from '@/app/lib/anexos-detectar';
import {
  resolverAnexoConIA, resolverEspecificacionesDesdeBasesConIA,
  type EmpresaCampos, type Resolucion, type AlertaInadmisibilidad,
} from '@/app/lib/anexos-ia-motor';
import { matchearPreciosConIA } from '@/app/lib/anexos-precios-ia';
import { calcularTotalesPorSeccion, resolverTablaResumen, tituloDeTabla, encabezadosLibres, type TituloCercano } from '@/app/lib/anexos-totales-seccion';
import { detectarFormularios, type FormularioDetectado } from '@/app/lib/anexos-dividir';
import { construirDocumentoUI, leerNumeracion, type BloqueUI, type Resuelto } from '@/app/lib/anexos-documento-ui';
import type { ItemCosteoPrecio } from '@/app/lib/motor-comercial';

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
export interface CeldaTablaUI {
  texto: string;                                   // texto ya existente en el Word (columna, dato fijo)
  auto?: { valor: string; via: 'ia' | 'costeo' | 'bases' };   // se completó sola — se muestra el valor, sin input
  input?: { id: string };                          // blanco real pendiente — el mismo id que usa generarAnexoFinal
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
): Promise<ResultadoResolucion> {
  const elegibles = candidatosCelda.filter(c => !soloManual?.has(c.indice));
  const soloManualCandidatos = candidatosCelda.filter(c => soloManual?.has(c.indice));
  const indicesDosPuntos = new Set(camposConDosPuntos.map(c => c.indice));

  const { celda, inline, alertasInadmisibilidad, checklistPendientes } = await resolverAnexoConIA({
    candidatos: [...elegibles, ...camposConDosPuntos],
    blancosInline,
    parrafos,
    empresa,
    basesTexto,
    tituloAnexos,
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
    if (res?.tipo === 'auto') {
      matcheados.push({ c, campo: res.categoria, valor: res.valor, via: 'ia', dosPuntos: indicesDosPuntos.has(c.indice) });
    } else if (!indicesDosPuntos.has(c.indice)) {
      // "Etiqueta:" (patrón 5) NUNCA alimenta la lista de pendientes — ver el comentario de
      // detectarCamposConDosPuntos en anexos-detectar.ts: cualquier título que termine en dos
      // puntos calza con esta forma, y mostrarlos todos llenaría la pantalla de campos que no
      // existen. Solo se usan para auto-completar; si el motor no resuelve uno, se descarta.
      pendientes.push(c);
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
  for (const b of blancosInline) {
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
  for (const r of rellenos) {
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

// Descarga la firma escaneada desde su URL pública (R2) y detecta su extensión real por
// Content-Type. null si falla o no hay firma cargada.
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

export interface FirmaInfo { detectada: boolean; disponible: boolean }

// Arma la vista de UNA tabla (todas sus filas/columnas, no solo las vacías) — la usan tanto
// `tablas` (lista plana filtrada, para las herramientas de medición) como `tablasPorIndice` (sin
// filtrar, para que la réplica del documento muestre también las tablas que no tienen blancos).
function construirTablaUI(
  t: TablaCruda, formularios: FormularioDetectado[], titulos: TituloCercano[],
  resolucionPorIndice: Map<number, ResolucionMostrada>, rellenosPorParaId: Map<string, { paraId: string; valor: string }>,
): TablaUI {
  return {
    formulario: t.indicePrimero != null ? formularioDe(t.indicePrimero, formularios) : undefined,
    titulo: tituloDeTabla(t.indicePrimero, titulos)?.texto,
    filas: t.filas.map(f => f.celdas.map((c): CeldaTablaUI => {
      const relleno = c.ultimoParaId ? rellenosPorParaId.get(c.ultimoParaId) : undefined;
      if (relleno) return { texto: c.texto, auto: { valor: `${c.texto ? c.texto + ' ' : ''}${relleno.valor}`, via: 'costeo' } };
      if (c.indiceGlobal == null) return { texto: c.texto };
      const res = resolucionPorIndice.get(c.indiceGlobal);
      if (!res) return { texto: c.texto };
      if (res.tipo === 'auto') return { texto: '', auto: { valor: res.valor, via: res.via } };
      return { texto: '', input: { id: res.id } };
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
}

type ResolucionMostrada =
  | { tipo: 'auto'; etiqueta: string; campo: string; valor: string; via: 'ia' | 'costeo' | 'bases' }
  | { tipo: 'pendiente'; etiqueta: string; id: string };

export async function analizarAnexoParaUI(
  bufferOriginal: Buffer, empresa: EmpresaCampos, itemsCosteo?: ItemCosteoPrecio[], basesTexto?: string,
): Promise<AnalisisAnexo> {
  const { zip, xml: xmlCrudo } = await abrirDocx(bufferOriginal);
  const { xml: xmlNormalizado } = normalizarParaIds(xmlCrudo);
  const analisis = analizarAnexo(xmlNormalizado);
  const formularios = detectarFormularios(xmlNormalizado);
  const numeracion = await leerNumeracion(zip);

  const tablasCrudo = extraerTablasCrudo(xmlNormalizado);
  const indicesEnTablas = new Set(
    tablasCrudo.flatMap(t => t.filas.flatMap(f => f.celdas.map(c => c.indiceGlobal).filter((i): i is number => i != null))),
  );
  const completadosAuto: CampoCompletado[] = [];
  const resolucionPorIndice = new Map<number, ResolucionMostrada>();

  const {
    matcheados, pendientes, pendientesConMotivo, inlineAuto, inlinePendientes,
    alertasInadmisibilidad, checklistPendientes,
  } = await resolverTodo(
    analisis.candidatosCelda, analisis.camposConDosPuntos, analisis.blancosInline,
    empresa, analisis.indicesSoloManual, analisis.parrafos, itemsCosteo, basesTexto,
    formularios.map(f => f.titulo),
  );
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

  // Reconstruye cada tabla del Word COMPLETA (todas las celdas, no solo las vacías). `tablasPorIndice`
  // queda SIN filtrar (todas, incluidas las que no tienen ningún blanco) porque la réplica del
  // documento (`documento`, ver más abajo) necesita mostrarlas igual que en el Word aunque no haya
  // nada que llenar en ellas; `tablas` sigue filtrada (solo las que tienen algo por completar) para
  // las herramientas de medición (scripts/anexos-golden) que ya dependían de ese recorte.
  const rellenosPorParaId = new Map(anexarDirecto.map(r => [r.paraId, r]));
  const tablasUI = tablasCrudo.map(t => ({ t, ui: construirTablaUI(t, formularios, titulos, resolucionPorIndice, rellenosPorParaId) }));
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

  const firma: FirmaInfo = { detectada: analisis.lineasFirma.length > 0, disponible: !!empresa.firma_url };
  if (firma.detectada && firma.disponible) {
    completadosAuto.push({ etiqueta: 'Firma', campo: 'firma_url', valor: '(imagen de la firma guardada)', via: 'ia' });
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
  // mapa que arma las tablas de arriba) y por BLANCO INLINE (`inlineAuto`/`inlinePendientes`,
  // clave `${indiceRun}:${posEnTexto}`). Los índices que caen DENTRO de una tabla no hacen daño
  // acá: `construirDocumentoUI` nunca los consulta porque una tabla se dibuja entera a través de
  // `tablasPorIndice`, no párrafo por párrafo.
  const porParrafo = new Map<number, Resuelto>();
  for (const [indice, res] of resolucionPorIndice) {
    porParrafo.set(indice, res.tipo === 'auto'
      ? { tipo: 'auto', valor: res.valor, via: res.via }
      : { tipo: 'pendiente', id: res.id });
  }
  const porBlancoInline = new Map<string, Resuelto>();
  for (const a of inlineAuto) {
    porBlancoInline.set(`${a.b.indiceRun}:${a.b.posEnTexto}`, { tipo: 'auto', valor: a.valor, via: a.via });
  }
  for (const { b } of inlinePendientes) {
    porBlancoInline.set(`${b.indiceRun}:${b.posEnTexto}`, { tipo: 'pendiente', id: `inline:${b.indiceRun}:${b.posEnTexto}` });
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
  };
}

export interface ResultadoGeneracion {
  buffer: Buffer;
  completados: number;
  respondidos: number;
  integridad: { parrafosIguales: boolean; parrafosAntes: number; parrafosDespues: number };
}

export async function generarAnexoFinal(
  bufferOriginal: Buffer,
  empresa: EmpresaCampos,
  respuestas: Record<string, string>,
  itemsCosteo?: ItemCosteoPrecio[],
  basesTexto?: string,
): Promise<ResultadoGeneracion> {
  const { zip, xml: xmlCrudo } = await abrirDocx(bufferOriginal);
  const { xml: xmlNormalizado } = normalizarParaIds(xmlCrudo);
  const analisis = analizarAnexo(xmlNormalizado);
  const formularios = detectarFormularios(xmlNormalizado);

  const {
    matcheados, pendientes, inlineAuto, inlinePendientes,
  } = await resolverTodo(
    analisis.candidatosCelda, analisis.camposConDosPuntos, analisis.blancosInline,
    empresa, analisis.indicesSoloManual, analisis.parrafos, itemsCosteo, basesTexto,
    formularios.map(f => f.titulo),
  );

  let xml = xmlNormalizado;
  let respondidos = 0;

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
      xml = rellenarCeldaVacia(xml, c.paraId, respuesta.trim());
      respondidos++;
    }
  }
  for (const a of anexarDirecto) {
    xml = rellenarFinDeParrafo(xml, a.paraId, a.valor);
    completados++;
  }

  // 3) Línea de firma: inserta la IMAGEN real si la empresa tiene una firma escaneada cargada.
  if (analisis.lineasFirma.length > 0 && empresa.firma_url) {
    const firma = await descargarFirma(empresa.firma_url);
    if (firma) {
      for (const linea of analisis.lineasFirma) {
        xml = await insertarImagenEnParrafo(zip, xml, linea.paraId, firma.buffer, firma.extension);
      }
    }
  }

  const integridad = verificarParrafos(xmlCrudo, xml);
  const buffer = await guardarDocx(zip, xml);

  return { buffer, completados, respondidos, integridad };
}
