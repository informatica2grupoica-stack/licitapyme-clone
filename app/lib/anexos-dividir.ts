// app/lib/anexos-dividir.ts
// Divide un anexo YA RELLENADO que trae varios formularios pegados en un solo .docx (patrón
// real visto en documentos de Mercado Público: "FORMULARIO N°1", "FORMULARIO N°1-A",
// "FORMULARIO N°2"…) en un .docx independiente por formulario. Se corre DESPUÉS de rellenar
// (anexos-rellenar.ts) — así el relleno ve el documento completo de una sola vez (un campo
// nunca queda a medias por estar "cortado" en otro fragmento), y esto solo separa el resultado
// final en archivos, sin tocar contenido.
//
// Cada fragmento clona el .docx completo (mismos estilos/tema/imágenes) y le cambia SOLO
// word/document.xml al rango de párrafos de ese formulario + el <w:sectPr> final original (el
// margen/tamaño de página) — así cada archivo abre igual de bien que el original, no una
// versión "pelada".
//
// Si el documento no tiene al menos 2 encabezados "FORMULARIO N°X", no se divide — sigue
// generando un solo archivo como antes (ver `< 2` abajo). Documentos sin ese patrón (la
// mayoría) no se ven afectados.
import JSZip from 'jszip';
import { finDeTabla } from '@/app/lib/anexos-docx';

export interface FormularioDetectado { titulo: string; indiceInicio: number; indiceFin: number }

// Los organismos usan indistintamente "FORMULARIO N°X" o "ANEXO N°X" como separador de
// secciones pegadas en un mismo .docx (caso real encontrado: "ANEXO Nº1" / "ANEXO N°2
// ECONOMICO" — antes solo se reconocía "FORMULARIO", así que un documento así no se dividía
// nunca, quedaba como un solo bloque de cientos de párrafos sin segmentar).
//
// Segunda forma (la alternativa después del "|"): a partir de cierto número, el mismo organismo
// puede titular "PAUTA DE EVALUACIÓN TÉCNICA DE INSUMOS CLÍNICOS (ANEXO 11)" — el número va al
// FINAL de una línea descriptiva, entre paréntesis, y SIN el "N°" (caso real 1058086-43-LP26:
// Anexo 1 a 10 usan "ANEXO N°X" al principio de la línea, pero 11, 12 y 13 usan "(ANEXO X)" al
// final). Sin esta segunda forma esos tres anexos no calzaban con ningún encabezado: no se
// dividían en su propio archivo y quedaban fusionados dentro del bloque del ANEXO N°10 anterior.
// BUG REAL (13-ago-2026, caso 1063538-204-LE26): el mismo organismo tituló "FORMULARIO Nº 7" sin
// punto pero "FORMULARIO N.º 8" y "FORMULARIO N.º 9" CON punto ANTES del símbolo º (no después,
// que es el único orden que el regex aceptaba vía el `\.?` al final). Con eso, detectarFormularios
// solo veía el encabezado N°7 y trataba TODO el resto del documento (8, 9, 10…) como si fuera
// parte de ese mismo formulario — "no trae más de un anexo pegado" en un archivo que en realidad
// traía varios. Los signos de puntuación (punto y/o °/º/O) ahora se aceptan en cualquier orden y
// cualquier cantidad entre la "N" y el número.
// TERCERA forma (14-ago-2026, caso real 761391-104-LE26): el mismo organismo puede rotular los
// anexos con LETRA en vez de número — "ANEXO “A”", "ANEXO “B”"… (comillas tipográficas, las que
// pega Word solo). Antes el regex exigía "N" + dígito SIEMPRE, así que un documento así detectaba
// 0 encabezados — el archivo entero (10 anexos con letra) quedaba como un solo bloque sin dividir.
// Anclado a fin de línea (`$`) para no confundir "Anexo A" con el inicio de una oración real
// ("Anexo a la presente declaración…" nunca calza: después de la letra sigue más texto, no el
// fin de la línea) — mismo criterio de "línea sola, nada más" que ya usa el resto del regex.
// Las comillas son OBLIGATORIAS a propósito (no ambas opcionales): sin exigirlas, "ANEXOS" y
// "FORMULARIOS" (el plural, sin número, título genérico de portada) calzaban igual —"ANEXO" +
// la "S" final interpretada como si fuera la letra del anexo— y aparecían como un encabezado
// fantasma antes del primero real. No hay ningún caso real visto con la letra SIN comillas;
// si aparece, mejor perderlo (queda pendiente, sin dividir ese anexo puntual) que arriesgar este
// falso positivo, que contamina TODOS los documentos con un título de portada genérico.
// CUARTA forma (14-ago-2026, caso real 1057536-107-LE26, CESFAM Frutillar): el organismo rotula
// por CATEGORÍA + número — "FORMULARIO A-1"/"A-2"/"A-3" (Administrativos), "FORMULARIO T-1" a
// "T-6" (Técnicos), "FORMULARIO E-1"/"E-2" (Económicos) — letra PRIMERO, guion, número, sin "N"
// en absoluto. Ninguna de las tres formas de arriba lo cubre (todas exigen "N" o comillas
// alrededor de la letra). Documento real de 10.452 párrafos, 12 formularios así, 0 detectados
// antes de esto — el peor caso visto hasta ahora de este mismo bug (título dentro/fuera de tabla
// no aplica acá, esto vive en párrafos sueltos normales; el problema era puramente el regex).
export const RE_ENCABEZADO_FORMULARIO = /^(?:FORMULARIO|ANEXO)\s*N[.\s]*[°ºO]?[.\s]*\d+|\(\s*ANEXO\s*N?[.\s]*[°ºO]?[.\s]*\d+(?:-[A-Z])?\s*\)\s*$|^(?:FORMULARIO|ANEXO)\s*["“‘'][A-Z]["”’']\s*$|^(?:FORMULARIO|ANEXO)\s*[A-Z]-\d+\s*$/i;
const LARGO_MAX_ENCABEZADO = 80; // evita falsos positivos: una oración larga que MENCIONA "Formulario N°1" no es un encabezado

// Solo la forma "FORMULARIO/ANEXO N°X" al INICIO (sin la alternativa "(ANEXO X)" al final) — se usa
// como fallback cuando la línea completa es demasiado larga para el chequeo normal de arriba. Ver
// RE_ENCABEZADO_PEGADO_SIN_ESPACIO más abajo para el caso real que motiva esto.
const RE_ENCABEZADO_PREFIJO = /^(?:FORMULARIO|ANEXO)\s*N[.\s]*[°ºO]?[.\s]*\d+(?:\s*-\s*[A-Za-z])?|^(?:FORMULARIO|ANEXO)\s*[A-Z]-\d+/i;

// BUG REAL (13-ago-2026, caso 1211839-58-LE26, "FORMULARIOS.doc"): el conversor de producción
// (LibreOffice headless, microservicio conversor-doc/) fusiona el párrafo del encabezado con el
// del título/contenido que sigue SIN dejar ningún espacio ni salto entre medio — mismo .doc
// convertido con Word real sí separa cada uno en su propio párrafo. Resultado: la línea completa
// queda gigante ("FORMULARIO N°1 - AIDENTIFICACIÓN DEL PROPONENTEPROPUESTA PÚBLICA…", con el
// nombre de la licitación repetido de yapa) y supera LARGO_MAX_ENCABEZADO, así que el chequeo de
// arriba la descarta entera — 0 formularios detectados, "Separar anexos" no hacía nada.
//
// Guardarraíl clave para no reabrir el falso positivo que motivó LARGO_MAX_ENCABEZADO ("una
// oración larga que MENCIONA 'Formulario N°1' no es un encabezado", ej. "Formulario N°1 debe
// presentarse junto con..."): en prosa real SIEMPRE hay un espacio o signo de puntuación después
// de "Formulario N°1" — nunca queda pegado letra con letra a la palabra siguiente. Los 6 casos
// reales de este bug (1211839-58-LE26) confirman el patrón: "...- AIDENTIFICACIÓN", "N°3EXPERIENCIA",
// "N°4LISTADO", "N°5DECLARACIÓN" — CERO espacio entre el número/letra y lo que sigue. Por eso el
// fallback exige que el carácter INMEDIATAMENTE siguiente al match sea una letra/dígito sin ningún
// espacio antes — eso es estructuralmente imposible en una oración real, así que no puede reabrir
// el falso positivo original.
function pareceEncabezadoPegadoSinEspacio(linea: string): RegExpExecArray | null {
  const m = RE_ENCABEZADO_PREFIJO.exec(linea);
  if (!m || m.index !== 0) return null;
  const siguiente = linea.slice(m[0].length);
  return /^[\p{L}\p{N}]/u.test(siguiente) ? m : null;
}

// Un BLOQUE es un elemento de NIVEL SUPERIOR del body: un párrafo suelto o una tabla completa
// (con todos sus <w:tr>/<w:tc> intactos). Bug real encontrado y corregido acá: la versión
// anterior aplanaba el documento a solo <w:p>, así que una tabla dentro del rango de un
// formulario perdía sus tags <w:tbl>/<w:tr>/<w:tc> al reconstruir el fragmento — quedaban los
// párrafos de sus celdas sueltos, sin filas ni columnas. Los anexos económicos (la mayoría de
// las veces la razón para dividir) son casi puras tablas, así que este caso no es raro.
//
// `ordinalInicio`/`ordinalFin` son la posición del bloque en la MISMA numeración de "índice de
// párrafo" que usa el resto del módulo (anexos-docx.ts listarParrafos, anexos-detectar.ts
// detectarBlancosInline): cada <w:p> del documento cuenta 1, sin importar si está dentro de una
// tabla o no. Una tabla con 6 párrafos en sus celdas ocupa 6 posiciones consecutivas de esa
// numeración — necesario para que detectarFormularios() (que trabaja con esos mismos índices,
// compartidos con anexos-rellenar.ts para agrupar pendientes por formulario) siga calzando.
interface BloqueCrudo {
  tipo: 'parrafo' | 'tabla';
  textoPlano: string;       // solo relevante para párrafos (búsqueda de encabezado)
  xmlCompleto: string;
  ordinalInicio: number;
  ordinalFin: number;
  enCuadroFlotante: boolean; // ver comentario sobre profundidadTxbx más abajo
}

const RE_PARRAFO_CON_ID = /<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>/g;
const RE_INICIO_BLOQUE = /<w:tbl\b[^>]*?(\/?)>|<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>/g;

// finDeTabla (posición donde CIERRA la tabla que abre en `desde`, contando anidamiento) vive
// ahora en anexos-docx.ts, compartida con anexos-documento-ui.ts y con las funciones de detección
// de anexos-detectar.ts que examinan tablas — ver su comentario ahí para el BUG REAL que resuelve
// (caso "Formularios.docx": una tabla dentro de una celda de otra).
//
// Se empareja con pila SOLO las tablas, a propósito. Los <w:p> se siguen cerrando en su primer
// </w:p>, porque hay documentos con párrafos ANIDADOS dentro de un cuadro de texto
// (<w:txbxContent> bajo <mc:AlternateContent> — caso real "ANEXO TÉCNICO.docx", profundidad 2) y
// listarParrafos(), que define la numeración de índices que este módulo comparte con
// anexos-rellenar.ts para ubicar los campos, los cuenta de esa misma forma plana. Emparejarlos con
// pila acá contaría el externo como uno solo y correría los índices de todo lo que viene después:
// los campos se rellenarían en el párrafo equivocado. Mientras listarParrafos cuente plano, esto
// también.

function listarBloquesCrudos(xml: string): BloqueCrudo[] {
  const out: BloqueCrudo[] = [];
  let ordinal = 0;
  let pos = 0;
  // Profundidad de <w:txbxContent> ABIERTOS y aún no cerrados, actualizada con cada trozo de XML
  // consumido (gap entre bloques + xmlCompleto de cada bloque). Un bloque que arranca con
  // profundidad > 0 es un párrafo ANIDADO dentro de un cuadro de texto flotante — ver
  // enCuadroFlotante más abajo y el BUG REAL que resuelve (4777-24-LE26) en detectarFormularios.
  let profundidadTxbx = 0;
  const registrarTxbx = (fragmento: string) => {
    profundidadTxbx += (fragmento.match(/<w:txbxContent\b/g) || []).length;
    profundidadTxbx -= (fragmento.match(/<\/w:txbxContent>/g) || []).length;
  };
  // Tras una TABLA se salta a su cierre real, así los <w:p> de sus celdas quedan dentro del salto y
  // nunca se toman como bloque propio (el ordinal de la tabla ya los cuenta, más abajo).
  for (;;) {
    RE_INICIO_BLOQUE.lastIndex = pos;
    const m = RE_INICIO_BLOQUE.exec(xml);
    if (!m) break;
    // Lo que queda ENTRE el cierre del bloque anterior y la apertura de este NO es basura
    // descartable: puede ser el cierre real de un cuadro de texto flotante (<w:txbxContent>,
    // <wps:txbx>, el propio </w:p> del párrafo ancla) cuyos párrafos INTERNOS (con su propio
    // w14:paraId) ya se contaron como bloques separados más arriba — a propósito, ver el
    // comentario de finDeTabla sobre por qué <w:p> no se empareja con pila. BUG REAL
    // (1227338-6-LE26, "FIRMA REPRESENTANTE LEGAL" en un cuadro de texto flotante): sin esto, ese
    // cierre se perdía en el salto entre el último párrafo interno del cuadro y el siguiente
    // párrafo del cuerpo — el fragmento dividido por formulario (anexos-dividir.ts) quedaba con
    // un "<w:txbxContent>" abierto sin su cierre, y Word se negaba a abrir el archivo entero
    // ("Word detectó un error de contenido"). Se pega al bloque ANTERIOR (el que dejó algo
    // abierto), nunca al siguiente, que es un párrafo/tabla nuevo sin relación con ese cierre.
    if (m.index > pos && out.length) {
      const gap = xml.slice(pos, m.index);
      out[out.length - 1].xmlCompleto += gap;
      registrarTxbx(gap);
    }
    const enCuadroFlotante = profundidadTxbx > 0;
    const esTabla = m[0].startsWith('<w:tbl');
    let fin: number;
    if (esTabla) {
      fin = m[1] === '/' ? m.index + m[0].length : finDeTabla(xml, m.index);
    } else {
      const cierre = xml.indexOf('</w:p>', m.index);
      fin = cierre < 0 ? -1 : cierre + '</w:p>'.length;
    }
    if (fin < 0) break;
    const xmlCompleto = xml.slice(m.index, fin);
    registrarTxbx(xmlCompleto);

    if (esTabla) {
      const numParrafos = (xmlCompleto.match(RE_PARRAFO_CON_ID) || []).length || 1;
      out.push({ tipo: 'tabla', textoPlano: '', xmlCompleto, ordinalInicio: ordinal, ordinalFin: ordinal + numParrafos - 1, enCuadroFlotante });
      ordinal += numParrafos;
    } else {
      // <w:br/> (salto de línea MANUAL, sin párrafo nuevo) se conserva como "\n" — caso real
      // (1058086-43-LP26): el cierre de firma de un anexo ("Santiago, __ de __ de __") y el
      // título del siguiente ("ANEXO N° 5") comparten el mismo <w:p>, separados solo por un
      // <w:br/>. Sin este marcador, textoPlano quedaba como una sola línea pegada y el título
      // nunca calzaba con el encabezado anclado al INICIO del texto (ver detectarFormularios) —
      // el anexo entero desaparecía, absorbido dentro del anterior.
      const texto = [...xmlCompleto.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:(?:br|cr)\b[^>]*\/?>/g)]
        .map(m => (m[1] !== undefined ? m[1] : '\n')).join('').trim();
      out.push({ tipo: 'parrafo', textoPlano: texto, xmlCompleto, ordinalInicio: ordinal, ordinalFin: ordinal, enCuadroFlotante });
      ordinal += 1;
    }
    pos = fin;
  }
  // Cola final: mismo problema que el salto entre bloques de arriba, pero para el ÚLTIMO — ahí
  // no hay ningún "próximo bloque" que dispare esa captura. BUG REAL (1227338-6-LE26): el párrafo
  // ancla de un cuadro de texto trae OTRO run de texto normal DESPUÉS del cuadro, en el MISMO
  // <w:p> (nunca se abre un <w:p> nuevo) — el bucle se quedaba sin más aperturas que encontrar y
  // terminaba (`if (!m) break`) sin haber capturado el cierre real del cuadro ni ese texto final.
  // Se recorta justo antes del <w:sectPr> final (o `</w:body>` si no hay), que es donde termina
  // el contenido real del cuerpo — nunca antes, para no perder ese texto final.
  if (out.length) {
    const sectPrMatch = xml.slice(pos).match(/<w:sectPr\b/);
    const finCuerpo = sectPrMatch ? pos + sectPrMatch.index! : xml.indexOf('</w:body>', pos);
    if (finCuerpo > pos) out[out.length - 1].xmlCompleto += xml.slice(pos, finCuerpo);
  }
  return out;
}

// Un encabezado "PELADO" (nada más que "FORMULARIO Nº 1", sin descripción propia) — caso real
// 1063538-204-LE26: cada Formulario abre con el número solo en su propio párrafo, y el título
// real ("IDENTIFICACION DEL PROPONENTE", "OFERTA ECONÓMICA"…) vive en el PÁRRAFO SIGUIENTE.
// Sin distinguir este caso, el nombre de archivo (nombreArchivoDesdeTitulo) salía genérico
// ("FORMULARIO_N1", "FORMULARIO_N5"…) — indistinguibles entre sí a simple vista, justo lo que el
// usuario reportó (7 anexos separados, todos con el mismo prefijo de categoría y sin forma de
// saber cuál es cuál sin abrirlos). Se usa como GUARDA para no tocar el caso ya-descriptivo
// ("ANEXO N°1: IDENTIFICACIÓN", "ANEXO N°2 ECONOMICO") — ahí no hace falta ni conviene mirar el
// párrafo siguiente (ver buscarSubtituloTrasEncabezadoPelado, que solo se llama cuando esto matchea).
const RE_ENCABEZADO_PELADO = /^(?:FORMULARIO|ANEXO)\s*N[.\s]*[°ºO]?[.\s]*\d+(?:-[A-Za-z])?\.?$|^(?:FORMULARIO|ANEXO)\s*[A-Z]-\d+\.?$/i;

// El nombre real de la licitación se repite ENTRE COMILLAS al pie de cada formulario ("SERVICIO
// DE ARRIENDO…") — nunca es el título de la sección, así que corta la búsqueda del subtítulo ahí.
const RE_EMPIEZA_CON_COMILLA = /^["“”«]/;

// Busca el título real de un encabezado pelado en los párrafos que le siguen (hasta 3, o hasta
// toparse con la línea entre comillas del nombre de la licitación / una tabla / otro encabezado).
// Se llama SOLO cuando el propio encabezado no trae nada más que el número (ver RE_ENCABEZADO_PELADO) —
// un encabezado ya descriptivo no necesita ni debe mirar más allá de su propio párrafo.
function buscarSubtituloTrasEncabezadoPelado(bloques: BloqueCrudo[], desdeIndice: number): string {
  const partes: string[] = [];
  for (let i = desdeIndice + 1; i < bloques.length && partes.length < 2; i++) {
    const b = bloques[i];
    if (b.tipo !== 'parrafo' || b.enCuadroFlotante) break;
    const texto = b.textoPlano.trim();
    if (!texto) continue; // párrafo vacío de por medio: se sigue buscando, no corta
    if (RE_EMPIEZA_CON_COMILLA.test(texto) || RE_ENCABEZADO_FORMULARIO.test(texto)) break;
    partes.push(texto);
  }
  return partes.join(' ').slice(0, 120);
}

// Párrafos internos de una tabla, CADA UNO por separado con su propio offset de ordinal —
// nunca aplanados en un solo string (ver el BUG REAL que motiva esto en detectarFormularios: la
// primera versión unía TODAS las celdas con espacios y el resultado, título + subtítulo + nombre
// de la licitación pegados, superaba siempre LARGO_MAX_ENCABEZADO, así que nunca calzaba con
// nada). `offset` cuenta TODOS los <w:p> (incluidos los vacíos, filtrados de la lista pero no del
// contador) para que `b.ordinalInicio + offset` siga apuntando al párrafo real — misma numeración
// que usa listarBloquesCrudos para contar una tabla (un <w:p> = una posición, esté vacío o no).
function parrafosDeTabla(xmlTabla: string): { texto: string; offset: number }[] {
  const out: { texto: string; offset: number }[] = [];
  const re = /<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>([\s\S]*?)<\/w:p>/g;
  let m: RegExpExecArray | null;
  let offset = 0;
  while ((m = re.exec(xmlTabla))) {
    const texto = [...m[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join('').trim();
    if (texto) out.push({ texto, offset });
    offset++;
  }
  return out;
}

export function detectarFormularios(xml: string): FormularioDetectado[] {
  const bloques = listarBloquesCrudos(xml);
  const encabezados: { indice: number; titulo: string }[] = [];
  // BUG REAL (14-ago-2026, caso 5827-3-LE26): al quitar el tope de tamaño de tabla (ver más
  // abajo), una tabla de DATOS real puede traer una columna que repite literalmente "ANEXO N.° 9"
  // en varias filas (qué línea/anexo cubre cada ítem) — cada aparición, sola en su celda, calza
  // con el regex de encabezado igual que un título real. Un título de sección real aparece UNA
  // sola vez en todo el documento; si el mismo texto se repite dentro de una tabla, es un VALOR de
  // columna, no un título — se guardan los candidatos de tabla APARTE y se descartan los que se
  // repiten antes de sumarlos a la lista final (ver el filtro después del loop principal).
  const candidatosTabla: { indice: number; titulo: string; clave: string }[] = [];
  for (let bi = 0; bi < bloques.length; bi++) {
    const b = bloques[bi];
    if (b.tipo !== 'parrafo') {
      // BUG REAL (14-ago-2026, casos 759-21-LE26 y 634-49-LR26): el organismo puede meter los
      // títulos DENTRO de una tabla — a veces una cajita de 1 celda por título (759-21-LE26,
      // recurso puramente visual para dibujarle un recuadro), a veces el documento ENTERO adentro
      // de UNA sola tabla gigante (634-49-LR26, layout de página completo). `listarBloquesCrudos`
      // cuenta cualquier tabla como un bloque tipo "tabla" (textoPlano vacío por diseño), así que
      // el chequeo de encabezado de abajo nunca las veía: en ambos casos, el documento entero
      // quedaba con 0 encabezados detectados pese a traer varios formularios/anexos completos.
      //
      // Se revisan los párrafos INTERNOS uno por uno (ver parrafosDeTabla) — NUNCA aplanados en
      // un solo string, y SIN límite de tamaño de tabla: la seguridad no viene de "la tabla es
      // chica" (un documento entero adentro de una tabla, como 634-49-LR26, rompe cualquier tope
      // razonable) sino del propio regex — una fila de datos real de un anexo económico o técnico
      // nunca es, ELLA SOLA en su párrafo, la línea exacta "FORMULARIO N°X"/"ANEXO N°X" y nada más.
      if (b.tipo === 'tabla') {
        const parrafosTabla = parrafosDeTabla(b.xmlCompleto);
        for (let ti = 0; ti < parrafosTabla.length; ti++) {
          const l = parrafosTabla[ti].texto;
          if (l.length > LARGO_MAX_ENCABEZADO || !RE_ENCABEZADO_FORMULARIO.test(l)) continue;
          // Mismo criterio que buscarSubtituloTrasEncabezadoPelado: si el encabezado viene
          // "pelado" (nada más que el número/letra), el título real vive en los párrafos
          // siguientes DE LA MISMA TABLA — se descarta el que empieza con comilla (el nombre de
          // la licitación, siempre entre comillas) y cualquiera que sea OTRO encabezado (el
          // siguiente formulario, si esta tabla los agrupa a todos).
          const subtitulo = RE_ENCABEZADO_PELADO.test(l)
            ? parrafosTabla.slice(ti + 1, ti + 3)
                .map(p => p.texto)
                .filter(t => t && !RE_EMPIEZA_CON_COMILLA.test(t) && !RE_ENCABEZADO_FORMULARIO.test(t))
                .join(' ').slice(0, 120)
            : '';
          candidatosTabla.push({
            indice: b.ordinalInicio + parrafosTabla[ti].offset,
            titulo: subtitulo ? `${l} ${subtitulo}` : l,
            clave: l.trim().toUpperCase(),
          });
        }
      }
      continue;
    }
    // BUG REAL (4777-24-LE26, "ANEXO N°2" impreso como título dentro de un cuadro de texto
    // flotante de ~48 KB que envuelve casi todo el formulario, típico de plantillas con un borde
    // decorativo hecho con <w:txbxContent>): el bloque que abre ESE cuadro (el <w:p> ancla con
    // <w:drawing>/<w:txbxContent>) queda con un ordinal ANTERIOR al de este título — es un
    // párrafo interno más, contado aparte a propósito (ver el comentario de finDeTabla). Si se
    // usa este título como borde de un formulario, dividirPorFormularios excluye ese bloque
    // ancla por ordinal (queda ordinalmente ANTES del rango) pero el bloque que se lleva el
    // CIERRE real del cuadro (el gap tras el último párrafo interno) SÍ cae dentro del rango —
    // el fragmento queda con un "</w:txbxContent>" sin su apertura, Word se niega a abrirlo. Un
    // título real de sección nunca vive DENTRO de un cuadro de texto sin cerrar; se ignora acá y,
    // si eso deja menos de 2 encabezados, dividirPorFormularios simplemente no divide (se sigue
    // generando un solo archivo, como antes de existir esta función — nunca corrupto).
    if (b.enCuadroFlotante) continue;
    // El título casi siempre ES el párrafo entero, pero cuando comparte <w:p> con el cierre del
    // anexo anterior (ver el comentario de "\n" en listarBloquesCrudos) queda en una línea
    // interna — se prueba cada línea, no solo el texto completo, para no perder ese caso.
    for (const linea of b.textoPlano.split('\n')) {
      const l = linea.trim();
      if (l.length <= LARGO_MAX_ENCABEZADO && RE_ENCABEZADO_FORMULARIO.test(l)) {
        const subtitulo = RE_ENCABEZADO_PELADO.test(l) ? buscarSubtituloTrasEncabezadoPelado(bloques, bi) : '';
        encabezados.push({ indice: b.ordinalInicio, titulo: subtitulo ? `${l} ${subtitulo}` : l });
        break; // un párrafo no trae dos encabezados propios
      }
      // Fallback: encabezado real pegado sin espacio al contenido siguiente (ver
      // pareceEncabezadoPegadoSinEspacio) — la línea completa no calzó arriba (casi siempre por
      // ser demasiado larga), pero el INICIO sí es un encabezado real. Se usa solo esa parte
      // pegada (número/letra) como título — el resto quedó mezclado sin separador, no se puede
      // reconstruir un subtítulo limpio de ahí.
      const mPegado = pareceEncabezadoPegadoSinEspacio(l);
      if (mPegado) {
        encabezados.push({ indice: b.ordinalInicio, titulo: mPegado[0].trim() });
        break;
      }
    }
  }
  // Descarta los candidatos de tabla que se REPITEN (ver el comentario de candidatosTabla más
  // arriba) y recién ahí los suma a los de párrafo — después se reordena por índice, porque
  // tablas y párrafos se intercalan en el documento real y cada fuente se empujó en su propio
  // momento del recorrido, no necesariamente en orden final.
  const conteoClave = new Map<string, number>();
  for (const c of candidatosTabla) conteoClave.set(c.clave, (conteoClave.get(c.clave) ?? 0) + 1);
  for (const c of candidatosTabla) {
    if ((conteoClave.get(c.clave) ?? 0) > 1) continue;
    encabezados.push({ indice: c.indice, titulo: c.titulo });
  }
  encabezados.sort((a, b) => a.indice - b.indice);
  const totalOrdinales = bloques.length ? bloques[bloques.length - 1].ordinalFin + 1 : 0;
  return encabezados.map((h, i) => ({
    titulo: h.titulo,
    indiceInicio: h.indice,
    indiceFin: (encabezados[i + 1]?.indice ?? totalOrdinales) - 1,
  }));
}

// "FORMULARIO N°1-A: IDENTIFICACIÓN..." / "ANEXO N°2 ECONOMICO" → "N1-A" / "N2" (nombre de archivo)
// / "PAUTA... (ANEXO 11)" → "N11" (ver RE_ENCABEZADO_FORMULARIO para la forma "(ANEXO X)").
function sufijoDeArchivo(titulo: string): string {
  const m = titulo.match(/(?:FORMULARIO|ANEXO)\s*N[.\s]*[°ºO]?[.\s]*(\d+(?:-[A-Z])?)/i)
    ?? titulo.match(/\(\s*ANEXO\s*N?[.\s]*[°ºO]?[.\s]*(\d+(?:-[A-Z])?)\s*\)\s*$/i);
  const base = m ? `N${m[1]}` : titulo.slice(0, 20);
  return base.replace(/[^\w-]/g, '_');
}

// ── Clasificación por categoría (administrativo/técnico/económico) ────────────────────────────
// Pedido explícito del usuario (13-ago-2026): al separar un .docx que trae varios anexos pegados,
// además de un archivo por anexo, cada uno debe quedar etiquetado por su categoría real de
// licitación pública — mismo criterio con el que un analista humano los ordena antes de armar la
// oferta. Determinista por palabras clave (mismo espíritu que los 4 regex de contexto de rol en
// anexos-detectar.ts): sin IA, porque el título + el texto del propio anexo casi siempre alcanzan
// y una clasificación equivocada acá es visible/corregible de inmediato (es solo el nombre del
// archivo), a diferencia de un campo mal rellenado. Si ninguna categoría destaca con claridad
// (empate o cero coincidencias), se deja "sin_clasificar" — nunca se adivina.
export type CategoriaAnexo = 'administrativo' | 'tecnico' | 'economico' | 'sin_clasificar';

const PALABRAS_ADMINISTRATIVO = [
  'declaracion jurada', 'identificacion del oferente', 'identificacion del proponente',
  'antecedentes legales', 'antecedentes administrativos', 'representante legal', 'domicilio',
  'boleta de garantia', 'garantia de seriedad', 'garantia de fiel cumplimiento', 'toma de razon',
  'pacto de integridad', 'inhabilidad', 'union temporal de proveedores', 'utp', 'plazo de entrega',
  'experiencia del oferente', 'vigencia de la oferta', 'certificado de antecedentes',
  'no tener deudas', 'discapacidad', 'responsabilidad penal', 'persona juridica', 'persona natural',
  'constitucion de la sociedad', 'poder del representante',
];
const PALABRAS_TECNICO = [
  'especificaciones tecnicas', 'ficha tecnica', 'propuesta tecnica', 'oferta tecnica',
  'cumplimiento tecnico', 'anexo tecnico', 'certificado de calidad', 'muestra',
  'capacidad tecnica', 'equipo de trabajo', 'personal tecnico', 'cronograma', 'plan de trabajo',
  'metodologia', 'garantia tecnica del producto', 'ficha de producto', 'catalogo tecnico',
  'memoria tecnica', 'hoja de datos de seguridad', 'certificacion iso',
];
const PALABRAS_ECONOMICO = [
  'oferta economica', 'propuesta economica', 'precio unitario', 'presupuesto detallado',
  'cotizacion', 'valor total', 'monto total', 'estructura de costos', 'forma de pago',
  'precio neto', 'anexo economico', 'cuadro de precios', 'lista de precios', 'iva incluido',
];

function normalizarParaClasificar(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function contarCoincidencias(base: string, palabras: string[]): number {
  return palabras.reduce((n, p) => n + (base.includes(p) ? 1 : 0), 0);
}

// `titulo` pesa igual que el resto del texto — a propósito no se le da más peso, porque un
// título como "ANEXO N°3" (sin descripción) no aporta nada y el cuerpo del formulario es la
// única señal real disponible en ese caso.
export function clasificarAnexo(titulo: string, textoPlano: string): CategoriaAnexo {
  const base = normalizarParaClasificar(`${titulo} ${textoPlano}`);
  const puntajes: [CategoriaAnexo, number][] = [
    ['administrativo', contarCoincidencias(base, PALABRAS_ADMINISTRATIVO)],
    ['tecnico', contarCoincidencias(base, PALABRAS_TECNICO)],
    ['economico', contarCoincidencias(base, PALABRAS_ECONOMICO)],
  ];
  puntajes.sort((a, b) => b[1] - a[1]);
  const [mejorCategoria, mejorPuntaje] = puntajes[0];
  const [, segundoPuntaje] = puntajes[1];
  if (mejorPuntaje === 0 || mejorPuntaje === segundoPuntaje) return 'sin_clasificar';
  return mejorCategoria;
}

// "ANEXO N°1: DECLARACIÓN JURADA DE REQUISITOS PARA OFERTAR" → "ANEXO_N1_DECLARACION_JURADA...".
// Se pega el número al "N" ANTES de la limpieza genérica (si no, "N°1" queda "N_1", separado del
// número por un guion bajo de más — mismo patrón "N{numero}" que ya usa sufijoDeArchivo).
// El guion SÍ se conserva (a diferencia del resto de la puntuación, que cae a "_"): un sufijo de
// letra tipo "N°1-A" solo lo reconoce anexos-match.ts (repartirArchivosGenerados, que empareja
// cada archivo dividido con SU punto del checklist del Auditor Técnico) si queda como "N1-A", con
// el guion literal pegado al número — su regex exige "-" o nada, nunca "_", entre el número y la
// letra. Perder ese guion no rompe nada visualmente, pero silenciosamente hace que un anexo con
// letra (ej. "1-A") deje de encontrar su punto exacto y caiga en el genérico.
function limpiarParaNombreArchivo(texto: string, maxLargo = 80): string {
  const conNumeroPegado = texto.replace(/N[.\s]*[°ºO]?[.\s]*(\d)/gi, 'N$1');
  const limpio = conNumeroPegado
    .replace(/[^\p{L}\p{N}-]+/gu, '_')
    .replace(/-{2,}/g, '-')
    .replace(/^[_-]+|[_-]+$/g, '')
    .toUpperCase();
  return limpio.slice(0, maxLargo).replace(/[_-]+$/, '') || 'ANEXO';
}

// Sin prefijo de categoría a propósito (13-ago-2026, feedback real del usuario: caso
// 1063538-204-LE26, 7 anexos separados todos "administrativos" — con el prefijo, la lista de
// documentos (que trunca nombres largos en la UI) mostraba "ADMINISTRATIVO…" idéntico en los 7,
// sin ninguna forma de distinguirlos a simple vista). La categoría ya se ve en la CAJA donde
// queda cada archivo ("Anexos Administrativos"/"Técnicos"/"Económicos" — ver
// POST /api/anexos/separar), así que repetirla en el nombre era redundante Y rompía la lectura.
export function nombreArchivoDesdeTitulo(titulo: string): string {
  return limpiarParaNombreArchivo(titulo);
}

// Mismo criterio de extracción de texto que usa listarBloquesCrudos para el título de un párrafo
// (ver el comentario del "\n" ahí), aplicado al FRAGMENTO completo del formulario — sirve como
// insumo de clasifarAnexo() cuando el título solo no alcanza (ej. "ANEXO N°3" sin descripción).
// Acotado a un largo razonable: alcanza con las primeras etiquetas/oraciones del formulario, no
// hace falta el documento entero para reconocer su categoría.
const LARGO_MAX_TEXTO_CLASIFICACION = 3000;

function textoPlanoDeXml(xml: string, maxLargo = LARGO_MAX_TEXTO_CLASIFICACION): string {
  const texto = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join(' ');
  return texto.slice(0, maxLargo);
}

export interface FormularioDividido {
  nombreSufijo: string;
  titulo: string;
  buffer: Buffer;
  categoria: CategoriaAnexo;
  nombreArchivo: string; // sin extensión — ver nombreArchivoDesdeTitulo
}

export async function dividirPorFormularios(bufferBase: Buffer, xml: string): Promise<FormularioDividido[]> {
  const bloques = listarBloquesCrudos(xml);
  const formularios = detectarFormularios(xml);
  if (formularios.length < 2) return []; // 0 o 1 no amerita dividir — se mantiene un solo archivo

  const aperturaBodyMatch = xml.match(/<w:body[^>]*>/);
  if (!aperturaBodyMatch) return [];
  const aperturaBody = aperturaBodyMatch[0];
  const preBody = xml.slice(0, aperturaBodyMatch.index);

  // El <w:sectPr> final (margen/tamaño/orientación de página) es hijo directo de <w:body>,
  // justo antes de </w:body> — se repite igual en cada fragmento para que abran igual de bien.
  //
  // BUG REAL encontrado y corregido acá: un documento con salto de sección a mitad (caso real:
  // 1738-18-LE26, "ANEXO Nº1" en una orientación/margen y "ANEXO N°2 ECONOMICO" en otra) trae
  // OTRO <w:sectPr> ANTES del final — ese va INCRUSTADO dentro del <w:pPr> del último párrafo de
  // su sección, no como hijo directo de <w:body>. Buscar con match() (single, no global) empieza
  // desde el PRIMER "<w:sectPr" del documento — que es ese sectPr incrustado de mitad de camino,
  // no el final — y como el lookahead solo calza en el sectPr VERDADERO (el que sí precede a
  // </w:body>), el "[\s\S]*?" no-greedy se ve obligado a extenderse por TODO el resto del
  // documento para satisfacerlo. Resultado: `sectPr` terminaba siendo ~367 KB — básicamente todo
  // el ANEXO N°2 completo metido adentro — y ese bloque gigante se pegaba DUPLICADO en cada
  // fragmento (incluido el propio ANEXO Nº1), corrompiendo el XML (Word no podía ni abrirlo) y
  // dejando campos sin completar porque el documento real quedaba hecho pedazos. La cantidad de
  // <w:sectPr> reales en el documento no importa: buscando TODOS con matchAll (cada uno no-greedy
  // hasta SU PROPIO cierre más cercano, nunca el de otro) y tomando el ÚLTIMO de la lista se
  // obtiene siempre el que de verdad es hijo directo de <w:body> — el orden del documento lo
  // garantiza.
  const sectPrMatches = [...xml.matchAll(/<w:sectPr[^>]*>[\s\S]*?<\/w:sectPr>/g)];
  const sectPr = sectPrMatches.length ? sectPrMatches[sectPrMatches.length - 1][0] : '';

  const resultados: FormularioDividido[] = [];
  const nombresUsados = new Set<string>();
  for (const f of formularios) {
    // Un bloque entra en el fragmento si CUALQUIER parte de su rango de ordinales cae dentro
    // del rango del formulario — así una tabla se incluye COMPLETA (nunca cortada a la mitad)
    // aunque su primer o último párrafo interno coincida justo con el borde.
    const cuerpo = bloques
      .filter(b => b.ordinalInicio <= f.indiceFin && b.ordinalFin >= f.indiceInicio)
      .map(b => b.xmlCompleto)
      .join('');
    const xmlFragmento = `${preBody}${aperturaBody}${cuerpo}${sectPr}</w:body></w:document>`;

    const zip = await JSZip.loadAsync(bufferBase);
    zip.file('word/document.xml', xmlFragmento);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const categoria = clasificarAnexo(f.titulo, textoPlanoDeXml(cuerpo));
    resultados.push({
      nombreSufijo: sufijoDeArchivo(f.titulo),
      titulo: f.titulo,
      buffer,
      categoria,
      nombreArchivo: nombreConDesempate(nombreArchivoDesdeTitulo(f.titulo), nombresUsados),
    });
  }
  return resultados;
}

// Dos anexos del mismo documento rara vez comparten título exacto, pero un título repetido (o dos
// que se limpian al mismo nombre, ej. "ANEXO N°1" y "ANEXO N°1 (continuación)" truncados por
// maxLargo) no puede pisarse en R2/documentos_cache — cada nombre devuelto queda único agregando
// un sufijo numérico a partir del segundo choque.
function nombreConDesempate(base: string, usados: Set<string>): string {
  let candidato = base;
  let n = 2;
  while (usados.has(candidato)) {
    candidato = `${base}_${n}`;
    n += 1;
  }
  usados.add(candidato);
  return candidato;
}
