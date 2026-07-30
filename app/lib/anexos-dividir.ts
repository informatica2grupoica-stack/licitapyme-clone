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

export interface FormularioDetectado { titulo: string; indiceInicio: number; indiceFin: number }

// Los organismos usan indistintamente "FORMULARIO N°X" o "ANEXO N°X" como separador de
// secciones pegadas en un mismo .docx (caso real encontrado: "ANEXO Nº1" / "ANEXO N°2
// ECONOMICO" — antes solo se reconocía "FORMULARIO", así que un documento así no se dividía
// nunca, quedaba como un solo bloque de cientos de párrafos sin segmentar).
export const RE_ENCABEZADO_FORMULARIO = /^(?:FORMULARIO|ANEXO)\s*N[°ºO]?\.?\s*\d+/i;
const LARGO_MAX_ENCABEZADO = 80; // evita falsos positivos: una oración larga que MENCIONA "Formulario N°1" no es un encabezado

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
}

const RE_PARRAFO_CON_ID = /<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>/g;
const RE_INICIO_BLOQUE = /<w:tbl\b[^>]*?(\/?)>|<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>/g;

// Devuelve la posición (exclusiva) donde CIERRA la TABLA que abre en `desde`, contando anidamiento.
// Reemplaza al no-greedy `<w:tbl…>[\s\S]*?</w:tbl>` que se usaba antes.
//
// BUG REAL que esto corrige (caso "Formularios.docx", detectado al validar anexos reales de la
// base): una TABLA DENTRO DE UNA CELDA de otra tabla. El no-greedy cerraba la tabla EXTERNA en el
// </w:tbl> de la INTERNA, así que el bloque quedaba cortado por la mitad: el fragmento salía con
// <w:tc> sin cerrar (Word se niega a abrirlo) y, peor, los ordinales de párrafo se contaban solo
// sobre el trozo truncado, desalineando el rango de todos los formularios siguientes.
//
// Se empareja con pila SOLO las tablas, a propósito. Los <w:p> se siguen cerrando en su primer
// </w:p>, porque hay documentos con párrafos ANIDADOS dentro de un cuadro de texto
// (<w:txbxContent> bajo <mc:AlternateContent> — caso real "ANEXO TÉCNICO.docx", profundidad 2) y
// listarParrafos(), que define la numeración de índices que este módulo comparte con
// anexos-rellenar.ts para ubicar los campos, los cuenta de esa misma forma plana. Emparejarlos con
// pila acá contaría el externo como uno solo y correría los índices de todo lo que viene después:
// los campos se rellenarían en el párrafo equivocado. Mientras listarParrafos cuente plano, esto
// también.
function finDeTabla(xml: string, desde: number): number {
  const re = /<w:tbl\b[^>]*?(\/?)>|<\/w:tbl>/g;
  re.lastIndex = desde;
  let profundidad = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[0].startsWith('</')) {
      if (--profundidad === 0) return m.index + m[0].length;
    } else if (m[1] !== '/') {
      profundidad++; // apertura real; un autocierre <w:tbl …/> no abre nada
    }
  }
  return -1; // sin cierre: XML mal formado — lo rechaza verificarXmlBienFormado en el endpoint
}

function listarBloquesCrudos(xml: string): BloqueCrudo[] {
  const out: BloqueCrudo[] = [];
  let ordinal = 0;
  let pos = 0;
  // Tras una TABLA se salta a su cierre real, así los <w:p> de sus celdas quedan dentro del salto y
  // nunca se toman como bloque propio (el ordinal de la tabla ya los cuenta, más abajo).
  for (;;) {
    RE_INICIO_BLOQUE.lastIndex = pos;
    const m = RE_INICIO_BLOQUE.exec(xml);
    if (!m) break;
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

    if (esTabla) {
      const numParrafos = (xmlCompleto.match(RE_PARRAFO_CON_ID) || []).length || 1;
      out.push({ tipo: 'tabla', textoPlano: '', xmlCompleto, ordinalInicio: ordinal, ordinalFin: ordinal + numParrafos - 1 });
      ordinal += numParrafos;
    } else {
      const texto = [...xmlCompleto.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(x => x[1]).join('').trim();
      out.push({ tipo: 'parrafo', textoPlano: texto, xmlCompleto, ordinalInicio: ordinal, ordinalFin: ordinal });
      ordinal += 1;
    }
    pos = fin;
  }
  return out;
}

export function detectarFormularios(xml: string): FormularioDetectado[] {
  const bloques = listarBloquesCrudos(xml);
  const encabezados: { indice: number; titulo: string }[] = [];
  for (const b of bloques) {
    if (b.tipo === 'parrafo' && b.textoPlano.length <= LARGO_MAX_ENCABEZADO && RE_ENCABEZADO_FORMULARIO.test(b.textoPlano)) {
      encabezados.push({ indice: b.ordinalInicio, titulo: b.textoPlano });
    }
  }
  const totalOrdinales = bloques.length ? bloques[bloques.length - 1].ordinalFin + 1 : 0;
  return encabezados.map((h, i) => ({
    titulo: h.titulo,
    indiceInicio: h.indice,
    indiceFin: (encabezados[i + 1]?.indice ?? totalOrdinales) - 1,
  }));
}

// "FORMULARIO N°1-A: IDENTIFICACIÓN..." / "ANEXO N°2 ECONOMICO" → "N1-A" / "N2" (nombre de archivo)
function sufijoDeArchivo(titulo: string): string {
  const m = titulo.match(/(?:FORMULARIO|ANEXO)\s*N[°ºO]?\.?\s*(\d+(?:-[A-Z])?)/i);
  const base = m ? `N${m[1]}` : titulo.slice(0, 20);
  return base.replace(/[^\w-]/g, '_');
}

export interface FormularioDividido { nombreSufijo: string; titulo: string; buffer: Buffer }

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
    resultados.push({ nombreSufijo: sufijoDeArchivo(f.titulo), titulo: f.titulo, buffer });
  }
  return resultados;
}
