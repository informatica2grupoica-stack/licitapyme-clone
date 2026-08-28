// app/lib/anexos-detectar.ts
// Frente E.1 — detección de campos a rellenar en un anexo real, sin conocimiento previo del
// documento. Probado contra 4 anexos reales de 4 organismos (Chile Chico, Lo Barnechea, y 2
// más) — ver docs/BITACORA-CAMBIOS-VIABILIDAD.md para el detalle de cada hallazgo.
import { listarParrafos, listarBlancosInline, parrafoEstaVacio, decodificarXml, textoDeRuns, iterarTablas, type Parrafo } from '@/app/lib/anexos-docx';
import { RE_ENCABEZADO_FORMULARIO } from '@/app/lib/anexos-dividir';

// Vocabulario de ROL cercano a una etiqueta duplicada ("<contexto> — <campo>", ver
// desambiguarDuplicados más abajo) — dice A QUIÉN describe un duplicado (representante legal,
// bloque bancario, la misma persona de la ficha bajo otro título, o un tercero ajeno). Vivía en
// el diccionario (anexos-diccionario.ts, borrado — el motor 100% IA ya no lo necesita para
// decidir VALORES), pero esto es detección ESTRUCTURAL: sigue haciendo falta para saber qué
// CONTEXTO mostrarle al motor de IA cuando el mismo texto corto se repite en bloques distintos.
// Mismo patrón que RE_RAYAS en anexos-docx.ts (guiones bajos, puntos ASCII, o el carácter elipsis
// "…" repetido) — usado acá para reconocer "este párrafo YA trae su propio blanco inline" en
// varios puntos de este archivo. BUG REAL (3713-7-LE26): cuando solo se miraba "_{4,}", un párrafo
// como "Garantía ………………… meses" (relleno con elipsis, no guiones) no se reconocía como que ya
// traía su propio blanco — Patrón 1 lo tomaba entero como ETIQUETA de un campo, apuntando al
// párrafo SIGUIENTE (puro espaciado) como si ahí fuera el valor, en vez de a los puntos DENTRO de
// esta misma línea (que ahora sí cubre el patrón 2, inline).
const RE_TIENE_BLANCO_PROPIO = /_{4,}|\.{6,}|…{2,}/;

// ── Diagnóstico de exclusiones silenciosas ────────────────────────────────────────────────
// Varias reglas heurísticas de este archivo (ancho de columna, "este blanco antecede un bloque
// no rellenable", etc.) descartan candidatos SIN dejar rastro — auditoría 12-ago-2026: cuando una
// de ellas dispara mal contra un organismo nuevo, el síntoma en pantalla es "faltó una casilla"
// sin ninguna pista de CUÁL regla la comió, y el único diagnóstico posible era reproducir en
// local con breakpoints. `console.debug` (no `warn`/`error`: esto no es un error, es información)
// solo en los puntos donde una regla EXCLUYE algo que de otro modo hubiera sido candidato — nunca
// en el camino feliz, así que el volumen es bajo (unas pocas líneas por documento, no por
// párrafo) y queda visible en los logs de producción (VPS) sin tener que reproducir nada.
function logExclusion(regla: string, detalle: string): void {
  console.debug(`[anexos-detectar] excluido por "${regla}": ${detalle}`);
}

// BUG REAL (27-ago-2026, 611669-17-LE26, ANEXO N°1-A): el encabezado "ANTECEDENTE(S)
// REPRESENTANTE(S) DE LA PERSONA JURIDICA" no dice "representante LEGAL" — dice solo
// "representante(s)". El patrón exigía la palabra "legal" pegada, así que este encabezado NO
// contaba como contexto de representante y contextoDeRolCercano() seguía buscando más atrás,
// hasta encontrar (falso positivo, ver CONTEXTO_TERCERO_AJENO) el encabezado de la tabla de
// participantes UTP varias filas antes — "NOMBRE COMPLETO" del representante terminó prefijado
// con el título de una tabla ajena, sin ningún campo que lo reconociera.
const CONTEXTO_REPRESENTANTE = /(representante(?:s)?\s*(?:\(s\))?\s+legal|rep\.?\s*legal|representante(?:s)?\s*(?:\(s\))?\s+de\s+la\s+persona\s+jur[ií]dica)/i;
const CONTEXTO_BANCARIO = /(banco|cuenta\s+(bancaria|corriente|vista)|entidad\s+bancaria|titular)/i;
const CONTEXTO_MISMA_PERSONA = /(encargado|contacto|administrador(\s+de\s+contrato)?|coordinador|responsable|ejecutivo|apoderado|coordinaci[óo]n|coordinador[ao])/i;
const CONTEXTO_TERCERO_AJENO = /(u\.?t\.?p\.?|uni[óo]n\s+temporal|integrante|socio|accionista|mandante|contraparte|inspector|i\.?t\.?o\.?|participante|capacitaci[óo]n|asistente|testigo|notario|proveedor\s+asociado|subcontrat)/i;

// De quién es una firma/fecha cuando la leyenda o el párrafo cercano lo dice: usado tanto para
// decidir si estampamos la imagen de la firma (más abajo) como para excluir una FECHA que en
// realidad le pertenece al evaluador (ver precedeFirmaContraparte). El lado NEGATIVO
// (CONTRAPARTE) es tan necesario como el positivo: hay leyendas que nombran a los dos a la vez
// ("FIRMA Y TIMBRE REPRESENTANTE LEGAL   FIRMA Y TIMBRE EVALUADOR" en el mismo párrafo) — ahí no
// se adivina, se trata como contraparte para no arriesgar estampar donde no corresponde.
const RE_FIRMA_NUESTRA = /(oferente|proponente|proveedor|contratista|representante\s+legal|rep\.?\s*legal|persona\s+natural)/i;
// Ojo: NO se puede meter acá "uso exclusivo" — "Para uso exclusivo Proveedor Adjudicado" es
// NUESTRO bloque (caso real 4291-38-LP26, cubierto por un test).
const RE_FIRMA_CONTRAPARTE = /(evaluador|entidad\s+licitante|comisi[óo]n\s+evaluadora|ministro\s+de\s+fe|mandante|inspector)/i;

// ── Patrón 1: etiqueta corta + párrafo vacío inmediatamente después ───────────────────────
// (celda de tabla de 2 columnas: "Razón social" | <celda vacía>). Es RUIDOSO a propósito: no
// distingue un título corto ("ANEXO N°1") de un campo real ("RUT") — esa distinción la hace
// después el diccionario (anexos-diccionario.ts): si la etiqueta no cruza con ningún campo
// conocido, no se autocompleta nada, como mucho queda disponible para que un humano la vea.
export interface CandidatoCelda {
  etiqueta: string; paraId: string; indice: number;
  // Campo de la ficha resuelto DE FORMA DETERMINISTA por la estructura del documento, sin pasar
  // por la IA — hoy solo lo pone asignarCamposDeBloqueFirma (ver más abajo): un "RUT:" / "NOMBRE:"
  // pegado bajo "FIRMA REPRESENTANTE LEGAL:" es, sin ninguna ambigüedad, el dato de esa persona.
  campoFijo?: string;
  // La celda se muestra para que la llene un humano, pero NUNCA se autocompleta sola. Se usa para
  // las filas en blanco de una tabla que se llena entera (ver detectarCandidatosTabla) y para las
  // secciones de oferente que no nos corresponden (ver analizarAnexo).
  soloManual?: boolean;
  // true si el párrafo YA tiene texto (un prefijo de moneda como "$", o "Etiqueta:") y el valor va
  // PEGADO al final — se escribe con rellenarFinDeParrafo, nunca con rellenarCeldaVacia (que exige
  // la celda vacía y revienta si encuentra texto). Ver detectarCeldaPrefijoMoneda más abajo.
  dosPuntos?: boolean;
}

// Celda de tabla cuyo ÚNICO contenido es un prefijo de moneda ("$", "US$", "CLP$") — el número va
// PEGADO después, en el mismo párrafo. BUG REAL (3713-7-LE26, tabla de "PRODUCTO/CANTIDAD/VALOR
// UNITARIO/VALOR TOTAL"): la celda de VALOR UNITARIO trae "$" ya escrito, así que `vacio` daba
// false (textoCelda !== '') y la celda entera desaparecía — ni se autocompletaba ni quedaba
// pendiente para rellenar a mano, el usuario no tenía CÓMO escribir el precio unitario. El mismo
// prefijo ya se resolvía para las filas de TOTALES (IVA, VALOR TOTAL — ver anexos-totales-seccion.ts,
// que usa `ultimoParaId` con el mismo criterio), pero nunca para las filas de PRODUCTO individuales.
const RE_PREFIJO_MONEDA = /^(?:US\$|CLP\$|\$)$/;

// Versión CRUDA (sin desambiguarDuplicados) — la necesita el clasificador por IA
// (anexos-clasificar-ia.ts): ese módulo reemplaza el heurístico "prefijo con el candidato
// anterior en la lista" por contexto real (fila/columna de tabla, párrafos previos), así que
// necesita la etiqueta TAL CUAL la vio el patrón 1, no ya mezclada con un vecino. El camino
// viejo (determinista) sigue usando `detectarCandidatosCelda` (con desambiguación) sin cambios.
//
// `indicesVacioSinCampo` (ver parrafosQueNuncaSonCampoEnTabla): párrafos vacíos que son puro
// RELLENO dentro de la MISMA celda que una etiqueta — un salto de línea extra que Word deja
// dentro de la celda de la etiqueta, no la celda de valor de al lado. BUG REAL (1227338-6-LE26,
// "IDENTIFICACIÓN DEL PROPONENTE"/"…DEL REPRESENTANTE LEGAL"): la celda de "NOMBRE O RAZÓN
// SOCIAL" trae DOS párrafos —el texto y uno vacío de relleno— antes de llegar a la celda de valor
// real (una tabla de 2 columnas [etiqueta][valor], SIN encabezado, que cubre justamente este
// patrón). Sin este ajuste, `actual`/`siguiente` (mirando solo i, i+1) tomaba ese relleno por el
// valor: la etiqueta apuntaba a un párrafo DENTRO de su propia celda —nunca la celda de al
// lado— y el campo quedaba sin ninguna casilla donde escribir, en TODO el bloque de
// identificación (razón social, RUT, domicilio, representante legal completo). Saltando los
// párrafos de puro relleno se llega al primer vacío de verdad, que es la celda de valor.
export function detectarCandidatosCeldaCrudos(
  parrafos: Parrafo[], indicesVacioSinCampo: Set<number> = new Set(), indicesEnCelda: Set<number> = new Set(),
): CandidatoCelda[] {
  const out: CandidatoCelda[] = [];
  for (let i = 0; i < parrafos.length - 1; i++) {
    const actual = parrafos[i];
    let j = i + 1;
    while (j < parrafos.length && parrafos[j].vacio && indicesVacioSinCampo.has(parrafos[j].indice)) j++;
    const siguiente = parrafos[j];
    // Un párrafo CENTRADO seguido de blanco es un encabezado/título de sección (Word centra
    // títulos, nunca etiquetas de campo — esas siempre van alineadas a la izquierda para calzar
    // con su blanco al lado o abajo). Caso real: "IDENTIFICACION DEL OFERENTE" como título de
    // página, centrado y en negrita, antes de la tabla real de identificación — textualmente casi
    // idéntico a la etiqueta real de una fila de esa misma tabla ("IDENTIFICACIÓN DEL OFERENTE"),
    // así que ni el diccionario ni un clasificador de IA por texto puro pueden distinguirlos de
    // forma confiable — pero la alineación SÍ los distingue, sin ambigüedad y sin costo de IA.
    //
    // Ese heurístico NO aplica dentro de una celda de tabla (`indicesEnCelda`, ver
    // indicesDentroDeCelda). BUG REAL (4999-8-LE26, "ANEXO N°1 FORMULARIO DATOS DEL OFERENTE"):
    // una tabla [etiqueta][valor] de 2 columnas SIN encabezado, con la CELDA (no el texto) centrada
    // por estilo del organismo — Nombre/RUT/Representante/Dirección/Ciudad/Teléfono/Correo, las 10
    // filas quedaron con 0 candidatos: ni auto ni pendiente, invisibles por completo en pantalla.
    // Un título de página nunca vive DENTRO de un `<w:tc>` (va antes de que empiece la tabla); una
    // etiqueta de fila sí — es la señal real que distingue los dos casos, no el centrado en sí.
    if (!actual.texto || actual.texto.length > 60 || (actual.centrado && !indicesEnCelda.has(actual.indice)) || !siguiente || !siguiente.vacio) continue;

    // La LEYENDA de una línea de firma ("Firma del Oferente o Represente Legal.", el párrafo justo
    // debajo de la raya) no es la etiqueta de un campo — el párrafo vacío que le sigue es puro
    // espaciado hasta el siguiente bloque. BUG REAL (4291-38-LP26, visto al exportar el .docx
    // generado a PDF): como la etiqueta menciona "firma", analizarAnexo la mandaba a lineasFirma y
    // estampaba la imagen de la firma en ese espaciado — quedaban DOS firmas seguidas, una sobre la
    // leyenda y otra debajo.
    if (i > 0 && esRayaLarga(parrafos[i - 1].texto) && RE_LEYENDA_FIRMA.test(actual.texto)) continue;

    // Caption breve bajo una firma doble ("(OFERENTE)", junto a su par "(EVALUADOR)" al otro
    // lado del mismo bloque) que solo indica DE QUIÉN es la columna de arriba — nunca pide un
    // dato. BUG REAL (1057480-41-LP26, anexos 7 y 8): "(OFERENTE)" seguido de un párrafo vacío
    // (puro espaciado antes de la línea de Fecha) calzaba con este patrón 1 y la IA, corrida tras
    // corrida, a veces le escribía la razón social ahí — texto suelto en medio del bloque de firma.
    if (RE_CAPTION_ROL_FIRMA.test(actual.texto)) continue;

    // Una PALABRA SUELTA terminada en punto, o cualquier texto terminado en coma, es el final de
    // una frase — no una etiqueta. Caso real medido (1058086-43-LP26): el párrafo "SANTIAGO." —la
    // ciudad de una línea de fecha, cuyo resto quedó en el párrafo de al lado— seguido de un vacío
    // de espaciado, se ofreció como campo y terminó rellenado con la región de la empresa en medio
    // del pie del anexo.
    // El punto solo descarta si el párrafo es UNA sola palabra, porque en una etiqueta de varias el
    // punto final casi siempre es una abreviatura: "INICIO ACTIV." es un campo real (4291-38-LP26)
    // y descartarlo dejaba esa casilla sin ninguna forma de llenarse.
    //
    // BUG REAL (4928-14-LP26, Carabineros de Chile): "R.U.T." como etiqueta SUELTA de una tabla
    // [Nombre|RUT|Firma] caía en esta misma regla — "sin espacios" también describe una sigla
    // (R-punto-U-punto-T-punto), no solo "SANTIAGO." La diferencia real es CUÁNTOS puntos trae: una
    // frase que termina en punto tiene UNO solo (el punto final); una sigla como "R.U.T."/"I.V.A."
    // trae uno POR CADA LETRA. Exigir un único punto total deja pasar la sigla y sigue rechazando
    // "SANTIAGO." — y de paso, sin esa casilla capturada, el párrafo vacío que le seguía quedaba
    // libre para que detectarLineasFirma (Caso C) lo tomara como el hueco de la firma de LA FILA
    // DE ABAJO: la imagen terminaba estampada en la celda de "R.U.T.", no en la de "Firma".
    if (/,$/.test(actual.texto)
      || (/\.$/.test(actual.texto) && !/\s/.test(actual.texto.trim()) && (actual.texto.match(/\./g)?.length ?? 0) === 1)) continue;

    // Un párrafo que YA trae su propio blanco ("Antofagasta,________________") tampoco es la
    // etiqueta de otro campo: ese blanco lo cubre el patrón 2 (inline), y el párrafo vacío
    // siguiente es de nuevo espaciado. Sin esto se pedía el mismo dato dos veces —y, por la
    // desambiguación de duplicados, con el prefijo "Firma del Oferente…" pegado adelante.
    if (RE_TIENE_BLANCO_PROPIO.test(actual.texto)) continue;

    out.push({ etiqueta: actual.texto, paraId: siguiente.paraId, indice: siguiente.indice });
  }
  return out;
}

export function detectarCandidatosCelda(
  parrafos: Parrafo[], indicesVacioSinCampo: Set<number> = new Set(), indicesEnCelda: Set<number> = new Set(),
): CandidatoCelda[] {
  return desambiguarDuplicados(detectarCandidatosCeldaCrudos(parrafos, indicesVacioSinCampo, indicesEnCelda), parrafos);
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

// BUG REAL (1057480-41-LP26, anexos 6 y 9): ambos cierran con la MISMA raya + "FIRMA Y TIMBRE
// EVALUADOR" seguida, 1-2 párrafos después, de "FECHA DE EVALUACIÓN: ___/___/___" — un blanco
// que vive en SU PROPIO párrafo, sin ninguna raya de firma adentro. La firma ya se excluía
// (esRayaFirmaPropia/esFirmaPropia), pero esa fecha es un candidato inline más: el motor de IA
// solo ve el párrafo donde vive ("FECHA DE EVALUACIÓN: ___/___/___"), sin la leyenda de la firma
// que la precede, y decidía caso a caso — en el anexo 9 la autocompletó con la fecha de HOY como
// si fuera nuestra, en el anexo 6 (mismo párrafo literal) la dejó pendiente. Ambos documentos son
// del HOSPITAL: esa fecha la escribe el evaluador al firmar, nunca el oferente. Ventana CORTA a
// propósito (a diferencia de VENTANA_CONTEXTO_ROL): solo cuenta si la firma de contraparte está
// PEGADA arriba (raya + leyenda + a lo más un espaciador), no en otro bloque lejano del documento.
//
// SEGUNDO BUG REAL, mismo síntoma (anexos 7 y 8 del mismo documento): la leyenda trae los DOS
// bloques en un solo párrafo ("FIRMA Y TIMBRE REPRESENTANTE LEGAL      FIRMA Y TIMBRE EVALUADOR")
// y la fecha que sigue también junta las DOS casillas en una sola línea ("Fecha: __/__/__
// Fecha: __/__/__", oferente a la izquierda, evaluador a la derecha — el mismo orden que la
// leyenda de arriba). Como ambos grupos de blancos viven en el MISMO párrafo, no hay forma de
// decirle al motor "el primero es tuyo, el segundo no" sin adivinar por posición de texto — y de
// hecho probado dos veces seguidas contra el documento real, el resultado varió: una corrida llenó
// el grupo del evaluador COMPLETO con nuestra fecha, la otra lo llenó A MEDIAS (mes y año sí, día
// no, un dato roto peor que uno vacío). Iguales al caso de la firma ("estampar sería adivinar cuál
// es cuál", ver esRayaFirmaPropia): si la leyenda menciona a la contraparte, aunque sea junto con
// la nuestra en el mismo párrafo, ninguna fecha cercana se autocompleta — la escribe un humano
// mirando cuál casilla es cuál.
const VENTANA_FECHA_CONTRAPARTE = 4;

function precedeFirmaContraparte(parrafos: Parrafo[], indiceParrafo: number): boolean {
  let vistos = 0;
  for (let i = indiceParrafo - 1; i >= 0 && vistos < VENTANA_FECHA_CONTRAPARTE; i--) {
    const p = parrafos[i];
    if (!p?.texto) continue;
    vistos++;
    if (RE_FIRMA_CONTRAPARTE.test(p.texto)) return true;
  }
  return false;
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
// Todo párrafo que vive DENTRO de algún `<w:tc>` (celda de tabla), sin importar si es la etiqueta
// o el valor. Única señal que distingue de forma confiable "título de página centrado" (nunca
// vive dentro de una celda — va antes de que empiece la tabla) de "etiqueta de fila centrada por
// estilo del organismo" (sí vive dentro de una celda) — ver el comentario de
// detectarCandidatosCeldaCrudos. Mismo patrón de escaneo que parrafosQueNuncaSonCampoEnTabla.
function indicesDentroDeCelda(xml: string): Set<number> {
  const offsetsIndices = offsetsAIndices(xml);
  const dentro = new Set<number>();
  for (const tc of xml.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
    const cuerpoCelda = tc[1];
    const offsetCelda = tc.index! + tc[0].indexOf(cuerpoCelda);
    for (const p of cuerpoCelda.matchAll(/<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>/g)) {
      const indice = offsetsIndices.get(offsetCelda + p.index!);
      if (indice != null) dentro.add(indice);
    }
  }
  return dentro;
}

// Índices de párrafo que son el PRIMER párrafo de una celda de tabla cuyo borde SUPERIOR
// efectivo es visible — la "raya" de firma en algunos anexos no es texto (`_____`) ni un borde de
// PÁRRAFO (`<w:pBdr>`, ver Parrafo.bordeInferior): es el borde de la CELDA misma, casi siempre
// heredado del borde general de la tabla (`<w:tblBorders>`) y visible porque esa celda en
// particular no lo anula. BUG REAL (1426039-8-LE26, 10-ago-2026): "Nombre, RUT y Firma
// Representante Legal" vive en una tabla de 2 celdas por fila — la celda de la izquierda anula
// los 4 bordes (`nil`), la de la leyenda solo anula izquierda/abajo/derecha, así que el borde
// SUPERIOR (heredado de la tabla) queda como la única línea visible, justo arriba del texto.
//
// "Efectivo" = la propia celda manda si declara `<w:tcBorders><w:top>`; si no lo declara, hereda
// el de `<w:tblBorders><w:top>` de SU tabla. "Visible" = cualquier valor de `w:val` que no sea
// "nil"/"none" (los dos que OOXML usa para "sin borde").
function indicesConBordeSuperiorDeCeldaVisible(xml: string): Set<number> {
  const offsetsIndices = offsetsAIndices(xml);
  const out = new Set<number>();
  const esVisible = (val: string | undefined) => !!val && val !== 'nil' && val !== 'none';
  for (const tabla of iterarTablas(xml)) {
    const cuerpoTabla = tabla.cuerpo;
    const offsetTabla = tabla.indexCuerpo;
    const tblBordersMatch = cuerpoTabla.match(/<w:tblBorders>([\s\S]*?)<\/w:tblBorders>/);
    const tblTop = tblBordersMatch?.[1].match(/<w:top\s+[^>]*w:val="([^"]+)"/)?.[1];
    for (const tc of cuerpoTabla.matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
      const cuerpoCelda = tc[1];
      const tcBordersMatch = cuerpoCelda.match(/<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/);
      const tcTop = tcBordersMatch?.[1].match(/<w:top\s+[^>]*w:val="([^"]+)"/)?.[1];
      // La celda manda si declara SU PROPIO top (aunque sea para anularlo); si no lo declara,
      // hereda el de la tabla completa.
      const efectivo = tcTop !== undefined ? tcTop : tblTop;
      if (!esVisible(efectivo)) continue;
      const primerParrafo = cuerpoCelda.match(/<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>/);
      if (!primerParrafo) continue;
      const offsetCelda = offsetTabla + tc.index! + tc[0].indexOf(cuerpoCelda);
      const indice = offsetsIndices.get(offsetCelda + primerParrafo.index!);
      if (indice != null) out.add(indice);
    }
  }
  return out;
}

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
      let huboVacio = false;
      for (const p of parrafosCelda) {
        const indice = offsetsIndices.get(offsetCelda + (p.index ?? 0));
        if (indice != null) excluidos.add(indice);
        if (parrafoEstaVacio(p[1])) huboVacio = true;
      }
      // Solo se registra cuando el corte por ancho se llevó un párrafo VACÍO (el caso que importa:
      // una casilla que nunca se va a ofrecer como candidato) — una celda angosta con texto propio
      // no pierde nada al excluirse, así que loguearla sería ruido sin valor diagnóstico.
      if (huboVacio) {
        logExclusion('columna angosta',
          `celda de ${anchoPct}‰ (umbral ${ANCHO_PCT_MINIMO_COLUMNA_REAL}‰) con un párrafo vacío descartado como candidato — texto de la celda: "${textoCelda.slice(0, 60) || '(vacía)'}"`);
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
  // true si `paraId`/`indiceGlobal` apuntan a un párrafo con texto (el prefijo de moneda) — el
  // candidato que salga de acá necesita rellenarFinDeParrafo, no rellenarCeldaVacia.
  dosPuntos?: boolean;
  // Índice GLOBAL de cada párrafo de la celda (mismo `indice` que usa Parrafo/blancosInline) —
  // BUG REAL (3713-7-LE26): una celda con texto propio ("SI ____ NO ____ declaro...", "Plazo de
  // entrega" con relleno de puntos al lado) NUNCA se marcaba `vacio`, así que el patrón de tabla
  // la trataba como texto fijo de solo lectura — el blanco INLINE que trae adentro (ver
  // blancosInline) desaparecía de la réplica aunque el detector sí lo hubiera encontrado. Con
  // estos índices, construirTablaUI (anexos-rellenar.ts) puede cruzar la celda contra
  // analisis.blancosInline y pintar el input donde corresponde, igual que ya hace con un párrafo
  // normal fuera de tabla.
  indicesParrafos: number[];
}

// Umbral de "celda decorativa": encontrado en un anexo real donde una columna de categoría del
// encabezado ("LETRERO INDICADOR DE OBRAS") venía MERGEADA en el encabezado pero partida en 3
// celdas angostas sueltas en cada fila de datos (sin <w:vMerge>, boradesr) — cada una de ~245
// (4.9% del ancho, escala pct de OOXML es 0-5000) contra columnas reales de 550+ (11%+). Sin
// filtrar esto, esas 3 celdas angostas se ofrecían como blancos a rellenar (con la etiqueta de
// columna mal calzada, ver comentario en detectarCandidatosTabla) — nunca son un dato real, son
// puro relleno visual de layout.
const ANCHO_PCT_MINIMO_COLUMNA_REAL = 400;

// Columnas que NOMBRAN la fila (qué producto/servicio es), distintas de las que la describen de
// otra forma (unidad de medida, cantidad, plazo). Se usan para elegir el texto que identifica a la
// fila cuando la tabla trae encabezado — ver detectarCandidatosTabla. Sin tildes a propósito: la
// comparación normaliza antes (DESCRIPCIÓN / DESCRIPCION / Ítem / item son la misma columna).
const RE_COLUMNA_DESCRIPTIVA = /\b(producto|productos|descripcion|descripciones|detalle|detalles|item|items|articulo|articulos|servicio|servicios|glosa|partida|partidas|insumo|insumos|material|materiales|especie|especies)\b/;

function sinTildesMinuscula(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

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
    (f.numCeldas >= 3 && f.numCeldasConTexto >= f.numCeldas - 1)
    // BUG REAL (2908-16-LE26, 10-ago-2026): "NOMBRE O RAZÓN SOCIAL DEL OFERENTE" | "RUT EMPRESA"
    // — la tabla de identificación más común que existe — usa gridSpan para repartir el ANCHO
    // entre dos columnas REALES, cada una fusionando varias columnas de la grilla. Eso también
    // pone tieneCeldaCombinada=true, así que sin esta rama la tabla entera se descartaba: caía al
    // patrón 1 (celda simple), que solo empareja UNA etiqueta con el ÚNICO párrafo vacío
    // siguiente — como las DOS etiquetas comparten la misma fila, la primera ("NOMBRE...") no
    // tenía con qué emparejarse y la segunda ("RUT EMPRESA") terminaba con la celda vacía de la
    // OTRA columna. Distinto del gridSpan de la rama de arriba (una celda-cajón que fusiona VARIAS
    // columnas conceptuales en una, "Requisitos excluyentes:", ANEXO N°4 1057472-89-LE26): acá
    // exigir EXACTAMENTE 2 celdas y las DOS con texto (no "casi todas") es la diferencia — un
    // encabezado ancho de 2 columnas siempre tiene sus 2 nombres completos; una fila de ítem con
    // gridSpan real trae solo el rótulo del cajón con texto, el resto de sus celdas (Cumple,
    // Catálogo, Observaciones) vienen vacías y esa asimetría ya la descarta esta regla.
    || (f.numCeldas === 2 && f.numCeldasConTexto === 2 && !!f.tieneCeldaCombinada);
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
    // tc.index es la posición del <w:tc>...</w:tc> completo; cuerpoCelda (tc[1]) arranca DESPUÉS
    // de la apertura "<w:tc...>" — hay que sumar esa diferencia para llegar a la posición real
    // dentro del XML completo (mismo ajuste para cualquier offset relativo a cuerpoCelda).
    const offsetCelda = offsetFila + tc.index! + tc[0].indexOf(cuerpoCelda);
    const indicesParrafos = parrafosCelda
      .map(p => offsetsIndices.get(offsetCelda + (p.index ?? 0)))
      .filter((i): i is number => i != null);
    // Toma el ÚLTIMO párrafo vacío de la celda como candidato a rellenar — casi siempre las celdas
    // de una tabla de specs traen un solo párrafo, así que en la práctica es el único. Se usa
    // parrafoEstaVacio (sin TEXTO) y no "sin runs": con el XML de LibreOffice, que deja un run
    // vacío en cada celda, la regla vieja no encontraba ni una celda libre en todo el documento.
    const parrafoVacio = [...parrafosCelda].reverse().find(p => parrafoEstaVacio(p[2]));
    let paraId: string | null = null;
    let indiceGlobal: number | null = null;
    let dosPuntos = false;
    if (parrafoVacio && textoCelda === '') {
      paraId = parrafoVacio[1];
      indiceGlobal = offsetsIndices.get(offsetCelda + (parrafoVacio.index ?? 0)) ?? null;
    } else if (RE_PREFIJO_MONEDA.test(textoCelda) && parrafosCelda.length) {
      // Celda con SOLO un prefijo de moneda ("$"): no hay párrafo vacío que ofrecer (el único
      // párrafo ya tiene texto), así que el candidato apunta al ÚLTIMO párrafo de la celda —el que
      // tiene el "$"— para escribir el número PEGADO a continuación (dosPuntos, ver más abajo).
      const ultimo = parrafosCelda[parrafosCelda.length - 1];
      paraId = ultimo[1];
      indiceGlobal = offsetsIndices.get(offsetCelda + (ultimo.index ?? 0)) ?? null;
      dosPuntos = true;
    }
    const ultimoParaId = parrafosCelda.length ? parrafosCelda[parrafosCelda.length - 1][1] : null;
    celdas.push({
      texto: textoCelda, vacio: (textoCelda === '' && paraId != null) || dosPuntos,
      paraId, indiceGlobal, anchoPct, ultimoParaId, dosPuntos, indicesParrafos,
    });
  }
  return celdas;
}

export function detectarCandidatosTabla(xml: string): CandidatoCelda[] {
  const out: CandidatoCelda[] = [];
  const offsetsIndices = offsetsAIndices(xml);

  for (const tabla of iterarTablas(xml)) {
    const cuerpoTabla = tabla.cuerpo;
    const offsetTabla = tabla.indexCuerpo;
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

      // BUG REAL (27-ago-2026, 611669-17-LE26, ANEXO N°1-A): un ÚNICO `<w:tbl>` físico de Word
      // puede contener VARIAS sub-secciones semánticamente distintas separadas por filas
      // divisorias de UNA sola celda (gridSpan a todo el ancho: "ANTECEDENTE(S) REPRESENTANTE(S)
      // DE LA PERSONA JURIDICA", "DATOS BANCARIOS PARA PAGO DE FACTURAS"). Antes de este fix, ese
      // divisor se descartaba EN SILENCIO (lo saca el filtro `celdas.length >= 2` un poco más
      // abajo) sin terminar el segmento — así que el encabezado de la tabla de participantes UTP
      // ("NOMBRE O RAZÓN SOCIAL DE LA PERSONA JURÍDICA O NATURAL MIEMBRO DE LA UTP") seguía
      // "pegado" a TODO lo que venía después en la misma tabla física: la sección del
      // representante legal y la sección bancaria, dos sub-tablas de formulario [etiqueta][valor]
      // sin ningún encabezado propio. Resultado real: "NOMBRE COMPLETO" del representante llegaba
      // a la IA como "NOMBRE COMPLETO — NOMBRE O RAZÓN SOCIAL DE LA PERSONA JURÍDICA O NATURAL
      // MIEMBRO DE LA UTP" — una etiqueta que no describe nada real — y quedaba sin poder
      // resolverse, aunque representante_nombre/representante_rut SÍ estaban en la ficha.
      //
      // La señal es la misma que ya usa el resto del archivo para reconocer un encabezado real
      // ("todas sus columnas nombradas", ver el comentario de más abajo): una fila que NO PUEDE
      // ser un dato de ESTE encabezado —tiene menos de 2 celdas físicas, no puede traer ninguna
      // columna nombrada— termina el segmento ahí mismo. Nunca al revés: no se inventa un
      // encabezado nuevo para lo que sigue, solo se deja de reclamar esas filas para el
      // encabezado VIEJO, así el patrón 1 (formulario simple, sin encabezado) las puede resolver
      // solo, con su propia etiqueta ("NOMBRE COMPLETO" a secas) intacta.
      let finSegmentoReal = finSegmento;
      for (let i = iEncabezado + 1; i < finSegmento; i++) {
        if (filasInfo[i].numCeldas < 2) { finSegmentoReal = i; break; }
      }

      const primeraFila = filas[iEncabezado];
      const restoFilas = filas.slice(iEncabezado + 1, finSegmentoReal);
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

      // Cuántas filas de este segmento son DATOS reales (≥2 celdas propias — mismo filtro que el
      // `continue` de más abajo, calculado antes para no repetir el parseo dos veces). Determina si
      // esto es una LISTA (varias entidades desconocidas, ej. asistentes a una capacitación —
      // ahí SÍ hay que forzar solo-manual, nunca adivinar de quién es cada fila) o el FORMULARIO DE
      // UNA SOLA ENTIDAD (identificación del propio oferente: Dirección/Teléfono/Representante
      // Legal como bloques de una fila cada uno) — ver el uso más abajo, junto al out.push.
      const filasDeDatos = restoFilas
        .map(fila => {
          // Mismo ajuste que siempre: fila.index es la posición del <w:tr>...</w:tr> completo, pero
          // fila[1] (lo que recibe extraerCeldasDeFila) arranca después de la apertura "<w:tr...>".
          const offsetFila = offsetTabla + fila.index! + fila[0].indexOf(fila[1]);
          return extraerCeldasDeFila(fila[1], offsetFila, offsetsIndices);
        })
        // Antes exigía 3+ columnas ("2 ya las cubre el patrón 1, etiqueta | valor") — pero esa
        // suposición solo vale cuando la tabla NO tiene encabezado (ahí sí la cubre el patrón 1, y
        // ni siquiera se llega hasta acá por el `if (!encabezados.length) continue` de arriba). Con
        // encabezado SÍ detectado (como acá) y solo 2 columnas, el patrón 1 nunca la toca — caso
        // real 1058086-43-LP26, ANEXO N°6 "(MARCAR CON UNA X)": una tabla de 2 columnas [casilla
        // vacía | descripción de la opción] donde la primera fila trae AMBAS celdas con texto (la
        // instrucción "(MARCAR CON UNA X)" comparte fila con la primera opción) — quedaba fuera de
        // los dos patrones a la vez y ninguna casilla de "marcar con X" aparecía nunca en el modal.
        .filter(celdas => celdas.length >= 2);
      // BUG REAL (2908-16-LE26, 10-ago-2026): la tabla de identificación más común que existe trae
      // Dirección Comercial / Teléfono / Representante Legal como bloques de UNA fila cada uno, SIN
      // texto propio (el dato va en una celda vacía bajo el nombre de columna) — antes, "sin texto
      // propio" forzaba SIEMPRE solo-manual, sin distinguir esto de una lista de terceros. Con
      // UNA sola fila de datos bajo el encabezado no hay ambigüedad de "a quién pertenece": el
      // propio nombre de columna ("Nombre"/"Rut"/"Cargo" bajo "REPRESENTANTE LEGAL:") ya lo dice, y
      // el resto del pipeline (contexto de párrafos previos + campoCalzaConLaEtiqueta +
      // CAMPOS_PERMITIDOS_POR_CATEGORIA) es el mismo que ya resuelve bien estos campos cuando vienen
      // por el patrón 5 ("Nombre del Representante Legal:" + valor en la misma línea). Con DOS O MÁS
      // filas de datos sigue siendo una LISTA (asistentes, integrantes) y se mantiene solo-manual.
      const esListaDeVariasFilas = filasDeDatos.length > 1;

      for (const celdas of filasDeDatos) {

        // Alineación por ANCHO REAL, no por índice de posición — ver columnasPorAncho arriba.
        // Reemplaza la alineación "desde la derecha" anterior: esa asumía que el relleno decorativo
        // siempre va al PRINCIPIO de la fila, pero un documento real (1738-18-LE26) trae filas con
        // relleno en cantidad y posición distintas fila a fila — con índices, cualquier fila que no
        // calzara con el patrón asumido perdía su candidato real de PRECIO (o lo etiquetaba con la
        // columna equivocada).
        const columnaDeCadaCelda = columnasPorAncho(anchosHeader, celdas.map(c => c.anchoPct));

        // Qué texto de la fila la identifica. El criterio "la celda con más texto" funciona en la
        // mayoría de las tablas, pero se equivoca justo donde más duele: BUG REAL
        // (539119-76-LP26, ANEXO N°3) la fila "5 | MASA DE PIZZA | 1 BOLSA CON 2 UNIDADES | ___"
        // se etiquetaba "1 BOLSA CON 2 UNIDADES — VALOR UNITARIO OFERTADO NETO" porque la unidad
        // de medida es más larga que el nombre del producto. La etiqueta es lo que después se
        // cruza contra el costeo (ver anexos-precios-ia.ts), así que perder el nombre del producto
        // es perder el precio: "MASA DE PIZZA" estaba en el costeo, "1 BOLSA CON 2 UNIDADES" no.
        // Con encabezado detectado hay una señal mucho mejor que la longitud: la propia tabla dice
        // cuál es su columna descriptiva ("PRODUCTOS", "DESCRIPCIÓN", "ÍTEM", "DETALLE"…).
        let filaContexto = '';
        const colDescriptiva = hayEncabezado
          ? nombresColumna.findIndex(n => RE_COLUMNA_DESCRIPTIVA.test(sinTildesMinuscula(n)))
          : -1;
        if (colDescriptiva >= 0) {
          const celdaDescriptiva = celdas.find((_, i) => columnaDeCadaCelda[i] === colDescriptiva);
          if (celdaDescriptiva?.texto) filaContexto = celdaDescriptiva.texto;
        }
        // Sin columna descriptiva (o con esa celda vacía) se mantiene el criterio de siempre.
        if (!filaContexto) for (const c of celdas) if (c.texto.length > filaContexto.length) filaContexto = c.texto;
        // Una fila SIN NINGÚN texto propio sigue siendo válida: en una tabla que se llena entera
        // (especificaciones técnicas, participantes de una capacitación) TODAS las filas están en
        // blanco y la etiqueta sale del nombre de la columna. Antes se descartaba la fila completa —
        // caso real 4291-38-LP26: el FORMULARIO N°3 tiene 20 celdas para llenar y no aparecía
        // ninguna, la caja salía en pantalla sin una sola casilla.

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
          // Si la fila no aporta NINGÚN texto, la etiqueta es solo el nombre de la columna. Si
          // ADEMÁS hay más de una fila así (una LISTA — especificaciones, participantes de una
          // capacitación), son datos de la oferta o de terceros desconocidos: se muestran para
          // llenarlos a mano pero NUNCA se autocompletan — sin esto, la columna "RUT" de la tabla de
          // asistentes del acta de capacitación se rellenaba con el RUT de la empresa en las 8
          // filas. Con UNA sola fila (el FORMULARIO de una sola entidad — ver esListaDeVariasFilas
          // más arriba) no hay esa ambigüedad y se deja resolver normal.
          out.push({
            etiqueta: etiqueta.slice(0, 160), paraId: c.paraId, indice: c.indiceGlobal,
            ...(filaContexto || !esListaDeVariasFilas ? {} : { soloManual: true }),
            ...(c.dosPuntos ? { dosPuntos: true } : {}),
          });
        });
      }
    }
  }
  return out;
}

// Todos los índices de párrafo que viven en las celdas de DATOS de una tabla que
// detectarCandidatosTabla reconoció con encabezado real — no solo el ÚLTIMO párrafo vacío que ese
// patrón elige como destino de cada celda, sino TODOS (incluidos los blancos "de más" que Word
// deja en la misma celda). Réplica intencional de la búsqueda de segmentos de detectarCandidatosTabla
// (mismas funciones, mismas condiciones) — se mantiene APARTE, sin tocar esa función ni su tipo de
// retorno (ya probado con casos reales), solo para juntar este set más ancho.
//
// BUG REAL (1426039-8-LE26, 10-ago-2026, ANEXO N°6): la celda de valor de "Banco"/"Tipo de
// Cuenta"/"Número de Cuenta" trae DOS párrafos vacíos (línea de más que deja Word). El patrón de
// tabla se queda con el SEGUNDO (mejor contexto: etiqueta "Banco — INFORMACIÓN"), pero el patrón 1
// —que solo mira "la etiqueta y el párrafo QUE LE SIGUE si está vacío"— se quedaba con el PRIMERO,
// un índice DISTINTO. El filtro que ya existía para no duplicar lo que la tabla reclama
// (`!indicesTabla.has(c.indice)`) no los reconocía como el mismo campo porque literalmente
// apuntan a párrafos distintos: quedaban dos candidatos para la misma casilla visual, uno con
// contexto rico (columna de la tabla) y otro sin ninguno — y ese segundo, sin nada que lo ancle,
// podía resolver "no aplica" aunque el dato SÍ estuviera en la ficha. Con este set más ancho, el
// párrafo "de más" también queda fuera del alcance del patrón 1 desde el vamos.
function indicesEnCeldasDeDatosDeTabla(xml: string): Set<number> {
  const out = new Set<number>();
  const offsetsIndices = offsetsAIndices(xml);
  for (const tabla of iterarTablas(xml)) {
    const cuerpoTabla = tabla.cuerpo;
    const offsetTabla = tabla.indexCuerpo;
    const filas = [...cuerpoTabla.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)];
    if (filas.length < 2) continue;
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
    for (let s = 0; s < encabezados.length; s++) {
      const iEncabezado = encabezados[s];
      const finSegmento = s + 1 < encabezados.length ? encabezados[s + 1] : filas.length;
      // MISMO corte que detectarCandidatosTabla (ver su comentario extenso, bug real
      // 611669-17-LE26): sin esto, este set marca como "ya cubierto por la tabla" TODA la cola de
      // la tabla física —incluidas sub-secciones separadas por un divisor de una sola celda—, así
      // que el patrón 1 las excluye (`!indicesTabla.has`) creyendo que el patrón de tabla ya las
      // resolvió, cuando en realidad NINGUNO de los dos las reclama: la casilla desaparece
      // entera, ni resuelta ni pendiente, sin que nadie pueda verla para llenarla a mano. Las dos
      // funciones tienen que cortar en el MISMO punto exacto o uno "libera" filas que el otro
      // sigue creyendo suyas.
      let finSegmentoReal = finSegmento;
      for (let i = iEncabezado + 1; i < finSegmento; i++) {
        if (filasInfo[i].numCeldas < 2) { finSegmentoReal = i; break; }
      }
      const restoFilas = filas.slice(iEncabezado + 1, finSegmentoReal);
      for (const fila of restoFilas) {
        const offsetFila = offsetTabla + fila.index! + fila[0].indexOf(fila[1]);
        const celdas = extraerCeldasDeFila(fila[1], offsetFila, offsetsIndices);
        if (celdas.length < 2) continue;
        for (const c of celdas) for (const idx of c.indicesParrafos) out.add(idx);
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

// BUG REAL (28-ago-2026, reportado por el usuario como "cuando pide 3 veces el correo lo pone una
// sola vez"; medido después en 67 casillas de 1.216, sobre 179 documentos): `indiceRun` tenía DOS
// definiciones distintas que no calzaban entre sí.
//
//   · Acá se contaban los <w:t> RECORRIENDO PÁRRAFOS. Ese regex de párrafo es no-greedy y NO
//     soporta <w:p> ANIDADOS — y los hay: un cuadro de texto (<w:txbxContent>) trae sus propios
//     párrafos DENTRO del párrafo ancla. El match del párrafo externo se corta en el `</w:p>` del
//     interno, así que todos los <w:t> que venían después, hasta el cierre real, NO SE CONTABAN.
//   · `rellenarRunPorIndice` (anexos-docx.ts), que es quien ESCRIBE, cuenta los <w:t> de TODO el
//     documento de corrido.
//
// Desde el primer cuadro de texto los dos índices quedaban corridos, y de ahí en adelante cada
// escritura caía en un run EQUIVOCADO: el marcador original quedaba intacto (nadie lo tocó) y el
// dato se escribía encima de otro texto cualquiera. En 1491-16-LE26 eso dejó literalmente
// "Santiago Osvaldo López Palavecino o>" en medio de un párrafo ajeno. No era una casilla sin
// llenar: era el dato escrito en el lugar incorrecto, que es bastante peor.
//
// El arreglo es que exista UNA sola definición: `indiceRun` ES la posición del <w:t> en la lista
// global del documento, con el MISMO regex que usa quien escribe. Los párrafos se siguen usando
// para el contexto y para `indiceParrafo`, pero ya no para numerar los runs.
export function detectarBlancosInline(xml: string): CandidatoInline[] {
  const out: CandidatoInline[] = [];
  // La lista que MANDA: mismo patrón, carácter por carácter, que rellenarRunPorIndice.
  const runsGlobales = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)];
  const parrafos = [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)];
  // Puntero que avanza junto con los párrafos: los dos arreglos vienen en orden de documento y
  // matchAll nunca devuelve matches solapados, así que alcanza con recorrerlos una sola vez.
  let puntero = 0;

  parrafos.forEach((parMatch, indiceParrafo) => {
    const desde = parMatch.index ?? 0;
    const hasta = desde + parMatch[0].length;
    while (puntero < runsGlobales.length && (runsGlobales[puntero].index ?? 0) < desde) puntero++;
    const indicesDeEsteParrafo: number[] = [];
    for (let i = puntero; i < runsGlobales.length && (runsGlobales[i].index ?? 0) < hasta; i++) indicesDeEsteParrafo.push(i);

    // DECODIFICADO (ver decodificarXml): las posiciones que se calculan acá son las mismas que
    // usa rellenarRunPorIndice para escribir, y ese también decodifica antes de editar.
    const runsDelParrafo = indicesDeEsteParrafo.map(i => decodificarXml(runsGlobales[i][1]));
    const textoParrafoCompleto = runsDelParrafo.join('');
    let offsetAcumulado = 0;
    let posicionEnParrafo = 0;

    for (const texto of runsDelParrafo) {
      const indiceRunGlobal = indicesDeEsteParrafo[posicionEnParrafo++];
      for (const b of listarBlancosInline(texto)) {
        const posGlobalEnParrafo = offsetAcumulado + b.posEnTexto;
        const previo = textoParrafoCompleto.slice(0, posGlobalEnParrafo);
        // "_{4,}" (el mismo umbral de listarBlancosInline) también corta el contexto — sin esto,
        // dos campos "Etiqueta: ____" seguidos en el mismo párrafo ("Nombre: ____Cargo: ____")
        // dejaban la corrida de guiones del campo ANTERIOR pegada al contexto del siguiente, y el
        // slice(-60) a ciegas cortaba la etiqueta a la mitad ("Cargo:" salía como "rgo:", caso
        // real 1058086-43-LP26, ANEXO N°8).
        // También corta en un MARCADOR anterior (patrón 2b) y en una línea de puntos (ASCII o el
        // carácter elipsis "…", que Word suele meter como un solo glifo en vez de tres puntos —
        // ver RE_RAYAS en anexos-docx.ts), por la misma razón que corta en "_{4,}": el marcador o
        // la raya de la casilla previa no son contexto de esta.
        const contexto = (previo.split(/[,.;]|\(\*+\)|_{4,}|…+|>>|\]/).pop() || previo).trim().slice(-60);
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
    }
  });
  return out;
}

// ── Fecha partida en 3 casillas — resuelto DETERMINISTA, sin pasar por la IA ──────────────────
// BUG REAL (608-156-LP26, "Viña del Mar, ___ de ________________ de ________" repetido 5 veces en
// el mismo documento): es SIEMPRE la fecha de hoy, en el mismo orden (día/mes/año), sin excepción
// — no hay nada que "decidir" ahí. Dejárselo a la IA, aun con el prompt explícito, dio dos fallas
// reales corriendo contra el documento: 1) escribió el MES EN NÚMERO ("08") en la casilla que va
// en palabra ("agosto") — formato equivocado para una declaración jurada chilena; 2) con las 5
// ocurrencias casi idénticas en el mismo documento, la categorización se mezcló entre ellas —
// el valor del DÍA apareció en la casilla del MES en una de las 5. Mismo criterio que
// detectarAvisoNoAplica: cuando la respuesta correcta NUNCA depende del contexto del documento,
// resolverla en código es más confiable que pedírsela al modelo.
// 'anio_2digitos': el SIGLO ya viene impreso en la plantilla y la casilla solo espera los dos
// últimos dígitos — ver RE_CONECTOR_DE_CON_SIGLO más abajo.
export type RolFechaTriplete = 'dia' | 'mes_numero' | 'mes_palabra' | 'anio' | 'anio_2digitos' | 'anio_1digito';

// Una línea de fecha siempre es corta ("Viña del Mar, ___ de ___ de ___" son ~55 caracteres). El
// tope descarta un párrafo de declaración jurada larga que solo por casualidad tenga dos "de"
// sueltos entre blancos no relacionados con una fecha.
const LARGO_MAX_LINEA_FECHA = 120;
const RE_CONECTOR_DE = /^de$/i;
// BUG REAL (18-ago-2026, caso 2296-48-LE26, Municipalidad de Conchalí — los 7 formatos del pliego
// cierran igual): "CONCHALÍ,……….DE…………………………DE  20…….." — el SIGLO ("20") viene impreso en la
// plantilla y la casilla del año solo espera los dos últimos dígitos. El conector entre el mes y
// el año no es "de" sino "de 20", así que RE_CONECTOR_DE fallaba y el triplete entero se caía: la
// fecha quedaba pendiente en LOS SIETE anexos del documento. Escribir el año completo ahí daría
// "20 2026" en el papel, así que este caso tiene su propio rol (ver valorTripleteFecha).
const RE_CONECTOR_DE_CON_SIGLO = /^de\s*(?:19|20)$/i;
// Variante del mismo pliego (2296-48-LE26, FORMATOS Nº1-B y Nº2): el organismo imprimió TRES
// dígitos ("DE  202") y dejó el último para escribir a mano. Se acepta hasta 3 dígitos y NUNCA 4:
// con el año completo impreso ("DE 2026") el blanco que sigue ya no es el año, es otra cosa, y
// completarlo con "" (los últimos 0 dígitos) sería silenciosamente escribir nada donde el humano
// sí tiene que decidir algo.
const RE_CONECTOR_DE_CON_DECADA = /^de\s*(?:19|20)\d$/i;

// Clave = `${indiceRun}:${posEnTexto}`, el mismo formato que usa el resto del pipeline
// (resolverAnexoConIA, generarAnexoFinal) para identificar un blanco inline único.
// Además del trío completo (día/mes/año los tres en blanco), hay un segundo formato real, igual
// de determinista: el AÑO ya viene IMPRESO en el propio documento y solo el día y el mes quedan en
// blanco — "Los Vilos, ____________de_______________2026" (caso real 3713-7-LE26, 6 ocurrencias en
// el mismo documento). Se exige que justo después del segundo blanco aparezca un año de 4 dígitos
// (19xx/20xx) suelto — sin eso, "de" es una palabra demasiado común como para bastar por sí sola.
const RE_ANIO_IMPRESO = /\b(19|20)\d{2}\b/;
const LARGO_COLA_ANIO = 20;

export function detectarTripletesFecha(blancos: CandidatoInline[]): Map<string, RolFechaTriplete> {
  const out = new Map<string, RolFechaTriplete>();
  const porParrafo = new Map<number, CandidatoInline[]>();
  for (const b of blancos) {
    if (!porParrafo.has(b.indiceParrafo)) porParrafo.set(b.indiceParrafo, []);
    porParrafo.get(b.indiceParrafo)!.push(b);
  }
  for (const grupoSinOrdenar of porParrafo.values()) {
    if (grupoSinOrdenar.length < 2) continue;
    const grupo = [...grupoSinOrdenar].sort((a, b) => a.posEnParrafo - b.posEnParrafo);
    const texto = grupo[0].parrafoCompleto;
    if (texto.length > LARGO_MAX_LINEA_FECHA) continue;
    let i = 0;
    while (i < grupo.length) {
      // Trío: día / mes / año, los tres en blanco — se intenta PRIMERO (más específico: dos
      // conectores en vez de uno) para no dejar que la dupla se coma el primer par de un trío.
      if (i + 2 < grupo.length) {
        const [b1, b2, b3] = [grupo[i], grupo[i + 1], grupo[i + 2]];
        const conector1 = texto.slice(b1.posEnParrafo + b1.largo, b2.posEnParrafo).trim();
        const conector2 = texto.slice(b2.posEnParrafo + b2.largo, b3.posEnParrafo).trim();
        const esBarra = conector1 === '/' && conector2 === '/';
        const esDe = RE_CONECTOR_DE.test(conector1) && RE_CONECTOR_DE.test(conector2);
        const esDeConSiglo = RE_CONECTOR_DE.test(conector1) && RE_CONECTOR_DE_CON_SIGLO.test(conector2);
        const esDeConDecada = RE_CONECTOR_DE.test(conector1) && RE_CONECTOR_DE_CON_DECADA.test(conector2);
        if (esBarra || esDe || esDeConSiglo || esDeConDecada) {
          out.set(`${b1.indiceRun}:${b1.posEnTexto}`, 'dia');
          out.set(`${b2.indiceRun}:${b2.posEnTexto}`, esBarra ? 'mes_numero' : 'mes_palabra');
          out.set(`${b3.indiceRun}:${b3.posEnTexto}`,
            esDeConSiglo ? 'anio_2digitos' : esDeConDecada ? 'anio_1digito' : 'anio');
          i += 3;
          continue;
        }
      }
      // Dupla: día / mes, con el año ya impreso a continuación.
      if (i + 1 < grupo.length) {
        const [b1, b2] = [grupo[i], grupo[i + 1]];
        const conector = texto.slice(b1.posEnParrafo + b1.largo, b2.posEnParrafo).trim();
        const cola = texto.slice(b2.posEnParrafo + b2.largo, b2.posEnParrafo + b2.largo + LARGO_COLA_ANIO);
        if (RE_CONECTOR_DE.test(conector) && RE_ANIO_IMPRESO.test(cola)) {
          out.set(`${b1.indiceRun}:${b1.posEnTexto}`, 'dia');
          out.set(`${b2.indiceRun}:${b2.posEnTexto}`, 'mes_palabra');
          i += 2;
          continue;
        }
      }
      i++;
    }
  }
  return out;
}

// ── Alternativa excluyente en prosa: "___registra..." / "___no registra..." — DETERMINISTA ──────
// BUG REAL (4999-8-LE26, "ANEXO N°4-A", encontrado 6-ago-2026 corriendo el banco de pruebas contra
// licitaciones reales): una declaración jurada ofrece DOS blancos, cada uno al principio de su
// propio párrafo, para que el oferente marque una X en la alternativa que le aplica — la MISMA
// frase repetida, una vez en positivo y otra negada con "no":
//   "___registra saldos insolutos de remuneraciones..."
//   "___no registra saldos insolutos de remuneraciones..."
// No es un dato que salga de la ficha de empresa: es una decisión que el oferente declara sobre sí
// mismo (nadie puede saber si tiene deudas laborales mirando su razón social). Dejárselo a la IA
// dio un resultado INCONSISTENTE entre corridas del mismo documento: a veces las dos casillas
// quedaban pendientes (correcto), otras la IA escribió la razón social en una de las dos —un dato
// real, pero del tipo equivocado, en una declaración jurada— solo porque el AGRUPAMIENTO en lotes
// de 8 le tocó distintos vecinos de un lote a otro (con temperature:0 cada llamada es estable, pero
// qué candidatos comparten lote con este par no lo es). Mismo criterio que detectarTripletesFecha:
// cuando la respuesta NUNCA puede salir de la ficha, resolverlo en código —mandándolo derecho a
// "hay que decidirlo"— es más confiable que dejar que la IA adivine lote a lote.
const LARGO_MAX_ALTERNATIVA = 400;
const RE_NEGACION_INICIAL = /^no\s+/i;
// El blanco tiene que vivir prácticamente al INICIO de su párrafo (excluyendo un posible espacio
// previo) — así una negación cualquiera en medio de una oración larga no dispara nada; el patrón
// real siempre abre la frase con la casilla a marcar.
const POS_MAX_INICIO_PARRAFO_ALTERNATIVA = 3;

function normalizarParaComparar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// Devuelve las claves (`${indiceRun}:${posEnTexto}`, mismo formato que usa el resto del pipeline)
// de los blancos que forman un par de alternativa excluyente — para que anexos-rellenar.ts los
// mande derecho a pendiente/decisión del usuario, sin pasar por la IA.
export function detectarAlternativasExcluyentes(blancos: CandidatoInline[]): Set<string> {
  const out = new Set<string>();
  const porParrafo = new Map<number, CandidatoInline[]>();
  for (const b of blancos) {
    if (!porParrafo.has(b.indiceParrafo)) porParrafo.set(b.indiceParrafo, []);
    porParrafo.get(b.indiceParrafo)!.push(b);
  }
  // Solo párrafos con UN blanco al inicio califican — un párrafo con varios blancos ya lo cubre
  // otro patrón (fecha partida, declaración jurada corrida con nombre/RUT/domicilio).
  const candidatoPorIndice = new Map<number, CandidatoInline>();
  for (const [indiceParrafo, grupo] of porParrafo) {
    if (grupo.length !== 1) continue;
    const [b] = grupo;
    if (b.posEnParrafo > POS_MAX_INICIO_PARRAFO_ALTERNATIVA) continue;
    if ((b.parrafoCompleto || '').length > LARGO_MAX_ALTERNATIVA) continue;
    candidatoPorIndice.set(indiceParrafo, b);
  }
  for (const [indiceParrafo, b1] of candidatoPorIndice) {
    // Solo mira el párrafo INMEDIATAMENTE siguiente — el patrón real siempre viene pegado, una
    // alternativa justo debajo de la otra.
    const b2 = candidatoPorIndice.get(indiceParrafo + 1);
    if (!b2) continue;
    const restoA = (b1.parrafoCompleto || '').slice(b1.posEnParrafo + b1.largo).trim();
    const restoB = (b2.parrafoCompleto || '').slice(b2.posEnParrafo + b2.largo).trim();
    if (!restoA || !restoB) continue;
    // ¿Es B la negación de A, o A la negación de B? El orden positivo→negado es lo habitual en
    // estas declaraciones, pero no se asume — se prueban los dos sentidos.
    const esNegacion =
      (RE_NEGACION_INICIAL.test(restoB) && normalizarParaComparar(restoB.replace(RE_NEGACION_INICIAL, '')) === normalizarParaComparar(restoA))
      || (RE_NEGACION_INICIAL.test(restoA) && normalizarParaComparar(restoA.replace(RE_NEGACION_INICIAL, '')) === normalizarParaComparar(restoB));
    if (!esNegacion) continue;
    out.add(`${b1.indiceRun}:${b1.posEnTexto}`);
    out.add(`${b2.indiceRun}:${b2.posEnTexto}`);
  }
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
// Una ETIQUETA de campo es una FRASE NOMINAL corta ("RUT:", "Nombre o Razón Social:", "FIRMA
// REPRESENTANTE LEGAL:", "N° de Teléfono:"). Un párrafo que TAMBIÉN termina en ":" pero es una
// ORACIÓN no es un campo: es el texto legal que introduce lo que viene abajo.
//
// BUG REAL GRAVE (1227338-6-LE26, visto en el .docx entregado al usuario): el patrón 5 tomó
// "El oferente que suscribe declara bajo juramento que:" y "Asimismo declara que:" como si fueran
// etiquetas de campo, y como el patrón 5 SÍ autocompleta (nunca queda visible como pendiente,
// ver el comentario de arriba), la IA les pegó el RUT del representante al final:
//   "El oferente que suscribe declara bajo juramento que: 6.736.698-0"
// dentro de una declaración jurada real. Un dato inventado en medio del texto legal es el peor
// resultado posible del sistema — peor que dejarlo en blanco.
//
// Dos filtros, los dos deterministas y baratos:
//  · Cantidad de palabras: una frase nominal corta, aunque sea COMPUESTA ("Firma Persona Natural o
//    Firma Representante Legal", 7 palabras — caso real 4928-14-LP26, ver BUG REAL abajo), no pasa
//    de ~9 palabras.
//  · Vocabulario que SOLO aparece en oraciones (verbos declarativos, conectores, "que"):
//    una frase nominal no los usa nunca.
//
// BUG REAL (4928-14-LP26, Carabineros de Chile, 7-ago-2026): la leyenda de firma cubre los DOS
// casos posibles ("Firma Persona Natural O Firma Representante Legal") en una sola línea en vez de
// la forma corta de un solo caso ("FIRMA REPRESENTANTE LEGAL", 3 palabras) — con el tope viejo (6)
// esEtiquetaDeCampo la rechazaba por "muy larga" (7 palabras), el Caso C de detectarLineasFirma
// (línea 1237) nunca disparaba, y el documento salía SIN FIRMA pese a tener el hueco vacío listo
// arriba — el motor de IA nunca llega a intervenir acá, es puro conteo de palabras. El bloqueo por
// vocabulario de oración (RE_PALABRA_DE_ORACION, más abajo) sigue intacto: "El oferente que
// suscribe declara bajo juramento que:" (el caso que motivó el tope original, 1227338-6-LE26) cae
// por "que"/"suscribe"/"declara" sin importar cuántas palabras tenga — subir el tope no reabre esa
// puerta.
const MAX_PALABRAS_ETIQUETA = 9;
const RE_PALABRA_DE_ORACION = /\b(que|qué|cual|cuales|declaro|declara|declaran|declaramos|declarar|suscribe|suscrito|suscribo|siguiente|siguientes|continuaci[óo]n|manifiesta|manifiesto|expresa|se[ñn]ala|indica|informa|certifica|acredita|compromete|comprometo|obliga|acepta|acepto|conoce|conozco|entiende|solicita|adjunta|cumple|mediante|asimismo|adem[áa]s|por\s+medio|a\s+saber|lo\s+cual)\b/i;

export function esEtiquetaDeCampo(texto: string): boolean {
  const limpio = texto.replace(/\s*:\s*$/, '').trim();
  if (!limpio) return false;
  if (RE_PALABRA_DE_ORACION.test(limpio)) return false;
  return limpio.split(/\s+/).length <= MAX_PALABRAS_ETIQUETA;
}

export function detectarCamposConDosPuntos(parrafos: Parrafo[]): CandidatoCelda[] {
  const out: CandidatoCelda[] = [];
  for (let i = 0; i < parrafos.length; i++) {
    const p = parrafos[i];
    const texto = p.texto.trim();
    if (!texto.endsWith(':') || texto.length > 80 || p.centrado) continue;
    if (RE_TIENE_BLANCO_PROPIO.test(texto)) continue;   // tiene su propio blanco → lo cubre el patrón 2
    if (!esEtiquetaDeCampo(texto)) continue;            // es una oración, no una etiqueta
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
// Un título puede traer una aclaración final entre paréntesis — caso real (6-ago-2026) "FORMATO
// IDENTIFICACIÓN UNION TEMPORAL DE PROVEEDORES (SOLO SI CORRESPONDE)": sin esto, el texto que
// sigue a la frase ("SOLO SI CORRESPONDE" trae letras) no calzaba con SOLO_PUNTUACION_FINAL y el
// título NUNCA se reconocía como encabezado de sección — la sección UTP no se abría ni se omitía,
// simplemente no existía para el resto del pipeline.
const CALIFICADOR_FINAL_ENTRE_PARENTESIS = /^\s*\([^()]{0,60}\)\s*$/;

// BUG REAL GRAVE (2724-35-LP26, ANEXO N°1 "Formulario datos del oferente", 19-ago-2026 — el que
// hacía que ESE anexo saliera 100% en blanco): la PRIMERA fila de la tabla de identificación se
// rotula "Razón social o nombre persona natural" — el organismo nombra las dos formas posibles de
// oferente en la etiqueta de UNA casilla, porque la misma casilla sirve para las dos. Como la
// frase "persona natural" queda al FINAL del párrafo, esEncabezadoDeSeccion la leía como el TÍTULO
// de un bloque de persona natural: se abría una sección PERSONA_NATURAL que —al no haber otro
// encabezado ni otro formulario después— se extendía hasta el final del documento y lo dejaba
// entero en `indicesSoloManual`. Las 15 casillas se mostraban vacías aunque el motor determinista
// resolvía 14 de ellas sin dudar (verificado corriendo resolverDeterminista aparte). Un fallo
// silencioso perfecto: en pantalla se ve igual que "el motor no supo".
//
// La regla que lo separa es la MISMA que ya distingue un campo de un título en el resto del
// archivo (ver esEtiquetaDeCampo, y el freno por RE_TIENE_BLANCO_PROPIO acá abajo): un ENCABEZADO
// dice de QUIÉN es el bloque ("PERSONA NATURAL", "DATOS DEL OFERENTE PERSONA NATURAL",
// "IDENTIFICACIÓN PERSONA JURÍDICA"); una ETIQUETA DE CAMPO empieza nombrando el DATO que se pide
// ("Razón social o nombre persona natural", "RUT persona natural o jurídica", "Domicilio persona
// natural"), y ahí el tipo de persona es solo la aclaración de a quién describe ese dato.
// Por eso el freno se ancla al INICIO del párrafo: los títulos reales del corpus arrancan con una
// palabra ESTRUCTURAL (datos, antecedentes, identificación, formato, formulario, sección, anexo,
// "en caso de", "si el oferente es") o son la frase pelada — ninguno arranca con el nombre de un
// dato de la ficha.
const RE_EMPIEZA_NOMBRANDO_UN_DATO =
  /^\s*(?:\d+\s*[.)\-]*\s*|[a-zA-Z]\s*[.)\-]+\s*)?(?:nombre|raz[oó]n\s+social|r\.?\s*u\.?\s*t\.?|rol\s+[uú]nico|run|c[eé]dula|domicilio|direcci[oó]n|giro|correo|e-?mail|tel[eé]fono|fono|celular|ciudad|comuna|regi[oó]n|representante|apoderado)\b/i;

function esEncabezadoDeSeccion(texto: string): { tipo: TipoSeccion } | null {
  if (texto.length > LARGO_MAX_ENCABEZADO) return null;
  if (/^firma\b/i.test(texto.trim())) return null; // pie de firma, no divisor
  // Etiqueta de campo, no título de bloque — ver RE_EMPIEZA_NOMBRANDO_UN_DATO.
  if (RE_EMPIEZA_NOMBRANDO_UN_DATO.test(texto)) return null;
  // Un párrafo con su propio blanco ("Nombre de la Unión Temporal de Proveedores: __________") es
  // un CAMPO del formulario, no el título de una sección nueva. Caso real 4291-38-LP26: como
  // SOLO_PUNTUACION_FINAL acepta "_", este campo se tomaba por encabezado y abría una sección UTP
  // que —sin el corte por formulario de abajo— se extendía hasta el final del documento.
  if (RE_TIENE_BLANCO_PROPIO.test(texto)) return null;
  for (const pat of PATRONES) {
    const m = texto.match(pat.re);
    if (!m) continue;
    const restante = texto.slice((m.index ?? 0) + m[0].length);
    // La frase es el final real del párrafo (con o sin una aclaración entre paréntesis pegada).
    if (SOLO_PUNTUACION_FINAL.test(restante) || CALIFICADOR_FINAL_ENTRE_PARENTESIS.test(restante)) return { tipo: pat.tipo };
  }
  return null;
}

// `postulaComoUTP` invierte la decisión SOLO para los bloques de Unión Temporal: es el caso en que
// esta licitación sí se presenta en UTP y el usuario lo confirmó en la pantalla. Persona natural
// nunca se habilita — la empresa es una persona jurídica, eso no depende de la licitación.
export function detectarSecciones(parrafos: Parrafo[], postulaComoUTP = false): SeccionOferente[] {
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
      decision: h.tipo === 'PERSONA_JURIDICA' || (postulaComoUTP && h.tipo === 'UTP') ? 'RELLENAR' : 'OMITIR',
      textoEncabezado: h.texto,
    } as SeccionOferente;
  });
}

// Dentro de una sección UTP OMITIDA, un campo SUELTO (no una fila de tabla) se trata por defecto
// como dato del PROPONENTE MISMO, no de un integrante de la unión — "proponente" es sinónimo de
// "oferente": la misma empresa de la ficha, se postule sola o como parte de una unión temporal.
// Regla agregada a pedido explícito del usuario (6-ago-2026), caso real "ANEXO N°1-A FORMATO
// IDENTIFICACIÓN UNIÓN TEMPORAL DE PROVEEDORES (SOLO SI CORRESPONDE)": el TÍTULO del propio
// formulario matchea el regex de sección UTP, así que el documento ENTERO —incluidos "NOMBRE
// COMPLETO DEL PROPONENTE", "ROL ÚNICO TRIBUTARIO" (sin la palabra "proponente" en SU propia
// etiqueta, pero es el mismo bloque A/B/C) y "NOMBRE Y RUT DEL REPRESENTANTE LEGAL DEL
// PROPONENTE"— quedaba marcado soloManual: 0/22 campos completados en un formulario que sí tenía
// de dónde sacar 3 de ellos.
//
// Dos frenos, para no pasarse de largo:
//  1. Solo aplica a secciones UTP, nunca a PERSONA_NATURAL: ahí si el campo dice "del proponente
//     (Persona Natural)" SÍ hay que omitirlo, porque pide datos de una persona natural que la
//     empresa (jurídica) no tiene — es una omisión real, no la misma confusión.
//  2. Si la ETIQUETA del campo suelto ya nombra a un tercero (integrante, socio, u otro miembro
//     de la unión — mismo vocabulario que CONTEXTO_TERCERO_AJENO, declarado arriba), sigue
//     excluido: la excepción es "por defecto es nuestro", no "siempre es nuestro".
//  3. La tabla real de MIEMBROS/INTEGRANTES (una fila por integrante) queda excluida SIEMPRE, sin
//     mirar el nombre de su columna — "Nombre o Razón Social"/"RUT"/"Domicilio" no dicen
//     "proponente" ni "tercero", pero una estructura repetida (varias filas) es la señal real de
//     que pide datos de MÁS de una empresa, que la ficha no tiene.
export function acotarASeccionesHabilitadas(
  candidatos: CandidatoCelda[], secciones: SeccionOferente[], indicesDeTabla: Set<number> = new Set(),
): CandidatoCelda[] {
  if (!secciones.length) return candidatos;
  const rangosOmitidos = secciones.filter(s => s.decision === 'OMITIR');
  if (!rangosOmitidos.length) return candidatos;
  return candidatos.filter(c => {
    const rango = rangosOmitidos.find(r => c.indice >= r.indiceInicio && c.indice <= r.indiceFin);
    if (!rango) return true;
    if (rango.tipo !== 'UTP' || indicesDeTabla.has(c.indice)) return false;
    return !CONTEXTO_TERCERO_AJENO.test(c.etiqueta);
  });
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
  // La leyenda pide NOMBRE además de firma ("Nombre y Firma del Oferente o su Representante
  // Legal" — caso real 1057678-2-LE26, repetido en 6 anexos distintos del mismo documento). Antes
  // solo se estampaba la imagen y el "Nombre" de la leyenda quedaba sin ningún dato al lado —
  // como si la leyenda solo pidiera la firma. Cuando la ficha trae representante_nombre, se
  // escribe como texto justo debajo de la imagen (ver insertarImagenEnParrafo, parámetro
  // `nombreDebajo`).
  pideNombre?: boolean;
  // La leyenda pide RUT además de nombre y firma ("Nombre, RUT y Firma Representante Legal" —
  // caso real 1426039-8-LE26, 10-ago-2026, y ya mencionado como ejemplo en el comentario de
  // paraIdLeyenda de más abajo sin que nadie lo hubiera implementado todavía). Mismo mecanismo que
  // pideNombre: se escribe representante_rut como una línea más debajo de la imagen (ver
  // insertarImagenEnParrafo, ahora acepta varias líneas en `nombreDebajo`). Antes la leyenda pedía
  // tres cosas y solo se entregaban dos (firma + nombre) — el RUT no salía en ningún lugar.
  pideRut?: boolean;
  // true cuando el párrafo NO tiene ninguna raya de guiones que limpiar (viene del patrón 5,
  // "Etiqueta:" sola — ver más abajo en analizarAnexo): la imagen se AGREGA al final del párrafo
  // sin tocar nada de lo que ya hay, nunca reemplazando texto. Caso real (1227338-6-LE26): un
  // cuadro de texto flotante trae "FIRMA REPRESENTANTE LEGAL:" impreso directo, sin celda ni raya
  // — insertar limpiando el párrafo (el comportamiento de siempre) borraría esa misma etiqueta.
  sinRaya?: boolean;
  // paraId del párrafo de la LEYENDA cuando es uno DISTINTO del que recibe la imagen (Casos C/D:
  // el hueco de la firma es un párrafo vacío separado, arriba o abajo de la leyenda — ver más
  // abajo). BUG REAL (3713-7-LE26, "Los Vilos"): sin nada que los mantenga juntos, Word paginaba
  // el bloque donde caía — la leyenda quedaba sola al final de una página ("NOMBRE COMPLETO, RUT Y
  // FIRMA REPRESENTANTE LEGAL" sin firma) y la firma+nombre aparecían solos al principio de la
  // siguiente, como flotando. La firma SÍ se estampaba — el bug era de paginación, no de datos —
  // pero se leía exactamente igual a "no se firmó". Con este paraId, generarAnexoFinal marca
  // ambos párrafos con keepNext (ver marcarKeepNext en anexos-docx.ts) para que Word nunca separe
  // la leyenda de su firma.
  paraIdLeyenda?: string;
  // true cuando la leyenda ("NOMBRE COMPLETO, RUT Y FIRMA...") está centrada (`p.centrado`) pero
  // el párrafo donde va la imagen NO trae ningún <w:jc> propio (default = izquierda). BUG REAL
  // (3713-7-LE26): la firma y el nombre salían pegados al margen izquierdo, sueltos debajo de un
  // título centrado — "está todo corrido". generarAnexoFinal usa esto como alineación POR DEFECTO
  // de la imagen (si el usuario no eligió una posición a mano en el modal), para que la firma
  // quede bajo su propio título en vez de heredar el alineado (o falta de él) del párrafo vacío.
  centradaLeyenda?: boolean;
  // paraIds de una corrida de párrafos VACÍOS pegada justo ANTES del bloque leyenda/firma — la
  // "raya negra" en varios anexos de Los Vilos NO es texto (`_____`), es un borde inferior
  // (`<w:pBdr><w:bottom .../></w:pBdr>`) puesto en 6-8 párrafos vacíos consecutivos, así que
  // `esRayaLarga` (que solo mira texto) nunca la ve — para el detector esa corrida es indistinguible
  // de espaciado suelto. BUG REAL (3713-7-LE26, mismo día que paraIdLeyenda): el keepNext entre
  // leyenda y firma alcanzaba para que esas dos no se separaran, pero Word igual podía cortar
  // ENTRE la raya y la leyenda — la línea negra quedaba sola al fondo de una página, sin ningún
  // texto ni firma debajo, y la leyenda+firma aparecían solas en la siguiente. Con esto,
  // generarAnexoFinal encadena keepNext también sobre toda la corrida (orden ascendente = cada
  // párrafo con el siguiente) para que la raya nunca quede separada de lo que anuncia.
  paraIdsRayaAntes?: string[];
  // true SOLO para la raya-borde-de-celda (ver Prioridad -1 más abajo): la leyenda va DENTRO de la
  // misma celda angosta que dibuja la línea, y suele envolver a 2+ líneas visuales por lo angosto
  // de la columna ("Nombre, RUT y Firma Representante" / "Legal"). BUG REAL (1426039-8-LE26,
  // 10-ago-2026): sin este salto, la imagen se agregaba pegada AL FINAL del texto de la leyenda
  // (mismo comportamiento que sinRaya siempre tuvo, pensado para una leyenda corta de una sola
  // línea, "FIRMA REPRESENTANTE LEGAL:") y terminaba superpuesta con "Legal", la segunda línea
  // envuelta. NO se activa en el sinRaya "clásico" (patrón 5, leyenda corta) para no arriesgar un
  // caso ya verificado — ver el uso en insertarImagenEnParrafo/anexos-rellenar.ts.
  saltoAntesDeFirma?: boolean;
}

// Antes exigía que el párrafo fuera UN solo guion largo (^_{10,}$) — pero cuando la raya trae DOS
// columnas de firma lado a lado en el MISMO párrafo ("_________________        __________",
// oferente y evaluador, separadas por espacios en blanco de layout), esta regex no la reconocía
// como raya: caso real 1057480-41-LP26 anexos 7 y 8. Sin reconocerla, ninguna de las dos columnas
// entraba a `todasLasLineasFirma`, así que sus guiones quedaban sueltos como blancos inline
// genéricos (candidatos "(sin contexto)" enviados a la IA sin ningún significado, puro ruido —
// la ambigüedad de A QUIÉN pertenece cada columna ya se resuelve aparte, ver esRayaFirmaPropia).
// Ahora acepta cualquier combinación de guiones bajos y espacios/tabs, siempre que haya al menos
// 10 guiones en total y NINGÚN otro carácter (así nunca confunde texto real con una raya).
function esRayaLarga(texto: string): boolean {
  return /^[_\s]+$/.test(texto) && (texto.match(/_/g)?.length ?? 0) >= 10;
}
// La leyenda bajo la raya no siempre dice "firma" — un caso real dice "Nombre Persona Natural o
// Representante legal..." sin esa palabra. "representante legal" / "persona natural" al pie de
// una raya de 10+ guiones es, en la práctica, siempre un bloque de firma en estos documentos.
const RE_LEYENDA_FIRMA = /firma|representante\s+legal|persona\s+natural/i;

// Ver el uso en detectarCandidatosCeldaCrudos: un párrafo que es SOLO uno de estos roles (con o
// sin paréntesis) es un caption de "de quién es la columna de arriba", nunca la etiqueta de un
// campo — anclado con ^...$ para no descartar una etiqueta real que solo MENCIONE la palabra
// ("Nombre del oferente" sigue siendo un campo válido, esto exige que sea la línea COMPLETA).
const RE_CAPTION_ROL_FIRMA = /^\(?\s*(oferente|proponente|evaluador|proveedor|contratista)\s*\)?$/i;

// Caso C (ver abajo): leyenda de firma SIN raya. Es un regex mucho más estrecho que
// RE_LEYENDA_FIRMA a propósito — ahí basta con que el texto MENCIONE "representante legal" porque
// ya se sabe que arriba hay una raya de 10+ guiones, que es la señal fuerte. Sin raya no hay tal
// señal, y "representante legal" aparece en media docena de párrafos de cualquier declaración
// jurada: usarlo estamparía la firma escaneada en mitad del texto legal. Acá se exige que el
// párrafo SEA la leyenda ("FIRMA Y TIMBRE REPRESENTANTE LEGAL", "Firma del oferente") — que empiece
// con la palabra firma y sea corto, como toda leyenda de pie de firma real.
// Antes exigía que el párrafo EMPEZARA con "firma". BUG REAL (3909-9-LE26, ANEXO N°1 de
// identificación del oferente): su pie dice "NOMBRE Y FIRMA" — la palabra está al final, así que
// el documento salía sin ninguna línea de firma detectada y el usuario tenía que estamparla a mano
// en un anexo que se autocompleta entero. Ahora basta con que la leyenda MENCIONE la firma, pero
// se sigue exigiendo que sea una leyenda y no texto corrido: `esEtiquetaDeCampo` (frase nominal
// corta, sin verbos ni conectores) descarta una declaración como "el que suscribe firma en señal
// de aceptación", que es justo lo que el ancla al inicio protegía.
const RE_LEYENDA_FIRMA_SOLA = /\bfirma[ns]?\b/i;
const LARGO_MAX_LEYENDA_FIRMA = 90;
const RE_PIDE_TIMBRE = /timbre/i;
// "Nombre" aparte de "Firma" en la MISMA leyenda ("Nombre y Firma...") — no calza con RE_LEYENDA_
// FIRMA_SOLA (esa exige la palabra "firma") a propósito: una leyenda puede pedir nombre sin pedir
// firma explícitamente en el mismo lugar, pero acá siempre se evalúa junto a una leyenda que YA
// pasó ese filtro, así que basta con la palabra "nombre" sola.
const RE_PIDE_NOMBRE = /\bnombre\b/i;
// Mismo criterio que RE_PIDE_NOMBRE: "RUT" (o "R.U.T", con o sin puntos) suelto en la leyenda,
// evaluado siempre junto a una leyenda que ya mencionó "firma" — nunca se confunde con una celda
// de RUT normal (esas las cubre el motor de IA de siempre, este regex solo mira leyendas de firma).
const RE_PIDE_RUT = /\br\.?\s*u\.?\s*t\b/i;

export function detectarLineasFirma(parrafos: Parrafo[], indicesConBordeSuperiorDeCelda: Set<number> = new Set()): LineaFirma[] {
  const out: LineaFirma[] = [];
  const usados = new Set<number>();
  // Índices de párrafo YA leídos como la LEYENDA de un bloque de firma con raya (Casos A/B) — un
  // párrafo así no puede volver a evaluarse como si fuera una leyenda SIN raya (Casos C/D):
  // BUG REAL (4928-14-LP26, ver Caso D más abajo): "Firma del Oferente…" ya resuelto por la raya
  // de arriba (Caso A) se volvía a examinar en su propia vuelta del loop, y el Caso D (que mira
  // HACIA ADELANTE) le agregaba una SEGUNDA firma fantasma en el párrafo vacío de espaciado que
  // le sigue — dos imágenes por el mismo bloque.
  const leyendasConRaya = new Set<number>();
  // Corrida de párrafos VACÍOS pegada justo antes de `desdeIndice` (tope de 20 — es solo la raya
  // visual, nunca debería ser más larga; el tope evita encadenar un bloque de espaciado enorme si
  // algún documento raro trae una corrida atípica). Devuelve los paraId en orden ascendente
  // (el más antiguo primero) para que keepNext los encadene en cascada hacia la leyenda.
  const corridaVaciosAntes = (desdeIndice: number): string[] => {
    const ids: string[] = [];
    let j = desdeIndice;
    while (j >= 0 && ids.length < 20 && parrafos[j]?.vacio) { ids.unshift(parrafos[j].paraId); j--; }
    return ids;
  };
  const agregar = (
    p: Parrafo, contexto: string, leyenda?: Parrafo, paraIdsRayaAntes?: string[],
    sinRaya?: boolean, saltoAntesDeFirma?: boolean,
  ) => {
    if (usados.has(p.indice)) return;
    usados.add(p.indice);
    out.push({
      paraId: p.paraId, indice: p.indice, contexto,
      pideTimbre: RE_PIDE_TIMBRE.test(contexto), pideNombre: RE_PIDE_NOMBRE.test(contexto),
      pideRut: RE_PIDE_RUT.test(contexto),
      paraIdLeyenda: leyenda && leyenda.paraId !== p.paraId ? leyenda.paraId : undefined,
      centradaLeyenda: leyenda?.centrado,
      paraIdsRayaAntes: paraIdsRayaAntes?.length ? paraIdsRayaAntes : undefined,
      ...(sinRaya ? { sinRaya: true } : {}),
      ...(saltoAntesDeFirma ? { saltoAntesDeFirma: true } : {}),
    });
  };

  for (let i = 0; i < parrafos.length; i++) {
    const p = parrafos[i];

    // Caso A: la raya ES todo el párrafo — la leyenda viene en el/los párrafo(s) siguiente(s)
    // ("____________\nFirma del Oferente...", en párrafos separados).
    if (esRayaLarga(p.texto)) {
      const siguiente1 = parrafos[i + 1]?.texto || '';
      const siguiente2 = parrafos[i + 2]?.texto || '';
      // La leyenda se lee ENTERA, no solo su primera línea. BUG REAL (3909-9-LE26, ANEXO N°1): el
      // pie es "NOMBRE Y FIRMA" / "REPRESENTANTE LEGAL" en DOS párrafos — quedándose con el primero
      // (el único que trae la palabra "firma"), el contexto no decía de quién era la firma y
      // esRayaFirmaPropia la descartaba por precaución: un anexo que se autocompleta entero salía
      // sin firmar. Juntar las dos líneas también hace más conservador el caso opuesto — si la
      // segunda nombra al evaluador, ahora sí se ve y el bloque se excluye.
      const partes = [siguiente1, siguiente2].filter(t => t && t.length <= LARGO_MAX_LEYENDA_FIRMA && !RE_TIENE_BLANCO_PROPIO.test(t));
      const contexto = partes.some(t => RE_LEYENDA_FIRMA.test(t)) ? partes.join(' ').trim() : '';
      if (contexto) {
        agregar(p, contexto, parrafos[i + 1]);
        if (parrafos[i + 1]) leyendasConRaya.add(parrafos[i + 1].indice);
        if (partes.length > 1 && parrafos[i + 2]) leyendasConRaya.add(parrafos[i + 2].indice);
        continue;
      }
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
    if (!leyendasConRaya.has(p.indice)
      && p.texto.length <= LARGO_MAX_LEYENDA_FIRMA && RE_LEYENDA_FIRMA_SOLA.test(p.texto) && esEtiquetaDeCampo(p.texto)) {
      // Prioridad -1: la raya NO es texto ni un borde de párrafo (pBdr) — es el borde SUPERIOR de
      // la CELDA de tabla donde vive la leyenda misma (heredado del borde general de la tabla o
      // puesto directo en esa celda). BUG REAL (1426039-8-LE26, 10-ago-2026, "Nombre, RUT y Firma
      // Representante Legal"): no hay ningún párrafo vacío ni antes ni después con el hueco
      // correcto — la única celda de esa fila ES la leyenda, y la línea visual está en el borde de
      // la celda, no en ningún párrafo. Los Casos C/D de abajo terminaban buscando el próximo
      // párrafo vacío disponible, que en esta plantilla cae en la FILA DE ABAJO (una celda vacía
      // separada, pensada como espacio de relleno) — la firma quedaba lejos de la línea, con la
      // leyenda en el medio. Con la celda propia bordeada, se firma en la MISMA celda de la
      // leyenda (imagen primero, la leyenda debajo — mismo mecanismo que sinRaya ya usa para
      // "Etiqueta:" del patrón 5, ver insertarImagenEnParrafo/nombreDebajo): no hay párrafo nuevo
      // que agregar, solo contenido nuevo dentro del que ya existe.
      if (indicesConBordeSuperiorDeCelda.has(p.indice)) {
        agregar(p, p.texto.trim(), undefined, undefined, true, true);
        continue;
      }
      // Prioridad 0: el párrafo INMEDIATAMENTE anterior es la raya de verdad (vacío + borde
      // inferior, ver Parrafo.bordeInferior) — ahí se firma, "sobre la línea", que es el estándar
      // visual chileno (la tinta va justo encima del renglón). BUG REAL (3713-7-LE26, Los Vilos):
      // esta licitación tiene AMBAS cosas a la vez — la raya-borde arriba de la leyenda Y un
      // párrafo vacío suelto (puro espaciado, sin borde) DESPUÉS de la leyenda. El Caso D de abajo
      // (pensado para tablas) tomaba el de abajo por ser "el más específico" y la firma salía
      // flotando sin ninguna línea, mientras la raya de verdad quedaba sin usar. Gana siempre que
      // haya borde real — no compite con el Caso D de tabla porque una celda de valor no trae
      // `pBdr` propio.
      if (parrafos[i - 1]?.vacio && parrafos[i - 1].bordeInferior) {
        agregar(parrafos[i - 1], p.texto.trim(), p, corridaVaciosAntes(i - 2));
        continue;
      }
      // Caso D: "Firma" como ETIQUETA de una fila de tabla [Nombre | RUT | Firma], con su propia
      // celda vacía DESPUÉS (mismo patrón que Nombre/RUT, Patrón 1 — "etiqueta + celda vacía" —
      // solo que esta etiqueta también nombra la firma). BUG REAL (4928-14-LP26, Carabineros de
      // Chile): el Caso C de arriba solo mira HACIA ATRÁS ("el hueco pegado a la leyenda" en un
      // documento que fluye, con la raya/espacio ARRIBA de la leyenda) — en una tabla el hueco de
      // ESTA fila está DESPUÉS de "Firma", no antes; lo de antes es la celda de valor de la fila
      // de ARRIBA (la de "R.U.T."). Se prueba primero porque es la forma más específica: si el
      // siguiente párrafo está vacío, es la propia celda de esta fila, sin ambigüedad.
      if (parrafos[i + 1]?.vacio) { agregar(parrafos[i + 1], p.texto.trim(), p, corridaVaciosAntes(i - 1)); continue; }
      if (!parrafos[i - 1]?.vacio) continue;
      // el hueco pegado a la leyenda, que es donde se firma — y lo que haya ANTES de ese hueco
      // (típicamente la raya-borde, ver paraIdsRayaAntes) también debe quedar pegado a la leyenda.
      agregar(parrafos[i - 1], p.texto.trim(), p, corridaVaciosAntes(i - 2));
    }
  }
  return out;
}

// ── Datos PEGADOS a una línea de firma: de quién son ya lo dice el documento ──────────────
// BUG REAL (1227338-6-LE26): los 6 anexos del documento cierran con el MISMO bloque de tres
// líneas sueltas —"FIRMA REPRESENTANTE LEGAL:" / "RUT:" / "SANTIAGO, ___ DE ___ DEL 2026"— y ese
// "RUT:" se le mandaba a la IA como una etiqueta pelada de dos caracteres. Resultado medido
// contra el documento real: de los 6 "RUT:" idénticos, uno salió con el RUT de la EMPRESA, cuatro
// con el del REPRESENTANTE y uno quedó sin nada. Seis casillas iguales, tres respuestas distintas
// — y como el patrón 5 no alimenta la lista de pendientes, la que no se resolvió desapareció sin
// avisar. No es un problema de prompt: es que la respuesta correcta NO depende de ningún juicio.
// Bajo una leyenda que dice textualmente "FIRMA REPRESENTANTE LEGAL", el RUT/nombre/cargo que se
// escribe al pie es el de ESA persona, siempre. Mismo criterio que detectarTripletesFecha: lo que
// no depende del contexto se resuelve en código, donde el resultado es idéntico las 6 veces.
//
// Se exige que la leyenda NOMBRE al firmante ("representante legal" / "apoderado" / "persona
// natural"). Una leyenda genérica ("Firma del oferente") se deja pasar a la IA como hasta ahora:
// ahí el RUT que corresponde puede ser el de la empresa y no hay por qué adivinarlo en código.
const VENTANA_CAMPOS_BLOQUE_FIRMA = 4;
const RE_LEYENDA_NOMBRA_PERSONA = /(representante\s+legal|rep\.?\s*legal|apoderado|persona\s+natural)/i;

const CAMPOS_FIJOS_BLOQUE_FIRMA: { re: RegExp; campo: string }[] = [
  { re: /^(r\.?u\.?t\.?|rol\s+[úu]nico\s+tributario|c[ée]dula(\s+de\s+identidad)?|c\.?i\.?|r\.?u\.?n\.?)$/i, campo: 'representante_rut' },
  { re: /^(nombre(\s+completo)?|nombre\s+del?\s+(representante|firmante|apoderado))$/i, campo: 'representante_nombre' },
  { re: /^(cargo|cargo\s+del?\s+representante)$/i, campo: 'representante_cargo' },
];

// Marca con `campoFijo` los candidatos que caen dentro del bloque de una firma que nombra a su
// firmante. No borra ni agrega candidatos: solo les adjunta la respuesta ya conocida.
export function asignarCamposDeBloqueFirma<T extends CandidatoCelda>(
  candidatos: T[], lineasFirma: LineaFirma[],
): T[] {
  const anclas = lineasFirma.filter(f => RE_LEYENDA_NOMBRA_PERSONA.test(f.contexto)).map(f => f.indice);
  if (!anclas.length) return candidatos;
  return candidatos.map(c => {
    const cerca = anclas.some(i => c.indice > i && c.indice <= i + VENTANA_CAMPOS_BLOQUE_FIRMA);
    if (!cerca) return c;
    const limpia = c.etiqueta.replace(/\s*:\s*$/, '').trim();
    const regla = CAMPOS_FIJOS_BLOQUE_FIRMA.find(r => r.re.test(limpia));
    return regla ? { ...c, campoFijo: regla.campo } : c;
  });
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
  for (const tabla of iterarTablas(xml)) {
    const cuerpoTabla = tabla.cuerpo;
    const offsetTabla = tabla.indexCuerpo;
    const filas = [...cuerpoTabla.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)];
    // BUG REAL (1426039-8-LE26, 10-ago-2026): sin esto, CUALQUIER tabla de una sola columna
    // perdía TODOS sus campos — "NOMBRE O RAZÓN SOCIAL: " y "R.U.T: ", cada una en su propia fila
    // de 1 celda (el valor se escribe pegado al final, mismo patrón que detectarCamposConDosPuntos
    // espera), se trataban como "título mergeado" y desaparecían sin dejar ni una casilla.
    // La señal real del bug original (CONTACTO DEL PROPONENTE:) es que esa fila de 1 celda es
    // REDUNDANTE: el dato de verdad vive en las filas de 2+ celdas que la SIGUEN en la MISMA
    // tabla ([Nombre completo][  ], [Cargo][  ]). Si la tabla entera es de filas de 1 celda, no
    // hay ningún "campo real" del que esta fila sea el título — cada fila de 1 celda ES el campo,
    // vía el patrón "Etiqueta: valor inline", y hay que dejarla pasar.
    const hayFilaConVariasCeldas = filas.some(f => [...f[1].matchAll(/<w:tc\b[^>]*>/g)].length >= 2);
    if (!hayFilaConVariasCeldas) continue;
    for (const fila of filas) {
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

// ── ¿Este anexo lo tenemos que presentar, o no nos corresponde? ───────────────────────────
// Muchos anexos traen al pie una nota que dice explícitamente quién debe presentarlos. La más
// común, y el caso que motivó esto (ANEXO N°4 de 1057480-41-LP26):
//
//   "Nota: Todos los representantes de la Unión Temporal de Proveedores deben presentar este
//    anexo, en caso de que el oferente no sea una Unión Temporal de Proveedores NO DEBE PRESENTAR
//    ESTE ANEXO."
//
// Sin leer esa nota, el sistema hacía lo peor de los dos mundos: la IA (con razón) dejaba los
// datos de la UTP sin llenar por no corresponder, pero la fecha, la firma y el timbre SÍ se
// estampaban — el usuario descargaba un documento a medio llenar y parecía una falla del relleno,
// cuando en realidad ese anexo no había que presentarlo. Detectarlo acá permite decirlo de frente
// en la pantalla en vez de entregar un documento ambiguo.
//
// Es deliberadamente ESTRECHO (una frase casi literal, no una inferencia): un falso positivo
// dejaría un anexo obligatorio sin autocompletar, que es peor que no avisar nada. Por eso exige la
// frase completa "no debe/corresponde presentar … anexo" — no alcanza con que el documento
// mencione una UTP.
export interface AvisoNoAplica { motivo: string; evidencia: string }

const RE_NO_PRESENTAR = /no\s+(?:debe|deben|corresponde|correspondera|corresponder[áa])\s+(?:presentar|adjuntar|completar)\s+(?:el\s+|este\s+|dicho\s+|el\s+presente\s+)?anexo/i;
const RE_CONDICION_UTP = /(uni[óo]n\s+temporal|u\.?t\.?p\.?)/i;
const RE_CONDICION_NATURAL = /persona\s+natural/i;

export function detectarAvisoNoAplica(parrafos: Parrafo[]): AvisoNoAplica | null {
  for (const p of parrafos) {
    if (!RE_NO_PRESENTAR.test(p.texto)) continue;
    // Solo interesa la condición que NO cumplimos: la empresa postula como persona jurídica
    // individual. Una nota tipo "las personas jurídicas no deben presentar este anexo" es
    // justamente la que aplica; una que hable de otra cosa se ignora.
    const esUTP = RE_CONDICION_UTP.test(p.texto);
    const esNatural = RE_CONDICION_NATURAL.test(p.texto);
    if (!esUTP && !esNatural) continue;
    return {
      motivo: esUTP
        ? 'Este anexo solo lo presentan las Uniones Temporales de Proveedores (UTP). Esta empresa postula como persona jurídica individual, así que no corresponde presentarlo.'
        : 'Este anexo es para oferentes persona natural. Esta empresa postula como persona jurídica, así que no corresponde presentarlo.',
      evidencia: p.texto.slice(0, 400),
    };
  }
  return null;
}

// ── Punto de entrada: analiza un XML completo y devuelve los patrones + secciones ─────────
export function analizarAnexo(xml: string, { postulaComoUTP = false }: { postulaComoUTP?: boolean } = {}) {
  const parrafos = listarParrafos(xml);
  const secciones = detectarSecciones(parrafos, postulaComoUTP);
  // Ver tapadoPorCuadroOpaco (anexos-docx.ts, listarParrafos): párrafos NORMALES del cuerpo que
  // quedan tapados detrás de un cuadro de texto flotante opaco dibujado encima — contenido que
  // Word no muestra en la página visible (caso real 4777-24-LE26: el cuadro trae el ANEXO N°2
  // real y visible; "ANEXO N°1-A", debajo, nunca se ve). Se descarta acá, antes de cualquier
  // patrón de detección, para que ninguno de los cinco (celda, tabla, inline, "Etiqueta:", firma)
  // lo ofrezca como casilla.
  const indicesTapadosPorCuadro = new Set(
    parrafos.filter(p => p.tapadoPorCuadroOpaco).map(p => p.indice),
  );

  // El patrón de tabla (1b) va PRIMERO — tiene mejor etiqueta — y el patrón plano (1) solo
  // aporta los índices que la tabla no reclamó, para no mostrar el mismo blanco dos veces con
  // una etiqueta buena y otra mala ("CO").
  const candidatosTabla = detectarCandidatosTabla(xml)
    .filter(c => !indicesTapadosPorCuadro.has(c.indice));
  // Set AMPLIO: no solo los índices que el patrón de tabla eligió como destino final
  // (`indicesTabla`), sino TODOS los párrafos de las celdas de datos de esas tablas — ver
  // indicesEnCeldasDeDatosDeTabla arriba. Evita que el patrón 1 dispute con el patrón de tabla
  // un párrafo "de más" de la MISMA celda con menos contexto que el que la tabla ya tiene.
  const indicesTabla = new Set([
    ...candidatosTabla.map(c => c.indice),
    ...indicesEnCeldasDeDatosDeTabla(xml),
  ]);
  // Relleno de tabla que nunca es un campo real (ver parrafosQueNuncaSonCampoEnTabla): ni como
  // valor apuntado por el candidato (el caso real encontrado), ni celdas angostas de puro layout.
  const parrafosSinCampo = parrafosQueNuncaSonCampoEnTabla(xml);
  const indicesEnCelda = indicesDentroDeCelda(xml);
  const candidatosCeldaCrudos = detectarCandidatosCelda(parrafos, parrafosSinCampo, indicesEnCelda)
    .filter(c => !indicesTabla.has(c.indice))
    .filter(c => !parrafosSinCampo.has(c.indice))
    .filter(c => !indicesTapadosPorCuadro.has(c.indice))
    .filter(c => {
      const precedeBloqueNoRellenable = blancoPrecedeBloqueNoRellenable(xml, c.paraId);
      if (precedeBloqueNoRellenable) {
        logExclusion('blanco antes de tabla/lista numerada',
          `"${c.etiqueta}" (paraId ${c.paraId}) — el párrafo vacío que le seguía es en realidad el inicio de otro bloque, no su valor`);
      }
      return !precedeBloqueNoRellenable;
    });

  // Los campos de una sección OMITIDA (Persona Natural / UTP, cuando postulamos como jurídica) ya
  // no se descartan: se muestran igual para que un humano pueda llenarlos, pero se marcan para que
  // NUNCA se autocompleten solos. Antes desaparecían por completo y las cajas "INTEGRANTES DE LA
  // UTP", "DATOS DEL REPRESENTANTE O APODERADO" y "DATOS DEL EJECUTIVO COORDINADOR" salían en
  // pantalla sin una sola casilla — y si la empresa sí postula en UTP alguna vez, no había forma de
  // completarlas. La regla original ("no rellenar solo lo que no nos corresponde") se mantiene
  // intacta; lo que cambia es que ahora se ven.
  const candidatosCeldaTodos = [...candidatosTabla, ...candidatosCeldaCrudos];
  const indicesDeTabla = new Set(candidatosTabla.map(c => c.indice));
  const habilitados = new Set(acotarASeccionesHabilitadas(candidatosCeldaTodos, secciones, indicesDeTabla).map(c => c.indice));
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
  // no se estampa nada y lo firma un humano. (RE_FIRMA_NUESTRA/RE_FIRMA_CONTRAPARTE ahora viven a
  // nivel de módulo — los reusa precedeFirmaContraparte más abajo.)
  const esFirmaPropia = (etiqueta: string) =>
    esEtiquetaFirma(etiqueta) && RE_FIRMA_NUESTRA.test(etiqueta) && !RE_FIRMA_CONTRAPARTE.test(etiqueta);
  // Para una RAYA de firma no se exige la palabra "firma" en la leyenda: la raya de 10+ guiones ya
  // es la señal de que ahí se firma, y hay leyendas reales que no la dicen ("Nombre Persona Natural
  // o Representante legal…", ver RE_LEYENDA_FIRMA). Solo se decide DE QUIÉN es.
  //
  // Y cuando la leyenda no nombra a NADIE ("NOMBRE Y FIRMA", "Firma", a secas) hay una segunda
  // señal, del documento completo, que resuelve la ambigüedad sin adivinar: si en ninguna parte del
  // anexo aparece una contraparte que firme (evaluador, comisión evaluadora, ministro de fe,
  // entidad licitante, mandante, inspector), entonces la única firma que ese documento puede pedir
  // es la nuestra. BUG REAL (3909-9-LE26, ANEXO N°1): un anexo de identificación del oferente que se
  // autocompleta entero, cuyo pie dice solo "NOMBRE Y FIRMA", salía sin firma. La regla conservadora
  // sigue mandando donde de verdad hay dos bloques (ahí sí "no se adivina", ver arriba), y en
  // cualquier caso el usuario decide lugar por lugar desde la pantalla antes de generar.
  const hayContraparteEnElDocumento = parrafos.some(p => RE_FIRMA_CONTRAPARTE.test(p.texto));
  const esRayaFirmaPropia = (contexto: string) => {
    if (RE_FIRMA_CONTRAPARTE.test(contexto)) return false;
    if (RE_FIRMA_NUESTRA.test(contexto)) return true;
    return !hayContraparteEnElDocumento;
  };
  // Las celdas de firma AJENA (ni nuestra firma ni un dato que tengamos) quedan fuera de los dos
  // grupos: no reciben la imagen, y tampoco vuelven al flujo diccionario→IA, que es donde antes
  // terminaban rellenadas con un cargo inventado. Las llena a mano quien corresponda.
  const candidatosFirmaCelda = candidatosCeldaTodos.filter(c => esFirmaPropia(c.etiqueta));
  const candidatosCelda = candidatosCeldaTodos.filter(c => !esEtiquetaFirma(c.etiqueta));

  // El patrón 5 ("Etiqueta:" sola, sin celda ni raya al lado — ver más abajo) TAMBIÉN puede pedir
  // una firma. BUG REAL (1227338-6-LE26): un cuadro de texto flotante trae "FIRMA REPRESENTANTE
  // LEGAL:" y "RUT:" impresos directo, sin ninguna celda vacía ni raya de guiones (en el papel
  // original, la firma se estampa a mano ENCIMA de ese texto). Sin esto, "FIRMA REPRESENTANTE
  // LEGAL:" caía al flujo normal diccionario→IA, que no tiene ninguna forma de insertar una
  // IMAGEN — el párrafo quedaba intacto, sin firma y sin siquiera avisar que faltaba. Se separa
  // ACÁ, antes de armar `parrafos` en RAW (detectarCamposConDosPuntos no depende de nada de lo de
  // abajo), para que reciba la imagen igual que cualquier otra firma.
  const camposConDosPuntosCrudo = acotarASeccionesHabilitadas(detectarCamposConDosPuntos(parrafos), secciones)
    .filter(c => !indicesTapadosPorCuadro.has(c.indice));
  const camposDosPuntosFirma = camposConDosPuntosCrudo.filter(c => esFirmaPropia(c.etiqueta));
  const camposConDosPuntosSinFirma = camposConDosPuntosCrudo.filter(c => !esEtiquetaFirma(c.etiqueta));

  // El mismo filtro esFirmaPropia que ya se aplicaba a las CELDAS de firma vale igual para las
  // RAYAS y leyendas — antes no se aplicaba y era un bug real: en 1057480-41-LP26 los anexos 6 y 9
  // cierran con "________ / FIRMA Y TIMBRE EVALUADOR", el bloque que llena el HOSPITAL al evaluar
  // la oferta, y ahí se estampaba nuestra firma escaneada. Firmar por el evaluador de la licitación
  // es bastante peor que dejar el documento sin firmar.
  // BUG REAL (4928-14-LP26, tabla [Nombre | RUT | Firma] de 3 filas): el Caso C de
  // detectarLineasFirma sube al párrafo vacío INMEDIATAMENTE anterior a la leyenda "Firma" para
  // usarlo de hueco donde firmar — pero en una tabla ese vacío puede ser la celda de VALOR de la
  // fila de ARRIBA ("R.U.T." + su propio vacío), no espacio libre. Sin este cruce, la imagen de la
  // firma se estampaba en la celda del RUT y la celda de "Firma" quedaba vacía. Un párrafo que YA
  // es el valor reclamado de OTRA etiqueta nunca puede ser también "el hueco para firmar".
  //
  // A propósito `candidatosCelda` (YA sin las etiquetas de firma, ver el filtro de arriba) y NO
  // `candidatosCeldaTodos`: la propia fila "Firma" también calza con el Patrón 1 genérico
  // (etiqueta + celda vacía, `candidatosCeldaTodos` SÍ la trae) — usar esa lista sin filtrar
  // excluía la celda de la firma DE SU PROPIA fila, dejando `todasLasLineasFirma` vacío entero.
  const indicesYaClaimedosPorCandidato = new Set(candidatosCelda.map(c => c.indice));
  const todasLasLineasFirma = detectarLineasFirma(parrafos, indicesConBordeSuperiorDeCeldaVisible(xml))
    .filter(f => !indicesTapadosPorCuadro.has(f.indice))
    .filter(f => !indicesYaClaimedosPorCandidato.has(f.indice));
  // BLOQUES DE FIRMA AMBIGUOS — no se estampan (esRayaFirmaPropia los descarta a propósito, ver
  // arriba: "no se adivina cuál raya es cuál"), pero hasta hoy desaparecían del todo: ni firma, ni
  // aviso. Caso real (26-ago-2026, auditoría, 1057480-41-LP26 ANEXO_N°7): "FIRMA Y TIMBRE
  // REPRESENTANTE LEGAL … FIRMA Y TIMBRE EVALUADOR" en el mismo párrafo, con el propio documento
  // advirtiendo "EN CASO CONTRARIO SU PROPUESTA SERÁ DECLARADA INADMISIBLE" — el usuario vio "0
  // casillas pendientes" dos veces, con dos semanas de diferencia, sin ninguna pista de que ahí
  // faltaba firmar. Se distingue del caso legítimo (un bloque que SOLO nombra al evaluador, sin
  // mención nuestra — ahí no hay nada que nos toque firmar y no corresponde avisar): un bloque
  // AMBIGUO menciona a las DOS partes a la vez, que es justo la condición que hace que
  // esRayaFirmaPropia devuelva false por su primera rama.
  const bloquesFirmaAmbiguos = todasLasLineasFirma.filter(f =>
    RE_FIRMA_CONTRAPARTE.test(f.contexto) && RE_FIRMA_NUESTRA.test(f.contexto));
  // El MISMO bloque de firma puede ser visto por dos patrones a la vez: el caso C de
  // detectarLineasFirma (leyenda sin raya → devuelve el párrafo VACÍO de ARRIBA, donde se firmaría a
  // mano) y el patrón 5 (la leyenda misma, "FIRMA REPRESENTANTE LEGAL:", terminada en dos puntos).
  //
  // BUG REAL (1227338-6-LE26, encontrado abriendo el .docx generado en Word y contando las formas):
  // los 6 anexos cierran con un CUADRO DE TEXTO flotante que contiene las tres líneas del pie
  // ("FIRMA REPRESENTANTE LEGAL:" / "RUT:" / "SANTIAGO, ___"). En 2 de los 6, el párrafo anterior a
  // la leyenda estaba vacío, así que los dos patrones vieron el mismo bloque: se estampaban DOS
  // firmas, y peor — la del caso C caía en ese párrafo vacío, que vive FUERA del cuadro de texto.
  // Resultado en pantalla: dos de los seis anexos aparecían SIN firma en su pie (la imagen quedaba
  // suelta en el cuerpo del documento, arriba del recuadro).
  //
  // Cuando los dos patrones apuntan al mismo bloque manda SIEMPRE el patrón 5: apunta al párrafo que
  // contiene la leyenda, o sea al mismo contenedor donde el pie realmente vive (cuadro de texto,
  // celda o cuerpo), y `sinRaya` hace que la imagen se agregue sin borrar la etiqueta. El hueco de
  // arriba solo se conserva si no hay ninguna leyenda con dos puntos justo debajo.
  // Cuál de los dos gana depende de qué haya arriba de la leyenda:
  //  · un párrafo VACÍO (caso C) → gana el patrón 5, por lo dicho arriba;
  //  · una RAYA de guiones real (casos A y B) → gana la raya, que es el lugar de firma clásico:
  //    la imagen la reemplaza y queda exactamente donde el organismo dibujó la línea.
  const indicesDosPuntosFirma = new Set(camposDosPuntosFirma.map(c => c.indice));
  const lineasFirmaRaya = todasLasLineasFirma
    .filter(f => esRayaFirmaPropia(f.contexto))
    .filter(f => !(parrafos[f.indice]?.vacio && indicesDosPuntosFirma.has(f.indice + 1)));
  const indicesConRayaArriba = new Set(
    lineasFirmaRaya.filter(f => !parrafos[f.indice]?.vacio).map(f => f.indice + 1),
  );
  const lineasFirma: LineaFirma[] = [
    ...lineasFirmaRaya,
    ...candidatosFirmaCelda.map(c => ({
      paraId: c.paraId, indice: c.indice, contexto: c.etiqueta,
      pideTimbre: /timbre/i.test(c.etiqueta), pideNombre: RE_PIDE_NOMBRE.test(c.etiqueta), pideRut: RE_PIDE_RUT.test(c.etiqueta),
    })),
    ...camposDosPuntosFirma
      .filter(c => !indicesConRayaArriba.has(c.indice))
      .map(c => ({
        paraId: c.paraId, indice: c.indice, contexto: c.etiqueta,
        pideTimbre: /timbre/i.test(c.etiqueta), pideNombre: RE_PIDE_NOMBRE.test(c.etiqueta), pideRut: RE_PIDE_RUT.test(c.etiqueta), sinRaya: true,
      })),
  ];
  // La raya de una línea de firma también matchea el patrón 2 (blanco inline, "_{4,}") — se
  // excluye de ahí para no ofrecer un input de texto Y la firma para el mismo párrafo. Esto vale
  // para CUALQUIER raya de firma, sea nuestra o ajena: una raya de guiones bajo "FIRMA Y TIMBRE
  // EVALUADOR" no recibe la imagen (esRayaFirmaPropia la excluye de lineasFirma) pero tampoco es
  // texto que rellenar — sin esto quedaba como blanco inline genérico, ofrecido a la IA como si
  // fuera una casilla cualquiera. También se excluye una FECHA que precede directo a una firma de
  // contraparte (ver precedeFirmaContraparte): esa fecha es del evaluador, no nuestra, y antes se
  // ofrecía a la IA sin ese contexto.
  const indicesRayaFirma = new Set(todasLasLineasFirma.map(f => f.indice));
  const blancosInline = detectarBlancosInline(xml)
    .filter(b => !indicesRayaFirma.has(b.indiceParrafo))
    .filter(b => !indicesTapadosPorCuadro.has(b.indiceParrafo))
    .filter(b => !(/fecha/i.test(parrafos[b.indiceParrafo]?.texto || '') && precedeFirmaContraparte(parrafos, b.indiceParrafo)));

  // Patrón 5: solo los que caen en una sección habilitada y no pisan un blanco ya detectado por
  // otro patrón (nunca se rellena dos veces el mismo párrafo).
  const yaCubiertos = new Set([
    ...candidatosCeldaTodos.map(c => c.indice),
    ...lineasFirma.map(f => f.indice),
    ...blancosInline.map(b => b.indiceParrafo),
  ]);
  // Se descarta también si el párrafo SIGUIENTE ya es un blanco VACÍO que otro patrón reclamó
  // (una celda de tabla, o la raya de una firma): ahí el valor va en esa celda/párrafo, no al
  // final de la etiqueta, y escribir en los dos lo pondría duplicado. Se mira el resultado real
  // de esos dos patrones y no "¿el siguiente está vacío?": un párrafo vacío puede haber sido
  // descartado como candidato (ej. blancoPrecedeTabla lo filtró por ser el espaciado antes de una
  // tabla), y en ese caso el campo SÍ queda para este patrón — es exactamente el caso del "RUT:"
  // del FORMULARIO N°2 de 4291-38-LP26, que si no queda sin llenar por caer en el hueco entre los
  // dos patrones.
  //
  // A propósito NO se mira blancosInline acá (aunque sí más abajo, para `c.indice` mismo): un
  // párrafo con blanco inline SIEMPRE trae texto propio ("SANTIAGO, ____ DE ____"), nunca es un
  // "hueco vacío que le pertenece a la etiqueta de arriba" — es un campo INDEPENDIENTE con su
  // propia etiqueta adentro. BUG REAL (1227338-6-LE26, cuadro de texto "FIRMA REPRESENTANTE
  // LEGAL:" / "RUT:" / "SANTIAGO, ___ DE ___", tres líneas sueltas sin ninguna relación entre
  // sí): "RUT:" se descartaba entero porque la línea SIGUIENTE (la fecha) tenía su propio blanco
  // inline — el RUT desaparecía sin ninguna casilla, ni siquiera pendiente, por un campo de OTRA
  // línea que no tiene nada que ver.
  const yaCubiertosComoVacio = new Set([...candidatosCeldaTodos.map(c => c.indice), ...lineasFirma.map(f => f.indice)]);
  // Ni siquiera un título de sección real (nunca un campo, ver indicesFilaTituloMergeada arriba).
  const indicesTituloMergeado = indicesFilaTituloMergeada(xml);
  const camposConDosPuntos = camposConDosPuntosSinFirma
    .filter(c => !yaCubiertos.has(c.indice) && !yaCubiertosComoVacio.has(c.indice + 1))
    .filter(c => !indicesTituloMergeado.has(c.indice));

  return {
    parrafos, secciones, blancosInline, lineasFirma, indicesSoloManual, bloquesFirmaAmbiguos,
    // Los datos que viven DENTRO de un bloque de firma que nombra a su firmante quedan resueltos
    // acá mismo (`campoFijo`), sin pasar por la IA — ver asignarCamposDeBloqueFirma.
    candidatosCelda: asignarCamposDeBloqueFirma(candidatosCelda, lineasFirma),
    camposConDosPuntos: asignarCamposDeBloqueFirma(camposConDosPuntos, lineasFirma),
    avisoNoAplica: detectarAvisoNoAplica(parrafos),
    tripletesFecha: detectarTripletesFecha(blancosInline),
    alternativasExcluyentes: detectarAlternativasExcluyentes(blancosInline),
  };
}

// ── Extracción de tablas COMPLETAS (todas las celdas, no solo las vacías) ─────────────────
// Para la vista de "tabla real" en la pantalla de relleno: el usuario pidió ver el documento
// tal cual es (filas y columnas reales), no una lista plana de "etiqueta: input" donde no se
// entiende a qué celda corresponde cada blanco. Reutiliza extraerCeldasDeFila (la misma función
// que ya usa detectarCandidatosTabla) para que "qué celda es un blanco real" sea EXACTAMENTE la
// misma lógica en los dos lugares — nunca dos criterios de "vacío" que puedan divergir.
export interface CeldaTablaCruda {
  texto: string; indiceGlobal: number | null; anchoPct: number | null; ultimoParaId: string | null;
  // Índice global de cada párrafo de la celda — permite cruzar contra blancosInline para pintar
  // un blanco DENTRO de una celda con texto propio (ver el comentario en CeldaCruda).
  indicesParrafos: number[];
}
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
    if (grupo.length === 0) return { texto: '', indiceGlobal: null, anchoPct: null, ultimoParaId: null, indicesParrafos: [] };
    if (grupo.length === 1) return grupo[0];
    // Varias celdas cayeron en la misma columna (típico: 2-3 celdas angostas decorativas, a
    // veces junto con la real) — concatena el texto real si lo hay, y usa como referencia (para
    // saber si es un candidato a rellenar) la única celda que NO es decorativa por ancho; si
    // todas son angostas, ninguna era un dato real de todos modos, cualquiera sirve.
    const texto = grupo.map(c => c.texto).filter(Boolean).join(' ').trim();
    const real = grupo.find(c => c.anchoPct == null || c.anchoPct >= ANCHO_PCT_MINIMO_COLUMNA_REAL) ?? grupo[grupo.length - 1];
    return {
      texto, indiceGlobal: real.indiceGlobal, anchoPct: real.anchoPct, ultimoParaId: real.ultimoParaId,
      indicesParrafos: grupo.flatMap(c => c.indicesParrafos),
    };
  });
}

export function extraerTablasCrudo(xml: string): TablaCruda[] {
  const offsetsIndices = offsetsAIndices(xml);
  const tablas: TablaCruda[] = [];

  for (const tabla of iterarTablas(xml)) {
    const cuerpoTabla = tabla.cuerpo;
    const offsetTabla = tabla.indexCuerpo;

    // Posición de la tabla en la numeración de "índice de párrafo" (para poder agruparla por
    // formulario/anexo igual que el resto de los pendientes) — la del primer párrafo que
    // aparece adentro, sea o no el que se vaya a rellenar.
    const primerParrafo = cuerpoTabla.match(/<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>/);
    const indicePrimero = primerParrafo ? (offsetsIndices.get(offsetTabla + primerParrafo.index!) ?? null) : null;

    const filasXml = [...cuerpoTabla.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)];
    const filasCrudo: FilaTablaCruda[] = filasXml.map(filaM => {
      const offsetFila = offsetTabla + filaM.index! + filaM[0].indexOf(filaM[1]);
      const celdas = extraerCeldasDeFila(filaM[1], offsetFila, offsetsIndices);
      return { celdas: celdas.map(c => ({ texto: c.texto, indiceGlobal: c.indiceGlobal, anchoPct: c.anchoPct, ultimoParaId: c.ultimoParaId, indicesParrafos: c.indicesParrafos })) };
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
