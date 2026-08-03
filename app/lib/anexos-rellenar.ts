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
  rellenarFinDeParrafo, verificarParrafos, abrirDocx, guardarDocx, type Parrafo,
} from '@/app/lib/anexos-docx';
import { analizarAnexo, extraerTablasCrudo, type CandidatoCelda, type CandidatoInline, type TablaCruda } from '@/app/lib/anexos-detectar';
import { buscarCampo, esMatchCoherente, type EmpresaCampos } from '@/app/lib/anexos-diccionario';
import { matchearConIA, clasificarTitulos } from '@/app/lib/anexos-ia-matching';
import { clasificarConIA } from '@/app/lib/anexos-clasificar-ia';
import { resolverTodoConIA } from '@/app/lib/anexos-ia-total';
import { matchearPreciosConIA } from '@/app/lib/anexos-precios-ia';
import { calcularTotalesPorSeccion, resolverTablaResumen, tituloDeTabla, encabezadosLibres, type TituloCercano } from '@/app/lib/anexos-totales-seccion';
import { detectarFormularios, type FormularioDetectado } from '@/app/lib/anexos-dividir';
import type { ItemCosteoPrecio } from '@/app/lib/motor-comercial';

const fmtNumeroCL = (n: number) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);

export interface CampoCompletado {
  etiqueta: string; campo: string; valor: string; via: 'diccionario' | 'ia' | 'costeo';
  formulario?: string; // a qué "FORMULARIO N°X" pertenece, para agruparlo igual que los pendientes
}
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
  auto?: { valor: string; via: 'diccionario' | 'ia' | 'costeo' }; // se completó sola — se muestra el valor, sin input
  input?: { id: string };                          // blanco real pendiente — el mismo id que usa generarAnexoFinal
}
export interface TablaUI {
  filas: CeldaTablaUI[][]; formulario?: string;
  // El párrafo-encabezado suelto que precede a esta tabla en el Word (ej. "LÍNEA 1: LETRERO DE
  // OBRAS") — se muestra tal cual arriba de la tabla en vez de perderse: antes se clasificaba
  // como "título" y desaparecía del panel por completo, dejando una tabla de ítems sin decir a
  // qué sección pertenece (pedido explícito: "no debe de omitir nada").
  titulo?: string;
}

// A qué formulario ("FORMULARIO N°X") pertenece un párrafo, si el documento tiene varios
// pegados — mismo detector que usa anexos-dividir.ts para separarlos en archivos. Sirve para
// agrupar los pendientes en el modal: sin esto, un texto repetido en cada formulario (ej. "Firma
// del Oferente" o la fecha de la ciudad) sale 5 veces idéntico y no hay forma de saber cuál es
// cuál. Si el documento no tiene ese patrón, todos quedan sin grupo (undefined) — no cambia nada.
function formularioDe(indiceParrafo: number, formularios: FormularioDetectado[]): string | undefined {
  return formularios.find(f => indiceParrafo >= f.indiceInicio && indiceParrafo <= f.indiceFin)?.titulo;
}

export interface CampoResuelto { c: CandidatoCelda; campo: string; valor: string; via: 'diccionario' | 'ia' | 'costeo' }

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
// ── Camino 100% IA (ANEXOS_IA_TOTAL=1) ────────────────────────────────────────────────────
// Decisión del usuario (3-ago-2026): que la creación del anexo la decida la IA, no un diccionario
// de regex. Ver la cabecera de anexos-ia-total.ts para el porqué (el diccionario topó su techo:
// 22 casillas resueltas y CERO aporte de la IA en 1057472-89-LE26, por el veto de campos usados).
//
// Diferencias deliberadas con el camino determinista, las dos a propósito:
//   · NO se aplica `soloManual` como filtro duro. Ese filtro sale de detectarSecciones, que tiene
//     un bug medido (un encabezado "PERSONA NATURAL" se come bloques que vienen después, y una
//     ETIQUETA de campo se confunde con un encabezado de sección y apaga la tabla entera). La IA
//     recibe los párrafos previos —incluidos esos encabezados— y decide ella si la casilla es de
//     un bloque que no nos corresponde. Es el mismo criterio, pero leyendo el documento en vez de
//     de un rango de índices calculado mal.
//   · NO se corre clasificarTitulos: la misma llamada ya decide "sin dato que pedir" para un
//     título, así que no hace falta una segunda pasada de IA que —medido— borraba campos reales.
const IA_TOTAL = process.env.ANEXOS_IA_TOTAL === '1';

async function resolverCandidatosCeldaIATotal(
  candidatos: CandidatoCelda[], parrafos: Parrafo[], empresa: EmpresaCampos, itemsCosteo?: ItemCosteoPrecio[],
) {
  const mapa = await resolverTodoConIA(candidatos, parrafos, empresa);

  const matcheados: CampoResuelto[] = [];
  const sinResolver: CandidatoCelda[] = [];
  for (const c of candidatos) {
    const r = mapa.get(c.indice);
    if (r) matcheados.push({ c, campo: r.campo, valor: r.valor, via: 'ia' });
    else sinResolver.push(c);
  }

  // El cruce de PRECIOS con el costeo se mantiene igual: no es un dato de la ficha de empresa,
  // sale del .xlsx del Motor Comercial (ver anexos-precios-ia.ts).
  let pendientes = sinResolver;
  if (itemsCosteo && itemsCosteo.length > 0) {
    const matchesPrecio = await matchearPreciosConIA(sinResolver.map(c => c.etiqueta), itemsCosteo);
    const mapaPrecio = new Map(matchesPrecio.map(m => [m.etiqueta, m]));
    pendientes = [];
    for (const c of sinResolver) {
      const m = mapaPrecio.get(c.etiqueta);
      if (m) matcheados.push({ c, campo: 'precio_unitario_costeo', valor: fmtNumeroCL(m.precioUnitario), via: 'costeo' });
      else pendientes.push(c);
    }
  }

  return { matcheados, pendientes, descartadosComoTitulo: [] as CandidatoCelda[] };
}

export async function resolverCandidatosCelda(
  candidatos: CandidatoCelda[], empresa: EmpresaCampos, soloManual?: Set<number>, itemsCosteo?: ItemCosteoPrecio[],
  parrafos?: Parrafo[],
) {
  if (IA_TOTAL && parrafos) return resolverCandidatosCeldaIATotal(candidatos, parrafos, empresa, itemsCosteo);

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
    // Campo de una sección que no nos corresponde (Persona Natural / UTP): se muestra para que un
    // humano lo llene si hace falta, pero no se autocompleta ni se manda a la IA.
    if (soloManual?.has(c.indice)) { sinMatch.push(c); continue; }
    const match = buscarCampo(c.etiqueta, empresa);
    if (match) {
      matcheados.push({ c, campo: match.campo, valor: match.valor, via: 'diccionario' });
      camposDiccionario.add(match.campo);
    } else {
      sinMatch.push(c);
    }
  }

  // Respaldo IA sobre lo que el diccionario NO resolvió, con el CONTEXTO REAL de cada casilla
  // (fila/columna de tabla, párrafos previos — ver anexos-clasificar-ia.ts) en vez de la etiqueta
  // pelada. Es lo que permite resolver "Nombre Completo", "Cédula de Identidad" y "Cargo" a secas,
  // que el diccionario deja pendientes a propósito porque el texto solo no dice de quién son.
  //
  // SIN VETO POR CAMPO YA USADO (quitado el 3-ago-2026). Antes se sembraba
  // `new Set(camposDiccionario)`, así que cualquier campo que el diccionario hubiera gastado en
  // CUALQUIER parte del documento quedaba prohibido para la IA. Medido en 1057472-89-LE26: el
  // ANEXO N°1 consumía razón social, RUT, dirección, correo, teléfono y los del representante, y
  // para los anexos 2 al 6 la IA se quedaba sin NADA que ofrecer — aportaba exactamente 0 campos
  // pese a correr y gastar tokens. Que un Word con 6 anexos pegados pida el mismo dato en cada uno
  // es lo NORMAL, no una señal de error.
  const elegiblesIA = sinMatch.filter(c => !soloManual?.has(c.indice));
  const mapaIA = await clasificarConIA(elegiblesIA, parrafos ?? [], empresa);
  const sinResolver: CandidatoCelda[] = [];
  for (const c of sinMatch) {
    const campoIA = soloManual?.has(c.indice) ? undefined : mapaIA.get(c.indice);
    const valorIA = campoIA ? empresa[campoIA] : null;
    // esMatchCoherente descarta los imposibles (un correo en "CIUDAD", un RUT en "FONO"…) — ver
    // COHERENCIA_CAMPO en anexos-diccionario.ts.
    if (campoIA && valorIA && esMatchCoherente(c.etiqueta, campoIA)) {
      matcheados.push({ c, campo: campoIA, valor: String(valorIA), via: 'ia' });
    } else {
      sinResolver.push(c);
    }
  }

  // Respaldo de PRECIOS (Motor Comercial, ver anexos-precios-ia.ts): si la licitación tiene un
  // costeo real subido, las filas de "precio unitario" que ni el diccionario ni la IA de empresa
  // pudieron resolver (nunca iban a poder — no describen un dato de la empresa) se cruzan contra
  // la descripción de cada ítem del costeo. Va ANTES del split compuestos/simples: una fila de
  // precio SIEMPRE es compuesta ("<ítem> — Precio unitario"), así que se resuelve aquí o pasa de
  // largo intacta a `compuestos` como pendiente, igual que hoy.
  let sinResolverTrasPrecio = sinResolver;
  if (itemsCosteo && itemsCosteo.length > 0) {
    const matchesPrecio = await matchearPreciosConIA(sinResolver.map(c => c.etiqueta), itemsCosteo);
    const mapaPrecio = new Map(matchesPrecio.map(m => [m.etiqueta, m]));
    sinResolverTrasPrecio = [];
    for (const c of sinResolver) {
      const m = mapaPrecio.get(c.etiqueta);
      if (m) matcheados.push({ c, campo: 'precio_unitario_costeo', valor: fmtNumeroCL(m.precioUnitario), via: 'costeo' });
      else sinResolverTrasPrecio.push(c);
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
    sinResolverTrasPrecio.filter(c => c.etiqueta.includes(' — ')),
    sinResolverTrasPrecio.filter(c => !c.etiqueta.includes(' — ')),
  ];
  const titulos = await clasificarTitulos(simples.map(c => c.etiqueta));
  const pendientesSimples = titulos.size > 0 ? simples.filter(c => !titulos.has(c.etiqueta)) : simples;
  const pendientes = [...compuestos, ...pendientesSimples];

  // Los que el clasificador dio por títulos NO se tiran: se devuelven aparte. Antes desaparecían
  // del análisis y quedaban en blanco en el documento sin que nadie se enterara de que existían —
  // caso real 4291-38-LP26: "INICIO ACTIV." (una fecha de inicio de actividades, campo perfectamente
  // real) se clasificaba como título y el anexo se entregaba con esa celda vacía. Siguen fuera de
  // la lista plana de pendientes (para no llenar la pantalla de títulos), pero se muestran como
  // input dentro de la vista de tabla, donde la fila y la columna dejan claro qué son — y si el
  // humano escribe algo ahí, generarAnexoFinal lo escribe igual que cualquier otro pendiente.
  const descartadosComoTitulo = titulos.size > 0 ? simples.filter(c => titulos.has(c.etiqueta)) : [];
  return { matcheados, pendientes, descartadosComoTitulo };
}

// ── Variante EXPERIMENTAL: detección con contexto real + IA en vez de desambiguarDuplicados ──
// Camino PARALELO a resolverCandidatosCelda — NO lo reemplaza todavía (ver plan "Detección de
// campos con IA en el Anexo Creator"). Recibe `candidatosCeldaSinDesambiguar` (analizarAnexo) en
// vez de `candidatosCelda`: los mismos blancos geométricos, pero con la etiqueta CRUDA (sin el
// prefijo "candidato anterior" de desambiguarDuplicados), para que anexos-clasificar-ia.ts arme
// contexto real (fila/columna de tabla, párrafos previos) en vez de heredar ruido de un vecino.
//
// Diferencia deliberada con resolverCandidatosCelda: no corre clasificarTitulos por separado —
// la misma llamada a la IA ya decide "sin campo que pedirle" para un título/encabezado (ver
// prompt en anexos-clasificar-ia.ts), así que no hay una lista `descartadosComoTitulo` aparte;
// todo lo no resuelto queda en `pendientes`. Es una diferencia cosmética (dónde aparece en la
// pantalla), no de qué campo se autocompleta — que es lo que valida la comparación cabeza a cabeza.
// Sin desambiguarDuplicados, "RUT" puede aparecer 2+ veces con el MISMO texto crudo describiendo
// a PERSONAS DISTINTAS (caso real 1738-18-LE26: RUT del oferente y RUT del representante legal,
// a 6 párrafos de distancia, en la misma tabla de 2 columnas) — buscarCampo por sí solo no tiene
// cómo distinguirlas y resolvería la segunda con el dato de la empresa, pisando lo que le
// corresponde al representante. Se detecta por CONTEO **y CERCANÍA** (no por prefijo, ver
// desambiguarDuplicados en anexos-detectar.ts): una repetición LOCAL (dentro del mismo bloque/
// tabla) es la que de verdad puede referirse a alguien distinto y va directo a la IA con contexto
// real. Una repetición LEJANA (ej. razón social pedida de nuevo en el ANEXO N°2, muchos párrafos
// después) es el caso NORMAL de "varios formularios piden el mismo dato de la empresa" — obligarla
// a pasar por la IA solo la hace más lenta y menos confiable sin ganar nada (probado: forzar TODO
// duplicado a IA en 1057472-89-LE26 hizo caer los resueltos de 13 a 4, porque casi todo el
// documento repite razón social/RUT/correo en cada uno de sus 6 formularios).
const DISTANCIA_MAX_DUPLICADO_LOCAL = 20;

function normalizarParaContarDuplicados(etiqueta: string): string {
  return etiqueta.trim().toLowerCase().replace(/[:.\s]+$/, '');
}

function indicesDeDuplicadosLocales(candidatos: CandidatoCelda[]): Set<number> {
  const porClave = new Map<string, CandidatoCelda[]>();
  for (const c of candidatos) {
    const clave = normalizarParaContarDuplicados(c.etiqueta);
    if (!porClave.has(clave)) porClave.set(clave, []);
    porClave.get(clave)!.push(c);
  }
  const locales = new Set<number>();
  for (const grupo of porClave.values()) {
    if (grupo.length < 2) continue;
    const ordenado = [...grupo].sort((a, b) => a.indice - b.indice);
    for (let i = 0; i < ordenado.length; i++) {
      const cercaAnterior = i > 0 && ordenado[i].indice - ordenado[i - 1].indice <= DISTANCIA_MAX_DUPLICADO_LOCAL;
      const cercaSiguiente = i < ordenado.length - 1 && ordenado[i + 1].indice - ordenado[i].indice <= DISTANCIA_MAX_DUPLICADO_LOCAL;
      if (cercaAnterior || cercaSiguiente) locales.add(ordenado[i].indice);
    }
  }
  return locales;
}

export async function resolverCandidatosCeldaConIA(
  candidatos: CandidatoCelda[], parrafos: Parrafo[], empresa: EmpresaCampos, soloManual?: Set<number>,
) {
  const duplicadosLocales = indicesDeDuplicadosLocales(candidatos);
  const esDuplicadoLocal = (c: CandidatoCelda) => duplicadosLocales.has(c.indice);

  const matcheados: CampoResuelto[] = [];
  const sinMatch: CandidatoCelda[] = [];
  const camposDiccionario = new Set<string>();
  for (const c of candidatos) {
    if (soloManual?.has(c.indice)) { sinMatch.push(c); continue; }
    if (esDuplicadoLocal(c)) { sinMatch.push(c); continue; }
    const match = buscarCampo(c.etiqueta, empresa);
    if (match) {
      matcheados.push({ c, campo: match.campo, valor: match.valor, via: 'diccionario' });
      camposDiccionario.add(match.campo);
    } else {
      sinMatch.push(c);
    }
  }

  const elegiblesIA = sinMatch.filter(c => !soloManual?.has(c.indice));
  const mapaIA = await clasificarConIA(elegiblesIA, parrafos, empresa);
  const camposUsadosPorIA = new Set(camposDiccionario);
  const pendientes: CandidatoCelda[] = [];
  for (const c of sinMatch) {
    const campoIA = soloManual?.has(c.indice) ? undefined : mapaIA.get(c.indice);
    const valorIA = campoIA ? empresa[campoIA] : null;
    if (campoIA && valorIA && !camposUsadosPorIA.has(campoIA) && esMatchCoherente(c.etiqueta, campoIA)) {
      matcheados.push({ c, campo: campoIA, valor: String(valorIA), via: 'ia' });
      camposUsadosPorIA.add(campoIA);
    } else {
      pendientes.push(c);
    }
  }

  return { matcheados, pendientes, descartadosComoTitulo: [] as CandidatoCelda[] };
}

// ── Totales por sección (LÍNEA/LOTE/ÍTEM...) — ver anexos-totales-seccion.ts ─────────────────
// Con los precios unitarios ya resueltos (paso de arriba), cruza cantidad × precio por fila de
// cada tabla de ítems, agrupa por su título de sección, y llena la tabla resumen que pide ESE
// total (patrón real 1738-18-LE26: "LÍNEA | MONTO TOTAL OFERTADO | PLAZO..."). Compartido entre
// analizarAnexoParaUI y generarAnexoFinal — con una diferencia a propósito: en generarAnexoFinal
// también cuentan los precios que el HUMANO escribió a mano para las celdas que el costeo no
// pudo cruzar solo (`respuestas`, ver más abajo). Sin esto, si a la IA se le escapaba UN ítem de
// una línea con 30, esa línea quedaba sin total PARA SIEMPRE aunque el usuario llenara el precio
// que faltaba — el total nunca se recalculaba. La vista previa (analizarAnexoParaUI) sigue
// mostrando solo lo automático porque ahí todavía no existe ninguna respuesta del humano.
function aplicarTotalesPorSeccion(
  tablasCrudo: TablaCruda[], parrafos: Parrafo[], indicesEnTablas: Set<number>,
  matcheados: CampoResuelto[], pendientes: CandidatoCelda[], respuestas?: Record<string, string>,
): { matcheadosExtra: CampoResuelto[]; pendientesFiltrados: CandidatoCelda[]; anexarDirecto: { paraId: string; valor: string }[]; titulos: TituloCercano[] } {
  const titulos: TituloCercano[] = encabezadosLibres(parrafos, indicesEnTablas);
  // Los precios que salieron del costeo son números confiables por construcción; los que escribió
  // el humano se toman tal cual SI son un número válido — filtrar por `via` en el primer caso, y
  // parsear+validar en el segundo, es la garantía de que nunca se suma algo que no es plata.
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

// ── Auto-relleno de blancos INLINE ("Proveedor: ______") ──────────────────────────────────
// Hasta jul-2026 los blancos inline solo se llenaban con lo que escribía el humano: nunca pasaban
// por el diccionario, aunque su etiqueta fuera tan explícita como la de una celda. Por eso, en un
// documento con varios formularios pegados, los datos de la empresa se completaban solos en la
// tabla del FORMULARIO N°1 pero quedaban en blanco en el N°2 y el N°4, que piden LOS MISMOS datos
// escritos como texto corrido ("Nombre o Razón Social:____", "RUT:____", "Proveedor:____") —
// justo lo que el usuario pedía: que lo automático quede en cada formulario que lo pida.
//
// Guarda deliberada: solo se autocompleta si el contexto TERMINA EN DOS PUNTOS. Esa es la marca de
// un campo etiquetado ("RUT: ____") y distingue el caso seguro de una declaración jurada corrida
// ("Yo, Juan Pérez, RUT ____, en representación de…"), donde el contexto que queda antes del blanco
// también sería "RUT" pero el dato pedido es el de una PERSONA, no el de la empresa — escribir ahí
// el RUT de la empresa sería exactamente el tipo de error que el diccionario evita a propósito.
const RE_CONTEXTO_ETIQUETADO = /:\s*$/;

// Patrón 5 ("Etiqueta:" y el valor va a continuación, misma línea): SOLO diccionario, nunca IA —
// ver detectarCamposConDosPuntos. Un título que termina en dos puntos tiene exactamente la misma
// forma que un campo, así que solo se escribe cuando el match es determinista y seguro.
export function resolverCamposConDosPuntos(
  campos: CandidatoCelda[], empresa: EmpresaCampos,
): { c: CandidatoCelda; campo: string; valor: string }[] {
  const out: { c: CandidatoCelda; campo: string; valor: string }[] = [];
  for (const c of campos) {
    const match = buscarCampo(c.etiqueta, empresa);
    if (match) out.push({ c, campo: match.campo, valor: match.valor });
  }
  return out;
}

export interface InlineAuto { b: CandidatoInline; campo: string; valor: string; etiqueta: string }

export function resolverBlancosInline(
  blancos: CandidatoInline[], empresa: EmpresaCampos,
): { auto: InlineAuto[]; pendientes: CandidatoInline[] } {
  const auto: InlineAuto[] = [];
  const pendientes: CandidatoInline[] = [];
  for (const b of blancos) {
    const etiqueta = b.contexto.trim();
    const match = RE_CONTEXTO_ETIQUETADO.test(etiqueta) ? buscarCampo(etiqueta, empresa) : null;
    if (match) auto.push({ b, campo: match.campo, valor: match.valor, etiqueta: etiqueta.replace(/\s*:\s*$/, '') });
    else pendientes.push(b);
  }
  return { auto, pendientes };
}

export interface FirmaInfo { detectada: boolean; disponible: boolean }

export interface AnalisisAnexo {
  completadosAuto: CampoCompletado[];
  pendientesCelda: PendienteCelda[];
  pendientesInline: PendienteInline[];
  tablas: TablaUI[];
  secciones: SeccionInfo[];
  firma: FirmaInfo;
  // Títulos de los formularios EN EL ORDEN DEL DOCUMENTO. La pantalla arma sus grupos a partir de
  // varias listas (pendientes, tablas, completados) y sin esto los mostraba en el orden en que
  // aparecían en la primera lista — el anexo de 4291 salía como N°2, N°4, N°1, que no se parece a
  // nada de lo que el usuario tiene delante en el Word.
  ordenFormularios: string[];
}

// Resolución de cada candidato de celda, para poder mapearla después sobre la tabla completa
// (extraerTablasCrudo) — evita tener DOS lugares que decidan "esto se completó solo" / "esto
// quedó pendiente", que podrían divergir.
type Resolucion =
  | { tipo: 'auto'; etiqueta: string; campo: string; valor: string; via: 'diccionario' | 'ia' | 'costeo' }
  | { tipo: 'pendiente'; etiqueta: string; id: string };

export async function analizarAnexoParaUI(
  bufferOriginal: Buffer, empresa: EmpresaCampos, itemsCosteo?: ItemCosteoPrecio[],
): Promise<AnalisisAnexo> {
  const { xml: xmlCrudo } = await abrirDocx(bufferOriginal);
  const { xml: xmlNormalizado } = normalizarParaIds(xmlCrudo);
  const analisis = analizarAnexo(xmlNormalizado);
  const formularios = detectarFormularios(xmlNormalizado);

  const tablasCrudo = extraerTablasCrudo(xmlNormalizado);
  const indicesEnTablas = new Set(
    tablasCrudo.flatMap(t => t.filas.flatMap(f => f.celdas.map(c => c.indiceGlobal).filter((i): i is number => i != null))),
  );
  const completadosAuto: CampoCompletado[] = [];
  const resolucionPorIndice = new Map<number, Resolucion>();
  const { matcheados, pendientes, descartadosComoTitulo } = await resolverCandidatosCelda(analisis.candidatosCelda, empresa, analisis.indicesSoloManual, itemsCosteo, analisis.parrafos);
  const { matcheadosExtra, pendientesFiltrados, anexarDirecto, titulos }
    = aplicarTotalesPorSeccion(tablasCrudo, analisis.parrafos, indicesEnTablas, matcheados, pendientes);
  const matcheadosTodos = [...matcheados, ...matcheadosExtra];
  for (const m of matcheadosTodos) {
    completadosAuto.push({
      etiqueta: m.c.etiqueta, campo: m.campo, valor: m.valor, via: m.via,
      formulario: formularioDe(m.c.indice, formularios),
    });
    resolucionPorIndice.set(m.c.indice, { tipo: 'auto', etiqueta: m.c.etiqueta, campo: m.campo, valor: m.valor, via: m.via });
  }

  const pendientesCeldaTodos: PendienteCelda[] = pendientesFiltrados.map(c => {
    const id = `celda:${c.indice}`;
    resolucionPorIndice.set(c.indice, { tipo: 'pendiente', etiqueta: c.etiqueta, id });
    return { id, etiqueta: c.etiqueta, formulario: formularioDe(c.indice, formularios) };
  });
  // Los descartados como título entran a la vista de tabla (con su input) pero no a la lista plana
  // — ver el comentario en resolverCandidatosCelda.
  for (const c of descartadosComoTitulo) {
    resolucionPorIndice.set(c.indice, { tipo: 'pendiente', etiqueta: c.etiqueta, id: `celda:${c.indice}` });
  }

  // Reconstruye cada tabla del Word COMPLETA (todas las celdas, no solo las vacías) para que el
  // panel de pendientes se vea como el documento real — fila por fila, columna por columna — en
  // vez de una lista plana donde no se sabe a qué celda corresponde cada blanco. Se devuelven
  // TODAS las tablas con al menos un candidato real (pendiente O ya resuelto) — antes solo se
  // mostraban las que tenían algo pendiente, así que una tabla 100% completada sola (ej. la
  // identificación del oferente repetida en cada anexo) desaparecía del panel sin dejar rastro:
  // pedido explícito, "quiero que me muestre esos datos tal cual, así sé a qué pertenecen".
  const rellenosPorParaId = new Map(anexarDirecto.map(r => [r.paraId, r]));
  const tablas: TablaUI[] = tablasCrudo
    .map(t => ({
      formulario: t.indicePrimero != null ? formularioDe(t.indicePrimero, formularios) : undefined,
      titulo: tituloDeTabla(t.indicePrimero, titulos)?.texto,
      filas: t.filas.map(f => f.celdas.map((c): CeldaTablaUI => {
        // Total de sección ya calculado (ver aplicarTotalesPorSeccion): la celda puede no estar
        // "vacía" en sentido estricto (ej. trae un "$" fijo) — el valor se agrega al texto que
        // ya existe, nunca se pisa.
        const relleno = c.ultimoParaId ? rellenosPorParaId.get(c.ultimoParaId) : undefined;
        if (relleno) return { texto: c.texto, auto: { valor: `${c.texto ? c.texto + ' ' : ''}${relleno.valor}`, via: 'costeo' } };
        if (c.indiceGlobal == null) return { texto: c.texto };
        const res = resolucionPorIndice.get(c.indiceGlobal);
        if (!res) return { texto: c.texto }; // celda vacía pero no es candidato real (decorativa, sección omitida, etc.)
        if (res.tipo === 'auto') return { texto: '', auto: { valor: res.valor, via: res.via } };
        return { texto: '', input: { id: res.id } };
      })),
    }))
    .filter(t => t.filas.some(f => f.some(c => c.input || c.auto)));

  // Los pendientes de celda que YA se muestran dentro de una tabla no se repiten en la lista
  // plana — solo quedan ahí los que no pertenecen a ninguna tabla detectada (ej. una etiqueta
  // suelta en medio del texto, sin estructura tabular real que mostrar).
  const pendientesCelda = pendientesCeldaTodos.filter(p => {
    const indice = Number(p.id.split(':')[1]);
    return !indicesEnTablas.has(indice);
  });

  // Mismos dos grupos que usa generarAnexoFinal — la misma función decide en los dos lados qué se
  // completa solo, para que la pantalla no prometa algo distinto de lo que el documento hará.
  const inline = resolverBlancosInline(analisis.blancosInline, empresa);
  for (const a of inline.auto) {
    completadosAuto.push({
      etiqueta: a.etiqueta, campo: a.campo, valor: a.valor, via: 'diccionario',
      formulario: formularioDe(a.b.indiceParrafo, formularios),
    });
  }
  for (const r of resolverCamposConDosPuntos(analisis.camposConDosPuntos, empresa)) {
    completadosAuto.push({
      etiqueta: r.c.etiqueta, campo: r.campo, valor: r.valor, via: 'diccionario',
      formulario: formularioDe(r.c.indice, formularios),
    });
  }
  const pendientesInline: PendienteInline[] = inline.pendientes.map(b => ({
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
    ordenFormularios: formularios.map(f => f.titulo),
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
  //    Los que tienen etiqueta reconocible se completan solos con el diccionario (ver
  //    resolverBlancosInline); el resto queda para lo que haya escrito el humano.
  let completadosInline = 0;
  const porRun = new Map<number, { pos: number; largo: number; valor: string }[]>();
  const anotar = (b: CandidatoInline, valor: string) => {
    if (!porRun.has(b.indiceRun)) porRun.set(b.indiceRun, []);
    porRun.get(b.indiceRun)!.push({ pos: b.posEnTexto, largo: b.largo, valor });
  };
  const inline = resolverBlancosInline(analisis.blancosInline, empresa);
  for (const a of inline.auto) {
    anotar(a.b, a.valor);
    completadosInline++;
  }
  for (const b of inline.pendientes) {
    const respuesta = respuestas[`inline:${b.indiceRun}:${b.posEnTexto}`];
    if (!respuesta || !respuesta.trim()) continue;
    anotar(b, respuesta.trim());
    respondidos++;
  }
  for (const [indiceRun, ediciones] of porRun) {
    xml = rellenarRunPorIndice(xml, indiceRun, ediciones);
  }

  // 2) Celdas de tabla: diccionario → respaldo IA → lo que escribió el humano. Van después —
  //    ver comentario arriba.
  let completados = completadosInline;
  const { matcheados, pendientes, descartadosComoTitulo } = await resolverCandidatosCelda(analisis.candidatosCelda, empresa, analisis.indicesSoloManual, itemsCosteo, analisis.parrafos);
  // Totales por sección (LÍNEA/LOTE/ÍTEM...) — MISMO cálculo que ve el admin en la vista previa
  // (aplicarTotalesPorSeccion), sobre las tablas del documento SIN mutar (tablasCrudo se saca de
  // xmlNormalizado, antes de que el paso 1 y este mismo paso empiecen a escribir encima).
  const tablasCrudo = extraerTablasCrudo(xmlNormalizado);
  const indicesEnTablasGen = new Set(
    tablasCrudo.flatMap(t => t.filas.flatMap(f => f.celdas.map(c => c.indiceGlobal).filter((i): i is number => i != null))),
  );
  const { matcheadosExtra, pendientesFiltrados, anexarDirecto } = aplicarTotalesPorSeccion(tablasCrudo, analisis.parrafos, indicesEnTablasGen, matcheados, pendientes, respuestas);
  for (const m of [...matcheados, ...matcheadosExtra]) {
    xml = rellenarCeldaVacia(xml, m.c.paraId, m.valor);
    completados++;
  }
  // Los descartados como título se escriben igual SI el humano les puso algo desde la vista de
  // tabla — no se ofrecen solos, pero tampoco se ignora lo que el usuario escribió.
  for (const c of [...pendientesFiltrados, ...descartadosComoTitulo]) {
    const respuesta = respuestas[`celda:${c.indice}`];
    if (respuesta && respuesta.trim()) {
      xml = rellenarCeldaVacia(xml, c.paraId, respuesta.trim());
      respondidos++;
    }
  }
  // Celdas que YA traían un prefijo fijo (ej. "$") y no una celda vacía: el total se agrega al
  // final del mismo párrafo, nunca se pisa lo que ya estaba impreso.
  for (const a of anexarDirecto) {
    xml = rellenarFinDeParrafo(xml, a.paraId, a.valor);
    completados++;
  }

  // 2b) "Etiqueta:" con el valor en la misma línea (patrón 5).
  for (const r of resolverCamposConDosPuntos(analisis.camposConDosPuntos, empresa)) {
    xml = rellenarFinDeParrafo(xml, r.c.paraId, r.valor);
    completados++;
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
