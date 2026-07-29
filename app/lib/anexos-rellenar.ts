// app/lib/anexos-rellenar.ts
// Frente E.1 — orquestador de alto nivel: junta detección + diccionario + respaldo IA + relleno.
// Expone dos funciones puras (buffer → resultado, sin DB ni R2 — eso vive en anexos-datos.ts):
//
//   analizarAnexoParaUI()  — SOLO LECTURA. Para la pantalla: qué se completaría solo y qué le
//                            falta a un humano, con un id ESTABLE por cada pendiente para que
//                            el formulario pueda mandarlo de vuelta en generarAnexoFinal().
//   generarAnexoFinal()    — aplica el auto-relleno (diccionario + IA) MÁS las respuestas del
//                            humano, y devuelve el .docx final.
//
// Como no hay estado entre una llamada HTTP y la otra (analizar y generar son requests
// separados), los ids de los pendientes NO pueden depender del w14:paraId que
// normalizarParaIds() inventa para párrafos que no traían uno — ese id es aleatorio y cambia
// en cada llamada. En cambio, el ÍNDICE de aparición (posición en el documento, calculado por
// simple orden de un regex.matchAll) es determinístico para el mismo documento sin importar
// qué string de paraId le haya tocado esta vez — por eso los ids usan índice, nunca paraId.
import {
  normalizarParaIds, rellenarCeldaVacia, rellenarRunPorIndice, insertarImagenEnParrafo,
  verificarParrafos, abrirDocx, guardarDocx,
} from '@/app/lib/anexos-docx';
import { analizarAnexo, extraerTablasCrudo, type CandidatoCelda } from '@/app/lib/anexos-detectar';
import { buscarCampo, type EmpresaCampos } from '@/app/lib/anexos-diccionario';
import { matchearConIA, clasificarTitulos } from '@/app/lib/anexos-ia-matching';
import { detectarFormularios, type FormularioDetectado } from '@/app/lib/anexos-dividir';

export interface CampoCompletado { etiqueta: string; campo: string; valor: string; via: 'diccionario' | 'ia' }
export interface PendienteCelda { id: string; etiqueta: string; formulario?: string }
export interface PendienteInline { id: string; contexto: string; formulario?: string }
export interface SeccionInfo { tipo: string; decision: string; textoEncabezado: string }

// Vista de "tabla real" (ver TablaUI abajo): a diferencia de PendienteCelda (una lista plana de
// "etiqueta: input"), esto reconstruye la tabla del Word tal cual es — todas las columnas, todas
// las filas — para que en pantalla se vea igual que el documento y quede claro a qué celda
// corresponde cada input. Pedido explícito del usuario tras probar la lista plana con un anexo
// económico real: con 160 blancos sueltos sin contexto de fila/columna, era imposible saber cuál
// era cuál. Solo se generan para tablas que tienen AL MENOS un blanco pendiente — una tabla ya
// 100% completada sola no necesita vista propia, ya aparece resumida en "completadosAuto".
export interface CeldaTablaUI {
  texto: string;                                   // texto ya existente en el Word (columna, dato fijo)
  auto?: { valor: string; via: 'diccionario' | 'ia' }; // se completó sola — se muestra el valor, sin input
  input?: { id: string };                          // blanco real pendiente — el mismo id que usa generarAnexoFinal
}
export interface TablaUI { filas: CeldaTablaUI[][]; formulario?: string }

// A qué formulario ("FORMULARIO N°X") pertenece un párrafo, si el documento tiene varios
// pegados — mismo detector que usa anexos-dividir.ts para separarlos en archivos. Sirve para
// agrupar los pendientes en el modal: sin esto, un texto repetido en cada formulario (ej. "Firma
// del Oferente" o la fecha de la ciudad) sale 5 veces idéntico y no hay forma de saber cuál es
// cuál. Si el documento no tiene ese patrón, todos quedan sin grupo (undefined) — no cambia nada.
function formularioDe(indiceParrafo: number, formularios: FormularioDetectado[]): string | undefined {
  return formularios.find(f => indiceParrafo >= f.indiceInicio && indiceParrafo <= f.indiceFin)?.titulo;
}

export interface CampoResuelto { c: CandidatoCelda; campo: string; valor: string; via: 'diccionario' | 'ia' }

// Resuelve TODOS los candidatos de celda de un documento — diccionario primero, respaldo IA
// después, clasificación de títulos AL FINAL (solo sobre lo que sigue sin resolver). El orden
// importa: clasificar títulos ANTES del diccionario se probó y expuso matches deterministas ya
// sólidos (ej. "2.- RUT:", que nunca depende de IA) al riesgo de que un batch de clasificación
// confuso los tumbara por error — un modelo rápido/menos cuidadoso (flashx) alcanzó a marcar como
// "título" etiquetas que llevaban sesiones funcionando perfecto. El caso real que motivó tocar
// esto — "IDENTIFICACION DEL OFERENTE" como ENCABEZADO DE PÁGINA (centrado, negrita, antes de la
// tabla real) robándole el campo razon_social a la fila homónima de la tabla de más abajo — ya
// se resuelve de forma determinista y sin IA en detectarCandidatosCelda (filtro de "centrado",
// ver anexos-detectar.ts): un título de página nunca es un párrafo alineado a la izquierda como
// las etiquetas de campo real. Clasificar títulos al final, solo sobre los pendientes, es una
// red de seguridad adicional para lo que ese filtro determinista no alcanza a cubrir — sin poner
// en riesgo lo que el diccionario/IA ya resolvieron bien.
// Compartida entre analizarAnexoParaUI y generarAnexoFinal para que ambas apliquen EXACTAMENTE
// el mismo filtro — antes cada una tenía su propia copia de esta lógica y solo una filtraba
// títulos, así que el .docx final podía quedar distinto de lo que mostraba la pantalla de revisión.
export async function resolverCandidatosCelda(candidatos: CandidatoCelda[], empresa: EmpresaCampos) {
  // El diccionario NO deduplica por campo: sus patrones son precisos por construcción (regex
  // ancladas a texto exacto), y es NORMAL que un documento combine varios formularios que piden
  // el MISMO dato de identificación cada uno por separado (ej. ANEXO N°1 y ANEXO N°2 de la misma
  // licitación, cada uno con su propio bloque "razón social / RUT / dirección"). Caso real que
  // expuso el bug de deduplicar acá: la primera vez que el diccionario resolvía razon_social
  // (en el ANEXO N°1) dejaba el campo "usado" y el bloque de identificación del ANEXO N°2 —que
  // pide el mismo dato de nuevo, correctamente— se quedaba sin completar aunque el dato SÍ estaba
  // disponible. Distinto del caso "RUT" repetido DENTRO de una misma tabla (oferente vs.
  // representante legal, dos personas distintas) — ese ya se resuelve ANTES de llegar acá, dándole
  // a cada ocurrencia una etiqueta distinta según su contexto de fila (ver desambiguarDuplicados
  // en anexos-detectar.ts), así que cada una matchea su propio campo sin competir por el mismo.
  const matcheados: CampoResuelto[] = [];
  const sinMatch: CandidatoCelda[] = [];
  const camposDiccionario = new Set<string>();
  for (const c of candidatos) {
    const match = buscarCampo(c.etiqueta, empresa);
    if (match) {
      matcheados.push({ c, campo: match.campo, valor: match.valor, via: 'diccionario' });
      camposDiccionario.add(match.campo);
    } else {
      sinMatch.push(c);
    }
  }

  // El respaldo IA SÍ deduplica (no repite el mismo campo dos veces, y nunca pisa uno que el
  // diccionario ya resolvió) — es un canal menos confiable que el diccionario, así que un posible
  // acierto real no vale el riesgo de que un mismo error se repita en varios lugares del documento.
  const matchesIA = await matchearConIA(sinMatch.map(c => c.etiqueta), empresa);
  const mapaIA = new Map(matchesIA.map(m => [m.etiqueta, m.campo]));
  const camposUsadosPorIA = new Set(camposDiccionario);
  const sinResolver: CandidatoCelda[] = [];
  for (const c of sinMatch) {
    const campoIA = mapaIA.get(c.etiqueta);
    const valorIA = campoIA ? empresa[campoIA] : null;
    if (campoIA && valorIA && !camposUsadosPorIA.has(campoIA)) {
      matcheados.push({ c, campo: campoIA, valor: String(valorIA), via: 'ia' });
      camposUsadosPorIA.add(campoIA);
    } else {
      sinResolver.push(c);
    }
  }

  // Los candidatos con etiqueta COMPUESTA ("<fila> — <columna>", ver patrón 1b y
  // desambiguarDuplicados en anexos-detectar.ts) NUNCA pueden ser un título de sección: por
  // construcción describen una celda puntual dentro de una tabla de 3+ columnas o un campo de
  // identificación duplicado — ya vienen con su columna real identificada. Mandarlos igual al
  // clasificador de IA solo agrega riesgo de que un modelo menos cuidadoso (flashx) los descarte
  // por error — caso real encontrado: "ESCOBILLONES INDUSTRIALES — PRECIO" (un precio real de
  // ítem, no un título) desaparecía de los pendientes en algunas corridas porque el clasificador
  // lo marcaba como título. Solo las etiquetas SIMPLES (patrón 1 sin desambiguar) pasan por el
  // clasificador — esas sí pueden ser un título de página colado, como el caso original que
  // motivó este filtro.
  const [compuestos, simples] = [
    sinResolver.filter(c => c.etiqueta.includes(' — ')),
    sinResolver.filter(c => !c.etiqueta.includes(' — ')),
  ];
  const titulos = await clasificarTitulos(simples.map(c => c.etiqueta));
  const pendientesSimples = titulos.size > 0 ? simples.filter(c => !titulos.has(c.etiqueta)) : simples;
  const pendientes = [...compuestos, ...pendientesSimples];
  return { matcheados, pendientes };
}

// Descarga la firma escaneada desde su URL pública (R2) y detecta su extensión real por
// Content-Type (más confiable que confiar en el nombre del archivo). null si falla o no hay
// firma cargada — nunca rompe el análisis/generación completa por esto.
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

export interface AnalisisAnexo {
  completadosAuto: CampoCompletado[];
  pendientesCelda: PendienteCelda[];
  pendientesInline: PendienteInline[];
  tablas: TablaUI[];
  secciones: SeccionInfo[];
  firma: FirmaInfo;
}

// Resolución de cada candidato de celda, para poder mapearla después sobre la tabla completa
// (extraerTablasCrudo) — evita tener DOS lugares que decidan "esto se completó solo" / "esto
// quedó pendiente", que podrían divergir.
type Resolucion =
  | { tipo: 'auto'; etiqueta: string; campo: string; valor: string; via: 'diccionario' | 'ia' }
  | { tipo: 'pendiente'; etiqueta: string; id: string };

export async function analizarAnexoParaUI(bufferOriginal: Buffer, empresa: EmpresaCampos): Promise<AnalisisAnexo> {
  const { xml: xmlCrudo } = await abrirDocx(bufferOriginal);
  const { xml: xmlNormalizado } = normalizarParaIds(xmlCrudo);
  const analisis = analizarAnexo(xmlNormalizado);
  const formularios = detectarFormularios(xmlNormalizado);

  const completadosAuto: CampoCompletado[] = [];
  const resolucionPorIndice = new Map<number, Resolucion>();
  const { matcheados, pendientes } = await resolverCandidatosCelda(analisis.candidatosCelda, empresa);
  for (const m of matcheados) {
    completadosAuto.push({ etiqueta: m.c.etiqueta, campo: m.campo, valor: m.valor, via: m.via });
    resolucionPorIndice.set(m.c.indice, { tipo: 'auto', etiqueta: m.c.etiqueta, campo: m.campo, valor: m.valor, via: m.via });
  }

  const pendientesCeldaTodos: PendienteCelda[] = pendientes.map(c => {
    const id = `celda:${c.indice}`;
    resolucionPorIndice.set(c.indice, { tipo: 'pendiente', etiqueta: c.etiqueta, id });
    return { id, etiqueta: c.etiqueta, formulario: formularioDe(c.indice, formularios) };
  });

  // Reconstruye cada tabla del Word COMPLETA (todas las celdas, no solo las vacías) para que el
  // panel de pendientes se vea como el documento real — fila por fila, columna por columna — en
  // vez de una lista plana donde no se sabe a qué celda corresponde cada blanco. Solo se
  // devuelven las tablas que tienen al menos un pendiente real; una tabla ya 100% resuelta por
  // diccionario/IA no necesita vista propia.
  const tablasCrudo = extraerTablasCrudo(xmlNormalizado);
  const indicesEnTablas = new Set(
    tablasCrudo.flatMap(t => t.filas.flatMap(f => f.celdas.map(c => c.indiceGlobal).filter((i): i is number => i != null))),
  );
  const tablas: TablaUI[] = tablasCrudo
    .map(t => ({
      formulario: t.indicePrimero != null ? formularioDe(t.indicePrimero, formularios) : undefined,
      filas: t.filas.map(f => f.celdas.map((c): CeldaTablaUI => {
        if (c.indiceGlobal == null) return { texto: c.texto };
        const res = resolucionPorIndice.get(c.indiceGlobal);
        if (!res) return { texto: c.texto }; // celda vacía pero no es candidato real (decorativa, sección omitida, etc.)
        if (res.tipo === 'auto') return { texto: '', auto: { valor: res.valor, via: res.via } };
        return { texto: '', input: { id: res.id } };
      })),
    }))
    .filter(t => t.filas.some(f => f.some(c => c.input)));

  // Los pendientes de celda que YA se muestran dentro de una tabla no se repiten en la lista
  // plana — solo quedan ahí los que no pertenecen a ninguna tabla detectada (ej. una etiqueta
  // suelta en medio del texto, sin estructura tabular real que mostrar).
  const pendientesCelda = pendientesCeldaTodos.filter(p => {
    const indice = Number(p.id.split(':')[1]);
    return !indicesEnTablas.has(indice);
  });

  const pendientesInline: PendienteInline[] = analisis.blancosInline.map(b => ({
    id: `inline:${b.indiceRun}:${b.posEnTexto}`,
    contexto: b.contexto || '(sin contexto)',
    formulario: formularioDe(b.indiceParrafo, formularios),
  }));

  const firma: FirmaInfo = { detectada: analisis.lineasFirma.length > 0, disponible: !!empresa.firma_url };
  if (firma.detectada && firma.disponible) {
    completadosAuto.push({ etiqueta: 'Firma', campo: 'firma_url', valor: '(imagen de la firma guardada)', via: 'diccionario' });
  }

  return {
    completadosAuto,
    pendientesCelda,
    pendientesInline,
    tablas,
    secciones: analisis.secciones.map(s => ({ tipo: s.tipo, decision: s.decision, textoEncabezado: s.textoEncabezado })),
    firma,
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
): Promise<ResultadoGeneracion> {
  const { zip, xml: xmlCrudo } = await abrirDocx(bufferOriginal);
  const { xml: xmlNormalizado } = normalizarParaIds(xmlCrudo);
  const analisis = analizarAnexo(xmlNormalizado);

  let xml = xmlNormalizado;
  let respondidos = 0;

  // 1) Blancos inline PRIMERO. rellenarRunPorIndice ubica cada run por su posición de aparición
  //    (indiceRun), calculada sobre el documento tal cual quedó tras normalizar. El paso 2
  //    (celdas) INSERTA un <w:t> nuevo dentro de párrafos que hoy no tienen ninguno — eso
  //    correría el índice de todos los runs que aparecen después. Mientras este paso solo EDITE
  //    texto de runs que ya existían (nunca agrega/quita un <w:t>), el orden de aparición no
  //    cambia y los índices siguen siendo válidos.
  const porRun = new Map<number, { pos: number; largo: number; valor: string }[]>();
  for (const b of analisis.blancosInline) {
    const respuesta = respuestas[`inline:${b.indiceRun}:${b.posEnTexto}`];
    if (!respuesta || !respuesta.trim()) continue;
    if (!porRun.has(b.indiceRun)) porRun.set(b.indiceRun, []);
    porRun.get(b.indiceRun)!.push({ pos: b.posEnTexto, largo: b.largo, valor: respuesta.trim() });
    respondidos++;
  }
  for (const [indiceRun, ediciones] of porRun) {
    xml = rellenarRunPorIndice(xml, indiceRun, ediciones);
  }

  // 2) Celdas de tabla: diccionario → respaldo IA → lo que escribió el humano. Van después —
  //    ver comentario arriba.
  let completados = 0;
  const { matcheados, pendientes } = await resolverCandidatosCelda(analisis.candidatosCelda, empresa);
  for (const m of matcheados) {
    xml = rellenarCeldaVacia(xml, m.c.paraId, m.valor);
    completados++;
  }
  for (const c of pendientes) {
    const respuesta = respuestas[`celda:${c.indice}`];
    if (respuesta && respuesta.trim()) {
      xml = rellenarCeldaVacia(xml, c.paraId, respuesta.trim());
      respondidos++;
    }
  }

  // 3) Línea de firma: inserta la IMAGEN real (no texto) si la empresa tiene una firma
  //    escaneada cargada. Va AL FINAL a propósito: insertarImagenEnParrafo() quita el <w:t> de
  //    la raya de subrayado y lo reemplaza por un <w:drawing> — eso cambia la cuenta global de
  //    <w:t> del documento, así que tiene que correr DESPUÉS del paso 1 (que todavía depende de
  //    esa cuenta para ubicar runs por índice). El paso 2 no le importa el orden porque ubica
  //    todo por paraId, nunca por índice.
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
