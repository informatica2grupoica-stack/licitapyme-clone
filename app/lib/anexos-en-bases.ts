// app/lib/anexos-en-bases.ts
// Detecta el caso en que la licitación NO publica sus anexos como archivos aparte, sino que los
// trae IMPRESOS DENTRO del PDF de bases, al final, uno tras otro.
//
// Caso real 1114-12-LE26 (DGA, compra de equipos para pozos): la licitación tiene UN solo
// documento —"Bases_administrativas_y_tecnicas...pdf"— y sus 11 anexos viven en las páginas 34 a
// 47 de ese mismo PDF. El Anexo Creator solo sabe trabajar sobre .doc/.docx, así que el selector
// de documentos salía vacío con el mensaje "esta licitación no tiene documentos Word descargados
// todavía, descárgalos en la pestaña Documentos y vuelve a intentar" — que en este caso es
// derechamente FALSO: no faltan por descargar, no existen. El usuario quedaba dando vueltas
// buscando un archivo que nunca hubo.
//
// Este módulo no rellena nada (no se puede editar un PDF como se edita el XML de un Word): su
// trabajo es que el sistema SEPA reconocer la situación y decirla — cuántos anexos hay, cómo se
// llaman y en qué página del PDF están, para ir directo a esa página en vez de buscar a ciegas.
//
// Trabaja sobre el texto YA extraído y cacheado del documento (documentos_cache.texto_extraido),
// así que no cuesta ni una llamada de IA ni una descarga: es todo determinista.

export interface AnexoEnBases {
  titulo: string;        // "ANEXO N° 2-A", tal cual aparece en el documento
  pagina: number | null; // página del PDF donde arranca (de los marcadores [[PÁGINA n]] del cache)
  offset: number;        // posición en el texto — para extraer el tramo si hace falta
}

export interface DeteccionAnexosEnBases {
  /** true solo si el documento trae una TANDA de anexos al final, no menciones sueltas. */
  hay: boolean;
  anexos: AnexoEnBases[];
  paginaInicio: number | null;
}

// El marcador que deja el extractor de texto al cachear un PDF ("[[PÁGINA 34]]"). Es lo que
// permite decirle al usuario "página 34" en vez de "por ahí al final".
const RE_MARCADOR_PAGINA = /\[\[P[ÁA]GINA\s+(\d+)\]\]/gi;

// Un encabezado de anexo es una LÍNEA propia y corta, no una mención en medio de un párrafo. Las
// tres formas que aparecen en documentos reales: "ANEXO Nº 1", "ANEXO N° 2-A", "FORMULARIO 3".
const RE_ENCABEZADO = /^\s*(anexo|formulario|apendice|apéndice)e?s?\b(.*)$/i;
// El título de la SECCIÓN ("ANEXOS", solo, antes del primero) — marca dónde empieza la tanda,
// pero no es un anexo en sí.
const RE_TITULO_SECCION = /^\s*anexos\s*(y\s+formularios)?\s*$/i;
// Identificador: "N° 2-A", "Nº 1", "3", "II". Un encabezado sin identificador todavía puede ser
// válido ("ANEXO TRÁMITE DIGITAL DCyF", real en 1114-12-LE26), pero solo si viene en mayúsculas.
const RE_IDENTIFICADOR = /^\s*(n[°ºo]?\.?\s*)?(\d{1,2}\s*[-–]?\s*[a-z]?|[ivx]{1,4})\b/i;

const LARGO_MAX_ENCABEZADO = 70;
const MAX_PALABRAS_ENCABEZADO = 8;
// Con un solo encabezado no hay "tanda": una mención suelta a "Anexo N°1" en medio de las bases
// no significa que el anexo esté impreso ahí. Dos seguidos ya no es casualidad.
const MINIMO_ANEXOS = 2;
// Los anexos van SIEMPRE al final del documento (después de las cláusulas). Exigirlo evita
// confundir el índice de contenidos del principio con los anexos de verdad.
const FRACCION_FINAL_MINIMA = 0.4;

function esEncabezadoDeAnexo(linea: string): boolean {
  const limpia = linea.trim();
  if (!limpia || limpia.length > LARGO_MAX_ENCABEZADO) return false;
  // Prosa: una frase termina en punto/coma/punto y coma. Un encabezado no.
  // ("Anexos y/o en el contrato que se suscriba (si fuera el caso).",
  //  "ANEXOS; Y DESIGNA COMISIÓN EVALUADORA DE" — ambas reales, ambas descartadas acá.)
  if (/[.;,]$/.test(limpia) || limpia.includes(';')) return false;
  if (limpia.split(/\s+/).length > MAX_PALABRAS_ENCABEZADO) return false;

  const m = limpia.match(RE_ENCABEZADO);
  if (!m) return false;
  const resto = (m[2] || '').trim();
  const conId = resto.match(RE_IDENTIFICADOR);
  if (conId) {
    // Lo que viene DESPUÉS del número decide si esto es un encabezado o una mención en prosa que
    // el salto de línea del PDF partió por la mitad. Un encabezado real o no trae nada más
    // ("ANEXO N° 2-A") o trae su título en mayúsculas ("ANEXO N° 1 DECLARACIÓN JURADA"); una
    // mención trae el resto de la oración en minúsculas ("Anexo N° 6, al cual", "Anexo N°7
    // (opción" — ambas reales, 2928-14-LR26).
    // De paso esto descarta el ÍNDICE de formularios del principio de las bases, que se escribe
    // "Formulario N°1: "Identificación completa del Oferente"" (3095-8-LE26, 1537592-4-LE26): el
    // formulario DE VERDAD viene más adelante, con su encabezado solo.
    return esTituloOVacio(resto.slice(conId[0].length));
  }
  // Sin número: solo se acepta si el encabezado va esencialmente en MAYÚSCULAS y dice algo más
  // que "ANEXO" (un "Anexos" suelto en minúsculas dentro de una oración no es un encabezado).
  // El umbral es 70% y no "todo mayúscula" por las siglas con minúsculas intercaladas: "ANEXO
  // TRÁMITE DIGITAL DCyF" (real, 1114-12-LE26) se perdía con la regla estricta.
  return !!resto && esTituloOVacio(resto);
}

// Nada, o algo escrito como TÍTULO (mayoritariamente en mayúsculas). El umbral es 70% y no "todo
// mayúscula" por las siglas con minúsculas intercaladas: "ANEXO TRÁMITE DIGITAL DCyF" (real,
// 1114-12-LE26) se perdía con la regla estricta.
const RATIO_MAYUSCULAS_TITULO = 0.7;

function esTituloOVacio(texto: string): boolean {
  const limpio = texto.trim().replace(/^[:.\-–—]+\s*/, '');
  if (!limpio) return true;
  const letras = limpio.replace(/[^a-záéíóúñ]/gi, '');
  if (!letras) return true; // solo símbolos/números ("(2)", "- 3")
  const mayusculas = letras.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length;
  return mayusculas / letras.length >= RATIO_MAYUSCULAS_TITULO;
}

// Página del PDF en la que cae una posición del texto: el último marcador [[PÁGINA n]] anterior.
function paginaDeOffset(marcadores: { offset: number; pagina: number }[], offset: number): number | null {
  let pagina: number | null = null;
  for (const m of marcadores) {
    if (m.offset > offset) break;
    pagina = m.pagina;
  }
  return pagina;
}

export function detectarAnexosEnBases(texto: string): DeteccionAnexosEnBases {
  const vacio: DeteccionAnexosEnBases = { hay: false, anexos: [], paginaInicio: null };
  if (!texto || texto.length < 500) return vacio;

  const marcadores: { offset: number; pagina: number }[] = [];
  for (const m of texto.matchAll(RE_MARCADOR_PAGINA)) {
    marcadores.push({ offset: m.index!, pagina: Number(m[1]) });
  }

  const candidatos: AnexoEnBases[] = [];
  let offsetSeccion: number | null = null;
  let offset = 0;
  for (const linea of texto.split('\n')) {
    if (RE_TITULO_SECCION.test(linea) && offsetSeccion == null && offset > texto.length * FRACCION_FINAL_MINIMA) {
      offsetSeccion = offset;
    } else if (esEncabezadoDeAnexo(linea)) {
      candidatos.push({ titulo: linea.trim(), pagina: paginaDeOffset(marcadores, offset), offset });
    }
    offset += linea.length + 1; // +1 por el \n que se comió el split
  }

  // Solo la TANDA final cuenta: se descartan las menciones que caen en el cuerpo de las bases
  // (un "ANEXO N°1" citado en una cláusula del artículo 12 no es el anexo impreso).
  const corte = offsetSeccion ?? texto.length * FRACCION_FINAL_MINIMA;
  const anexos = deduplicar(candidatos.filter(a => a.offset >= corte));
  if (anexos.length < MINIMO_ANEXOS) return vacio;

  return { hay: true, anexos, paginaInicio: anexos[0].pagina };
}

// Un mismo anexo puede aparecer dos veces: primero listado en un índice ("FORMULARIOS DE
// ANTECEDENTES" con las siete líneas de contenido) y después impreso de verdad. Gana SIEMPRE la
// última aparición, que es el formulario real — la del índice está en la página del índice y
// mandaría al usuario a la página equivocada.
function deduplicar(anexos: AnexoEnBases[]): AnexoEnBases[] {
  const porClave = new Map<string, AnexoEnBases>();
  for (const a of anexos) porClave.set(claveDeAnexo(a.titulo), a);
  return [...porClave.values()].sort((x, y) => x.offset - y.offset);
}

// "ANEXO Nº 1", "Anexo N°1" y "ANEXO 1" son el mismo anexo; "2-A" y "2-B" no lo son.
function claveDeAnexo(titulo: string): string {
  return titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/n[°ºo]?\.?/g, ' ').replace(/[^a-z0-9-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
