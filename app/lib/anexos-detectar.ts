// app/lib/anexos-detectar.ts
// Frente E.1 — detección de campos a rellenar en un anexo real, sin conocimiento previo del
// documento. Probado contra 4 anexos reales de 4 organismos (Chile Chico, Lo Barnechea, y 2
// más) — ver docs/BITACORA-CAMBIOS-VIABILIDAD.md para el detalle de cada hallazgo.
import { listarParrafos, listarBlancosInline, parrafoEstaVacio, decodificarXml, textoDeRuns, type Parrafo } from '@/app/lib/anexos-docx';
import { RE_ENCABEZADO_FORMULARIO } from '@/app/lib/anexos-dividir';

// Vocabulario de ROL cercano a una etiqueta duplicada ("<contexto> — <campo>", ver
// desambiguarDuplicados más abajo) — dice A QUIÉN describe un duplicado (representante legal,
// bloque bancario, la misma persona de la ficha bajo otro título, o un tercero ajeno). Vivía en
// el diccionario (anexos-diccionario.ts, borrado — el motor 100% IA ya no lo necesita para
// decidir VALORES), pero esto es detección ESTRUCTURAL: sigue haciendo falta para saber qué
// CONTEXTO mostrarle al motor de IA cuando el mismo texto corto se repite en bloques distintos.
const CONTEXTO_REPRESENTANTE = /(representante\s+legal|rep\.?\s*legal)/i;
const CONTEXTO_BANCARIO = /(banco|cuenta\s+(bancaria|corriente|vista)|entidad\s+bancaria|titular)/i;
const CONTEXTO_MISMA_PERSONA = /(encargado|contacto|administrador(\s+de\s+contrato)?|coordinador|responsable|ejecutivo|apoderado|coordinaci[óo]n|coordinador[ao])/i;
const CONTEXTO_TERCERO_AJENO = /(u\.?t\.?p\.?|uni[óo]n\s+temporal|integrante|socio|accionista|mandante|contraparte|inspector|i\.?t\.?o\.?|participante|capacitaci[óo]n|asistente|testigo|notario|proveedor\s+asociado|subcontrat)/i;

// ── Patrón 1: etiqueta corta + párrafo vacío inmediatamente después ───────────────────────
// (celda de tabla de 2 columnas: "Razón social" | <celda vacía>). Es RUIDOSO a propósito: no
// distingue un título corto ("ANEXO N°1") de un campo real ("RUT") — esa distinción la hace
// después el diccionario (anexos-diccionario.ts): si la etiqueta no cruza con ningún campo
// conocido, no se autocompleta nada, como mucho queda disponible para que un humano la vea.
export interface CandidatoCelda {
  etiqueta: string; paraId: string; indice: number;
  // La celda se muestra para que la llene un humano, pero NUNCA se autocompleta sola. Se usa para
  // las filas en blanco de una tabla que se llena entera (ver detectarCandidatosTabla) y para las
  // secciones de oferente que no nos corresponden (ver analizarAnexo).
  soloManual?: boolean;
}

// Versión CRUDA (sin desambiguarDuplicados) — la necesita el clasificador por IA
// (anexos-clasificar-ia.ts): ese módulo reemplaza el heurístico "prefijo con el candidato
// anterior en la lista" por contexto real (fila/columna de tabla, párrafos previos), así que
// necesita la etiqueta TAL CUAL la vio el patrón 1, no ya mezclada con un vecino. El camino
// viejo (determinista) sigue usando `detectarCandidatosCelda` (con desambiguación) sin cambios.
export function detectarCandidatosCeldaCrudos(parrafos: Parrafo[]): CandidatoCelda[] {
  const out: CandidatoCelda[] = [];
  for (let i = 0; i < parrafos.length - 1; i++) {
    const actual = parrafos[i];
    const siguiente = parrafos[i + 1];
    // Un párrafo CENTRADO seguido de blanco es un encabezado/título de sección (Word centra
    // títulos, nunca etiquetas de campo — esas siempre van alineadas a la izquierda para calzar
    // con su blanco al lado o abajo). Caso real: "IDENTIFICACION DEL OFERENTE" como título de
    // página, centrado y en negrita, antes de la tabla real de identificación — textualmente casi
    // idéntico a la etiqueta real de una fila de esa misma tabla ("IDENTIFICACIÓN DEL OFERENTE"),
    // así que ni el diccionario ni un clasificador de IA por texto puro pueden distinguirlos de
    // forma confiable — pero la alineación SÍ los distingue, sin ambigüedad y sin costo de IA.
    if (!actual.texto || actual.texto.length > 60 || actual.centrado || !siguiente.vacio) continue;

    // La LEYENDA de una línea de firma ("Firma del Oferente o Represente Legal.", el párrafo justo
    // debajo de la raya) no es la etiqueta de un campo — el párrafo vacío que le sigue es puro
    // espaciado hasta el siguiente bloque. BUG REAL (4291-38-LP26, visto al exportar el .docx
    // generado a PDF): como la etiqueta menciona "firma", analizarAnexo la mandaba a lineasFirma y
    // estampaba la imagen de la firma en ese espaciado — quedaban DOS firmas seguidas, una sobre la
    // leyenda y otra debajo.
    if (i > 0 && RE_RAYA_LARGA.test(parrafos[i - 1].texto) && RE_LEYENDA_FIRMA.test(actual.texto)) continue;

    // Un párrafo que YA trae su propio blanco ("Antofagasta,________________") tampoco es la
    // etiqueta de otro campo: ese blanco lo cubre el patrón 2 (inline), y el párrafo vacío
    // siguiente es de nuevo espaciado. Sin esto se pedía el mismo dato dos veces —y, por la
    // desambiguación de duplicados, con el prefijo "Firma del Oferente…" pegado adelante.
    if (/_{4,}/.test(actual.texto)) continue;

    out.push({ etiqueta: actual.texto, paraId: siguiente.paraId, indice: siguiente.indice });
  }
  return out;
}

export function detectarCandidatosCelda(parrafos: Parrafo[]): CandidatoCelda[] {
  return desambiguarDuplicados(detectarCandidatosCeldaCrudos(parrafos), parrafos);
}

// Caso real (1738-18-LE26): una tabla de identificación trae "RUT" DOS veces — una fila para el
// RUT del oferente, otra para el RUT del representante legal. El texto es LITERALMENTE idéntico
// ("RUT") en ambas, así que ni el diccionario ni la IA tienen cómo distinguir cuál es cuál — el
// diccionario asigna el campo `rut` a la primera que ve y la segunda queda sin poder resolverse
// (el campo ya fue "usado"), y la IA recibe dos líneas idénticas sin nada que las diferencie.
//
// Cuando una etiqueta se repite en el documento, se prefija con el ROL más cercano encontrado
// escaneando HACIA ATRÁS en los PÁRRAFOS REALES del documento (representante legal / cuenta
// bancaria / un tercero del que no tenemos datos — mismo vocabulario que usa buscarCampo en
// anexos-diccionario.ts). Reemplaza un heurístico anterior ("prefijar con el candidato
// INMEDIATAMENTE anterior en la lista de candidatos") que fallaba en dos casos reales:
//   1. El "anterior" podía ser ruido de una celda vecina sin relación real (1057472-89-LE26:
//      "Fax —" bloqueaba el correo de la empresa, porque "Fax" no es un rol reconocido y
//      buscarCampo trataba cualquier contexto no reconocido como "tercero desconocido").
//   2. La PRIMERA aparición de una etiqueta duplicada en TODO el documento no tenía ningún
//      "anterior" del cual heredar contexto — el bloque REPRESENTANTE LEGAL completo (Nombre,
//      RUT, Cargo) quedaba vacío por esto, aunque la ficha de empresa SÍ tiene esos datos.
// Escaneando los párrafos reales en vez de la lista de candidatos, "REPRESENTANTE LEGAL:" se
// encuentra sin importar si es la primera vez que aparece "Nombre completo" en el documento.
//
// Compara por texto NORMALIZADO, no literal — caso real encontrado (1058086-43-LP26): "N° de
// Teléfono" (bloque del Administrador de Contrato, sin dos puntos) y "N° de Teléfono:" (bloque
// de la empresa, con dos puntos) son EL MISMO campo con puntuación distinta — comparar el string
// crudo no los reconocía como duplicados, así que ninguno se prefijaba con su contexto, y ambos
// terminaban rellenados con el teléfono de la empresa aunque el primero le pertenece a otra
// persona (de la que no tenemos datos). Normalizar antes de comparar (sin tocar la etiqueta que
// se muestra) hace que este caso SÍ dispare la desambiguación de abajo.
function normalizarParaCompararDuplicados(etiqueta: string): string {
  return etiqueta.trim().toLowerCase().replace(/[:.\s]+$/, '');
}

const RE_CONTEXTO_ROL = new RegExp(
  `(${CONTEXTO_REPRESENTANTE.source})|(${CONTEXTO_BANCARIO.source})|(${CONTEXTO_MISMA_PERSONA.source})|(${CONTEXTO_TERCERO_AJENO.source})`, 'i',
);

// Ventana corta a propósito: un rol mencionado muy lejos (ej. en OTRO formulario, muchos párrafos
// atrás) no describe el bloque actual — solo cuenta el más cercano dentro de una distancia corta,
// que es donde realmente viven los encabezados de sección ("REPRESENTANTE LEGAL:",
// "CONTACTO DEL PROPONENTE:") en los documentos reales vistos.
const VENTANA_CONTEXTO_ROL = 15;

// BUG REAL encontrado (1738-18-LE26): la leyenda de firma del ANEXO N°1 ("FIRMA Y TIMBRE
// OFERENTE O REPRESENTANTE LEGAL") menciona "representante legal" — no porque describa de quién
// es un dato, sino porque dice QUIÉN DEBE FIRMAR. Sin excluirla, se tomaba como si fuera el
// encabezado de un bloque de datos: el RUT del OFERENTE (en el ANEXO N°2, bastante más adelante)
// terminaba prefijado con esa leyenda, resolviendo al RUT DEL REPRESENTANTE (dato de otra
// persona) — y de paso, como la etiqueta resultante contenía la palabra "firma", el candidato se
// reclasificaba entero como "acá va la imagen de la firma" (ver esEtiquetaFirma en analizarAnexo),
// así que la firma escaneada habría terminado estampada en la celda del RUT. Una leyenda de firma
// NUNCA describe de quién es un dato de texto — se descarta como fuente de contexto, se sigue
// buscando más atrás.
function esLeyendaDeFirma(texto: string): boolean {
  return /firma/i.test(texto);
}

function contextoDeRolCercano(parrafos: Parrafo[], antesDeIndice: number): string | null {
  let vistos = 0;
  for (let i = antesDeIndice - 1; i >= 0 && vistos < VENTANA_CONTEXTO_ROL; i--) {
    const p = parrafos[i];
    if (!p?.texto) continue;
    vistos++;
    if (esLeyendaDeFirma(p.texto)) continue;
    if (RE_CONTEXTO_ROL.test(p.texto)) return p.texto;
  }
  return null;
}

function desambiguarDuplicados(candidatos: CandidatoCelda[], parrafos: Parrafo[]): CandidatoCelda[] {
  const conteo = new Map<string, number>();
  for (const c of candidatos) {
    const clave = normalizarParaCompararDuplicados(c.etiqueta);
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }
  return candidatos.map(c => {
    const clave = normalizarParaCompararDuplicados(c.etiqueta);
    if ((conteo.get(clave) ?? 0) < 2) return c;
    // Sin rol reconocido cerca: se deja tal cual — es el caso NORMAL de un dato de empresa
    // pedido de nuevo en otro formulario del mismo documento, no una ambigüedad real.
    const contexto = contextoDeRolCercano(parrafos, c.indice - 1);
    if (!contexto) return c;
    return { ...c, etiqueta: `${contexto} — ${c.etiqueta}`.slice(0, 160) };
  });
}

// ── Patrón 1b: celdas dentro de TABLAS de 3+ columnas (specs, evaluación técnica…) ────────
// El patrón 1 asume una tabla de 2 columnas "Etiqueta | Valor" — el párrafo justo antes de la
// celda vacía ES la etiqueta. En una tabla de más columnas (N° | Especificación | Criterio |
// SI/NO | Observaciones), el párrafo "justo antes" de una celda vacía es apenas OTRA columna de
// la MISMA fila (ej. "CO", el valor de Criterio) — no describe qué hay que escribir ahí. Acá se
// arma la etiqueta con la celda MÁS LARGA de la fila (heurística: la columna de descripción
// siempre es la más larga en una tabla de requisitos) + el nombre de columna, sacado de la
// primera fila de la tabla (encabezado). Caso real: hallado en un Anexo de Evaluación Técnica
// donde el patrón 1 mostraba "CO" como etiqueta cuatro veces sin poder distinguirlas.
//
// Límite conocido y aceptado: usa regex, no un parser XML real — una tabla ANIDADA dentro de
// una celda puede confundir el emparejamiento de <w:tr>/<w:tc>. Bajo riesgo aquí porque solo
// afecta la ETIQUETA mostrada al humano (nunca escribe el valor solo) — el peor caso es una
// etiqueta rara, no un dato incorrecto en el documento.
function offsetsAIndices(xml: string): Map<number, number> {
  const mapa = new Map<number, number>();
  let indice = 0;
  for (const m of xml.matchAll(/<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>[\s\S]*?<\/w:p>/g)) {
    mapa.set(m.index!, indice);
    indice++;
  }
  return mapa;
}

// Párrafos de tabla que Patrón 1 (detectarCandidatosCelda, ciego a filas/columnas) NUNCA debería
// ofrecer como campo — dos motivos distintos, ambos reales (1738-18-LE26):
//
//  1. Relleno decorativo DENTRO de una celda que YA tiene texto (hábito de Word: Enter después de
//     escribir, dejando un párrafo vacío de más en la misma celda) — ej. la celda de encabezado
//     "CANTIDAD" o la celda de etiqueta "LÍNEA 1: LETRERO DE OBRAS". A nivel de CELDA no están
//     vacías, así que Patrón 1b (detectarCandidatosTabla) las ignora correctamente, pero Patrón 1
//     sí ve "texto corto + párrafo vacío después" y ofrece ESE relleno como si fuera un campo real.
//     El párrafo vacío "de más" puede ir ANTES del texto o DESPUÉS (ej. la celda de encabezado
//     "PRECIO" empieza con un párrafo vacío y el texto viene en el segundo) — cualquier párrafo
//     vacío dentro de una celda que en conjunto SÍ tiene texto es relleno, sea cual sea su posición.
//
//  2. Celdas angostas de puro relleno de layout — MISMO umbral que ya usa Patrón 1b
//     (ANCHO_PCT_MINIMO_COLUMNA_REAL, ver detectarCandidatosTabla): una columna partida en 2-3
//     celdas sueltas en las filas de datos, donde la real mide 400+ de 5000 y las decorativas unas
//     pocas decenas. Patrón 1b ya las descarta aunque estén VACÍAS; Patrón 1, que no conoce el
//     ancho de ninguna celda, las ofrecía igual como campo suelto.
//
// A propósito NO se excluye toda celda vacía normal (esa sigue cubierta por Patrón 1, ver "2
// columnas ya las cubre el patrón 1" en detectarCandidatosTabla) — solo estas dos formas de
// relleno, que nunca son un campo real a llenar en ningún caso.
function parrafosQueNuncaSonCampoEnTabla(xml: string): Set<number> {
  const offsetsIndices = offsetsAIndices(xml);
  const excluidos = new Set<number>();
  for (const tc of xml.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
    const cuerpoCelda = tc[1];
    const anchoMatch = tc[0].match(/<w:tcW\s+w:w="(\d+)"\s+w:type="pct"/);
    const anchoPct = anchoMatch ? Number(anchoMatch[1]) : null;
    const angosta = anchoPct != null && anchoPct < ANCHO_PCT_MINIMO_COLUMNA_REAL;

    const parrafosCelda = [...cuerpoCelda.matchAll(/<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>([\s\S]*?)<\/w:p>/g)];
    const offsetCelda = tc.index! + tc[0].indexOf(cuerpoCelda);
    const textoCelda = parrafosCelda.map(p => textoDeRuns(p[1])).join('').trim();

    if (angosta) {
      // Celda decorativa por ancho: NINGUNO de sus párrafos es un campo real, tenga texto o no.
      for (const p of parrafosCelda) {
        const indice = offsetsIndices.get(offsetCelda + (p.index ?? 0));
        if (indice != null) excluidos.add(indice);
      }
      continue;
    }
    if (parrafosCelda.length < 2 || !textoCelda) continue; // sin relleno "de más" que excluir
    for (const p of parrafosCelda) {
      if (!parrafoEstaVacio(p[1])) continue;
      const indice = offsetsIndices.get(offsetCelda + (p.index ?? 0));
      if (indice != null) excluidos.add(indice);
    }
  }
  return excluidos;
}

interface CeldaCruda {
  texto: string; vacio: boolean; paraId: string | null; indiceGlobal: number | null; anchoPct: number | null;
  // El paraId del ÚLTIMO párrafo de la celda, SIEMPRE presente (a diferencia de `paraId`, que
  // solo se llena si la celda está vacía) — lo necesita anexos-totales-seccion.ts para poder
  // escribir en celdas que no son técnicamente "vacías" pero traen un prefijo fijo sin blanco
  // propio (ej. una celda cuyo único contenido es "$", el número va pegado después).
  ultimoParaId: string | null;
}

// Umbral de "celda decorativa": encontrado en un anexo real donde una columna de categoría del
// encabezado ("LETRERO INDICADOR DE OBRAS") venía MERGEADA en el encabezado pero partida en 3
// celdas angostas sueltas en cada fila de datos (sin <w:vMerge>, boradesr) — cada una de ~245
// (4.9% del ancho, escala pct de OOXML es 0-5000) contra columnas reales de 550+ (11%+). Sin
// filtrar esto, esas 3 celdas angostas se ofrecían como blancos a rellenar (con la etiqueta de
// columna mal calzada, ver comentario en detectarCandidatosTabla) — nunca son un dato real, son
// puro relleno visual de layout.
const ANCHO_PCT_MINIMO_COLUMNA_REAL = 400;

// Ubica cada celda de una fila en la columna del encabezado que le corresponde por ANCHO REAL
// (w:tcW, escala pct 0-5000 de OOXML), no por índice de posición simple. Necesario porque una
// columna del encabezado puede venir partida en 2-3 celdas angostas sueltas en las filas de
// datos (sin <w:vMerge>) — CUALQUIER cantidad, y no siempre al principio de la fila (caso real
// visto en 1738-18-LE26: distintas filas de la MISMA tabla traen distinta cantidad de celdas de
// relleno, a veces antes de la descripción, a veces en medio) — alinear por índice (incluso
// "desde la derecha") descuadra la columna real en cuanto el patrón de relleno cambia de fila en
// fila. Comparando la posición ACUMULADA de cada celda contra los límites del encabezado, cada
// celda cae en la columna que geométricamente ocupa, sin importar cuántas haya antes o después.
// Compartida entre detectarCandidatosTabla (qué celda es un candidato a rellenar y con qué
// nombre de columna) y extraerTablasCrudo/alinearFilaConEncabezado (cómo se ve la fila completa
// en la vista de tabla) — antes cada uno tenía su propia lógica de alineación y podían no
// coincidir (un PRECIO real detectado como candidato, pero mostrado bajo la columna equivocada,
// o directamente no detectado porque el índice desde la derecha caía mal).
function columnasPorAncho(anchosHeader: (number | null)[], anchosFila: (number | null)[]): number[] {
  const anchoTotal = anchosHeader.reduce((a: number, w) => a + (w ?? 0), 0) || 5000;
  let acc = 0;
  const inicios = anchosHeader.map(w => {
    const inicio = acc;
    acc += w ?? (anchoTotal / anchosHeader.length);
    return inicio;
  });

  const resultado: number[] = [];
  let pos = 0;
  for (const w of anchosFila) {
    const ancho = w ?? (anchoTotal / anchosFila.length);
    let col = 0;
    for (let k = 0; k < inicios.length; k++) if (pos >= inicios[k] - 1) col = k;
    resultado.push(col);
    pos += ancho;
  }
  return resultado;
}

// ¿Cuál es la fila de ENCABEZADO de esta tabla, si es que tiene una?
//
// Recibe, por fila y en orden, si TODAS sus celdas traen texto. Devuelve el índice de la última
// fila del bloque inicial que cumple eso, o -1 si ni la primera lo cumple (entonces la tabla no
// tiene encabezado: es una tabla de FORMULARIO, [etiqueta][valor][etiqueta][valor], que maneja el
// patrón 1). Un encabezado real siempre tiene todas sus columnas nombradas; en cuanto aparece una
// celda en blanco, ya empezaron los datos.
//
// Las tres cosas que esto resuelve, todas casos reales:
//  · "INTEGRANTES DE LA UTP", "DATOS DEL REPRESENTANTE O APODERADO", "DATOS DEL EJECUTIVO
//    COORDINADOR" y la tabla de participantes del acta (4291-38-LP26) abren con una fila-TÍTULO de
//    una sola celda mergeada; el encabezado real es la fila siguiente. Tomando el título por
//    encabezado, la tabla quedaba de una columna y alinearFilaConEncabezado colapsaba ahí las 3-5
//    celdas de cada fila de datos: esas cajas salían en pantalla sin una sola casilla donde escribir.
//  · La tabla de cierre del acta ("Para uso exclusivo Proveedor Adjudicado" | "Para uso exclusivo
//    Universidad de Antofagasta") es al revés: ESA primera fila SÍ es el encabezado, y la siguiente
//    ya trae blancos. Quedarse con la de más columnas rompía la distinción entre los dos bloques y
//    el RUT de la empresa terminaba ofrecido también para el lado de la universidad.
//  · BUG REAL (1057472-89-LE26, "DATOS DEL PROPONENTE"): una tabla de FORMULARIO (2 columnas
//    [etiqueta][valor], SIN encabezado real) que abre con una fila-TÍTULO de una sola celda
//    mergeada ("DATOS DEL PROPONENTE:") — sin encabezado real después, solo filas de datos. Antes,
//    esa fila-título de 1 celda (con texto → "completa") se tomaba directo por encabezado de la
//    tabla entera: alinearFilaConEncabezado, con un encabezado de 1 columna, colapsaba cada fila de
//    2 celdas en una sola, perdiendo el indiceGlobal de la celda vacía (queda en la celda de
//    ETIQUETA, que nunca está vacía) — la fila entera desaparecía de la vista de tabla real, y el
//    bloque completo (Nombre, RUT, Domicilio, Teléfono...) cayó a la lista plana de "pendientes/se
//    completa solo" en vez de mostrarse como la tabla que es. Una fila de 1 sola celda NUNCA es un
//    encabezado de columnas real (no hay nada que alinear contra ella) — se salta sin cortar el
//    rastreo, exactamente igual que el caso UTP de arriba, para que el encabezado real (si existe)
//    se seguya buscando en la fila siguiente.
//  · BUG REAL (1057472-89-LE26, "ESPECIFICACIONES TÉCNICAS", ANEXO N°4): la fila que abre cada
//    ítem trae Nº + descripción del producto en 2 celdas normales, MÁS una celda con
//    `<w:gridSpan w:val="4">` que combina las 4 columnas restantes en una sola ("Requisitos
//    excluyentes:") — sus 3 celdas TIENEN texto, así que "todas sus celdas con texto" la marcaba
//    como el encabezado real de la tabla (en vez del la fila 0, la de verdad, con los 6 nombres de
//    columna). Con ese encabezado fantasma de 3 columnas, alinearFilaConEncabezado colapsaba las 6
//    celdas de CADA fila de requisito (Cumple/Catálogo/Observaciones incluidas) contra solo 3
//    columnas — "Cumple (Sí/No)", "Catálogo" y "Observaciones del Proveedor" quedaban fusionadas
//    sin casilla en la mitad de las filas, exactamente lo que no dejaba rellenar el usuario. Una
//    celda combinada (gridSpan) fusiona VARIAS columnas en una — lo opuesto de lo que hace un
//    encabezado real (nombrar cada columna por separado) — así que tampoco cuenta como encabezado.
export function indiceFilaEncabezado(filas: { completa: boolean; numCeldas: number; tieneCeldaCombinada?: boolean }[]): number {
  let ultimo = -1;
  for (let i = 0; i < filas.length; i++) {
    if (!filas[i].completa) break;
    // fila-título de 1 celda, o fila con alguna celda combinada (gridSpan): ninguna de las dos es
    // el encabezado real — se salta sin cortar el rastreo.
    if (filas[i].numCeldas < 2 || filas[i].tieneCeldaCombinada) continue;
    ultimo = i;
  }
  return ultimo;
}

// Red de respaldo de indiceFilaEncabezado, para cuando esta NO encuentra nada (-1): busca el
// PRÓXIMO bloque de filas completas en CUALQUIER PARTE de lo que queda de la tabla, no solo al
// principio — y aplica el mismo criterio de arriba (saltar título de 1 celda / gridSpan, quedarse
// con la última del bloque) sobre ese bloque.
//
// Caso real (1058086-43-LP26, "PAUTA DE EVALUACIÓN TÉCNICA DE INSUMOS CLÍNICOS (ANEXO 11)"): UN
// SOLO <w:tbl> físico mete tres secciones distintas, una atrás de otra ("1.- DATOS
// INSTITUCIONALES", "2.- CARACTERÍSTICAS ENVASE", "3.- CARACTERÍSTICAS PRODUCTO"), cada una con SU
// PROPIO encabezado de columnas (SÍ | NO | N/A | FUNDAMENTACIÓN) a mitad de tabla — la primera
// fila de la tabla YA es una celda vacía (relleno de layout), así que indiceFilaEncabezado corta
// el rastreo ahí mismo y nunca llega a ver esos encabezados. Sin esto, `detectarCandidatosTabla`
// se saltaba la tabla ENTERA (`iEncabezado < 0`) y cada fila de evaluación ("A) ROTULACIÓN EN
// ESPAÑOL", 4 casillas SÍ/NO/N/A/FUNDAMENTACIÓN) quedaba en manos del patrón 1 (etiqueta + UN
// blanco siguiente): de las 4 casillas por fila, solo la primera (bajo "SÍ") aparecía en pantalla.
//
// Exige 3+ columnas — a diferencia de indiceFilaEncabezado, que sí acepta un encabezado de 2 (ver
// "ANEXO N°6 (MARCAR CON UNA X)" en detectarCandidatosTabla): activar este respaldo con solo 2
// columnas en medio de una tabla de FORMULARIO [etiqueta][valor] arriesgaría tomar una fila
// casualmente llena (ej. una fecha pre-impresa entre dos filas en blanco) como un encabezado
// falso y desalinear todo lo que sigue. Con 3+ columnas ese falso positivo es improbable.
//
// Y a diferencia de indiceFilaEncabezado, NO exige que TODAS las celdas traigan texto — se
// conforma con "como mucho una en blanco". La grilla SÍ/NO/N/A/FUNDAMENTACIÓN real trae la
// PRIMERA columna (la que en las filas de datos lleva la etiqueta "A) ROTULACIÓN...") en blanco
// también en la fila de encabezado — no hay "nombre de columna" para la columna de la etiqueta,
// solo para las que vienen después. Exigir el 100% de las celdas con texto (como si fuera el
// encabezado de arriba de una tabla de datos normal) hacía que esta fila NUNCA calzara.
//
// Tampoco descarta filas con celda combinada (gridSpan) — a diferencia de indiceFilaEncabezado.
// Verificado contra el documento real: la fila SÍ/NO/N/A/FUNDAMENTACIÓN trae un gridSpan (probable
// combinación de layout ajena al significado de las columnas) y sin este ajuste NUNCA calificaba
// como encabezado. El requisito de "como mucho una celda en blanco" ya descarta las filas de DATOS
// de esta misma tabla (traen 1 sola celda con texto de 5), así que no hay riesgo real de tomar una
// fila de datos por encabezado solo por sacar esta condición.
function siguienteEncabezadoTablaExtenso(
  filas: { numCeldas: number; numCeldasConTexto: number; tieneCeldaCombinada?: boolean }[], desde: number,
): number {
  const esCandidata = (f: { numCeldas: number; numCeldasConTexto: number; tieneCeldaCombinada?: boolean }) =>
    f.numCeldas >= 3 && f.numCeldasConTexto >= f.numCeldas - 1;
  let i = desde;
  while (i < filas.length && !esCandidata(filas[i])) i++;
  if (i >= filas.length) return -1;
  let ultimo = i;
  for (; i < filas.length && esCandidata(filas[i]); i++) ultimo = i;
  return ultimo;
}

function textosDeFila(filaXml: string): string[] {
  return [...filaXml.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map(tc => textoDeRuns(tc[1]).trim());
}

function filaTieneCeldaCombinada(filaXml: string): boolean {
  return /<w:gridSpan\b/.test(filaXml);
}

function filaTieneTodasSusCeldasConTexto(filaXml: string): boolean {
  const textos = textosDeFila(filaXml);
  return textos.length > 0 && textos.every(t => t !== '');
}

function extraerCeldasDeFila(filaXml: string, offsetFila: number, offsetsIndices: Map<number, number>): CeldaCruda[] {
  const celdas: CeldaCruda[] = [];
  for (const tc of filaXml.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
    const cuerpoCelda = tc[1];
    const anchoMatch = tc[0].match(/<w:tcW\s+w:w="(\d+)"\s+w:type="pct"/);
    const anchoPct = anchoMatch ? Number(anchoMatch[1]) : null;
    const parrafosCelda = [...cuerpoCelda.matchAll(/<w:p\b[^>]*w14:paraId="([0-9A-Fa-f]+)"[^>]*>([\s\S]*?)<\/w:p>/g)];
    const textoCelda = parrafosCelda.map(p => textoDeRuns(p[2])).join(' ').trim();
    // Toma el ÚLTIMO párrafo vacío de la celda como candidato a rellenar — casi siempre las celdas
    // de una tabla de specs traen un solo párrafo, así que en la práctica es el único. Se usa
    // parrafoEstaVacio (sin TEXTO) y no "sin runs": con el XML de LibreOffice, que deja un run
    // vacío en cada celda, la regla vieja no encontraba ni una celda libre en todo el documento.
    const parrafoVacio = [...parrafosCelda].reverse().find(p => parrafoEstaVacio(p[2]));
    let paraId: string | null = null;
    let indiceGlobal: number | null = null;
    if (parrafoVacio && textoCelda === '') {
      paraId = parrafoVacio[1];
      // tc.index es la posición del <w:tc>...</w:tc> completo; cuerpoCelda (tc[1]) arranca
      // DESPUÉS de la apertura "<w:tc...>" — hay que sumar esa diferencia para llegar a la
      // posición real del párrafo dentro del XML completo (mismo ajuste para parrafoVacio.index,
      // que es relativo a cuerpoCelda).
      const offsetCelda = offsetFila + tc.index! + tc[0].indexOf(cuerpoCelda);
      indiceGlobal = offsetsIndices.get(offsetCelda + (parrafoVacio.index ?? 0)) ?? null;
    }
    const ultimoParaId = parrafosCelda.length ? parrafosCelda[parrafosCelda.length - 1][1] : null;
    celdas.push({ texto: textoCelda, vacio: textoCelda === '' && paraId != null, paraId, indiceGlobal, anchoPct, ultimoParaId });
  }
  return celdas;
}

export function detectarCandidatosTabla(xml: string): CandidatoCelda[] {
  const out: CandidatoCelda[] = [];
  const offsetsIndices = offsetsAIndices(xml);

  for (const tabla of xml.matchAll(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g)) {
    const cuerpoTabla = tabla[1];
    const offsetTabla = tabla.index! + tabla[0].indexOf(cuerpoTabla);
    const filas = [...cuerpoTabla.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)];
    if (filas.length < 2) continue; // hace falta al menos encabezado + 1 fila de datos

    // El encabezado no es necesariamente la fila 0 — ver indiceFilaEncabezado. Las filas anteriores
    // son títulos de la tabla y no llevan datos. Si no hay encabezado (-1) en el bloque inicial, se
    // intenta el respaldo (siguienteEncabezadoTablaExtenso): puede haber uno o más encabezados más
    // adelante en la MISMA tabla física (ver su comentario — caso real ANEXO 11). Si tampoco
    // encuentra nada, la tabla es de formulario y la cubre el patrón 1.
    const filasInfo = filas.map(f => {
      const textos = textosDeFila(f[1]);
      return {
        completa: filaTieneTodasSusCeldasConTexto(f[1]), numCeldas: textos.length,
        numCeldasConTexto: textos.filter(t => t !== '').length,
        tieneCeldaCombinada: filaTieneCeldaCombinada(f[1]),
      };
    });
    const primerEncabezado = indiceFilaEncabezado(filasInfo);
    const encabezados: number[] = [];
    if (primerEncabezado >= 0) {
      // Camino normal — SIN cambios de comportamiento respecto a antes: un solo encabezado.
      encabezados.push(primerEncabezado);
    } else {
      for (let desde = 0; ;) {
        const i = siguienteEncabezadoTablaExtenso(filasInfo, desde);
        if (i < 0) break;
        encabezados.push(i);
        desde = i + 1;
      }
    }
    if (!encabezados.length) continue;

    // Cada encabezado abre su propio SEGMENTO — sus filas de datos van hasta el próximo encabezado
    // (o el fin de la tabla, para el último). Con un solo encabezado (el caso de siempre) hay un
    // solo segmento y esto es idéntico al comportamiento anterior.
    for (let s = 0; s < encabezados.length; s++) {
      const iEncabezado = encabezados[s];
      const finSegmento = s + 1 < encabezados.length ? encabezados[s + 1] : filas.length;
      const primeraFila = filas[iEncabezado];
      const restoFilas = filas.slice(iEncabezado + 1, finSegmento);
      if (!restoFilas.length) continue;
      const celdasEncabezado = extraerCeldasDeFila(primeraFila[1], 0, new Map());
      const nombresColumna = celdasEncabezado.map(c => c.texto);
      const anchosHeader = celdasEncabezado.map(c => c.anchoPct);

      // ¿Es una tabla de DATOS (primera fila = nombres de columna, resto = filas de datos) o una
      // tabla de FORMULARIO ([etiqueta][valor][etiqueta][valor], sin encabezado)? Todo lo que sigue
      // asume la primera; aplicado a la segunda produce datos en la celda equivocada.
      //
      // BUG REAL que esto corrige (4291-38-LP26, verificado exportando el .docx generado a PDF): la
      // tabla de identificación del oferente es
      //     [NOMBRE O RAZÓN SOCIAL][  ][RUT          ][  ]
      //     [DIRECCIÓN COMERCIAL  ][  ][INICIO ACTIV.][  ]
      //     [CIUDAD               ][  ][FONO         ][  ]
      // Al tratarla como tabla de datos: (a) `filaContexto` —la celda más larga de la fila— se le
      // asignaba a TODAS las celdas vacías de esa fila, así que la celda de INICIO ACTIV. recibía la
      // etiqueta "DIRECCIÓN COMERCIAL" y terminaba con la dirección escrita adentro, y la del RUT del
      // representante recibía "NOMBRE COMPLETO REP. LEGAL" y terminaba con el nombre; (b) la primera
      // fila se tomaba como encabezado, inventando una columna llamada "RUT" que producía etiquetas
      // fantasma ("CORREO ELECTRÓNICO — RUT") rellenadas con el RUT de la empresa; y (c) al quedar
      // dos celdas bajo una sola etiqueta, CIUDAD, FONO y CONTACTO OFERENTE 2 nunca llegaban a ser
      // candidatos y quedaban vacíos sin avisar.
      //
      // La señal es simple y determinista: un encabezado REAL tiene todas sus columnas nombradas. Si
      // ninguna fila inicial cumple eso, la tabla no tiene encabezado y es de formulario — la cubre el
      // patrón 1, que empareja cada etiqueta con la celda vacía que le sigue en orden de lectura. Ese
      // caso ya salió por el `if (!encabezados.length) continue` de arriba.
      const hayEncabezado = nombresColumna.some(t => t.length > 0);

      for (const fila of restoFilas) {
        // Mismo ajuste que arriba: fila.index es la posición del <w:tr>...</w:tr> completo, pero
        // fila[1] (lo que se le pasa a extraerCeldasDeFila) arranca después de la apertura "<w:tr...>".
        const offsetFila = offsetTabla + fila.index! + fila[0].indexOf(fila[1]);
        const celdas = extraerCeldasDeFila(fila[1], offsetFila, offsetsIndices);
        // Antes exigía 3+ columnas ("2 ya las cubre el patrón 1, etiqueta | valor") — pero esa
        // suposición solo vale cuando la tabla NO tiene encabezado (ahí sí la cubre el patrón 1, y
        // ni siquiera se llega hasta acá por el `if (!encabezados.length) continue` de arriba). Con
        // encabezado SÍ detectado (como acá) y solo 2 columnas, el patrón 1 nunca la toca — caso
        // real 1058086-43-LP26, ANEXO N°6 "(MARCAR CON UNA X)": una tabla de 2 columnas [casilla
        // vacía | descripción de la opción] donde la primera fila trae AMBAS celdas con texto (la
        // instrucción "(MARCAR CON UNA X)" comparte fila con la primera opción) — quedaba fuera de
        // los dos patrones a la vez y ninguna casilla de "marcar con X" aparecía nunca en el modal.
        if (celdas.length < 2) continue;

        let filaContexto = '';
        for (const c of celdas) if (c.texto.length > filaContexto.length) filaContexto = c.texto;
        // Una fila SIN NINGÚN texto propio sigue siendo válida: en una tabla que se llena entera
        // (especificaciones técnicas, participantes de una capacitación) TODAS las filas están en
        // blanco y la etiqueta sale del nombre de la columna. Antes se descartaba la fila completa —
        // caso real 4291-38-LP26: el FORMULARIO N°3 tiene 20 celdas para llenar y no aparecía
        // ninguna, la caja salía en pantalla sin una sola casilla.

        // Alineación por ANCHO REAL, no por índice de posición — ver columnasPorAncho arriba.
        // Reemplaza la alineación "desde la derecha" anterior: esa asumía que el relleno decorativo
        // siempre va al PRINCIPIO de la fila, pero un documento real (1738-18-LE26) trae filas con
        // relleno en cantidad y posición distintas fila a fila — con índices, cualquier fila que no
        // calzara con el patrón asumido perdía su candidato real de PRECIO (o lo etiquetaba con la
        // columna equivocada).
        const columnaDeCadaCelda = columnasPorAncho(anchosHeader, celdas.map(c => c.anchoPct));

        celdas.forEach((c, colIndex) => {
          if (!c.vacio || c.indiceGlobal == null || !c.paraId) return;
          // Celda angosta a propósito (relleno de layout, ver ANCHO_PCT_MINIMO_COLUMNA_REAL) —
          // nunca es un dato real que pedir, se ignora aunque esté "vacía".
          if (c.anchoPct != null && c.anchoPct < ANCHO_PCT_MINIMO_COLUMNA_REAL) return;
          const nombreColumna = hayEncabezado ? nombresColumna[columnaDeCadaCelda[colIndex]] : '';
          const etiqueta = filaContexto && nombreColumna
            ? `${filaContexto} — ${nombreColumna}`
            : (filaContexto || nombreColumna);
          if (!etiqueta) return; // ni fila ni columna dan un nombre: no hay cómo describir la celda
          // Si la fila no aporta NINGÚN texto, la etiqueta es solo el nombre de la columna y la celda
          // pertenece a una tabla que se llena entera (especificaciones, participantes de una
          // capacitación): son datos de la oferta, nunca de identificación de la empresa. Se muestran
          // para llenarlos a mano pero no se autocompletan — sin esto, la columna "RUT" de la tabla de
          // asistentes del acta de capacitación se rellenaba con el RUT de la empresa en las 8 filas.
          out.push({
            etiqueta: etiqueta.slice(0, 160), paraId: c.paraId, indice: c.indiceGlobal,
            ...(filaContexto ? {} : { soloManual: true }),
          });
        });
      }
    }
  }
  return out;
}

// ── Patrón 2: subrayados dentro de una misma oración ──────────────────────────────────────
// indiceRun es GLOBAL (posición entre TODOS los <w:t> del documento — lo que espera
// rellenarRunPorIndice para editar). indiceParrafo ubica en qué párrafo cae (para agrupar por
// formulario después). El CONTEXTO se arma con el texto de TODO el párrafo, no solo del run
// donde cae el blanco — en Word real, la etiqueta ("Proveedor:") y la raya de subrayado
// (`____`) casi siempre son runs SEPARADOS (distinto formato), así que mirar solo el run del
// blanco perdía la etiqueta y mostraba "(sin contexto)" aunque el párrafo sí la tuviera.
export interface CandidatoInline {
  indiceRun: number; indiceParrafo: number;
  textoRunOriginal: string; posEnTexto: number; largo: number; contexto: string;
  // Instrucción literal que el organismo dejó dentro del marcador ("Insertar RUT", "fecha",
  // "indicar en esta casilla el número del documento…") — ver listarBlancosInline / patrón 2b en
  // anexos-docx.ts. Cuando existe, es MEJOR pista que el contexto inferido: dice textualmente qué
  // va en esa casilla, así que se le pasa al motor de IA y se le muestra al humano tal cual.
  textoMarcador?: string;
  // El párrafo ENTERO donde vive el blanco, más dónde cae dentro de él — para que el modal pueda
  // mostrar la oración completa (pedido del usuario, caso real 1058086-43-LP26: con solo
  // "contexto" recortado a 60 caracteres, blancos de una declaración jurada corrida como "de ___
  // de ___" no se entendían sin abrir el Word).
  parrafoCompleto: string; posEnParrafo: number;
}

export function detectarBlancosInline(xml: string): CandidatoInline[] {
  const out: CandidatoInline[] = [];
  let indiceRunGlobal = 0;
  const parrafos = [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)];

  parrafos.forEach((parMatch, indiceParrafo) => {
    // DECODIFICADO (ver decodificarXml): las posiciones que se calculan acá son las mismas que
    // usa rellenarRunPorIndice para escribir, y ese también decodifica antes de editar.
    const runsDelParrafo = [...parMatch[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => decodificarXml(m[1]));
    const textoParrafoCompleto = runsDelParrafo.join('');
    let offsetAcumulado = 0;

    for (const texto of runsDelParrafo) {
      for (const b of listarBlancosInline(texto)) {
        const posGlobalEnParrafo = offsetAcumulado + b.posEnTexto;
        const previo = textoParrafoCompleto.slice(0, posGlobalEnParrafo);
        // "_{4,}" (el mismo umbral de listarBlancosInline) también corta el contexto — sin esto,
        // dos campos "Etiqueta: ____" seguidos en el mismo párrafo ("Nombre: ____Cargo: ____")
        // dejaban la corrida de guiones del campo ANTERIOR pegada al contexto del siguiente, y el
        // slice(-60) a ciegas cortaba la etiqueta a la mitad ("Cargo:" salía como "rgo:", caso
        // real 1058086-43-LP26, ANEXO N°8).
        // También corta en un MARCADOR anterior (patrón 2b) y en una línea de puntos, por la misma
        // razón que corta en "_{4,}": el marcador de la casilla previa no es contexto de esta.
        const contexto = (previo.split(/[,.;]|\(\*+\)|_{4,}|>>|\]/).pop() || previo).trim().slice(-60);
        // Cuánto espacio se recorta por la izquierda al hacer trim() — para correr posEnParrafo
        // en la misma medida y que siga apuntando al blanco real dentro del texto YA recortado.
        const recorteIzquierdo = textoParrafoCompleto.length - textoParrafoCompleto.trimStart().length;
        out.push({
          indiceRun: indiceRunGlobal, indiceParrafo,
          textoRunOriginal: texto, posEnTexto: b.posEnTexto, largo: b.largo,
          contexto: contexto || '(sin contexto)',
          parrafoCompleto: textoParrafoCompleto.trim(),
          posEnParrafo: Math.max(0, posGlobalEnParrafo - recorteIzquierdo),
          ...(b.textoMarcador ? { textoMarcador: b.textoMarcador } : {}),
        });
      }
      offsetAcumulado += texto.length;
      indiceRunGlobal++;
    }
  });
  return out;
}

// ── Patrón 5: "Etiqueta:" sin nada después, el valor va en la misma línea ─────────────────
// Ver rellenarFinDeParrafo() en anexos-docx.ts para el caso real que lo motiva (FORMULARIO N°2 de
// 4291-38-LP26: "Nombre o Razón Social       :" y "RUT:", párrafos sueltos sin celda ni subrayado).
//
// A propósito NO alimenta la lista de pendientes del modal: cualquier título que termine en dos
// puntos ("OFERTA ECONÓMICA:", "INTEGRANTES DE LA UTP:") calza con esta forma, y ofrecerlos todos
// llenaría la pantalla de campos que no existen. Solo se usa para AUTO-completar cuando el
// diccionario reconoce la etiqueta con certeza — si no la reconoce, el párrafo queda intacto.
export function detectarCamposConDosPuntos(parrafos: Parrafo[]): CandidatoCelda[] {
  const out: CandidatoCelda[] = [];
  for (let i = 0; i < parrafos.length; i++) {
    const p = parrafos[i];
    const texto = p.texto.trim();
    if (!texto.endsWith(':') || texto.length > 80 || p.centrado) continue;
    if (/_{4,}/.test(texto)) continue;              // tiene su propio blanco → lo cubre el patrón 2
    out.push({ etiqueta: texto.replace(/\s*:\s*$/, ''), paraId: p.paraId, indice: p.indice });
  }
  return out;
}

// ── Patrón 3: secciones por tipo de oferente (Natural / Jurídica / UTP) ───────────────────
// Regla del plan (categoría C): "omitir sin preguntar" Natural y UTP — nuestra empresa
// siempre postula como persona jurídica. Solo se habilita para rellenar la sección jurídica.
//
// Dos exclusiones agregadas después de encontrar falsos positivos reales:
//   1. Párrafos que EMPIEZAN con "firma" ("Firma representante legal o persona natural:") —
//      es un pie de firma que se repite en cada anexo, no un divisor de secciones.
//   2. Coincidencias donde después de la frase sigue más texto real (no solo puntuación) —
//      ej. "Naturaleza Jurídica (Persona Natural, Jurídica, Otra)" es la lista de opciones
//      de UN campo, no el título de una sección nueva.
export type TipoSeccion = 'PERSONA_NATURAL' | 'PERSONA_JURIDICA' | 'UTP';
export interface SeccionOferente { indiceInicio: number; indiceFin: number; tipo: TipoSeccion; decision: 'RELLENAR' | 'OMITIR'; textoEncabezado: string }

const PATRONES: { tipo: TipoSeccion; re: RegExp }[] = [
  { tipo: 'PERSONA_NATURAL', re: /persona\s+natural/i },
  { tipo: 'PERSONA_JURIDICA', re: /persona\s+jur[íi]dica/i },
  { tipo: 'UTP', re: /uni[óo]n\s+temporal\s+de\s+proveedores/i },
];
const LARGO_MAX_ENCABEZADO = 80;
const SOLO_PUNTUACION_FINAL = /^[\s_:"'”)]*$/;

function esEncabezadoDeSeccion(texto: string): { tipo: TipoSeccion } | null {
  if (texto.length > LARGO_MAX_ENCABEZADO) return null;
  if (/^firma\b/i.test(texto.trim())) return null; // pie de firma, no divisor
  // Un párrafo con su propio blanco ("Nombre de la Unión Temporal de Proveedores: __________") es
  // un CAMPO del formulario, no el título de una sección nueva. Caso real 4291-38-LP26: como
  // SOLO_PUNTUACION_FINAL acepta "_", este campo se tomaba por encabezado y abría una sección UTP
  // que —sin el corte por formulario de abajo— se extendía hasta el final del documento.
  if (/_{4,}/.test(texto)) return null;
  for (const pat of PATRONES) {
    const m = texto.match(pat.re);
    if (!m) continue;
    const restante = texto.slice((m.index ?? 0) + m[0].length);
    if (SOLO_PUNTUACION_FINAL.test(restante)) return { tipo: pat.tipo }; // la frase es el final real del párrafo
  }
  return null;
}

export function detectarSecciones(parrafos: Parrafo[]): SeccionOferente[] {
  const encabezados: { indice: number; tipo: TipoSeccion; texto: string }[] = [];
  parrafos.forEach(p => {
    const h = esEncabezadoDeSeccion(p.texto);
    if (h) encabezados.push({ indice: p.indice, tipo: h.tipo, texto: p.texto });
  });

  // Una sección de tipo de oferente vale hasta el siguiente encabezado de sección O hasta que
  // empieza otro FORMULARIO/ANEXO — lo que venga primero. Sin el corte por formulario, una
  // sección se extiende hasta el final del documento.
  //
  // BUG REAL (4291-38-LP26, el que hacía que "lo automático no llegara a los anexos 2, 3 y 4"): el
  // FORMULARIO N°1-A es el de Unión Temporal de Proveedores, así que abre una sección UTP. Como
  // nuestra empresa postula siempre como persona jurídica, esa sección se OMITE — y al no tener
  // corte, "omitir la sección UTP" terminaba omitiendo TODO el resto del documento: los
  // formularios 2, 3 y 4 completos. De los 44 campos detectados en el documento sobrevivían 17,
  // los del formulario 1; los otros 27 se descartaban en silencio y quedaban en blanco.
  const iniciosDeFormulario = parrafos
    .filter(p => p.texto.length <= LARGO_MAX_ENCABEZADO && RE_ENCABEZADO_FORMULARIO.test(p.texto))
    .map(p => p.indice);

  return encabezados.map((h, i) => {
    const finPorSeccion = (encabezados[i + 1]?.indice ?? parrafos.length + 1) - 1;
    const proximoFormulario = iniciosDeFormulario.find(indice => indice > h.indice);
    const finPorFormulario = proximoFormulario != null ? proximoFormulario - 1 : finPorSeccion;
    return {
      indiceInicio: h.indice,
      indiceFin: Math.min(finPorSeccion, finPorFormulario),
      tipo: h.tipo,
      decision: h.tipo === 'PERSONA_JURIDICA' ? 'RELLENAR' : 'OMITIR',
      textoEncabezado: h.texto,
    } as SeccionOferente;
  });
}

// Filtra candidatos de celda para quedarse SOLO con los que caen dentro de secciones
// habilitadas (RELLENAR) — si el documento no tiene secciones (caso común: un solo anexo sin
// variantes), no se descarta nada.
export function acotarASeccionesHabilitadas(candidatos: CandidatoCelda[], secciones: SeccionOferente[]): CandidatoCelda[] {
  if (!secciones.length) return candidatos;
  const rangosOmitidos = secciones.filter(s => s.decision === 'OMITIR');
  if (!rangosOmitidos.length) return candidatos;
  return candidatos.filter(c => !rangosOmitidos.some(r => c.indice >= r.indiceInicio && c.indice <= r.indiceFin));
}

// ── Patrón 4: línea de firma ("____________" + "Firma del Oferente...") ──────────────────
// Patrón real visto en TODOS los anexos con firma: un párrafo que es SOLO una raya larga,
// seguido (1-2 párrafos después, a veces con una línea en blanco entre medio) por una leyenda
// que menciona "firma". Es DISTINTO al blanco inline (patrón 2): no se le pide texto al humano,
// se le ofrece insertar la IMAGEN de la firma guardada en la ficha de la empresa (si existe) —
// ver insertarImagenEnParrafo() en anexos-docx.ts.
export interface LineaFirma {
  paraId: string; indice: number; contexto: string;
  // La leyenda pide firma Y TIMBRE ("FIRMA Y TIMBRE REPRESENTANTE LEGAL" — la forma habitual en
  // los anexos de hospitales/servicios públicos). Cuando la empresa tiene un timbre cargado en su
  // ficha, se estampa al lado de la firma; si la leyenda solo dice "firma", no se estampa timbre
  // aunque exista, porque no lo están pidiendo.
  pideTimbre?: boolean;
}

const RE_RAYA_LARGA = /^_{10,}$/;
// La leyenda bajo la raya no siempre dice "firma" — un caso real dice "Nombre Persona Natural o
// Representante legal..." sin esa palabra. "representante legal" / "persona natural" al pie de
// una raya de 10+ guiones es, en la práctica, siempre un bloque de firma en estos documentos.
const RE_LEYENDA_FIRMA = /firma|representante\s+legal|persona\s+natural/i;

// Caso C (ver abajo): leyenda de firma SIN raya. Es un regex mucho más estrecho que
// RE_LEYENDA_FIRMA a propósito — ahí basta con que el texto MENCIONE "representante legal" porque
// ya se sabe que arriba hay una raya de 10+ guiones, que es la señal fuerte. Sin raya no hay tal
// señal, y "representante legal" aparece en media docena de párrafos de cualquier declaración
// jurada: usarlo estamparía la firma escaneada en mitad del texto legal. Acá se exige que el
// párrafo SEA la leyenda ("FIRMA Y TIMBRE REPRESENTANTE LEGAL", "Firma del oferente") — que empiece
// con la palabra firma y sea corto, como toda leyenda de pie de firma real.
const RE_LEYENDA_FIRMA_SOLA = /^[\s(]*firma\b/i;
const LARGO_MAX_LEYENDA_FIRMA = 90;
const RE_PIDE_TIMBRE = /timbre/i;

export function detectarLineasFirma(parrafos: Parrafo[]): LineaFirma[] {
  const out: LineaFirma[] = [];
  const usados = new Set<number>();
  const agregar = (p: Parrafo, contexto: string) => {
    if (usados.has(p.indice)) return;
    usados.add(p.indice);
    out.push({ paraId: p.paraId, indice: p.indice, contexto, pideTimbre: RE_PIDE_TIMBRE.test(contexto) });
  };

  for (let i = 0; i < parrafos.length; i++) {
    const p = parrafos[i];

    // Caso A: la raya ES todo el párrafo — la leyenda viene en el/los párrafo(s) siguiente(s)
    // ("____________\nFirma del Oferente...", en párrafos separados).
    if (RE_RAYA_LARGA.test(p.texto)) {
      const siguiente1 = parrafos[i + 1]?.texto || '';
      const siguiente2 = parrafos[i + 2]?.texto || '';
      const contexto = RE_LEYENDA_FIRMA.test(siguiente1) ? siguiente1 : (RE_LEYENDA_FIRMA.test(siguiente2) ? siguiente2 : '');
      if (contexto) { agregar(p, contexto); continue; }
    }

    // Caso B: la raya y la leyenda comparten el MISMO párrafo — otro patrón real visto
    // ("____________________ Nombre Persona Natural o Representante legal...", todo junto).
    const compuesto = p.texto.match(/^_{10,}\s*(.+)$/);
    if (compuesto && RE_LEYENDA_FIRMA.test(compuesto[1])) {
      agregar(p, compuesto[1].trim());
      continue;
    }

    // Caso C: leyenda de firma SIN NINGUNA RAYA — el espacio para firmar son párrafos VACÍOS.
    // BUG REAL (1057480-41-LP26, Hospital San José de Melipilla): 6 de sus 11 anexos cierran con
    // varios párrafos en blanco y después "FIRMA Y TIMBRE REPRESENTANTE LEGAL / (OFERENTE)", sin un
    // solo guión bajo. Los casos A y B, que arrancan buscando "_{10,}", no veían nada: el documento
    // salía sin firma y el usuario tenía que estamparla a mano en todos ellos.
    //
    // Se exige que el párrafo INMEDIATAMENTE anterior esté vacío, y se sube hasta el primero de la
    // corrida de vacíos (es donde queda el espacio de la firma, arriba de la leyenda, no pegado a
    // ella). Si el anterior TIENE texto no se hace nada: ahí no hay hueco donde estampar sin pisar
    // algo — es justo lo que pasa en los anexos 7 y 8 de esta misma licitación, donde arriba de la
    // leyenda va un párrafo con DOS rayas (la del oferente y la del evaluador) y estampar sería
    // adivinar cuál es cuál.
    if (p.texto.length <= LARGO_MAX_LEYENDA_FIRMA && RE_LEYENDA_FIRMA_SOLA.test(p.texto)) {
      if (!parrafos[i - 1]?.vacio) continue;
      agregar(parrafos[i - 1], p.texto.trim());   // el hueco pegado a la leyenda, que es donde se firma
    }
  }
  return out;
}

// Un título/sección seguido de un párrafo vacío que es puro espaciado ANTES de su propia tabla
// ("RESUMEN:" + línea en blanco + <w:tbl>) o de una LISTA NUMERADA por Word ("...declara lo
// siguiente:" + línea en blanco + "a) Haber estudiado...", numeración automática vía <w:numPr>,
// nunca texto literal "a)") no es un campo a llenar — es una leyenda. Caso real encontrado: el
// patrón 1 los tomaba como candidato porque no mira qué viene DESPUÉS del blanco, solo que esté
// vacío. BUG REAL (1057472-89-LE26, ANEXO N°2): "El proponente que suscribe, declara lo
// siguiente:" quedaba como pendiente con un motivo inventado por la IA — no había nada que
// rellenar ahí, lo que sigue es la lista de declaraciones (a, b, c...). Se salta cualquier
// cantidad de párrafos vacíos consecutivos (a veces hay más de uno de puro espaciado) antes de
// decidir qué viene después.
function blancoPrecedeBloqueNoRellenable(xml: string, paraId: string): boolean {
  const m = xml.match(new RegExp(`<w:p\\b[^>]*w14:paraId="${paraId}"[^>]*>[\\s\\S]*?<\\/w:p>`));
  if (!m) return false;
  let pos = (m.index ?? 0) + m[0].length;
  while (true) {
    const resto = xml.slice(pos, pos + 4000);
    const mp = resto.match(/^\s*<w:p\b[^>]*>([\s\S]*?)<\/w:p>/);
    if (mp && !/<w:r[ >]/.test(mp[1])) { pos += mp[0].length; continue; }
    break;
  }
  const siguiente = xml.slice(pos, pos + 4000);
  if (/^\s*<w:tbl\b/.test(siguiente)) return true;
  const siguienteParrafo = siguiente.match(/^\s*<w:p\b[^>]*>([\s\S]*?)<\/w:p>/);
  return !!siguienteParrafo && /<w:numPr\b/.test(siguienteParrafo[1]);
}

// Los párrafos que son el ÚNICO contenido de una fila de tabla con 1 sola celda (fila-título
// mergeada, ver indiceFilaEncabezado) NUNCA son un campo pese a terminar en ":" — completar el
// patrón 5 ahí ("Etiqueta:" + valor al final del MISMO párrafo, ver detectarCamposConDosPuntos)
// pegaría el valor al final del TÍTULO de la sección en vez de llenar ningún dato real. BUG REAL
// (1057472-89-LE26): "CONTACTO DEL PROPONENTE:" —título de la fila que abre ese bloque dentro de
// la tabla de identificación, exactamente igual que "DATOS DEL PROPONENTE:" o "REPRESENTANTE
// LEGAL:" que la comparten— fue tomado como candidato del patrón 5 y la IA lo resolvió con el
// nombre del contacto, aunque nunca se iba a estampar ahí (el dato real vive en las celdas de la
// fila siguiente, ya cubiertas por el patrón de tabla).
function indicesFilaTituloMergeada(xml: string): Set<number> {
  const offsetsIndices = offsetsAIndices(xml);
  const out = new Set<number>();
  for (const tabla of xml.matchAll(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g)) {
    const cuerpoTabla = tabla[1];
    const offsetTabla = tabla.index! + tabla[0].indexOf(cuerpoTabla);
    for (const fila of cuerpoTabla.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
      const celdas = [...fila[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)];
      if (celdas.length !== 1) continue; // solo filas de 1 celda: título mergeado
      const offsetFila = offsetTabla + fila.index! + fila[0].indexOf(fila[1]);
      const offsetCelda = offsetFila + celdas[0].index! + celdas[0][0].indexOf(celdas[0][1]);
      for (const p of celdas[0][1].matchAll(/<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>[\s\S]*?<\/w:p>/g)) {
        const indice = offsetsIndices.get(offsetCelda + p.index!);
        if (indice != null) out.add(indice);
      }
    }
  }
  return out;
}

// ── Punto de entrada: analiza un XML completo y devuelve los patrones + secciones ─────────
export function analizarAnexo(xml: string) {
  const parrafos = listarParrafos(xml);
  const secciones = detectarSecciones(parrafos);

  // El patrón de tabla (1b) va PRIMERO — tiene mejor etiqueta — y el patrón plano (1) solo
  // aporta los índices que la tabla no reclamó, para no mostrar el mismo blanco dos veces con
  // una etiqueta buena y otra mala ("CO").
  const candidatosTabla = detectarCandidatosTabla(xml);
  const indicesTabla = new Set(candidatosTabla.map(c => c.indice));
  // Relleno de tabla que nunca es un campo real (ver parrafosQueNuncaSonCampoEnTabla): ni como
  // valor apuntado por el candidato (el caso real encontrado), ni celdas angostas de puro layout.
  const parrafosSinCampo = parrafosQueNuncaSonCampoEnTabla(xml);
  // Camino paralelo SIN desambiguar (mismos filtros geométricos, sin el prefijo "candidato
  // anterior") — lo necesita anexos-clasificar-ia.ts. `.indice`/`.paraId` son idénticos al camino
  // desambiguado (desambiguarDuplicados solo toca `.etiqueta`), así que indicesSoloManual y el
  // resto del post-procesado de abajo siguen valiendo igual para ambos.
  const candidatosCeldaSinDesambiguar = [
    ...candidatosTabla,
    ...detectarCandidatosCeldaCrudos(parrafos)
      .filter(c => !indicesTabla.has(c.indice))
      .filter(c => !parrafosSinCampo.has(c.indice))
      .filter(c => !blancoPrecedeBloqueNoRellenable(xml, c.paraId)),
  ];
  const candidatosCeldaCrudos = detectarCandidatosCelda(parrafos)
    .filter(c => !indicesTabla.has(c.indice))
    .filter(c => !parrafosSinCampo.has(c.indice))
    .filter(c => !blancoPrecedeBloqueNoRellenable(xml, c.paraId));

  // Los campos de una sección OMITIDA (Persona Natural / UTP, cuando postulamos como jurídica) ya
  // no se descartan: se muestran igual para que un humano pueda llenarlos, pero se marcan para que
  // NUNCA se autocompleten solos. Antes desaparecían por completo y las cajas "INTEGRANTES DE LA
  // UTP", "DATOS DEL REPRESENTANTE O APODERADO" y "DATOS DEL EJECUTIVO COORDINADOR" salían en
  // pantalla sin una sola casilla — y si la empresa sí postula en UTP alguna vez, no había forma de
  // completarlas. La regla original ("no rellenar solo lo que no nos corresponde") se mantiene
  // intacta; lo que cambia es que ahora se ven.
  const candidatosCeldaTodos = [...candidatosTabla, ...candidatosCeldaCrudos];
  const habilitados = new Set(acotarASeccionesHabilitadas(candidatosCeldaTodos, secciones).map(c => c.indice));
  const indicesSoloManual = new Set(
    candidatosCeldaTodos.filter(c => c.soloManual || !habilitados.has(c.indice)).map(c => c.indice),
  );

  // Cualquier etiqueta que mencione "firma" (ej. "Firma y Timbre del Oferente o Representante
  // Legal:" seguida de una celda vacía — patrón real visto en anexos reales, DISTINTO de la
  // raya de guiones que cubre detectarLineasFirma) no es un dato de texto: es el lugar donde va
  // la IMAGEN de la firma escaneada. Bug real encontrado en pruebas contra un anexo real: sin
  // esto, caía al flujo normal diccionario→IA y la IA a veces la matcheaba mal contra
  // representante_cargo, escribiendo un cargo inventado ahí en vez de insertar la firma.
  // Se mira la etiqueta COMPLETA a propósito: en una etiqueta compuesta el "firma" puede estar de
  // los dos lados según de dónde venga — "Firma: — Para uso exclusivo Proveedor Adjudicado"
  // (contexto de fila — nombre de columna, de detectarCandidatosTabla) o "… — Firma y Timbre"
  // (contexto — campo, de desambiguarDuplicados).
  const esEtiquetaFirma = (etiqueta: string) => /firma/i.test(etiqueta);

  // …pero que un campo pida UNA firma no significa que pida LA NUESTRA. Mismo principio
  // conservador que el diccionario (ver anexos-diccionario.ts): si la etiqueta no dice de quién es
  // la firma, no se adivina. Caso real 4291-38-LP26, FORMULARIO N°4 (acta de capacitación): trae
  // una columna "Firma" para los asistentes a la capacitación y DOS bloques de cierre, "Para uso
  // exclusivo Proveedor Adjudicado" y "Para uso exclusivo Universidad de Antofagasta" — estampar
  // nuestra firma escaneada en los tres es sencillamente falso. Solo se firma donde la etiqueta
  // dice oferente / proponente / proveedor / contratista / representante legal.
  //
  // El lado NEGATIVO (RE_FIRMA_CONTRAPARTE) es tan necesario como el positivo: hay leyendas que
  // nombran a los dos a la vez ("FIRMA Y TIMBRE REPRESENTANTE LEGAL      FIRMA Y TIMBRE EVALUADOR",
  // los dos bloques en el MISMO párrafo — anexos 7 y 8 de 1057480-41-LP26). Ahí la mención al
  // oferente es real pero no alcanza para saber DÓNDE va nuestra firma dentro del párrafo, así que
  // no se estampa nada y lo firma un humano.
  const RE_FIRMA_NUESTRA = /(oferente|proponente|proveedor|contratista|representante\s+legal|rep\.?\s*legal|persona\s+natural)/i;
  // Ojo: NO se puede meter acá "uso exclusivo" — "Para uso exclusivo Proveedor Adjudicado" es
  // NUESTRO bloque (caso real 4291-38-LP26, cubierto por un test). El bloque ajeno de ese mismo
  // documento ("…Universidad de Antofagasta") ya queda fuera por el lado positivo, que no lo nombra.
  const RE_FIRMA_CONTRAPARTE = /(evaluador|entidad\s+licitante|comisi[óo]n\s+evaluadora|ministro\s+de\s+fe|mandante|inspector)/i;
  const esFirmaPropia = (etiqueta: string) =>
    esEtiquetaFirma(etiqueta) && RE_FIRMA_NUESTRA.test(etiqueta) && !RE_FIRMA_CONTRAPARTE.test(etiqueta);
  // Para una RAYA de firma no se exige la palabra "firma" en la leyenda: la raya de 10+ guiones ya
  // es la señal de que ahí se firma, y hay leyendas reales que no la dicen ("Nombre Persona Natural
  // o Representante legal…", ver RE_LEYENDA_FIRMA). Solo se decide DE QUIÉN es.
  const esRayaFirmaPropia = (contexto: string) =>
    RE_FIRMA_NUESTRA.test(contexto) && !RE_FIRMA_CONTRAPARTE.test(contexto);
  // Las celdas de firma AJENA (ni nuestra firma ni un dato que tengamos) quedan fuera de los dos
  // grupos: no reciben la imagen, y tampoco vuelven al flujo diccionario→IA, que es donde antes
  // terminaban rellenadas con un cargo inventado. Las llena a mano quien corresponda.
  const candidatosFirmaCelda = candidatosCeldaTodos.filter(c => esFirmaPropia(c.etiqueta));
  const candidatosCelda = candidatosCeldaTodos.filter(c => !esEtiquetaFirma(c.etiqueta));

  // El mismo filtro esFirmaPropia que ya se aplicaba a las CELDAS de firma vale igual para las
  // RAYAS y leyendas — antes no se aplicaba y era un bug real: en 1057480-41-LP26 los anexos 6 y 9
  // cierran con "________ / FIRMA Y TIMBRE EVALUADOR", el bloque que llena el HOSPITAL al evaluar
  // la oferta, y ahí se estampaba nuestra firma escaneada. Firmar por el evaluador de la licitación
  // es bastante peor que dejar el documento sin firmar.
  const lineasFirma = [
    ...detectarLineasFirma(parrafos).filter(f => esRayaFirmaPropia(f.contexto)),
    ...candidatosFirmaCelda.map(c => ({ paraId: c.paraId, indice: c.indice, contexto: c.etiqueta, pideTimbre: /timbre/i.test(c.etiqueta) })),
  ];
  const indicesFirma = new Set(lineasFirma.map(f => f.indice));
  // La raya de una línea de firma también matchea el patrón 2 (blanco inline, "_{4,}") — se
  // excluye de ahí para no ofrecer un input de texto Y la firma para el mismo párrafo.
  const blancosInline = detectarBlancosInline(xml).filter(b => !indicesFirma.has(b.indiceParrafo));

  // Patrón 5: solo los que caen en una sección habilitada y no pisan un blanco ya detectado por
  // otro patrón (nunca se rellena dos veces el mismo párrafo).
  const yaCubiertos = new Set([
    ...candidatosCeldaTodos.map(c => c.indice),
    ...lineasFirma.map(f => f.indice),
    ...blancosInline.map(b => b.indiceParrafo),
  ]);
  // Se descarta también si el párrafo SIGUIENTE ya es un blanco de otro patrón: ahí el valor va en
  // esa celda/párrafo, no al final de la etiqueta, y escribir en los dos lo pondría duplicado. Se
  // mira el resultado real de los otros patrones y no "¿el siguiente está vacío?": un párrafo vacío
  // puede haber sido descartado como candidato (ej. blancoPrecedeTabla lo filtró por ser el
  // espaciado antes de una tabla), y en ese caso el campo SÍ queda para este patrón — es
  // exactamente el caso del "RUT:" del FORMULARIO N°2 de 4291-38-LP26, que si no queda sin llenar
  // por caer en el hueco entre los dos patrones.
  // Ni siquiera un título de sección real (nunca un campo, ver indicesFilaTituloMergeada arriba).
  const indicesTituloMergeado = indicesFilaTituloMergeada(xml);
  const camposConDosPuntos = acotarASeccionesHabilitadas(detectarCamposConDosPuntos(parrafos), secciones)
    .filter(c => !yaCubiertos.has(c.indice) && !yaCubiertos.has(c.indice + 1))
    .filter(c => !indicesTituloMergeado.has(c.indice));

  return {
    parrafos, secciones, candidatosCelda, blancosInline, lineasFirma, camposConDosPuntos, indicesSoloManual,
    candidatosCeldaSinDesambiguar,
  };
}

// ── Extracción de tablas COMPLETAS (todas las celdas, no solo las vacías) ─────────────────
// Para la vista de "tabla real" en la pantalla de relleno: el usuario pidió ver el documento
// tal cual es (filas y columnas reales), no una lista plana de "etiqueta: input" donde no se
// entiende a qué celda corresponde cada blanco. Reutiliza extraerCeldasDeFila (la misma función
// que ya usa detectarCandidatosTabla) para que "qué celda es un blanco real" sea EXACTAMENTE la
// misma lógica en los dos lugares — nunca dos criterios de "vacío" que puedan divergir.
export interface CeldaTablaCruda { texto: string; indiceGlobal: number | null; anchoPct: number | null; ultimoParaId: string | null }
export interface FilaTablaCruda { celdas: CeldaTablaCruda[] }
export interface TablaCruda { indicePrimero: number | null; filas: FilaTablaCruda[] }

// Mismo problema que resuelve patrón 1b para la ETIQUETA de un blanco (ver detectarCandidatosTabla
// más arriba), pero acá aplicado a la fila COMPLETA para la vista de tabla real: una columna del
// encabezado puede venir partida en 2-3 celdas angostas sueltas en las filas de datos (sin
// <w:vMerge>) — si esas celdas de más se renderizan por POSICIÓN simple (un <td> por celda, en
// orden), la fila entera se corre respecto al encabezado: "UN" (unidad) termina bajo la columna
// "CANTIDAD" y el precio real queda literalmente fuera de la tabla, invisible. Caso real que
// expuso esto: 1738-18-LE26, tabla de materiales con 33 filas donde varias traen 6-7 celdas
// contra las 5 del encabezado. Se ubica cada celda por su posición ACUMULADA real dentro del
// ancho total de la fila (w:tcW, escala pct 0-5000 de OOXML) contra los límites de cada columna
// del encabezado — así una celda angosta decorativa cae en la MISMA columna que su vecina real,
// en vez de correr todo lo que viene después. Probado contra el documento real: reconstruye
// exactamente las columnas correctas para las 33 filas, incluidas las que traen celdas de más.
function alinearFilaConEncabezado(header: CeldaTablaCruda[], fila: CeldaTablaCruda[]): CeldaTablaCruda[] {
  if (fila.length === header.length) return fila; // caso normal (la inmensa mayoría) — nada que alinear

  const columnaDeCadaCelda = columnasPorAncho(header.map(c => c.anchoPct), fila.map(c => c.anchoPct));
  const grupos: CeldaTablaCruda[][] = header.map(() => []);
  fila.forEach((c, i) => grupos[columnaDeCadaCelda[i]].push(c));

  return grupos.map(grupo => {
    if (grupo.length === 0) return { texto: '', indiceGlobal: null, anchoPct: null, ultimoParaId: null };
    if (grupo.length === 1) return grupo[0];
    // Varias celdas cayeron en la misma columna (típico: 2-3 celdas angostas decorativas, a
    // veces junto con la real) — concatena el texto real si lo hay, y usa como referencia (para
    // saber si es un candidato a rellenar) la única celda que NO es decorativa por ancho; si
    // todas son angostas, ninguna era un dato real de todos modos, cualquiera sirve.
    const texto = grupo.map(c => c.texto).filter(Boolean).join(' ').trim();
    const real = grupo.find(c => c.anchoPct == null || c.anchoPct >= ANCHO_PCT_MINIMO_COLUMNA_REAL) ?? grupo[grupo.length - 1];
    return { texto, indiceGlobal: real.indiceGlobal, anchoPct: real.anchoPct, ultimoParaId: real.ultimoParaId };
  });
}

export function extraerTablasCrudo(xml: string): TablaCruda[] {
  const offsetsIndices = offsetsAIndices(xml);
  const tablas: TablaCruda[] = [];

  for (const tabla of xml.matchAll(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g)) {
    const cuerpoTabla = tabla[1];
    const offsetTabla = tabla.index! + tabla[0].indexOf(cuerpoTabla);

    // Posición de la tabla en la numeración de "índice de párrafo" (para poder agruparla por
    // formulario/anexo igual que el resto de los pendientes) — la del primer párrafo que
    // aparece adentro, sea o no el que se vaya a rellenar.
    const primerParrafo = cuerpoTabla.match(/<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>/);
    const indicePrimero = primerParrafo ? (offsetsIndices.get(offsetTabla + primerParrafo.index!) ?? null) : null;

    const filasXml = [...cuerpoTabla.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)];
    const filasCrudo: FilaTablaCruda[] = filasXml.map(filaM => {
      const offsetFila = offsetTabla + filaM.index! + filaM[0].indexOf(filaM[1]);
      const celdas = extraerCeldasDeFila(filaM[1], offsetFila, offsetsIndices);
      return { celdas: celdas.map(c => ({ texto: c.texto, indiceGlobal: c.indiceGlobal, anchoPct: c.anchoPct, ultimoParaId: c.ultimoParaId })) };
    });

    // Se alinea contra el encabezado REAL (que puede no ser la fila 0 si la tabla abre con un
    // título mergeado — ver indiceFilaEncabezado): alinear contra el título dejaba la tabla de una
    // sola columna y se perdían todas las casillas de las filas de datos.
    const iEncabezado = indiceFilaEncabezado(
      filasCrudo.map((f, i) => ({
        completa: f.celdas.length > 0 && f.celdas.every(c => c.texto.trim() !== ''),
        numCeldas: f.celdas.length,
        tieneCeldaCombinada: filaTieneCeldaCombinada(filasXml[i][1]),
      })),
    );
    const header = iEncabezado >= 0 ? filasCrudo[iEncabezado].celdas : [];
    const filas = filasCrudo.map((f, i) =>
      (iEncabezado < 0 || i <= iEncabezado ? f : { celdas: alinearFilaConEncabezado(header, f.celdas) }));

    tablas.push({ indicePrimero, filas });
  }
  return tablas;
}
