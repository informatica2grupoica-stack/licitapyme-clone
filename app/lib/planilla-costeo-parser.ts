// app/lib/planilla-costeo-parser.ts
// Parser DETERMINISTA de la planilla de cotización / oferta económica (Anexo Económico,
// ETT, FORMATO N°n). Extrae en código el listado COMPLETO de ítems con su descripción
// EXACTA, unidad, cantidad, y —cuando existe— el número de LÍNEA/LOTE y la CATEGORÍA.
//
// Por qué: pedirle a la IA que enumere N filas es frágil (selecciona ítems "notables" en
// vez de listarlos todos). Aquí las sacamos exactas, gratis en tokens. Es la SEMILLA del
// Excel de costeo: si hay ≥2 líneas → "costeo en línea" (1 hoja por línea); si no →
// "costeo" (suma alzada, 1 hoja).
//
// Fuentes que entiende (el texto ya viene extraído por document-extraction):
//   - Excel (metodo 'excel'): CSV de XLSX.utils.sheet_to_csv; hojas marcadas con
//     "--- Hoja: <nombre> ---" (p.ej. "--- Hoja: Línea 1 ---").
//   - PDF/Word: tablas markdown "| n | desc | un | cant |" y/o líneas planas.
// Agrupaciones que detecta: LÍNEAS/LOTES ("LÍNEA 1: ...", "--- Hoja: Línea N ---") y
// CATEGORÍAS/rubros ("A FERRETERIA", "B PINTURA").

import { esFilaNoProducto } from '@/app/lib/fila-no-producto';

export interface ItemPlanilla {
  linea: number;              // número de LÍNEA/LOTE (1 si el listado no está en líneas)
  categoria: string | null;   // nombre de la categoría/rubro (FERRETERIA…) o null
  numero: number | null;      // correlativo del ítem dentro de su grupo (referencia)
  descripcion: string;
  unidad: string;
  cantidad: number | null;
}

// Patrón del correlativo de ítems — el discriminador determinista suma_alzada vs por_linea:
//  - 'continua'   : 1,2,3,…,N de corrido (único, creciente, sin reinicios) → SUMA ALZADA
//                   (una planilla integrada, aunque venga partida en hojas/secciones "Línea N").
//  - 'reinicia'   : el correlativo se reinicia (1,2,3|1,2,3) o se repite agrupando ítems
//                   (1,1,2,2,3) → POR LÍNEA/LOTE.
//  - 'indefinida' : no hay suficientes correlativos para juzgar (se respetan los títulos).
export type PatronNumeracion = 'continua' | 'reinicia' | 'indefinida';

export interface PlanillaParseResult {
  estructura: 'por_linea' | 'por_categoria' | 'plana';
  lineas: number[];           // números de línea detectados (en orden)
  categorias: string[];       // nombres de categoría en orden de aparición
  items: ItemPlanilla[];
  numeracion: PatronNumeracion;
  fuenteDoc: string;
  // Traza de TODAS las fuentes leídas (no solo la elegida) y en qué se contradicen. Las rellena
  // parsearPlanillaCosteo sobre el resultado ganador; los parsers individuales no las tocan.
  candidatos?: FuenteCandidata[];
  discrepancias?: string[];
}

export interface FuenteCandidata {
  fuenteDoc: string;
  autoridad: number;   // AUTORIDAD_FUENTE: 0 anexo económico · 1 bases técnicas · 2 ómnibus
  items: number;
  elegido: boolean;
}

interface DocTexto { nombre: string; categoria?: string | null; texto: string; metodo?: string | null }

const normalizar = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const limpiarCelda = (s: string) =>
  s.replace(/\*\*/g, '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

// Divide una línea CSV respetando comillas dobles ("" = comilla escapada).
function csvSplit(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(limpiarCelda);
}

// Convierte una línea del texto en celdas, o null si no parece tabular.
function celdasDe(line: string): string[] | null {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith('|')) {
    if (/^\|[\s:|-]+\|?$/.test(t)) return null; // separador markdown
    const partes = t.split('|').map(limpiarCelda);
    if (partes.length && partes[0] === '') partes.shift();
    if (partes.length && partes[partes.length - 1] === '') partes.pop();
    return partes.length ? partes : null;
  }
  if ((line.match(/,/g) || []).length >= 3) return csvSplit(line);
  // TABULACIONES: así queda una tabla de Word al extraerse a texto — una celda por tab. Sin esto
  // el parser era CIEGO a todo cuadro económico en .doc/.docx, que es donde vive el listado
  // canónico (el formulario que el oferente llena para cotizar). Caso real 2328-41-LE26: el
  // "Formulario_oferta_económica_E-44-2026.doc" traía las 18 herramientas con su cantidad y
  // unidad, y el parser no leyó ninguna; ganó por volumen un xlsx de útiles escolares que ni
  // siquiera correspondía a esa licitación, y sus 35 filas sepultaron el listado real.
  // Se exigen >=2 tabs (3 celdas) por el mismo criterio que las comas: un tab suelto es sangría
  // o separación de un párrafo, no una tabla.
  if ((line.match(/	/g) || []).length >= 2) {
    const partes = line.split(/	/).map(limpiarCelda);
    while (partes.length && partes[partes.length - 1] === '') partes.pop();
    // Una fila de tabla REAL trae varias celdas con contenido (cantidad + descripción + unidad).
    // Los anexos administrativos en Word están llenos de líneas tabuladas que son un formulario
    // EN BLANCO —"NOMBRE OFERENTE		", "	 	 	 	 	 	Rut	"— y una plantilla vacía no
    // puede convertirse en un listado de productos. Por eso se exigen 2 celdas con texto, no solo
    // 3 posiciones: sin este piso, tres licitaciones pasaban de "sin planilla" a una planilla de
    // rótulos ("NOMBRE o RAZÓN SOCIAL", "Ficha técnica en español") con cantidades leídas de otra
    // columna.
    if (partes.length >= 3 && partes.filter(c => c !== '').length >= 2) return partes;
  }
  return null;
}

interface ColMap { num: number; desc: number; unidad: number; cant: number }

function detectarHeader(celdas: string[]): ColMap | null {
  const n = celdas.map(normalizar);
  // La columna de NUMERACIÓN se detecta primero: "N°", "Ítem", "Línea" y también compuestos
  // como "Línea de insumo" / "N° de línea" (caso real 2178-14-LE26: el encabezado "Línea de
  // insumo" contiene la palabra "insumo" y se elegía como DESCRIPCIÓN → ítems basura "10","11"…).
  const num = n.findIndex(h => /^(item|itemn|n|no|numero|linea|nro)\.?$/.test(h) || h === 'n°' || h === 'nº'
    || /^(l[ií]nea|item|numero|nro|n[°º]?)\s+de\s+(insumo|producto|item|l[ií]nea|parte)s?$/.test(h));
  // Un rótulo de encabezado es CORTO ("INSUMO", "CANTIDAD"): una frase larga que menciona
  // "producto"/"cantidad" es prosa (nota al pie), no un encabezado (caso real 2178-14-LE26:
  // "1. Valor unitario neto … del producto … la cantidad 1 …" fijaba desc=cant=0 y las notas
  // siguientes entraban como ítems).
  const buscar = (claves: string[]) => n.findIndex((h, i) => i !== num && h && h.length <= 60 && claves.some(k => h.includes(k)));
  // 'bienes': formularios municipales de suministro ("Bienes o Servicios Requeridos" es la
  // columna del NOMBRE del ítem; la de "Descripción..." suele venir vacía — caso 2731-21-LE26).
  const desc = buscar(['detalle', 'descrip', 'producto', 'material', 'articulo', 'glosa', 'insumo', 'item a', 'nombre', 'elemento', 'bienes']);
  const cant = buscar(['cantidad', 'cant', 'cdad']);
  if (desc < 0 || cant < 0 || desc === cant) return null;
  const unidad = buscar(['unidad', 'medida']);
  return { num, desc, unidad, cant };
}

// ¿Header de una tabla de CUMPLIMIENTO/especificaciones técnicas? (Formulario ETT:
// "Ítem | Características técnicas | Cumple Si/No | N° página | Observaciones").
// Sus filas son REQUISITOS (certificaciones, garantías, postventa…), NO productos a
// cotizar: si entrara al manifiesto, el costeo se llena de basura.
function esHeaderEspecificaciones(celdas: string[]): boolean {
  const n = celdas.map(normalizar).join(' | ');
  if (/cumple/.test(n) && /si\s*\/?\s*no/.test(n)) return true;
  if (/caracteristicas?\s+tecnicas?/.test(n) && !/cantidad/.test(n)) return true;
  if (/criterios?\s+de\s+evaluacion/.test(n)) return true;
  // CHECKLIST DE ANTECEDENTES: "N° | CRITERIO | ANTECEDENTE PARA PRESENTAR | DOCUMENTO ADJUNTO
  // (SÍ/NO) | OBSERVACIONES". Sus filas son DOCUMENTOS que el oferente debe adjuntar (ficha
  // técnica, resolución ISP, certificados), no productos a cotizar. Aparecen en los anexos en
  // Word, que antes eran ilegibles y ahora sí se leen.
  if (/documento\s+adjunto/.test(n) || /antecedentes?\s+para\s+presentar/.test(n)) return true;
  // TABLA DE EXPERIENCIA del oferente: tiene una columna "Cantidad" que la hace pasar por planilla,
  // pero sus filas son CONTRATOS ANTERIORES, no el listado a comprar.
  if (/nombre\s+de\s+la\s+instituci[oó]n/.test(n) && /id\s+licitaci[oó]n|orden\s+de\s+compra/.test(n)) return true;
  return false;
}

// Detecta un encabezado de LÍNEA/LOTE y devuelve su número. Cubre:
//  - marcador de hoja Excel: "--- Hoja: Línea 3 ---"
//  - encabezado en el texto: "LÍNEA 3:", "LINEA N° 3", "LOTE 2", "ITEM 2:" (como grupo)
function detectarLinea(lineaCruda: string): number | null {
  const t = limpiarCelda(lineaCruda);
  let m = t.match(/^-{0,3}\s*hoja:\s*l[ií]nea\s*n?\s*[°º]?\s*(\d{1,3})/i);
  if (m) return parseInt(m[1], 10);
  m = t.match(/^\s*l[ií]nea\s*n?\s*[°º]?\s*(\d{1,3})\s*[:\-.)]/i);
  if (m) return parseInt(m[1], 10);
  // "FORMULARIO Línea N°1: analizador de…" / "FORMATO LÍNEA 2 - …" (una ficha por producto)
  m = t.match(/^\s*(?:formulario|formato)\s+l[ií]nea\s*n?\s*[°º]?\s*(\d{1,3})/i);
  if (m) return parseInt(m[1], 10);
  m = t.match(/^\s*lote\s*n?\s*[°º]?\s*(\d{1,3})\s*[:\-.)]/i);
  if (m) return parseInt(m[1], 10);
  return null;
}

// Escaneo liviano sobre TODOS los documentos: números de línea mencionados en títulos
// "FORMULARIO Línea N°X" / "Línea N°X:". Sirve como señal de modalidad por_linea aunque
// el parser no logre extraer una planilla de cotización (p.ej. bases escaneadas donde
// solo hay fichas técnicas por línea, sin tabla de precios).
export function detectarLineasFormulario(docs: { texto: string }[]): number[] {
  const set = new Set<number>();
  // SOLO títulos de ficha ("FORMULARIO Línea N°X", "FICHA LÍNEA 2"): un listado de
  // productos "LINEA 1 BUTACA…" NO cuenta — eso es un correlativo de ítems, no fichas.
  const re = /(?:formulario|formato|ficha)\s+l[ií]nea\s*n?\s*[°º]?\s*(\d{1,3})/gi;
  for (const d of docs) {
    if (!d.texto) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(d.texto)) !== null) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 200) set.add(n);
    }
    re.lastIndex = 0;
  }
  return [...set].sort((a, b) => a - b);
}

// FORMULARIOS ECONÓMICOS SEPARADOS POR LÍNEA — archivos DISTINTOS, uno por línea, en vez de un
// único formulario consolidado (ej. "01_FORMULARIO_ECONÓMICO_LÍNEA_1.xlsx" … "_8.xlsx"). Es
// evidencia dura y muy segura de por_linea: si cada línea se cotiza en su PROPIO archivo, no puede
// existir un total único consolidado (eso exigiría un solo formulario con todo adentro). Mira los
// NOMBRES de archivo, no el contenido — el organismo los nombra así para que el oferente sepa que
// cada uno se llena y sube por separado.
//
// Caso real 2446-167-LP26 (equipos veterinarios, 8 líneas): 8 archivos
// "0N_FORMULARIO_ECONÓMICO_LÍNEA_N.xlsx" — señal inequívoca que ningún detector existente miraba
// (todos leen el TEXTO de los documentos, ninguno el nombre del archivo).
export function detectarFormulariosEconomicosPorArchivo(docs: { nombre?: string }[]): number[] {
  const set = new Set<number>();
  const re = /formulario[_\s]*econ[oó]mic[oa][_\s]*l[ií]nea[_\s]*n?[°º]?[_\s]*(\d{1,3})/i;
  for (const d of docs) {
    const m = (d.nombre || '').match(re);
    if (m) { const n = parseInt(m[1], 10); if (n >= 1 && n <= 200) set.add(n); }
  }
  return [...set].sort((a, b) => a - b);
}

// TIPO DE ADJUDICACIÓN declarado EXPLÍCITAMENTE en las bases como campo formal — no una mención
// suelta en prosa, sino la respuesta directa a "cómo se adjudica" que las bases chilenas suelen
// declarar en una tabla/ficha de resumen: "TIPO DE ADJUDICACIÓN: Múltiple (Por líneas)" o
// "… (Por lotes)". A diferencia de "se podrá adjudicar por línea" mencionado al pasar (que la
// doctrina del proyecto NO usa como señal — ver comentario en construirSenalModalidad: eso es "a
// quién se adjudica", no "cómo se cotiza"), esta es una DECLARACIÓN FORMAL en un campo dedicado del
// resumen de bases, tan concluyente como cualquier otro dato de portada (presupuesto, plazo, etc.).
//
// Caso real 2446-167-LP26: la IA citó textualmente "TIPO DE ADJUDICACIÓN Múltiple (Por lineas)"
// (pág. 21 de las bases) como fuente de su propio veredicto POR_LINEAS, pero como NINGÚN detector
// determinista reconocía esa frase, la "red de seguridad" (sin evidencia → default GLOBAL) revirtió
// el veredicto correcto del modelo. Devuelve la frase-evidencia hallada, o null.
//
// NO exige que "TIPO DE ADJUDICACIÓN" esté pegado a "Múltiple": en PDFs con tablas mal extraídas
// (mismo caso 2446-167-LP26) la etiqueta y el valor quedan en pedazos de texto separados por miles
// de caracteres (la columna de etiquetas se extrae aparte de la columna de datos). Se busca
// directamente la frase "múltiple … por líneas/lotes" con una ventana amplia, tolerando errores de
// OCR de un carácter en "líneas" (p.ej. "lfneas" con í→f).
//
// Caso real 2920-30-LE26 (6 líneas): la declaración NO viene en formato tabular compacto sino en
// prosa dentro de las Bases Administrativas: "la adjudicación será múltiple, lo que significa que
// cada línea será evaluada y adjudicada de manera independiente... se puede adjudicar a un oferente
// distinto por cada una de las 6 líneas". El regex original no la cazaba porque "múltiple" y "por
// líneas" quedan a >30 caracteres de distancia con una oración completa en medio (la IA SÍ lo leyó
// bien y citó esta frase como su propia evidencia, pero la red de seguridad la revirtió a GLOBAL por
// falta de un detector determinista). Se agregan dos patrones de prosa: (a) "adjudicación... múltiple"
// seguido, en una ventana amplia, de "adjudicada de manera independiente" o "oferente/proveedor
// distinto por cada"; (b) "cada línea/lote será adjudicada de manera independiente" a secas.
// NOTA DE ALCANCE (para quien lea este comentario buscando "por qué falló de nuevo"): esto es
// reconocimiento de PATRONES DE TEXTO, no comprensión del lenguaje. Cada caso real que agrega un
// patrón nuevo (2446-167-LP26, 2920-30-LE26...) es la redacción de UN organismo específico; hay
// cientos de organismos en Chile y cada uno redacta las bases a su manera, así que NINGUNA lista de
// regex agota todas las formas de decir "cada línea/lote se adjudica de forma independiente,
// posiblemente a proveedores distintos". El golden set (scripts/regresion/) es el mecanismo real de
// corrección: cada vez que un caso nuevo se cuela, se agrega aquí en minutos y ya no vuelve a fallar
// PARA ESA REDACCIÓN. Lo que sí se puede hacer para bajar la tasa de recurrencia es ampliar la
// familia de patrones a un CLUSTER de conceptos (distinto/diferente + oferente/proveedor/adjudicatario
// + línea/lote, en cualquier orden dentro de una ventana) en vez de frases exactas — eso es lo que
// hacen los últimos 3 patrones de abajo. Sigue siendo lenguaje natural: no hay "arréglalo una vez y
// nunca más". Si esto necesita dejar de fallar en cualquier redacción posible, la solución de fondo
// no es regex: es una segunda pregunta dirigida al modelo ("¿esta cita concreta dice que puede haber
// un ganador distinto por línea/lote? cítala") en vez de un detector de texto — eso sí generaliza
// como el resto de la lectura de bases, a costo de una llamada extra. Avísame si quieres ese camino.
// 23-jul-2026 (auditoría manual de 19 casos, CA): dos casos reales sin ningún patrón que los
// cazara — 3507-12-LE26 ("La presente licitación podrá adjudicarse por línea de oferta.") y
// 1389488-29-LE26 ("La evaluación y adjudicación se realizará por línea, considerando los
// criterios..."). Son DECLARACIONES DIRECTAS del artículo de adjudicación (la fuente que el propio
// prompt pide confirmar en A.3①), pero ninguna trae "múltiple" ni "independiente" ni "distintos
// oferentes" cerca — son la forma MÁS simple y común de decirlo, y por eso mismo faltaban. Se
// agregan dos patrones "a secas" (sin calificativo de independencia): (a) verbo "adjudicar(se)
// por línea/lote/ítem"; (b) "la adjudicación se realizará/hará por línea/lote/ítem". Con guardia
// de negación (ver bucle) para no disparar en "NO podrá adjudicarse por línea".
export function detectarTipoAdjudicacionMultiple(docs: { texto: string }[]): string | null {
  const patrones: RegExp[] = [
    // Campo formal "TIPO DE ADJUDICACIÓN: Múltiple (Por líneas/lotes)".
    /m[uú]ltiple[\s\S]{0,30}?\bpor\s+(l.neas?|lotes?)\b/i,
    // Prosa: "la adjudicación será múltiple" + confirmación de independencia/distinto oferente.
    /adjudicaci[oó]n\s+(?:ser[aá]|es)\s+m[uú]ltiple[\s\S]{0,400}?(?:adjudicad[ao]s?\s+de\s+manera\s+independiente|(?:oferente|proveedor)\s+distinto\s+(?:por|para)\s+cada)/i,
    // "cada línea/lote será adjudicada de manera independiente" a secas.
    /cada\s+(?:l[ií]nea|lote)\s+(?:ser[aá]|es)\s+(?:evaluad[ao]\s+y\s+)?adjudicad[ao]\s+de\s+manera\s+independiente/i,
    // CLUSTER (no frase exacta): "adjudicación/adjudicar... independiente" cerca de línea/lote.
    /adjudicaci[oó]n\s+independiente\s+(?:por|de\s+cada|entre)\s+(?:l[ií]neas?|lotes?)/i,
    /adjudicar[aá]?\s+(?:de\s+forma|de\s+manera)\s+independiente\s+(?:cada\s+)?(?:l[ií]nea|lote)/i,
    // CLUSTER: distinto/diferente/varios + oferente/proveedor/adjudicatario, cerca de línea/lote/ítem
    // (en cualquier orden, ventana amplia) — cubre "distintos proveedores por línea", "puede
    // resultar adjudicada a diferentes oferentes por lote", "no necesariamente al mismo proveedor".
    // 28-jul-2026: se agregó "ítems" a los patrones (antes solo línea/lote).
    /(?:distint[oa]s?|diferentes?|vari[oa]s)\s+(?:oferentes?|proveedores?|adjudicatarios?)[\s\S]{0,150}?\b(?:l[ií]neas?|lotes?|[ií]tems?)\b/i,
    /\b(?:l[ií]neas?|lotes?|[ií]tems?)\b[\s\S]{0,150}?(?:no\s+necesariamente\s+(?:al?|el)\s+mismo\s+(?:oferente|proveedor)|distint[oa]s?\s+(?:oferentes?|proveedores?|adjudicatarios?)|m[aá]s\s+de\s+un\s+adjudicatario)/i,
    // Mismo cluster, orden invertido (el calificativo de independencia puede venir ANTES de
    // mencionar línea/lote, no siempre después): "no necesariamente al mismo oferente... cada línea".
    /(?:no\s+necesariamente\s+(?:al?|el)\s+mismo\s+(?:oferente|proveedor)|distint[oa]s?\s+(?:oferentes?|proveedores?|adjudicatarios?)|m[aá]s\s+de\s+un\s+adjudicatario)[\s\S]{0,150}?\b(?:l[ií]neas?|lotes?|[ií]tems?)\b/i,
    // 28-jul-2026: orden invertido PLURAL — el sustantivo "oferentes/proveedores" ANTES del
    // adjetivo "distintos" (los patrones de arriba solo cubren adjetivo-antes-de-sustantivo:
    // "distintos oferentes"). Caso real 1260113-2-LE26: "pudiendo adjudicar hasta a seis oferentes
    // distintos" — en este caso puntual ya queda cubierto igual por el patrón de encabezado nominal
    // más abajo ("la adjudicación ES POR LÍNEA" aparece unas palabras antes en el mismo documento),
    // pero esta variante es útil por sí sola para licitaciones que NO tengan esa frase adicional.
    /(?:oferentes?|proveedores?|adjudicatarios?)\s+distint[oa]s?[\s\S]{0,150}?\b(?:l[ií]neas?|lotes?|[ií]tems?)\b/i,
    // 28-jul-2026 (caso real 1079576-27-LE26): orden invertido y singular — "cada anexo/línea/ítem
    // [puede] resultar adjudicado A UN PROVEEDOR/OFERENTE DISTINTO" — el cluster de arriba exige el
    // adjetivo en plural ANTES del sustantivo ("distintos oferentes"); acá va en singular DESPUÉS
    // ("un proveedor distinto"), variante que ningún patrón anterior reconocía.
    /(?:l[ií]neas?|lotes?|[ií]tems?|anexos?)\b[\s\S]{0,100}?adjudicad[oa]\s+a\s+un\s+(?:proveedor|oferente)\s+distint[oa]/i,
    // DECLARACIÓN DIRECTA a secas (sin "múltiple"/"independiente"/"distintos oferentes" cerca):
    // "podrá adjudicarse por línea de oferta", "se adjudicará por lote", "adjudicar por ítem".
    /adjudicar(?:se|á|an|a)?\s+por\s+(?:cada\s+)?(?:l[ií]neas?|lotes?|[ií]tems?)\b/i,
    // Forma nominal: "la adjudicación se realizará/hará por línea/lote/ítem".
    /adjudicaci[oó]n\s+se\s+(?:realizar[aá]|har[aá]|efectuar[aá])\s+por\s+(?:cada\s+)?(?:l[ií]neas?|lotes?|[ií]tems?)\b/i,
    // 23-jul-2026 (caso real 5240-77-LP26, Carabineros): "La presente licitación se desarrollará
    // bajo la MODALIDAD DE ADJUDICACIÓN EN LÍNEA". Dice "EN línea", no "POR línea", así que ningún
    // patrón de arriba la cazaba y el veredicto cayó al default GLOBAL pese a que la propia IA
    // había citado la frase. OJO con el falso amigo: "en línea" también significa "por internet"
    // ("la adjudicación se publicará en línea"), por eso se exige el contexto "modalidad de" o
    // "postular/ofertar en" — nunca la frase suelta.
    /modalidad\s+de\s+adjudicaci[oó]n\s+en\s+l[ií]neas?\b/i,
    /(?:postular|ofertar|participar)\s+en\s+adjudicaci[oó]n\s+en\s+l[ií]neas?\b/i,
    // Pasiva "será adjudicada/adjudicado por línea/lote": participio (termina en "-ada"/"-ado"),
    // no cubierto por adjudicar(?:se|á|an|a)? de la línea de abajo (esa alternativa no incluye la
    // terminación de participio). Caso real 2713-110-LE26 (Equipamiento Cementerio Municipal
    // Puerto Aysén): "la cual será adjudicada por línea, pudiendo presentarse ofertas para una o
    // varias líneas".
    /adjudicad[ao]\s+por\s+(?:cada\s+)?(?:l[ií]neas?|lotes?|[ií]tems?)\b/i,
    // "El método/la forma de adjudicación... será por línea/lote" — sin "múltiple"/"independiente"
    // cerca, así que ningún patrón de arriba la cazaba. Mismo caso 2713-110-LE26: "El método de
    // adjudicación de la presente licitación será por línea las cuales tiene un presupuesto
    // designado para cada una de ellas".
    /(?:m[eé]todo|forma)\s+de\s+adjudicaci[oó]n[\s\S]{0,60}?\bser[aá]\s+por\s+(?:cada\s+)?(?:l[ií]neas?|lotes?|[ií]tems?)\b/i,
    // 28-jul-2026 (caso real 1057536-83-LE26, CESFAM Frutillar): "Se podrá adjudicar A UN SOLO
    // PROVEEDOR por línea" — "un solo proveedor" queda ENTRE "adjudicar" y "por línea", así que el
    // patrón de arriba (adjudicar(?:se|á|an|a)?\s+por\s+…, sin nada en medio) no la cazaba. Es
    // evidencia fuerte de por_linea: "un solo proveedor POR LÍNEA" significa que cada línea tiene su
    // propio ganador — pueden ser proveedores DISTINTOS entre líneas, aunque cada línea individual
    // sea todo-o-nada para un único proveedor.
    // AMPLIADO el mismo día (auditoría masiva sobre 892 licitaciones con documentos): el "solo/
    // único" resultó opcional en la práctica ("será adjudicada A UN OFERENTE por línea", sin
    // "solo" — 1057500-53-LE26; "se adjudicará a un oferente por cada línea" — 1057494-41-LP26), y
    // la forma PASIVA ("ser adjudicada") con el mismo intermedio tampoco calzaba con el patrón
    // participio de más arriba (que exige "adjudicad[ao]" pegado a "por línea"): "podrá SER
    // ADJUDICADA a un solo oferente por línea" (1057049-210-LP26, 1671-21-CO26). También se agregó
    // "en" como preposición alternativa a "por": "adjudicar a un solo proveedor EN cada una de las
    // líneas" (4956-52-LE26).
    /(?:(?:ser\s+)?adjudicad[ao]|adjudicar(?:se|á|an|a)?)\s+a\s+un\s+(?:solo\s+|[uú]nico\s+)?(?:proveedor|oferente)\s+(?:por|en)\s+(?:cada\s+(?:una\s+de\s+las?\s+)?)?(?:l[ií]neas?|lotes?|[ií]tems?)\b/i,
    // 28-jul-2026 (mismo barrido): "ADJUDICACIÓN [simple/múltiple] POR LÍNEA" como encabezado de
    // sección o etiqueta de tabla, SIN verbo conjugado — ningún patrón de arriba la reconoce porque
    // todos exigen la forma verbal "adjudicar/adjudicad[ao]". Casos reales: "ADJUDICACIÓN POR
    // LÍNEAS" (5053-27-LE26, 5054-12-LE26, encabezado de sección), "Adjudicación</td><td>Por línea"
    // (2109-5-LP26, celda de tabla), "la adjudicación es por línea" (1113403-21-LE26), "La
    // adjudicación será por línea" (3134-59-LP26, 3134-67-LP26), "adjudicación simple por línea"
    // (1057474-24-LE26). Ventana corta (20 caract.) para no cruzar de oración y enganchar frases
    // no relacionadas (ej. "evaluará...por línea", que es del eje de PUNTAJE, no de adjudicación).
    // SOLO "por" (no "en"): "en línea" es el falso amigo ya documentado arriba ("adjudicación se
    // publicará EN LÍNEA" = por internet, no por ítem) — agregar "en" aquí lo reabriría.
    /adjudicaci[oó]n[\s\S]{0,20}?\bpor\s+(?:cada\s+)?(?:l[ií]neas?|lotes?|[ií]tems?)\b/i,
    // 28-jul-2026 (mismo barrido, confianza media): "la MEJOR OFERTA/MAYOR PUNTAJE POR CADA línea" —
    // el ganador se determina línea por línea (no dice "distinto oferente" explícito, pero la
    // mecánica per-línea es evidencia real de reparto: nada obliga a que el mismo oferente gane la
    // mejor oferta en todas). Casos reales: "la adjudicación se realizará considerando la mejor
    // oferta por cada línea" (3336-16-LP26); "se adjudicará al oferente que tuviere mayor puntaje EN
    // LA EVALUACIÓN FINAL DE cada línea" (752-24-LP26, con "de", no "por" — ambas preposiciones
    // aparecen en la práctica).
    /(?:mejor\s+oferta|mayor\s+puntaje)(?:\s+final)?[\s\S]{0,40}?\b(?:por|de)\s+(?:cada\s+)?(?:l[ií]neas?|lotes?|[ií]tems?)\b/i,
    // 10-ago-2026 (caso real 608-156-LP26, Hospital Dr. Gustavo Fricke, papel clínico): declaración
    // FORMAL en el CONSIDERANDO de la resolución — "la modalidad [del proceso] será DE adjudicación
    // MÚLTIPLE" — sin "por línea/lote", "independiente" ni "distintos oferentes" cerca (por eso
    // ningún patrón de arriba la cazaba; la ventana de 30 caract. del primer patrón exige "múltiple
    // por línea/lote" pegados, y acá "múltiple" es el final de la oración). Es la clasificación
    // OFICIAL del tipo de proceso (terminología ChileCompra: adjudicación simple = 1 ganador,
    // múltiple = puede ir a más de un proveedor) — no requiere elaboración adicional para ser
    // evidencia decisiva, a diferencia de una mención suelta de "múltiple" en otro contexto.
    // 17-ago-2026 (caso real 859378-8-LE26, kayaks Escuela Naútica): el sujeto de "será DE
    // adjudicación múltiple" no siempre es "la modalidad" — la forma más común en la práctica es
    // "la presente licitación será de adjudicación múltiple". Ampliado el sujeto para no exigir
    // literalmente "modalidad" delante.
    /(?:modalidad|licitaci[oó]n|proceso(?:\s+de\s+compra)?|contrataci[oó]n)[\s\S]{0,60}?ser[aá]\s+de\s+adjudicaci[oó]n\s+m[uú]ltiple\b/i,
    // Campo/encabezado formal "TIPO DE ADJUDICACIÓN: MÚLTIPLE" sin calificativo adicional cerca.
    /tipo\s+de\s+adjudicaci[oó]n\s*:?\s*m[uú]ltiple\b/i,
    // 17-ago-2026 (mismo caso 859378-8-LE26): "pudiendo adjudicar a más de un oferente [o a un
    // mismo oferente]" — declara explícitamente que puede haber más de un ganador, sin decir
    // "distintos/diferentes" oferentes (los clusters de arriba exigen ese calificativo) ni "por
    // línea/lote" pegado a "adjudicar". Es evidencia decisiva por sí sola: si el propio texto dice
    // que SE PUEDE repartir entre más de un oferente, no es adjudicación global a un solo ganador.
    /adjudicar\s+a\s+m[aá]s\s+de\s+un\s+(?:oferente|proveedor|adjudicatario)\b/i,
    // 20-ago-2026 (caso real 1079650-47-LE26, Hospital Traumatológico de Concepción): dos frases
    // reales, ninguna cazada por los patrones de arriba.
    // (a) Campo formal "c) Tipo de licitación: Pública-Adjudicación Múltiple-Licitación Pública
    // Entre 100 y 1000 UTM (LE)" — el campo formal es "TIPO DE LICITACIÓN", no "TIPO DE
    // ADJUDICACIÓN" (el patrón de la línea de arriba exige literalmente "tipo de adjudicación").
    /tipo\s+de\s+licitaci[oó]n\s*:?[\s\S]{0,40}?adjudicaci[oó]n\s+m[uú]ltiple\b/i,
    // (b) Prosa de la sección "DE LA ADJUDICACIÓN": "el Servicio adjudicará bajo la modalidad de
    // Adjudicación Múltiple aceptando la oferta que obtenga el mayor puntaje en la evaluación" —
    // el patrón "modalidad...será de adjudicación múltiple" (línea de arriba) exige el verbo SER;
    // acá el verbo es ADJUDICAR y la preposición es "bajo la modalidad de", no "será de".
    /bajo\s+la\s+modalidad\s+de\s+adjudicaci[oó]n\s+m[uú]ltiple\b/i,
  ];
  for (const d of docs) {
    if (!d.texto) continue;
    for (const re of patrones) {
      const m = d.texto.match(re);
      if (!m) continue;
      // Guardia de negación: "NO podrá adjudicarse por línea…" dice lo contrario.
      const i = d.texto.indexOf(m[0]);
      const previo = d.texto.slice(Math.max(0, i - 60), i);
      // OJO: sin \b final — "podrá" termina en vocal acentuada, que \b de JS no trata como
      // carácter de palabra (solo ASCII), así que "podrá "+\b nunca matchea y la guardia queda
      // muda en el caso más común ("no podrá..."). [^.]{0,40}$ ya acota el resto de la frase.
      if (/\bno\s+(?:se\s+)?(?:podr[aá]n?|puede[n]?|permit\w+|acept\w+)[^.]{0,40}$/i.test(previo)) continue;
      // Guardia de negación DENTRO del propio match (11-ago-2026, caso real 1426039-8-LE26,
      // mobiliario JUNJI): los patrones de ventana ancha ("adjudicación...por línea", hasta 150
      // caract. en medio) pueden capturar una NEGACIÓN completa como si fuera evidencia positiva.
      // Texto real: "Nota 1: la adjudicación NO ES por linea, sino por el total del proyecto" —
      // declaración GLOBAL explícita, pero el patrón "adjudicación...por línea" (ventana 20
      // caract.) la capturó ENTERA (m[0]="adjudicación no es por linea") y la citó como evidencia
      // de POR_LINEAS: literalmente lo contrario de lo que dice el texto. La guardia de arriba no
      // la agarra porque el "no" queda DENTRO del match, no antes. "sino" es la otra pista de la
      // misma construcción contrastiva ("no es X, sino Y").
      if (/\bno\s+(?:es|ser[aá]|est[aá]|fue|ser[aá]n|son)\b/i.test(m[0]) || /\bsino\b/i.test(m[0])) continue;
      return m[0].replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}

// ¿El formulario de OFERTA ECONÓMICA exige un ÚNICO total consolidado? (regla del
// experto: el formato de la oferta económica MANDA sobre cómo se adjudica — un solo
// "Monto total neto/IVA incluido" al pie de la planilla = SUMA ALZADA, aunque las bases
// hablen de "adjudicación por línea"). Busca el título del formulario económico y un
// "monto/precio total" global en su vecindad.
//
// OJO (falso positivo real): en una planilla POR ÍTEM (una fila por producto con su
// "VALOR UNITARIO" y su "TOTAL IVA INCLUIDO") el "total" es un ENCABEZADO DE COLUMNA, NO
// un gran total al pie. Por eso, cada aparición de "total" se descarta si está pegada a
// "valor/precio unitario" (fila de encabezados de una tabla por-ítem = por_linea).
export function detectarOfertaTotalUnico(docs: { texto: string }[]): boolean {
  const reTitulo = /formulario\s+e\s*-?\s*1|oferta\s+econ[oó]mica|anexo\s+econ[oó]mico/gi;
  const reTotal = /monto\s+total\s+(neto|iva|general)|precio\s+total\s+(neto\s+)?(final|general)|total\s+(general|neto)\s+(de\s+la\s+)?oferta|costo\s+total\s+(de\s+la\s+)?oferta|valor\s+total\s+ofertad|total\s+iva\s+incluido/gi;
  for (const d of docs) {
    if (!d.texto) continue;
    let m: RegExpExecArray | null;
    reTitulo.lastIndex = 0;
    while ((m = reTitulo.exec(d.texto)) !== null) {
      const ventana = d.texto.slice(m.index, m.index + 6000);
      // Si la misma ventana pide un total POR LÍNEA/LOTE, no es total único.
      if (/total\s+(por\s+)?l[ií]nea|total\s+(por\s+)?lote/i.test(ventana)) continue;
      // BLOQUE DE CIERRE "Subtotal … IVA … Total": trío de consolidación al pie de la
      // planilla (suma de todos los ítems) = SUMA ALZADA, aunque la tabla tenga columna
      // "Precio Unitario" por ítem y aunque las bases digan "adjudica por línea o ítem".
      // Es distinto de una columna "TOTAL IVA INCLUIDO" por fila (por_linea): ahí NO hay
      // "Subtotal". Cubre el formato hiper-común "Ítem|Precio Unitario| … Subtotal/IVA/Total".
      if (/\bsub\s*total\b[\s\S]{0,60}\biva\b[\s\S]{0,60}\btotal\b/i.test(ventana)) return true;
      let t: RegExpExecArray | null;
      reTotal.lastIndex = 0;
      while ((t = reTotal.exec(ventana)) !== null) {
        // Vecindad del "total" (antes y después): si viene junto a un contexto de CÁLCULO
        // POR ÍTEM — "VALOR/PRECIO UNITARIO", "cálculo del…", "debe aplicar", "cantidad ×" —
        // es la columna "total" de una planilla por-ítem o la nota de cómo calcularla (cada
        // fila su propio total), NO un gran total consolidado al pie → no cuenta como total
        // único (es indicio de por_linea).
        const sub = ventana.slice(Math.max(0, t.index - 200), t.index + 160);
        if (/valor\s+unitario|precio\s+unitario|p\.?\s*unit|c[aá]lculo\s+del|debe\s+aplicar|cantidad\s*[x×*]/i.test(sub)) continue;
        // GUARD DE CONTEXTO NEGATIVO: "monto/precio total" también aparece en textos que NO
        // son el pie del formulario económico y NO prueban suma alzada: cláusula de GARANTÍA
        // ("5% del monto total neto del contrato"), FÓRMULA de evaluación ("O.E. = Monto Total
        // Neto Menor Ofertado"), ACTA de adjudicación ("MONTO TOTAL NETO ADJUDICADO"), notas de
        // corrección/consistencia. Si la vecindad trae ese contexto, no cuenta como total único.
        const ctx = ventana.slice(Math.max(0, t.index - 150), t.index + 150);
        if (/garant|boleta|fiel\s+cumpl|seriedad|f[oó]rmula|menor\s+ofertad|puntaj|ponderaci|adjudicad|\bacta\b|correcci[oó]n|\bmulta|contrato/i.test(ctx)) continue;
        return true;
      }
    }
  }
  return false;
}

// LENGUAJE EXPLÍCITO de modalidad por-línea en las bases (la declaración más directa del
// "cómo se cotiza": se oferta y evalúa CADA línea/producto por separado). Es la señal más
// confiable y no dependía de nadie determinista hasta ahora. Devuelve la frase textual
// hallada (para citarla como evidencia) o null.
// NO incluye "adjudicación por línea/ítem" a secas: eso es "a quién se adjudica"
// (adjudicación múltiple), no "cómo se cotiza" — por doctrina no gatilla por_linea.
export function detectarLenguajePorLinea(docs: { texto: string }[]): string | null {
  // "se evaluará por línea (de producto)": cómo se EVALÚA, no a quién se adjudica → gatilla.
  // Caso real 1250623-4-LE26: "se evaluará por línea de\nproducto" (OCR parte la frase con
  // saltos de línea; \s+ los cruza). No confundir con "adjudicación por línea" a secas.
  // 10-ago-2026 (caso real 608-156-LP26): otras tres formas reales de decir "se evalúa por línea"
  // que el verbo "evaluar" de arriba no cubre porque usan otro verbo — "la evaluación... SE
  // REALIZARÁ por la línea de insumo licitado", "se ASIGNARÁ PUNTAJE por la línea", "se
  // CONSIDERARÁ LA NOTA por cada línea" (Criterios de Evaluación, numeral 4.4).
  const re = /ofertar\s+(?:por\s+)?(?:la\s+)?l[ií]nea\s+de\s+producto|(?:pudiendo\s+(?:los\s+)?(?:proponentes|oferentes)?\s*)?(?:podr[aá]n?\s+|pueden\s+)?ofertar\s+(?:en\s+|por\s+)?(?:una\s+o\s+m[aá]s|por)\s+(?:de\s+(?:las?|los)\s+)?(?:siguientes\s+)?l[ií]neas?|se\s+evaluar[aá]n?\s+por\s+l[ií]neas?(?:\s+de\s+producto)?|se\s+evaluar[aá]\s+cada\s+l[ií]nea(?:\s+de\s+manera\s+individual)?|cada\s+l[ií]nea\s+(?:se\s+evaluar[aá]|ser[aá]\s+evaluada)\s+de\s+manera\s+individual|se\s+evaluar[aá]n?\s+(?:[uú]nicamente\s+)?las\s+l[ií]neas\s+que|omitir\s+l[ií]neas\s+de\s+producto|completar\s+seg[uú]n\s+la\s+l[ií]nea|l[ií]nea\s+a\s+la\s+cual\s+postula|s[oó]lo\s+deber[aá]\s+completar\s+los\s+campos\s+en\s+aquellas\s+l[ií]neas|(?:campos\s+de\s+)?las\s+dem[aá]s\s+l[ií]neas\s+(?:deber[aá]\s+)?mantener|mantener\w*\s+en\s+blanco\s+(?:los\s+campos\s+de\s+)?las\s+dem[aá]s\s+l[ií]neas|evaluaci[oó]n[\s\S]{0,60}?se\s+realizar[aá]\s+por\s+(?:la\s+)?l[ií]nea|se\s+asignar[aá]\s+puntaje\s+por\s+(?:la\s+)?l[ií]nea|(?:se\s+)?considerar[aá]\s+la\s+nota\s+por\s+cada\s+l[ií]nea/i;
  for (const d of docs) {
    if (!d.texto) continue;
    const m = d.texto.match(re);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return null;
}

// PARTICIPACIÓN PARCIAL POR LÍNEA — subconjunto ESTRICTO de detectarLenguajePorLinea, para usar
// como evidencia de ADJUDICACIÓN ("¿a quién?"). Corrección 21-jul-2026 (caso real 1250623-4-LE26,
// detectado por CA leyendo las bases a mano): esa licitación dice "se evaluará por línea de
// producto" y SE ADJUDICA A UN SOLO OFERENTE (Art. 13º: "el Servicio aceptará LA propuesta más
// ventajosa"; Art. 15º solo readjudica a un segundo oferente en casos excepcionales — sigue siendo
// UN ganador). detectarLenguajePorLinea() disparaba por esa frase de EVALUACIÓN y
// veredictoAdjudicacionDeterminista la usaba como si fuera evidencia de que "pueden ganar varios
// oferentes distintos" — están confundiendo otra vez las dos preguntas del A.3, esta vez en el
// código de detección, no en el prompt. Esta función SOLO matchea frases que describen PARTICIPAR
// o GANAR solo una parte (omitir líneas, ofertar en una o más líneas, dejar en blanco las líneas
// que no se ofertan) — nunca frases de "se evaluará por línea", que son sobre el PUNTAJE, no sobre
// quién gana.
export function detectarParticipacionParcialPorLinea(docs: { texto: string }[]): string | null {
  // Incluye el orden invertido "en más de una línea" (caso real 1389488-29-LE26: "los oferentes
  // podrán ofertar en más de una línea de servicio"), que "una o más" no cubre.
  const re = /ofertar\s+(?:por\s+)?(?:la\s+)?l[ií]nea\s+de\s+producto|(?:pudiendo\s+(?:los\s+)?(?:proponentes|oferentes)?\s*)?(?:podr[aá]n?\s+|pueden\s+)?ofertar\s+(?:en\s+|por\s+)?(?:una\s+o\s+m[aá]s|m[aá]s\s+de\s+(?:un|una)|por)\s+(?:de\s+(?:las?|los)\s+)?(?:siguientes\s+)?l[ií]neas?|omitir\s+l[ií]neas\s+de\s+producto|completar\s+seg[uú]n\s+la\s+l[ií]nea|l[ií]nea\s+a\s+la\s+cual\s+postula|s[oó]lo\s+deber[aá]\s+completar\s+los\s+campos\s+en\s+aquellas\s+l[ií]neas|(?:campos\s+de\s+)?las\s+dem[aá]s\s+l[ií]neas\s+(?:deber[aá]\s+)?mantener|mantener\w*\s+en\s+blanco\s+(?:los\s+campos\s+de\s+)?las\s+dem[aá]s\s+l[ií]neas/i;
  for (const d of docs) {
    if (!d.texto) continue;
    const m = d.texto.match(re);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return null;
}

// OFERTA POR SUBCONJUNTO — el oferente puede postular SOLO A ALGUNOS ítems/líneas y omitir el
// resto ("podrán ofertar por una línea, más de una, o todas"; "pueden presentar oferta en uno o
// más ítems"; "si la licitación fuere por ítem y un proveedor ofertare a dos o más ítems").
//
// Es evidencia CONCLUYENTE de por_linea y la EXCEPCIÓN a la regla del total único: suma alzada
// significa todo-o-nada, así que si se puede ofertar a un subconjunto NO es suma alzada por
// definición. El trío "Subtotal/IVA/Total" al pie de esos formularios NO es un gran total
// consolidado: es la suma de LO QUE CADA OFERENTE ELIGIÓ ofertar.
//
// Caso que motivó la señal (1549-58-LE26): 3 equipos médicos heterogéneos, tabla con "Precio
// Unitario Neto" por ítem y "Subtotal/IVA/Total" al pie → el total único forzaba suma_alzada y
// el costeo salía global, cuando el propio anexo económico decía "Si la licitación fuere por
// ítem y un proveedor ofertare a dos o más ítems…".
//
// Medido sobre 742 licitaciones con documentos: dispara en 26 (3,5%), todas verificadas como
// por-línea reales. Devuelve la frase textual hallada (evidencia citable) o null.
export function detectarOfertaSubconjuntoItems(docs: { texto: string }[]): string | null {
  const patrones: RegExp[] = [
    // "Si la licitación fuere por ítem [y un proveedor ofertare a dos o más ítems]"
    /(?:si\s+)?la\s+licitaci[oó]n\s+(?:fuere|es|ser[aá])\s+por\s+[ií]tem/i,
    // "ofertar/presentar oferta a|por|en {uno|una|dos} o más {ítems|líneas}"
    /ofert\w+\s+(?:a|por|en)\s+(?:uno|una|dos)\s+o\s+m[aá]s\s+(?:de\s+(?:las?|los)\s+)?(?:siguientes\s+)?(?:[ií]tems?|l[ií]neas?)/i,
    // "podrán/pueden ofertar a|por|en {una|varias} [o más] {líneas|ítems}"
    /(?:podr[aá]n?|puede[n]?|pudiendo)\s+(?:\w+\s+){0,4}ofertar\s+(?:a|por|en)\s+(?:uno|una|varios|varias)\s+(?:o\s+m[aá]s\s+)?(?:[ií]tems?|l[ií]neas?)/i,
    // "ofertar a|por {una|varias|algunas} [o más] {líneas|ítems}"
    /ofertar\s+(?:a|por)\s+(?:uno|una|varios|varias|algunos|algunas)\s+(?:o\s+m[aá]s\s+)?(?:[ií]tems?|l[ií]neas?)/i,
    // Orden invertido "más de una/uno": "ofertar en más de una línea de servicio" (caso real
    // 1389488-29-LE26). Los patrones de arriba esperan "una o más"; este cubre "más de una".
    /(?:podr[aá]n?|puede[n]?|pudiendo)?\s*(?:\w+\s+){0,3}ofertar\s+(?:a|por|en)\s+m[aá]s\s+de\s+(?:un|uno|una)\s+(?:[ií]tems?|l[ií]neas?)/i,
    // 23-jul-2026 (caso real 5240-77-LP26, Carabineros). Dos redacciones que ningún patrón de
    // arriba cazaba porque TODOS exigen el verbo "ofertar", y estas usan "participar" y "postular":
    //   · "el oferente podrá PARTICIPAR por el total o por alguna(s) de la(s) línea(s)"
    //   · "los oferentes podrán POSTULAR en adjudicación en línea EN CONJUNTO O POR SEPARADO"
    // La disyuntiva todo-o-parte es justamente la definición de oferta por subconjunto.
    /(?:participar|postular|ofertar)\s+(?:por|en|a)\s+(?:el\s+|la\s+)?total(?:idad)?\s+o\s+(?:por|en|a)\s+(?:algun|un\b|una\b|s[oó]lo|solo|part)/i,
    /(?:participar|postular|ofertar)\s+(?:\w+\s+){0,6}?en\s+conjunto\s+o\s+por\s+separado/i,
  ];
  for (const d of docs) {
    if (!d.texto) continue;
    for (const re of patrones) {
      const m = d.texto.match(re);
      if (!m) continue;
      // Guard de NEGACIÓN: "NO podrá ofertar por una línea…" dice lo contrario. Se mira la
      // vecindad previa; si niega, esta aparición no cuenta (se siguen probando las demás).
      const i = d.texto.indexOf(m[0]);
      const previo = d.texto.slice(Math.max(0, i - 60), i);
      // OJO: sin \b final — "podrá" termina en vocal acentuada, que \b de JS no trata como
      // carácter de palabra (solo ASCII), así que "podrá "+\b nunca matchea y la guardia queda
      // muda en el caso más común ("no podrá..."). [^.]{0,40}$ ya acota el resto de la frase.
      if (/\bno\s+(?:se\s+)?(?:podr[aá]n?|puede[n]?|permit\w+|acept\w+)[^.]{0,40}$/i.test(previo)) continue;
      return m[0].replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}

// CUADRO ECONÓMICO POR LÍNEA — el formulario de oferta económica trae UNA TABLA POR LÍNEA,
// cada una cerrando con su PROPIO bloque de totales ("TOTAL NETO $ / 19% IVA $ / TOTAL $"),
// y NO existe un gran total consolidado que las sume. Por la regla maestra del experto
// ("el formato de la oferta económica manda"), ese formato ES por_linea: cada línea se
// cotiza y se cierra por separado, así que el oferente puede ofertar solo las líneas que
// le interesen (suma alzada tendría UN único cierre al pie).
//
// Caso que motivó la señal (1057489-203-LP26, Hospital del Salvador): Anexo N°7 con
// "Línea 1. Procesador…", "Línea 2. Resectoscopio…", "Línea 3. Ureteroscopio…", "Línea 4.
// Espirómetro…" — CADA una con su "TOTAL NETO$ / 19% IVA$ / TOTAL$" — y Art. 25° "se
// procederá a adjudicar por línea". Ninguna señal existente disparaba: el detector de
// total único no ve gran total (correcto), el parser no tabula (solo 4 ítems, piso 8),
// y el lenguaje "adjudicar por línea" a secas no gatilla por doctrina → el LLM quedó
// solo y lo clasificó GLOBAL con confianza 1. Esta señal cierra ese hueco.
// Devuelve la frase-evidencia (citable) o null.
export function detectarCuadroEconomicoPorLinea(docs: { texto: string }[]): string | null {
  const reTitulo = /cuadro\s+de\s+oferta\s+econ[oó]mica|formulario\s+(?:de\s+)?oferta\s+econ[oó]mica|anexo\s+econ[oó]mico/gi;
  // Un bloque = etiqueta "Línea N" seguida (a corta distancia) de su cierre de totales
  // "TOTAL [NETO] $ … IVA … TOTAL": el trío de consolidación, pero de UNA sola línea.
  const reBloque = /l[ií]nea\s*(?:n\s*[°º])?\s*(\d{1,3})[\s\S]{0,1800}?total(?:\s+neto)?\s*\$?[\s\S]{0,100}?iva\s*\$?[\s\S]{0,100}?total\s*\$?/gi;
  for (const d of docs) {
    if (!d.texto) continue;
    let m: RegExpExecArray | null;
    reTitulo.lastIndex = 0;
    while ((m = reTitulo.exec(d.texto)) !== null) {
      const ventana = d.texto.slice(m.index, m.index + 12_000);
      reBloque.lastIndex = 0;
      const lineas = new Set<number>();
      let fin = 0;
      let b: RegExpExecArray | null;
      while ((b = reBloque.exec(ventana)) !== null) {
        lineas.add(parseInt(b[1], 10));
        fin = b.index + b[0].length;
      }
      if (lineas.size < 2) continue;
      // Si tras el último bloque hay un GRAN TOTAL consolidado, mandaría suma alzada → no dispara.
      const cola = ventana.slice(fin, fin + 700);
      if (/total\s+general|gran\s+total|monto\s+total\s+de\s+la\s+oferta|sumatoria\s+de\s+(?:todas\s+)?las\s+l[ií]neas/i.test(cola)) continue;
      return `cuadro de oferta económica con ${lineas.size} líneas independientes (líneas ${[...lineas].sort((a, b) => a - b).slice(0, 8).join(', ')}), cada una con su propio bloque de totales TOTAL/IVA/TOTAL y sin gran total consolidado`;
    }
  }
  return null;
}

// PRESUPUESTO POR LÍNEA — patrón muy común en bases ESCANEADAS (OCR) donde la oferta
// económica NO es una planilla tabulable: las bases fijan un "monto máximo POR LÍNEA" y
// listan ≥2 líneas, cada una con su propio destino y su propio "TOTAL IVA INCLUIDO $X"
// (presupuestos independientes, típicamente imputados a ítems presupuestarios distintos).
// Eso es por_linea de forma CONCLUYENTE, aunque:
//   - el formulario económico venga EN BLANCO (encabezados + "XXX"),
//   - los ítems estén dispersos en el texto (parser de planilla → null),
//   - las etiquetas vengan pegadas/mutiladas por el OCR ("LíneaN°1", o "Línea" sin número).
// Estrategia robusta al OCR: exige (a) la FRASE "monto/presupuesto (máximo) por línea" y
// (b) ≥2 "TOTAL/monto por línea" (o ≥2 etiquetas "Línea N°"). Un suma_alzada tiene UN solo
// total al pie y NO usa esa frase → no dispara (bajo riesgo de falso positivo).
// Devuelve la frase-evidencia hallada, o null.
export function detectarPresupuestoPorLinea(docs: { texto: string }[]): string | null {
  // Frase-ancla: "presupuesto/monto [máximo|disponible|referencial|total|tope]* {por|de cada|de la|para (la)} línea".
  // El {0,3} permite VARIOS calificativos encadenados ("presupuesto máximo DISPONIBLE por línea",
  // "monto tope máximo disponible para la Línea") — antes solo aceptaba UNO y se caía justo en
  // ese caso (KIT de soluciones hídricas 4524-2-LP26).
  const reFrase = /(?:presupuesto|monto)\s+(?:(?:m[aá]ximo|disponible|referencial|total|tope)\s+){0,3}(?:por|de\s+cada|de\s+la|para(?:\s+la)?)\s+l[ií]nea|disponibilidad\s+presupuestaria\s+por\s+l[ií]nea/i;
  for (const d of docs) {
    if (!d.texto) continue;
    const mFrase = d.texto.match(reFrase);
    if (!mFrase) continue;
    // Cuenta señales de MÚLTIPLES líneas presupuestadas en el mismo documento:
    //  - "TOTAL IVA INCLUIDO $X" repetido (un total por línea, no un único gran total), o
    //  - etiquetas "Línea N°1/2/…" (tolerando OCR pegado y <td>).
    const totalesPorLinea = (d.texto.match(/total\s+iva\s+incluido[^\d]{0,25}\$?\s*[\d.]{4,}/gi) || []).length;
    const etiquetasLinea = new Set(
      [...d.texto.matchAll(/l[ií]nea\s*n\s*[°º]\s*(\d{1,3})/gi)].map(m => parseInt(m[1], 10)),
    ).size;
    // ENUMERACIÓN "Línea N: $monto" (con o sin "N°"): cada línea listada con su propio
    // presupuesto. Cubre el formato donde el punto "Presupuesto por línea:" abre una lista
    // "Línea 1: $ 1.970.640 (IVA incluido) … Línea 5: $ 4.069.995" — etiquetas SIN "N°" y
    // montos "(IVA incluido)" en vez de "TOTAL IVA INCLUIDO $", que los otros dos contadores
    // no ven. Exige el "$" pegado al número para no contar "Línea 1" suelto en prosa. Caso
    // real 1057822-37-LE26 (Mobiliario Cesfam O'Higgins – Concepción, 5 líneas presupuestadas;
    // el experto confirmó por_línea y la plataforma lo tomaba como global).
    const lineasConMonto = new Set(
      [...d.texto.matchAll(/l[ií]nea\s*(?:n\s*[°º]\s*)?(\d{1,3})\s*[:.\-)]?\s*\$\s*[\d.]{4,}/gi)].map(m => parseInt(m[1], 10)),
    ).size;
    // TABLA con columna "LINEAS"/"LÍNEAS" + presupuesto por FILA (formato bases administrativas
    // municipales): <tr><td>N</td>...<td>$monto</td></tr>, donde el primer <td> es solo el número
    // de línea y el último de la fila es el monto — la palabra "línea" NO se repite en cada fila
    // (solo aparece una vez, en el encabezado de columna), así que ninguno de los 3 contadores de
    // arriba la reconoce. Caso real 2713-110-LE26 (Equipamiento Cementerio Municipal Puerto
    // Aysén): tabla "LINEAS | PARTIDA | UNIDAD | CANTIDAD | Presupuesto disponible por línea" con
    // 13 filas numeradas 1..13 y su propio monto, agrupadas por categoría (OPERACIONAL /
    // ADMINISTRATIVO) vía <td colspan> (esas filas de categoría tienen 1 sola celda y no matchean).
    let filasTablaLineaMonto = 0;
    if (/<tr[\s>]/i.test(d.texto)) {
      const numerosVistos = new Set<number>();
      for (const f of d.texto.matchAll(/<tr[^>]*>((?:(?!<\/tr>)[\s\S])*?)<\/tr>/gi)) {
        const celdas = [...f[1].matchAll(/<td[^>]*>([^<]*)<\/td>/gi)].map(c => c[1].trim());
        if (celdas.length < 2) continue;
        const primera = celdas[0];
        const ultima = celdas[celdas.length - 1];
        if (/^\d{1,3}$/.test(primera) && /^\$?\s*[\d][\d.,]{3,}$/.test(ultima)) numerosVistos.add(parseInt(primera, 10));
      }
      filasTablaLineaMonto = numerosVistos.size;
    }
    if (totalesPorLinea >= 2 || etiquetasLinea >= 2 || lineasConMonto >= 2 || filasTablaLineaMonto >= 2) {
      return mFrase[0].replace(/\s+/g, ' ').trim();
    }
  }
  return null;
}

// TABLA "DISTRIBUCIÓN PRESUPUESTARIA POR LÍNEA" — formato de resoluciones que aprueban bases
// (tabla HTML de GLM-OCR): columnas SUBTITULO/CENTRO/N° LÍNEAS/CANTIDAD/DESCRIPCIÓN/PRESUPUESTO
// (ASIGNADO|LICITACION) CON IVA, con SUBTITULO/CENTRO en rowspan (una celda cubre varias filas).
// Se ancla en "LINEA N°X" + cantidad + descripción + monto, así el rowspan de las 2 primeras
// columnas no estorba. Caso real 1426098-10-LE26: el manifiesto de la IA traía
// `presupuesto_linea=0` en las 20 líneas aunque la Resolución SÍ trae el monto exacto de cada
// una (el usuario lo verificó contra el chat, que sí lo leyó porque tiene el texto completo).
// Devuelve {línea → presupuesto con IVA} o null si no hay ≥2 líneas con monto (evita falsos
// positivos de una tabla suelta).
export function extraerPresupuestoPorLineaTabla(docs: { texto: string }[]): Map<number, number> | null {
  const mapa = new Map<number, number>();
  const reTabla = /l[ií]nea\s*n[°ºo]?\s*(\d{1,3})\s*<\/td>\s*<td[^>]*>\s*\d+\s*<\/td>\s*<td[^>]*>\s*[^<]*?<\/td>\s*<td[^>]*>\s*\$?\s*([\d][\d.,]*)\s*<\/td>/gi;
  // 20-ago-2026 (caso real 1079650-47-LE26): PROSA "Monto disponible Item N°X $ Y.- (IVA
  // incluido)" — una línea de texto corrido por ítem, no una tabla HTML (el guard `<tr>` de
  // arriba la descarta entera). La palabra "Item/Ítem" viene MAL OCR-eada distinto en cada
  // línea del mismo documento (9 líneas reales: "Item", "tem", "¡tem", "Ítem", "ltem", "ítem" —
  // 6 variantes), así que no se intenta reconocerla: cualquier run corto no numérico entre
  // "disponible" y "N°X" sirve. El símbolo "$" también sale mal en 2 de las 9 líneas (OCR lo lee
  // como "S" mayúscula) — se acepta como alternativa (no "s" minúscula, para no enganchar
  // palabras sueltas de la prosa circundante).
  const reProsa = /monto\s+(?:disponible|m[aá]ximo|asignado)\s+[^\n\d]{0,10}n[°ºo*]\s*(\d{1,3})[^\d$S\n]{0,10}[$S]\s*([\d][\d.,]*)/gi;
  for (const d of docs) {
    if (!d.texto) continue;
    if (/<tr[\s>]/i.test(d.texto)) {
      reTabla.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = reTabla.exec(d.texto)) !== null) {
        const linea = parseInt(m[1], 10);
        const monto = parseInt(m[2].replace(/[.,]/g, ''), 10);
        if (linea > 0 && monto > 0 && !mapa.has(linea)) mapa.set(linea, monto);
      }
    }
    reProsa.lastIndex = 0;
    let m2: RegExpExecArray | null;
    while ((m2 = reProsa.exec(d.texto)) !== null) {
      const linea = parseInt(m2[1], 10);
      const monto = parseInt(m2[2].replace(/[.,]/g, ''), 10);
      if (linea > 0 && monto > 0 && !mapa.has(linea)) mapa.set(linea, monto);
    }
  }
  return mapa.size >= 2 ? mapa : null;
}

// SECCIONES "LÍNEA DE PRODUCTO N°X" en las BASES TÉCNICAS: cada una es un lote independiente
// (con su propio kit de productos y su propio presupuesto). Es una señal estructural de por_linea
// aunque el listado de productos NO sea tabulable de forma limpia (nombres de producto que contienen
// palabras-unidad como "tira"/"caja" hacen el parseo de ítems poco confiable). NO extrae los ítems
// —eso lo hace el LLM guiado con contexto—, solo reconoce la estructura y el número de líneas.
// Devuelve los números de línea de producto detectados (en orden).
export function detectarLineasProductoTecnicas(docs: { texto: string }[]): number[] {
  const set = new Set<number>();
  const re = /l[ií]nea\s+de\s+producto\s+n[°º]\s*(\d{1,2})/gi;
  for (const d of docs) {
    if (!d.texto) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(d.texto)) !== null) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 60) set.add(n);
    }
    re.lastIndex = 0;
  }
  return [...set].sort((a, b) => a - b);
}

// Extrae el TEXTO de cada sección "LÍNEA DE PRODUCTO N°X" de los documentos, acotado hasta la
// siguiente sección de línea o el siguiente título numerado (p.ej. "3.5. FORMA DE ENTREGA"). Es la
// MATERIA PRIMA para el extractor dedicado por IA: en este formato los productos vienen en tablas
// en prosa (PDF de bases técnicas) o en un Excel/anexo con una hoja por línea (sin numeral de
// artículo delante del encabezado) que el parser tabular no puede desenredar solo, pero una IA
// enfocada SOLO en estas secciones sí los lista. Devuelve [] si no hay ≥2 secciones.
//
// El prefijo "N.M." (p.ej. "9.1.") es OPCIONAL: las bases en PDF lo traen ("9.1 LÍNEA DE PRODUCTO
// N°1 – Nombre"), pero un anexo económico en Excel exportado a texto suele traer el encabezado
// PELADO, sin numeral de artículo ("LINEA DE PRODUCTO N°1: Nombre", una hoja por línea). Caso real
// 2295-74-LE26: el regex exigía el prefijo → nunca matcheaba en el Excel → 0 secciones → la
// extracción dedicada nunca corría → el manifiesto quedó con 1 "ítem" por línea (la categoría
// completa) en vez de los productos reales de cada hoja.
//
// "DE PRODUCTO" y el "N°/Nº" también son OPCIONALES: el Anexo N°2 Económico de proyectos PMU trae
// el encabezado corto "LÍNEA 1: LETRERO DE OBRAS" (sin "DE PRODUCTO" ni "N°"). Caso real
// 1738-18-LE26: el regex exigía ambos → 0 secciones → la extracción dedicada nunca corrió → el
// manifiesto quedó con 1 ítem "Global" por línea (los nombres de los ~50 productos reales
// aplastados en el campo "modelo" como texto) en vez de una fila por producto con su cantidad real.
//
// NO se queda con el PRIMER documento que matchea: prueba TODOS y elige el que tenga el MEJOR
// PISO (la sección MÁS CHICA de todas, la más grande posible) — no el total ni el conteo de filas.
// Razón (mismo caso 2295-74-LE26, segunda vuelta): un documento de referencia (BAE) menciona "Línea
// de Producto N°1/2/3/4" varias veces SOLO como etiqueta (tabla de presupuesto, tabla de tiempos de
// entrega) sin listar productos — heads dispersos y desparejos que, al recortar por secciones,
// producen 3 secciones DIMINUTAS (70-370 caracteres, solo la etiqueta) y 1 GIGANTE (hasta el tope de
// 16000, porque de pura casualidad barre por encima la lista real de productos que vive entre dos
// de esas etiquetas). Total de caracteres y conteo de filas ambos premian a ese candidato desparejo
// por su sección gigante accidental. El PISO (mínimo de las secciones) lo descarta: un documento
// bien formado (una hoja/sección real por línea, como el Excel Anexo N°6) tiene TODAS sus secciones
// con contenido — su peor sección sigue siendo mucho más grande que el peor caso de un candidato
// con etiquetas sueltas.
//
// Caso real 707423-56-LE26 (6-ago-2026): el MISMO documento traía DOS juegos de encabezados de
// línea — un resumen corto "Línea 9 - Comunicaciones:" (con guion, ~200 caracteres, sin tabla de
// productos) Y, más abajo, las secciones REALES con tabla completa "## LINEA 1 INVERNADERO" /
// "## LINEA 2 MOTRICIDAD" (sin "DE PRODUCTO", sin "N°", Y sin ":"/"–" — el único ancla es que la
// línea del documento contiene SOLO "LINEA N NOMBRE", nada más, un título real de tabla). Antes,
// el patrón corto encontraba las 4 menciones-resumen (≥2, así que paraba ahí) y NUNCA llegaba a
// intentar el patrón de título — el manifiesto se quedó con apenas 3 de los 12 productos reales.
// Fix: los TRES patrones se prueban SIEMPRE (no en cascada "para en el primero que matchee ≥2") y
// compiten por PISO igual que ya competían los documentos entre sí — así el candidato con tablas
// reales le gana al candidato con solo etiquetas sueltas, sea cual sea el orden en que aparecen.
export function extraerSeccionesLineaProducto(docs: { nombre?: string; texto?: string | null }[]): { linea: number; nombre: string; texto: string }[] {
  const RE_ESTRICTO = /(?:(\d{1,2})\.(\d{1,2})\.?\s*)?L[ÍI]NEA\s+DE\s+PRODUCTO\s+N[°º]\s*(\d{1,2})\s*[:–\-]?\s*([^\n]{0,60})/gi;
  // Encabezado CORTO "LÍNEA 1: Nombre" (sin "DE PRODUCTO" ni "N°") — el Anexo N°2 Económico de
  // proyectos PMU lo usa así. Sin "DE PRODUCTO"/"N°" de por medio, el ÚNICO ancla estructural que
  // separa un título real de una mención suelta en prosa ("la línea 1 del cuadro...") es el ":"/"–"
  // pegado al número.
  const RE_CORTA = /L[ÍI]NEA\s+(\d{1,2})\s*[:–\-]\s*([^\n]{0,60})/gi;
  // Encabezado de TÍTULO "LINEA N NOMBRE" — sin "DE PRODUCTO", sin "N°" Y sin separador tampoco.
  // El ancla acá no es puntuación: es que la línea ENTERA del documento (delimitada por `\n`, con
  // flag `m`) es solo eso, nada antes ni después — un título real de sección, a diferencia de una
  // mención en prosa ("Para la Línea 11, deberán...") que SIEMPRE trae texto antes en su misma
  // línea y por eso nunca calza con `^`. El prefijo "#+" (heading markdown que deja el OCR) es
  // opcional porque algunas secciones vienen sin él (envueltas en un `<div align="center">`, ver
  // caso 707423-56-LE26 línea 11).
  const RE_TITULO = /^(?:#+\s*)?L[ÍI]NEA\s+(\d{1,2})\s+([^\n]{2,60})$/gim;

  function heads(t: string, patron: RegExp): { idx: number; linea: number; nombre: string }[] {
    const out: { idx: number; linea: number; nombre: string }[] = [];
    patron.lastIndex = 0;
    let m: RegExpExecArray | null;
    // El nombre de sección puede venir seguido de comas CSV colgando (celdas vacías del Excel
    // exportado a texto, ej. `Mobiliario Urbano",,,,,,,`) — se recortan por prolijidad (no afecta
    // la extracción de ítems, que usa `texto`, solo la etiqueta que se muestra).
    while ((m = patron.exec(t)) !== null) {
      // RE_ESTRICTO trae el número de línea en el grupo 3 (el 1/2 son el numeral de artículo
      // opcional); los otros dos patrones lo traen en el grupo 1.
      const linea = parseInt(m[3] ?? m[1], 10);
      const nombre = (m[4] ?? m[2] ?? '').replace(/["'\s,]+$/, '').trim();
      out.push({ idx: m.index, linea, nombre });
    }
    return out;
  }

  // Un mismo documento puede repetir el mismo número de línea varias veces (portada + tabla de
  // presupuesto + tabla de tiempos = 3 apariciones de "Línea N°1"), cada aparición mucho más chica
  // que la sección real. Nos quedamos SOLO con la aparición MÁS GRANDE de cada número de línea:
  // así una mención suelta de una línea no arrastra al piso hacia abajo si esa MISMA línea tiene
  // en otra parte del documento su sección real y grande.
  function seccionesDe(t: string, hs: { idx: number; linea: number; nombre: string }[]): { linea: number; nombre: string; texto: string }[] {
    if (hs.length < 2) return [];
    const porLinea = new Map<number, { linea: number; nombre: string; texto: string }>();
    for (let i = 0; i < hs.length; i++) {
      const start = hs[i].idx;
      let end = i + 1 < hs.length ? hs[i + 1].idx : t.length;
      // Última sección: cortar en el próximo título numerado "N.M TÍTULO" (FORMA DE ENTREGA, etc.).
      if (i + 1 >= hs.length) {
        const mNext = t.slice(start + 1, end).match(/\n\s*\d{1,2}\.\d{1,2}\.?\s+[A-ZÁÉÍÓÚ]{4,}/);
        if (mNext && mNext.index != null) end = start + 1 + mNext.index;
      }
      const texto = t.slice(start, Math.min(end, start + 16000));
      const prev = porLinea.get(hs[i].linea);
      if (!prev || texto.length > prev.texto.length) {
        porLinea.set(hs[i].linea, { linea: hs[i].linea, nombre: hs[i].nombre, texto });
      }
    }
    return [...porLinea.values()].sort((a, b) => a.linea - b.linea);
  }

  let mejor: { linea: number; nombre: string; texto: string }[] = [];
  let mejorPiso = 0;
  for (const d of docs) {
    const t = d.texto || '';
    if (t.length < 200) continue;
    for (const patron of [RE_ESTRICTO, RE_CORTA, RE_TITULO]) {
      const out = seccionesDe(t, heads(t, patron));
      if (out.length < 2) continue;
      const piso = Math.min(...out.map(s => s.texto.length));
      if (piso > mejorPiso) { mejorPiso = piso; mejor = out; }
    }
  }
  return mejor;
}

// ¿Fila de categoría? Ej: ["", "A", "FERRETERIA", ""] o ["F", "HERRAMIENTAS"].
function detectarCategoria(celdas: string[]): string | null {
  for (let i = 0; i < celdas.length - 1; i++) {
    const c = limpiarCelda(celdas[i]);
    if (!/^[A-Z]$/.test(c)) continue;
    for (let j = i + 1; j < celdas.length; j++) {
      const nombre = limpiarCelda(celdas[j]);
      if (!nombre) continue;
      if (nombre.length >= 3 && /[a-záéíóúñ]/i.test(nombre) && !/^\d/.test(nombre)) {
        return nombre.toUpperCase();
      }
      break;
    }
  }
  return null;
}

const esEntero = (s: string) => /^\d{1,4}$/.test(limpiarCelda(s));
// Numeración compuesta "1.1" / "2.13" / "3.1.2": la parte entera es la LÍNEA/grupo y la
// fracción el correlativo del ítem dentro de ella (patrón típico de planillas por línea).
const esCompuesto = (s: string) => /^\d{1,3}\.\d{1,3}(\.\d{1,3})?$/.test(limpiarCelda(s));
const parteLinea = (s: string) => parseInt(limpiarCelda(s).split('.')[0], 10);
const parteItem  = (s: string) => parseInt(limpiarCelda(s).split('.')[1], 10);
const aNumero = (s: string): number | null => {
  const t = limpiarCelda(s).replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) && t !== '' ? n : null;
};

type ItemExtraido = Omit<ItemPlanilla, 'categoria' | 'linea'> & { lineaCompuesta?: number };

function extraerItem(celdas: string[], col: ColMap | null): ItemExtraido | null {
  if (col) {
    const desc = limpiarCelda(celdas[col.desc] || '');
    // Debe tener letras: una celda puramente numérica es un correlativo/cantidad mal mapeado,
    // no un producto (misma regla que la rama sin mapa de columnas).
    if (desc.length < 2 || !/[a-záéíóúñ]/i.test(desc)) return null;
    const numRaw = col.num >= 0 ? celdas[col.num] : '';
    if (col.num >= 0 && !esEntero(numRaw) && !esCompuesto(numRaw)) return null;
    const unidad = col.unidad >= 0 ? limpiarCelda(celdas[col.unidad] || '') : '';
    const cantidad = col.cant >= 0 ? aNumero(celdas[col.cant] || '') : null;
    if (esCompuesto(numRaw)) {
      return { numero: parteItem(numRaw), lineaCompuesta: parteLinea(numRaw), descripcion: desc, unidad, cantidad };
    }
    const numero = esEntero(numRaw) ? Number(limpiarCelda(numRaw)) : null;
    return { numero, descripcion: desc, unidad, cantidad };
  }
  const idxNum = celdas.findIndex(c => esEntero(c) || esCompuesto(c));
  if (idxNum < 0) return null;
  const numRaw = celdas[idxNum];
  const desc = limpiarCelda(celdas[idxNum + 1] || '');
  if (desc.length < 2 || !/[a-záéíóúñ]/i.test(desc)) return null;
  const base = {
    descripcion: desc,
    unidad: limpiarCelda(celdas[idxNum + 2] || ''),
    cantidad: aNumero(celdas[idxNum + 3] || ''),
  };
  if (esCompuesto(numRaw)) {
    return { numero: parteItem(numRaw), lineaCompuesta: parteLinea(numRaw), ...base };
  }
  return { numero: Number(limpiarCelda(numRaw)), ...base };
}

const PALABRAS_NO_ITEM = /^(total|subtotal|valor|monto|observ|notas?|precio|rut|item|detalle|descrip|n°|nº|#)\b/i;

// Analiza el patrón del correlativo de los ítems (heurística del experto):
//   de corrido 1,2,3,…,N (único, creciente, sin reinicios) → suma alzada;
//   reinicia 1,2,3|1,2,3 o repite agrupando 1,1,2,2,3 → por línea/lote.
function analizarNumeracion(items: { numero: number | null }[]): PatronNumeracion {
  const seq = items.map(i => i.numero).filter((n): n is number => n != null && n > 0);
  // Necesitamos correlativos en la mayoría de los ítems para juzgar con confianza.
  if (seq.length < 6 || seq.length < items.length * 0.5) return 'indefinida';

  let bajadas = 0;        // seq[i] < seq[i-1]   → el correlativo reinicia
  let repeticiones = 0;   // seq[i] === seq[i-1] → un mismo número agrupa varios ítems
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] < seq[i - 1]) bajadas++;
    else if (seq[i] === seq[i - 1]) repeticiones++;
  }
  const maxNum = Math.max(...seq);
  const cicla = maxNum <= seq.length * 0.7; // el máximo es mucho menor que la cantidad → el nº cicla

  // Reinicia si el correlativo baja varias veces (varios lotes) o se repite agrupando ítems.
  if ((bajadas >= 2 && cicla) || repeticiones >= Math.max(2, seq.length * 0.2)) return 'reinicia';
  // De corrido: estrictamente creciente (sin bajadas) → suma alzada.
  if (bajadas === 0) return 'continua';
  // Una bajada aislada en una lista larga y creciente es ruido de parseo → suma alzada.
  if (bajadas <= 1 && maxNum >= seq.length * 0.7) return 'continua';
  return 'indefinida';
}

// Cuando la numeración indica líneas pero NO hubo títulos "LÍNEA N", reasigna item.linea.
function segmentarLineasPorNumeracion(items: ItemPlanilla[]): void {
  const nums = items.map(i => i.numero);
  const hayRepes = nums.some((n, i) => i > 0 && n != null && n === nums[i - 1]);
  if (hayRepes) {
    // 1,1,2,2,3 → el número ES la línea (agrupa varios ítems bajo el mismo nº).
    let ultima = 1;
    for (const it of items) { if (it.numero != null) ultima = it.numero; it.linea = ultima; }
    return;
  }
  // 1,2,3|1,2,3 → nueva línea en cada reinicio del correlativo.
  let linea = 1, prev = 0;
  for (const it of items) {
    if (it.numero != null) { if (it.numero <= prev) linea++; prev = it.numero; }
    it.linea = linea;
  }
}

// CATÁLOGO DE SUMINISTRO con VALOR UNITARIO (sin columna de cantidad). Formato típico de
// convenios/suministros de ferretería-gasfitería: una tabla larga "Línea | Código interno |
// Detalle | Valor Unitario Neto Referencial" con N productos numerados 1..N y su precio unitario
// de referencia, PERO sin cantidad (se ofertan precios unitarios del catálogo). El parser tabular
// normal lo ignora: (a) no hay pipes/comas (OCR aplana en varias líneas), (b) el 2º número es un
// CÓDIGO de 7 díg (no cantidad), (c) el gate de cantidad lo rechaza. Aquí lo extraemos con el ancla
// fuerte "nº(1-3) · código(6-8 díg) · descripción · $precio". Numeración 1..N continua ⇒ suma_alzada.
function parsearCatalogoValorUnitario(doc: DocTexto): PlanillaParseResult | null {
  const t = doc.texto;
  // Header del catálogo (tolerante a saltos de línea del OCR entre los nombres de columna).
  if (!/l[ií]nea[\s\S]{0,40}c[oó]digo[\s\S]{0,60}(?:detalle|descrip)[\s\S]{0,80}valor\s+unitario/i.test(t)
      && !/c[oó]digo\s+interno[\s\S]{0,80}valor\s+unitario\s+neto/i.test(t)) return null;
  // Fila: nº correlativo (1-3 díg) · código interno (6-8 díg) · descripción (puede traer saltos
  // del OCR hasta el $) · $precio unitario. La descripción NO puede contener otro código largo.
  const re = /(?:^|\n)\s*(\d{1,3})\s+(\d{6,8})\s+((?:(?!\d{6,8})[\s\S]){3,110}?)\s*\$\s*([\d.]+)/g;
  // Dedupe por NÚMERO DE LÍNEA (1..N, el identificador canónico del ítem), NO por código: la
  // tabla suele venir repetida (resumen + anexo) y el OCR desalinea número↔código entre copias,
  // así que dedupear por código descartaba ítems válidos cuyo código ya se había visto pareado con
  // otro número. CANTIDAD = null: el documento NO la trae (es un catálogo de precios unitarios), y
  // el parser no inventa datos — la celda del Excel queda vacía para que la llene quien cotiza.
  // Lo mismo la UNIDAD. Ver el comentario "REGLA: NO SE INVENTAN DATOS" en el modo catálogo.
  const porNumero = new Map<number, ItemPlanilla>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const numero = parseInt(m[1], 10);
    const desc = limpiarCelda(m[3]).replace(/\s+/g, ' ');
    if (desc.length < 3 || !/[a-záéíóúñ]/i.test(desc)) continue;
    if (PALABRAS_NO_ITEM.test(desc)) continue;
    if (!porNumero.has(numero)) {
      porNumero.set(numero, { linea: 1, categoria: null, numero, descripcion: desc, unidad: '', cantidad: null });
    }
  }
  const items = [...porNumero.values()].sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0));
  if (items.length < 8) return null;
  // Sanidad: el correlativo debe arrancar cerca de 1 y cubrir la mayor parte del rango (evita
  // capturar coincidencias sueltas "nº código $" fuera de la tabla real).
  const nums = items.map(i => i.numero!).filter(n => n > 0);
  const maxNum = Math.max(...nums);
  if (Math.min(...nums) > 3 || items.length < maxNum * 0.6) return null;
  return { estructura: 'plana', lineas: [1], categorias: [], items, numeracion: 'continua', fuenteDoc: doc.nombre };
}

// PARSER DE TABLAS HTML — formato que emite GLM-OCR para documentos ESCANEADOS:
// "<table border=1><tr><td>1.</td><td>ELEMENTO</td><td>22</td><td></td></tr>…</table>". Todas las
// filas vienen en UNA sola línea, así que el parser tabular por saltos de línea no las ve. Aquí
// desarmamos <tr>/<td> y aplicamos la misma lógica de encabezado. Clave: la planilla suele PARTIRSE
// en varios <table> tras cada salto de página SIN repetir el encabezado (empiezan directo en "10.",
// "28."…) → arrastramos el layout de columnas (col) entre tablas. Las tablas de PUNTAJES (que van
// antes, sin columna de cantidad) no fijan col → sus filas se ignoran. Numeración 1..N ⇒ suma alzada.
function parsearTablasHtml(doc: DocTexto): PlanillaParseResult | null {
  const t = doc.texto;
  if (!/<tr[\s>]/i.test(t)) return null;

  const filas: string[][] = [];
  for (const trm of t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const celdas = [...trm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(c => limpiarCelda(c[1].replace(/<[^>]+>/g, ' ')));
    if (celdas.length >= 2) filas.push(celdas);
  }
  if (filas.length < 8) return null;

  let col: ColMap | null = null;
  let vistoHeader = false;
  const porNumero = new Map<number, ItemPlanilla>();
  const vistosSinNumero = new Set<string>();
  const items: ItemPlanilla[] = [];
  // CATÁLOGO DE SUMINISTRO SIN CANTIDADES (caso real 2731-21-LE26: "Solicitud de Compra" municipal
  // con ~290 productos de ferretería, columna Cantidad VACÍA en todas las filas): las filas con
  // descripción real pero sin correlativo NI cantidad se juntan aparte; si la tabla resulta ser un
  // catálogo (muchas de estas filas y casi ningún ítem "normal"), SÍ son el listado a costear.
  const catalogo: ItemPlanilla[] = [];

  for (const celdas of filas) {
    if (esHeaderEspecificaciones(celdas)) { col = null; continue; }
    const h = detectarHeader(celdas);
    if (h) { col = h; vistoHeader = true; continue; }
    if (!col) continue; // fuera de una tabla de cotización (p.ej. tablas de puntajes de evaluación)

    const desc = limpiarCelda(celdas[col.desc] || '');
    if (desc.length < 2 || !/[a-záéíóúñ]/i.test(desc)) continue;
    if (PALABRAS_NO_ITEM.test(desc)) continue;

    const numRaw = col.num >= 0 ? limpiarCelda(celdas[col.num] || '').replace(/\.$/, '') : '';
    const numero = /^\d{1,3}$/.test(numRaw) ? parseInt(numRaw, 10) : null;

    // Cantidad = número inicial de la celda CANT; lo que sigue (si hay) es la UNIDAD pegada por el
    // OCR ("25 MTS", "01 ROLLO", "04 Tineta"). El número puede traer separador de miles chileno
    // ("5.500"): capturar solo \d{1,5} lo truncaba en el punto → 5 en vez de 5500 (caso real
    // 3220-18-LE26, tabla HTML de GLM-OCR). aNumero() ya sabe leer "5.500" → 5500.
    const cantRaw = col.cant >= 0 ? limpiarCelda(celdas[col.cant] || '') : '';
    const mCant = cantRaw.match(/^(\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*(.*)$/);
    const cantidad = mCant ? aNumero(mCant[1]) : null;
    let unidad = col.unidad >= 0 ? limpiarCelda(celdas[col.unidad] || '') : '';
    if (!unidad && mCant && mCant[2]) unidad = mCant[2].trim();

    // Sin correlativo NI cantidad: puede ser una nota/observación arrastrada ("DEBERÁ MENCIONAR EL
    // TIEMPO DE ENTREGA…") o una fila de CATÁLOGO sin cantidades. FIRMA DEL CATÁLOGO: solo la celda
    // de descripción (y a lo más la de unidad) trae contenido y el resto viene VACÍO — las tablas
    // administrativas (etapas, puntajes, formularios) llenan varias columnas y quedan fuera.
    if (numero == null && cantidad == null) {
      const soloDescripcion = celdas.every((c, i) => i === col!.desc || i === col!.unidad || !limpiarCelda(c));
      if (soloDescripcion && desc.length <= 90) {
        catalogo.push({ linea: 1, categoria: null, numero: null, descripcion: desc, unidad, cantidad: null });
      }
      continue;
    }

    const item: ItemPlanilla = { linea: 1, categoria: null, numero, descripcion: desc, unidad, cantidad };
    // Dedupe (la tabla suele venir repetida: resumen + anexo económico, o el mismo bloque OCR-eado
    // dos veces). Con correlativo se dedupea por número; sin correlativo (tablas de solo 2 columnas
    // tipo ARTICULO/CANTIDAD, caso real 3489-29-LP26) se dedupea por descripción+cantidad+unidad.
    if (numero != null) {
      if (!porNumero.has(numero)) { porNumero.set(numero, item); items.push(item); }
    } else {
      const k = `${desc.toUpperCase()}|${cantidad ?? ''}|${unidad.toUpperCase()}`;
      if (!vistosSinNumero.has(k)) { vistosSinNumero.add(k); items.push(item); }
    }
  }

  // MODO CATÁLOGO: hubo header de planilla ("Bienes o Servicios Requeridos | Cantidad | …") pero
  // casi ninguna fila trajo correlativo/cantidad → es un catálogo de suministro (contrato marco de
  // ferretería/construcción): cada fila ES un producto a costear. Se exige un volumen alto (≥15
  // tras dedupe) para no confundir notas sueltas con un catálogo real.
  //
  // ═══ REGLA: NO SE INVENTAN DATOS ═══════════════════════════════════════════════════════════
  // (25-ago-2026, regla explícita del usuario a raíz del caso 2981-225-LE26.)
  // Este modo ANTES rellenaba `cantidad: 1` y `unidad: 'Unidad'` en cada fila, con el argumento de
  // que "el Excel necesita una cantidad base". Eso tenía DOS consecuencias, y las dos son graves:
  //
  //   1. Le mentía al que cotiza. Una cantidad de 1 se ve igual que una cantidad leída del
  //      documento — no hay forma de distinguir el dato real del relleno, y el total del Excel
  //      sale calculado sobre un número que nadie escribió nunca.
  //   2. Rompía los guardarraíles de más abajo. El GATE DE COTIZACIÓN descarta formularios
  //      justamente porque NO traen cantidades; al fabricarlas, el parser pasaba su propio gate
  //      con las cantidades que él mismo acababa de poner. Así los 16 rótulos de los anexos en
  //      blanco de 2981-225-LE26 llegaron al manifiesto como si fueran productos.
  //
  // Un dato inventado no solo es un dato falso: además desactiva las defensas que dependen de su
  // ausencia. Si el documento no lo dice, va NULL/vacío y la celda del Excel queda en blanco para
  // que la llene un humano. Vale para cantidad, unidad y cualquier campo que se agregue después.
  if (vistoHeader && items.length < 8 && catalogo.length >= 15) {
    const vistos = new Set<string>();
    const itemsCat = catalogo.filter(i => {
      const k = i.descripcion.toUpperCase();
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
    // GATE ANTI-FORMULARIO (25-ago-2026, caso 2981-225-LE26). El modo catálogo se activa sobre la
    // firma "solo la celda de descripción trae contenido, el resto vacío" — y un ANEXO EN BLANCO
    // (declaración jurada, formulario de datos del oferente, tabla de tramos de un criterio) tiene
    // EXACTAMENTE esa misma firma: las celdas están vacías porque se rellenan a mano. Ahí el parser
    // inventaba cantidad=1 por fila, se saltaba el GATE DE COTIZACIÓN (que exige cantidades reales)
    // con las cantidades que él mismo puso, y devolvía 16 rótulos como si fueran el listado a
    // costear — pisando al LLM, que traía el único producto correcto.
    // Discriminador: un catálogo real nombra OBJETOS; un formulario lista RÓTULOS. Si un quinto o
    // más de las filas son rótulos/tramos, esto no es un catálogo de suministro.
    const rotulos = itemsCat.filter(i => esFilaNoProducto(i.descripcion)).length;
    if (itemsCat.length && rotulos / itemsCat.length >= 0.2) {
      console.warn(`[planilla-costeo] ${doc.nombre}: modo catálogo DESCARTADO — ${rotulos}/${itemsCat.length} filas son rótulos de formulario o tramos de criterio, no productos.`);
      return null;
    }
    if (itemsCat.length >= 15) {
      return { estructura: 'plana', lineas: [1], categorias: [], items: itemsCat, numeracion: 'indefinida', fuenteDoc: doc.nombre };
    }
  }

  if (!vistoHeader || items.length < 8) return null;
  // Gate de cotización: una planilla real trae CANTIDADES (evita colar tablas de texto).
  const conCantidad = items.filter(i => i.cantidad != null && i.cantidad > 0).length;
  if (conCantidad < Math.max(3, Math.ceil(items.length * 0.25))) return null;

  return { estructura: 'plana', lineas: [1], categorias: [], items, numeracion: analizarNumeracion(items), fuenteDoc: doc.nombre };
}

// ITEMIZADO APLANADO DE PDF, EN SECCIONES ("Anexo N°1 … / Anexo N°2 …") — último recurso.
//
// Caso real 2422-144-LE26 (Municipalidad de Puente Alto, materiales + herramientas): las Bases
// Técnicas traen DOS itemizados, "Anexo N°1 Materiales de ferretería…" y "Anexo N°2 Herramientas
// y útiles…", que el Formulario N°4 de oferta económica cotiza como "LINEA 1:" y "LINEA 2:". El
// extractor de PDF aplana esas tablas a texto plano SIN pipes ni comas ("1 COPLA PPR 20 MM   25"),
// así que `celdasDe` no las ve y `parsearDoc` devolvía null: el manifiesto quedaba en manos de la
// IA, que listó los 151 ítems del Anexo N°1, se saltó entero el Anexo N°2 y marcó todo línea=1
// → el Excel salió en UNA sola hoja "Costeo" pese a que la modalidad era por_linea.
//
// Qué reconoce (todo anclado al CORRELATIVO ESPERADO dentro de cada sección, que es lo que
// distingue una fila de ítem de una línea cualquiera de prosa que empiece con un número):
//   ① "1 COPLA PPR 20 MM   25"                        → n° + descripción + cantidad al final
//   ② "9 MEZCLADOR 1400W  …  1 UNIDAD"                → n° + descripción + cantidad + unidad
//   ③ "7 PODADORA TELESCÓPICA 8''" … "2 UNIDAD"       → ficha: n° + nombre, descripción larga
//                                                       en medio, y cantidad+unidad más abajo
// La LÍNEA de cada ítem es el ORDINAL de su sección (1ª sección con ítems → LINEA1), no el número
// del anexo: así "Anexo N°3 / Anexo N°7" también salen como LINEA1/LINEA2.
const RE_SECCION_ANEXO = /^\s*anexo\s*n?\s*[°º]?\s*(\d{1,2})\b/i;
// Cantidad + unidad en su propia línea: "2 UNIDAD", "3 cajas", "10 unidades". La unidad se
// acepta en singular o plural — un "3 cajas" no reconocido desincroniza el correlativo y el
// listado se corta a la mitad (pasó con la LÍNEA 2 de 2422-144-LE26: 41 de 75 ítems).
const UNIDAD_SUELTA = /^(\d{1,4})\s+(unidad|und|un|c\/u|mts?|ml|m2|m3|kg|kilos?|grs?|lts?|litros?|metros?|gl|glb|par|jgo|juego|caja|cja|rollo|saco|set|pack|global|servicio|docena|bolsa|kit|tira|pliego|hoja|bidon|tambor)(?:e?s)?\.?$/i;
// Cierre GENÉRICO de ficha: "<n> <palabra en minúsculas>" cuando ya hay un ítem abierto con
// nombre — en esa posición una sola palabra suelta después de un número es la unidad de medida
// ("3 cajas", "2 juegos"), no prosa: la prosa trae varias palabras.
const CANTIDAD_UNIDAD_LIBRE = /^(\d{1,4})\s+([a-zá-úñ]{2,12})\.?$/;

function parsearItemizadoPdf(doc: DocTexto): PlanillaParseResult | null {
  type Seccion = { items: ItemPlanilla[]; esperado: number; pendiente: ItemPlanilla | null; faltaNombre: number };
  const nuevaSeccion = (): Seccion => ({ items: [], esperado: 1, pendiente: null, faltaNombre: 0 });
  const secciones: Seccion[] = [nuevaSeccion()];
  let sec = secciones[0];

  const descValida = (d: string) =>
    d.length >= 3 && d.length <= 120 && /[a-záéíóúñ]/i.test(d) && !PALABRAS_NO_ITEM.test(d);

  // Cierra la ficha abierta (③): sin cantidad si nunca apareció su "N UNIDAD".
  const cerrarPendiente = (cantidad: number | null, unidad: string) => {
    if (!sec.pendiente) return;
    sec.pendiente.cantidad = cantidad;
    sec.pendiente.unidad = unidad;
    if (descValida(sec.pendiente.descripcion)) sec.items.push(sec.pendiente);
    sec.pendiente = null;
    sec.faltaNombre = 0;
  };

  for (const cruda of doc.texto.split(/\r?\n/)) {
    const t = limpiarCelda(cruda);
    if (!t || /^\[\[P[ÁA]GINA/i.test(t)) continue;

    // ¿Encabezado de sección? ("Anexo N°2", "LÍNEA 2:", "LOTE 3 -")
    if (RE_SECCION_ANEXO.test(t) || detectarLinea(t) != null) {
      cerrarPendiente(null, '');
      // Solo abre sección nueva si la actual ya juntó ítems (evita cadenas de anexos vacíos).
      if (sec.items.length) { sec = nuevaSeccion(); secciones.push(sec); }
      else { sec.esperado = 1; }
      continue;
    }

    // ① n° + descripción + cantidad al final (dos o más espacios separan la columna).
    let m = t.match(/^(\d{1,3})\s+(.{3,120}?)\s{2,}(\d{1,4})$/);
    // ② n° + descripción + cantidad + unidad, todo en una línea.
    const m2 = m ? null : t.match(/^(\d{1,3})\s+(.{3,120}?)\s+(\d{1,4})\s+([A-Za-zÁÉÍÓÚÑ\/]{1,10})\.?$/);
    if (m2 && UNIDAD_SUELTA.test(`1 ${m2[4]}`)) m = m2;

    if (m && parseInt(m[1], 10) === sec.esperado) {
      const desc = limpiarCelda(m[2]);
      if (descValida(desc)) {
        cerrarPendiente(null, '');
        sec.items.push({
          linea: 1, categoria: null, numero: sec.esperado,
          descripcion: desc, unidad: m === m2 ? m2![4].toUpperCase() : '',
          cantidad: parseInt(m[3], 10),
        });
        sec.esperado++;
        continue;
      }
    }

    // ③ cierre de ficha: la cantidad y la unidad vienen solas en su propia línea.
    const mu = sec.pendiente
      ? (t.match(UNIDAD_SUELTA) || (descValida(sec.pendiente.descripcion) ? t.match(CANTIDAD_UNIDAD_LIBRE) : null))
      : null;
    if (mu) { cerrarPendiente(parseInt(mu[1], 10), mu[2].toUpperCase()); continue; }

    // ④ FILA PARTIDA en varias líneas (muy común cuando el nombre no cabe en la columna):
    // el n° va solo ("26"), el nombre en las 1-4 líneas siguientes y la cantidad sola al final
    // ("  20"). Una línea que es SOLO un número cierra la ficha abierta (es su cantidad) o, si no
    // hay ninguna abierta y calza con el correlativo esperado, abre una a la espera del nombre.
    const mn = t.match(/^(\d{1,4})$/);
    if (mn) {
      if (sec.pendiente) { cerrarPendiente(parseInt(mn[1], 10), ''); continue; }
      if (parseInt(mn[1], 10) === sec.esperado) {
        sec.pendiente = { linea: 1, categoria: null, numero: sec.esperado, descripcion: '', unidad: '', cantidad: null };
        sec.faltaNombre = 4;
        sec.esperado++;
        continue;
      }
    }
    // Continuación del nombre de una ficha abierta sin nombre (④).
    if (sec.pendiente && sec.faltaNombre > 0 && /[a-záéíóúñ]/i.test(t)) {
      sec.pendiente.descripcion = limpiarCelda(`${sec.pendiente.descripcion} ${t}`).slice(0, 120);
      sec.faltaNombre--;
      continue;
    }

    // ③ apertura de ficha: "7 PODADORA TELESCÓPICA 8''" con el correlativo esperado.
    const mf = t.match(/^(\d{1,3})\s+(\S.{2,120})$/);
    if (mf && parseInt(mf[1], 10) === sec.esperado) {
      const desc = limpiarCelda(mf[2]);
      if (descValida(desc)) {
        cerrarPendiente(null, '');
        sec.pendiente = { linea: 1, categoria: null, numero: sec.esperado, descripcion: desc, unidad: '', cantidad: null };
        sec.esperado++;
      }
    }
  }
  cerrarPendiente(null, '');

  // Solo cuentan las secciones que trajeron un LISTADO A COTIZAR: ≥2 ítems y la mayoría CON
  // cantidad. El gate por sección (no solo global) descarta los "ecos" del mismo listado que
  // traen las bases — índices, resúmenes de compra, fichas técnicas sin cantidad — que si no
  // se colarían como una LÍNEA 2 duplicada (caso real 867990-45-LP26: el listado de equipos
  // aparecía dos veces en la misma Resolución, la segunda sin cantidades).
  const conItems = secciones.filter(s =>
    s.items.length >= 2 && s.items.filter(i => i.cantidad != null && i.cantidad > 0).length >= s.items.length * 0.5);
  if (!conItems.length) return null;
  const items: ItemPlanilla[] = [];
  conItems.forEach((s, i) => { for (const it of s.items) { it.linea = i + 1; items.push(it); } });

  if (items.length < 8) return null;
  // Gate de cotización: un itemizado real trae CANTIDADES (evita colar prosa numerada).
  const conCantidad = items.filter(i => i.cantidad != null && i.cantidad > 0).length;
  if (conCantidad < Math.max(3, Math.ceil(items.length * 0.25))) return null;

  // Cada sección se numera desde 1 de forma INDEPENDIENTE: eso es un reinicio de correlativo
  // aunque la secuencia concatenada (1..151 | 1..25) parezca casi creciente y `analizarNumeracion`
  // la leería como continua. Con ≥2 secciones así, son listados separados → por línea.
  const porLinea = conItems.length >= 2;
  if (!porLinea) for (const it of items) it.linea = 1;
  return {
    estructura: porLinea ? 'por_linea' : 'plana',
    lineas: porLinea ? conItems.map((_, i) => i + 1) : [1],
    categorias: [],
    items,
    numeracion: porLinea ? 'reinicia' : analizarNumeracion(items),
    fuenteDoc: doc.nombre,
  };
}

// Reúne las filas que el extractor de Word PARTIÓ en dos líneas: la descripción queda en una
// ("133<tab>Terciado Estructural Pino 18 mm 122x244 cm") y la cantidad sola en la siguiente
// ("<tab>6<tab><tab>"). Cada mitad por separado es ilegible —una no tiene cantidad, la otra no
// tiene descripción— y la fila se pierde entera. Caso real 2791-24-LE26: 12 productos (paneles
// LED, alargadores, sanitarios, tornillos) desaparecían de un listado de 133.
// Solo actúa cuando la línea siguiente es EXCLUSIVAMENTE un número entre tabulaciones y la actual
// no termina ya en su propia cantidad: cualquier otra cosa se deja intacta.
const RE_SOLO_CANTIDAD = /^\t[\t ]*(\d{1,6}(?:[.,]\d{1,3})?)[\t ]*$/;
const RE_YA_TERMINA_EN_CANTIDAD = /\t[\t ]*\d[\d.,]*[\t ]*$/;
function reunirFilasPartidas(lineas: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lineas.length; i++) {
    const act = lineas[i];
    const sig = lineas[i + 1];
    if (sig !== undefined && act.includes('\t') && !RE_YA_TERMINA_EN_CANTIDAD.test(act)) {
      const m = sig.match(RE_SOLO_CANTIDAD);
      if (m) { out.push(`${act.replace(/\t+$/, '')}\t${m[1]}`); i++; continue; }
    }
    out.push(act);
  }
  return out;
}

function parsearDoc(doc: DocTexto): PlanillaParseResult | null {
  const lineas = reunirFilasPartidas(doc.texto.split(/\r?\n/));
  const items: ItemPlanilla[] = [];
  const lineasOrden: number[] = [];
  const catsOrden: string[] = [];
  let col: ColMap | null = null;
  let categoriaActual: string | null = null;
  let lineaActual = 1;
  let vistoHeader = false;
  let vioLineaExplicita = false;
  let vioCompuesta = false;
  let vioFilaPlana = false;
  // Dentro de una tabla de cumplimiento/ETT ("Cumple Si/No"): sus filas NO son productos.
  let enTablaEspec = false;
  // Correlativo esperado para desambiguar filas PEGADAS sin espacio (ver más abajo): sin esto,
  // "122NRBARRA…" (ítem 12, cant 2) se lee mal como ítem "1", cant "22" al probar el dígito
  // mínimo primero. Ancla la lectura al N° que debería seguir; si no calza, cae al modo laxo.
  let siguienteNumeroPlano = 1;

  for (const cruda of lineas) {
    // LÍNEA/LOTE (mirar la línea cruda antes de tabular).
    const nLinea = detectarLinea(cruda);
    if (nLinea != null) {
      lineaActual = nLinea;
      vioLineaExplicita = true;
      if (!lineasOrden.includes(nLinea)) lineasOrden.push(nLinea);
      continue;
    }

    const celdas = celdasDe(cruda);
    if (!celdas) {
      // Fila PLANA de listado (Anexo N°2 estilo texto): "1 3 BUTACA 4 CUERPOS $ 360.000.-"
      // → correlativo, cantidad, descripción y precio referencial, sin pipes ni comas.
      // Es la forma en que pdf-text aplana las tablas de varios organismos.
      if (!enTablaEspec) {
        const mp = cruda.match(/^\s*(\d{1,3})\s+(\d{1,4})\s+([A-ZÁÉÍÓÚÑ(][^$|]{2,90}?)\s+\$\s*([\d.,]+)/);
        if (mp) {
          const desc = limpiarCelda(mp[3]);
          if (desc.length >= 3 && /[a-záéíóúñ]/i.test(desc) && !PALABRAS_NO_ITEM.test(desc)) {
            vioFilaPlana = true;
            items.push({
              linea: vioLineaExplicita ? lineaActual : 1,
              categoria: categoriaActual,
              numero: parseInt(mp[1], 10),
              descripcion: desc,
              unidad: '',
              cantidad: parseInt(mp[2], 10),
            });
          }
        } else {
          // Fila PLANA con columnas PEGADAS sin espacio ni "$" (caso real 3220-18-LE26,
          // "DETALLE_MATERIALES_ELECTRICOS..pdf"): pdf-text aplana "N° | CANT. | UNIDAD |
          // DESCRIPCION" a "3" + "5.500" + "MTS" + "CABLE RVK…" sin separador, típico de
          // solicitudes de cotización SIN precio (por eso el patrón de arriba, que exige
          // "$ monto" al final, nunca matchea y el documento entero queda sin ítems).
          const UNIDAD_PEGADA = '(UN|UND|NR|MTS?|ML|M2|M3|KG|GRS?|LTS?|GL|GLB|PAR|JGO|CJA|CAJA|ROLLO|SACO|GLOBAL|SERV|DIAS?|HRS?)';
          // Intento 1: anclar al correlativo ESPERADO ("12" para el ítem 12, no solo "1").
          // Sin esto, un dígito mínimo lazy interpretaría "122NRBARRA…" como ítem 1 cant 22
          // en vez de ítem 12 cant 2 (ambigüedad real: ambos parsean "bien" como regex).
          const reEsperado = new RegExp(`^\\s*(${siguienteNumeroPlano})(\\d{1,3}(?:\\.\\d{3})*)${UNIDAD_PEGADA}([A-ZÁÉÍÓÚÑ(][^$|]{2,90})$`);
          let mp2 = cruda.match(reEsperado);
          if (!mp2) {
            // Intento 2 (laxo, dígito mínimo): documentos donde la numeración no arranca en 1
            // o no es correlativa. Puede leer mal casos de 2 dígitos, pero es mejor que nada.
            mp2 = cruda.match(new RegExp(`^\\s*(\\d{1,3}?)(\\d{1,3}(?:\\.\\d{3})*)${UNIDAD_PEGADA}([A-ZÁÉÍÓÚÑ(][^$|]{2,90})$`));
          }
          if (mp2) {
            const desc = limpiarCelda(mp2[4]);
            const cantidad = aNumero(mp2[2]);
            const numero = parseInt(mp2[1], 10) || null;
            if (desc.length >= 3 && /[a-záéíóúñ]/i.test(desc) && !PALABRAS_NO_ITEM.test(desc) && cantidad != null && cantidad > 0) {
              vioFilaPlana = true;
              if (numero != null) siguienteNumeroPlano = numero + 1;
              items.push({
                linea: vioLineaExplicita ? lineaActual : 1,
                categoria: categoriaActual,
                numero,
                descripcion: desc,
                unidad: mp2[3],
                cantidad,
              });
            }
          }
        }
      }
      continue;
    }

    if (esHeaderEspecificaciones(celdas)) { enTablaEspec = true; col = null; continue; }

    const header = detectarHeader(celdas);
    if (header) { col = header; vistoHeader = true; enTablaEspec = false; continue; }

    if (enTablaEspec) continue; // requisitos de cumplimiento, no ítems a cotizar

    const cat = detectarCategoria(celdas);
    if (cat) {
      categoriaActual = cat;
      if (!catsOrden.includes(cat)) catsOrden.push(cat);
      continue;
    }

    const it = extraerItem(celdas, col);
    if (!it) continue;
    if (PALABRAS_NO_ITEM.test(it.descripcion)) continue;
    const { lineaCompuesta, ...resto } = it;
    // Numeración compuesta "L.i": la parte entera manda como línea del ítem.
    const lineaItem = lineaCompuesta ?? (vioLineaExplicita ? lineaActual : 1);
    if (lineaCompuesta != null) {
      vioCompuesta = true;
      if (!lineasOrden.includes(lineaCompuesta)) lineasOrden.push(lineaCompuesta);
    } else if (vioLineaExplicita && !lineasOrden.includes(lineaActual)) {
      lineasOrden.push(lineaActual);
    }
    items.push({ linea: lineaItem, categoria: categoriaActual, ...resto });
  }

  // Con numeración compuesta, las filas de número ENTERO intercaladas son títulos de
  // grupo/sección ("1 | Características generales"), no productos → fuera del manifiesto.
  if (vioCompuesta) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      const esTituloGrupo = it.cantidad == null && !it.unidad &&
        items.some(o => o !== it && o.linea === it.numero && o.cantidad != null);
      if (esTituloGrupo && !vioLineaExplicita) items.splice(i, 1);
    }
  }

  if (items.length < 8) return null;
  if (!vistoHeader && catsOrden.length === 0 && !vioLineaExplicita && !vioCompuesta && !vioFilaPlana) return null;

  // GATE DE COTIZACIÓN: una planilla de oferta económica real trae CANTIDADES. Si casi
  // ninguna fila tiene cantidad, esto es un checklist/formulario (ETT, criterios, socios…)
  // y NO debe alimentar el manifiesto ni el Excel de costeo.
  const conCantidad = items.filter(i => i.cantidad != null && i.cantidad > 0).length;
  if (conCantidad < Math.max(3, Math.ceil(items.length * 0.25))) return null;

  // PATRÓN DE NUMERACIÓN — el discriminador clave suma_alzada vs por_linea. Manda por
  // sobre los títulos "LÍNEA N": una planilla numerada de corrido 1..N es suma alzada
  // aunque venga partida en hojas/secciones tituladas "Línea N".
  let numeracion = analizarNumeracion(items);
  let lineasFinal = lineasOrden;
  let estructura: PlanillaParseResult['estructura'];

  if (vioCompuesta) {
    // Numeración compuesta "L.i" (1.1, 1.2 … 2.1, 2.2): la parte entera ES la línea/lote.
    // Es el patrón más explícito de todos → manda sobre el resto de heurísticas.
    lineasFinal = [...new Set(items.map(it => it.linea))].sort((a, b) => a - b);
    estructura = lineasFinal.length >= 2 ? 'por_linea' : 'plana';
    numeracion = lineasFinal.length >= 2 ? 'reinicia' : numeracion;
  } else if (numeracion === 'reinicia' && vioLineaExplicita) {
    // Lotes EXPLÍCITOS ("LÍNEA N"/"Hoja: Línea N") + correlativo que reinicia = por línea real.
    lineasFinal = lineasOrden;
    estructura = lineasFinal.length >= 2 ? 'por_linea' : (catsOrden.length >= 2 ? 'por_categoria' : 'plana');
  } else if (numeracion === 'reinicia' && catsOrden.length >= 2) {
    // El correlativo reinicia por CATEGORÍA/rubro (FERRETERIA 1..n, PINTURA 1..n), NO por lote
    // de adjudicación → por_categoria (suma alzada, costeo desglosado por rubro). Línea 1 para todos.
    for (const it of items) it.linea = 1;
    lineasFinal = [1];
    estructura = 'por_categoria';
  } else if (numeracion === 'reinicia') {
    // Reinicia/repite SIN títulos ni categorías → líneas inferidas de la propia numeración.
    segmentarLineasPorNumeracion(items);
    lineasFinal = [...new Set(items.map(it => it.linea))].sort((a, b) => a - b);
    estructura = lineasFinal.length >= 2 ? 'por_linea' : 'plana';
  } else if (numeracion === 'continua') {
    // De corrido = suma alzada. Los títulos "LÍNEA N" son secciones de una MISMA planilla
    // integrada, NO lotes de adjudicación → todos los ítems quedan en la línea 1.
    for (const it of items) it.linea = 1;
    lineasFinal = [1];
    estructura = catsOrden.length >= 2 ? 'por_categoria' : 'plana';
  } else {
    // 'indefinida' → respeta los títulos explícitos (comportamiento previo).
    lineasFinal = lineasOrden;
    estructura = lineasOrden.length >= 2 ? 'por_linea' : (catsOrden.length >= 2 ? 'por_categoria' : 'plana');
  }

  return {
    estructura,
    lineas: lineasFinal.length ? lineasFinal : [1],
    categorias: catsOrden,
    items,
    numeracion,
    fuenteDoc: doc.nombre,
  };
}

function esCandidato(doc: DocTexto): boolean {
  // NUNCA parsear NUESTROS propios archivos generados (COSTEO_*) ni los "documentos propios"
  // que sube el usuario: el Excel de costeo trae 1 hoja por línea → el parser lo leería como
  // por_linea, contaminando la detección suma_alzada vs por_linea (bucle de realimentación).
  // (La ruta generar-costeo ya excluye estos mismos al armar el manifiesto; aquí se replica.)
  if (/^costeo_/i.test(doc.nombre)) return false;
  if ((doc.categoria || '').toUpperCase() === 'DOCUMENTOS_PROPIOS') return false;

  const n = normalizar(doc.nombre);
  if (/anexo.?o|anexo.?econom|economic|cotiza|itemiz|presupuesto|listado|formato.?\d|oferta.?econ/.test(n)) return true;
  if (/ett|tecnic|especif|bases|resoluc/.test(n)) return true;
  if ((doc.metodo || '') === 'excel') return true;
  // Catálogo de suministro con valor unitario (aunque el doc no tenga "cantidad" ni nombre típico):
  // la firma "Código interno … Valor Unitario Neto" identifica la tabla de productos a costear.
  if (/c[oó]digo\s+interno|valor\s+unitario\s+neto/i.test(doc.texto)) return true;
  // Cabecera "Cantidad / Unidad / Productos" con precio unitario (caso real 1736-82-LE26,
  // ANEXO_N°4.docx: "Precio unitario (Neto$)", sin "valor unitario neto" exacto ni "detalle/
  // descripción" — y el nombre del archivo no dice "económico"). Firma más laxa a propósito.
  if (/precio\s+unitario/i.test(doc.texto) && /\bcant/i.test(doc.texto) && /\bunidad\b/i.test(doc.texto)) return true;
  return /detalle|descrip/i.test(doc.texto) && /\bcant/i.test(doc.texto);
}

// El filtro de filas que NO son productos vive en su propio módulo (lo usa también el cliente).
// Se re-exporta acá para no romper los imports existentes desde el parser.
export { esFilaNoProducto, esFilaDeCriterioNoProducto } from '@/app/lib/fila-no-producto';


// ─── TABLA CANÓNICA "Producto | Cantidad" de las BASES TÉCNICAS ────────────────────────────
// (17-ago-2026, caso real 2345-128-LP26.) El listado AUTORITATIVO de qué se compra casi siempre
// vive en las bases técnicas como una tabla mínima de dos columnas:
//
//     Producto Cantidad
//     Chaleco Balístico con funda con logo institucional. 155
//     Cascos balísticos   300
//
// Extraída de un PDF, esa tabla NO es markdown ni CSV — las columnas se aplastan en una sola
// línea con el número al final, así que `celdasDe()` (que solo entiende "|" y comas) devuelve
// null y el parser tabular completo nunca la ve. Resultado: el manifiesto quedaba 100% a merced
// del LLM, que en este caso mezcló 20 filas de la tabla de criterios entre los 10 productos.
//
// Esta función es a propósito ESTRECHA: exige el encabezado literal de dos columnas y filas
// "<descripción con letras> <entero>". No compite con el parser tabular (que maneja planillas
// ricas con unidad/línea/categoría) — es una RED DE SEGURIDAD determinista para saber CUÁNTOS y
// CUÁLES productos son, cuando el documento fuente es un PDF de bases y no una planilla Excel.
const RE_HEADER_PRODUCTO_CANTIDAD =
  /^(producto|productos|bien|bienes|art[ií]culo|art[ií]culos|descripci[óo]n|detalle|insumo|insumos|equipamiento)\s*\|?\s*(cantidad|cant\.?|n[°º]\s*unidades)\s*$/i;
// Corta el barrido: un encabezado de sección nueva ("B.2. ESPECIFICACIONES", "ANEXO N°3",
// "5. GARANTÍAS") significa que la tabla terminó. Sin esto, el barrido seguiría comiéndose la
// prosa que viene abajo mientras alguna línea termine por casualidad en un número.
const RE_FIN_DE_TABLA_CANONICA =
  /^(\s*[A-Z]\.\d|\s*\d+\.\d|anexo\b|formulario\b|art[ií]culo\s+\d|cap[ií]tulo\b|secci[óo]n\b)/i;

export function extraerTablaProductoCantidad(docs: DocTexto[]): ItemPlanilla[] {
  for (const doc of docs) {
    if (!doc.texto) continue;
    const lineas = doc.texto.split('\n');
    for (let i = 0; i < lineas.length; i++) {
      if (!RE_HEADER_PRODUCTO_CANTIDAD.test(limpiarCelda(lineas[i]))) continue;

      const items: ItemPlanilla[] = [];
      let vacíasSeguidas = 0;
      for (let j = i + 1; j < lineas.length; j++) {
        const t = limpiarCelda(lineas[j]);
        if (!t) {
          // Una tabla de PDF trae líneas en blanco entre filas (saltos de página, espaciado).
          // Se toleran unas pocas; muchas seguidas significan que la tabla ya terminó.
          if (++vacíasSeguidas > 3) break;
          continue;
        }
        if (RE_FIN_DE_TABLA_CANONICA.test(t)) break;
        vacíasSeguidas = 0;
        // Fila válida: texto con letras + un entero al final. El punto final es habitual
        // ("Cascos balísticos.  300") y no forma parte ni del nombre ni del número.
        const m = t.match(/^(.*[\p{L}].*?)\s*[.:]?\s+(\d{1,6})\s*$/u);
        if (!m) break;                       // una fila que no calza cierra la tabla
        const descripcion = m[1].replace(/[.\s]+$/, '').trim();
        const cantidad = Number(m[2]);
        if (descripcion.length < 3 || descripcion.length > 200) break;
        if (!Number.isFinite(cantidad) || cantidad <= 0) break;
        items.push({ linea: 1, categoria: null, numero: items.length + 1, descripcion, unidad: '', cantidad });
      }
      // Dos filas no son una tabla (puede ser prosa con un número al final por casualidad).
      if (items.length >= 3) return items;
    }
  }
  return [];
}

// Recorre los documentos candidatos y devuelve el MEJOR resultado (más ítems; a igualdad,
// el que detecte líneas y luego categorías). Si ninguno califica → null.
// ─── AUTORIDAD DE LA FUENTE ───────────────────────────────────────────────────────────────
// REGLA: se leen TODOS los documentos de la licitación y se elige por AUTORIDAD del documento,
// NUNCA por cantidad de filas. El volumen solo desempata DENTRO del mismo nivel de autoridad.
//
// Por qué: "más ítems gana" premia la CONTAMINACIÓN. Un documento ómnibus (resolución exenta,
// bases administrativas) CONTIENE el anexo económico más otras tablas, así que siempre empata o
// supera en filas al anexo dedicado — la regla garantizaba que perdiera el documento bueno.
// Caso real 1414396-21-LP26 (mobiliario SLEP, 24-ago-2026): el Anexo_Económico.xlsx daba los 29
// productos correctos, pero la Resolución Exenta daba 34 y ganaba. Sus 5 filas de más venían del
// ANEXO N°6 de DISTRIBUCIÓN DE ENTREGA (Comuna|Dirección|Unidad Educativa|Producto|Cantidad),
// que repite productos por establecimiento; además partía "Mueble Estante 30 Espacios" (cant. 2)
// leyendo el "30" del NOMBRE como si fuera la cantidad.
export const AUTORIDAD_FUENTE = {
  ANEXO_ECONOMICO: 0,   // la planilla que el oferente LLENA para cotizar: lista canónica
  BASES_TECNICAS: 1,    // tabla de productos de las ETT/especificaciones
  OMNIBUS: 2,           // resolución exenta / bases administrativas: contienen todo mezclado
} as const;

function autoridadDe(doc: DocTexto): number {
  const n = normalizar(doc.nombre);
  if (/anexo.?econom|oferta.?econ|economic|itemiz|presupuesto.?ofert|formulario.?ofert/.test(n)) {
    return AUTORIDAD_FUENTE.ANEXO_ECONOMICO;
  }
  if (/ett|tecnic|especif/.test(n)) return AUTORIDAD_FUENTE.BASES_TECNICAS;
  return AUTORIDAD_FUENTE.OMNIBUS;
}

export function parsearPlanillaCosteo(docs: DocTexto[]): PlanillaParseResult | null {
  const mejorScore = (m: PlanillaParseResult) => m.items.length * 100 + m.lineas.length * 10 + m.categorias.length;
  // Se parsean TODOS los candidatos y se conservan TODOS: ninguno se descarta en silencio.
  // Lo que no se elige queda registrado como fuente alternativa para poder contrastar.
  const candidatos: { r: PlanillaParseResult; autoridad: number; doc: DocTexto }[] = [];
  for (const doc of docs) {
    if (!doc.texto || doc.texto.length < 40) continue;
    if (!esCandidato(doc)) continue;
    // Orden: tablas HTML (GLM-OCR de escaneados) → catálogo valor unitario → parser tabular normal.
    const r = parsearTablasHtml(doc) || parsearCatalogoValorUnitario(doc) || parsearDoc(doc);
    if (!r) continue;
    candidatos.push({ r, autoridad: autoridadDe(doc), doc });
  }

  if (candidatos.length) {
    // Guardarraíl del 50%: una fuente autoritativa manda SALVO que haya leído menos de la mitad
    // de filas que la que más leyó — ahí viene truncada, ilegible o es una plantilla en blanco,
    // y no se le hace caso. Evita que un anexo roto silencie al documento que sí se pudo leer.
    const maxItems = Math.max(...candidatos.map(c => c.r.items.length));
    const elegibles = candidatos.filter(c => c.r.items.length >= maxItems * 0.5);
    const orden = (elegibles.length ? elegibles : candidatos).slice().sort((a, b) =>
      a.autoridad - b.autoridad || mejorScore(b.r) - mejorScore(a.r));
    const ganador = orden[0];

    // TRAZA ANTI-INVENTO: qué se leyó, de dónde, y en qué NO coinciden las fuentes entre sí.
    // No se corrige nada a mano ni se "rellena" con criterio propio: si los documentos se
    // contradicen, queda escrito para que lo revise una persona (regla V-15 del validador).
    ganador.r.candidatos = candidatos.map(c => ({
      fuenteDoc: c.r.fuenteDoc || c.doc.nombre,
      autoridad: c.autoridad,
      items: c.r.items.length,
      elegido: c === ganador,
    }));
    ganador.r.discrepancias = candidatos
      .filter(c => c !== ganador && c.r.items.length !== ganador.r.items.length)
      .map(c => `"${c.r.fuenteDoc || c.doc.nombre}" lista ${c.r.items.length} ítems y la fuente elegida `
        + `"${ganador.r.fuenteDoc || ganador.doc.nombre}" lista ${ganador.r.items.length}`);
    return ganador.r;
  }
  let mejor: PlanillaParseResult | null = null;

  // ÚLTIMO RECURSO: itemizados que el extractor de PDF/Word aplanó a texto suelto. Va aparte y
  // DESPUÉS del bucle normal a propósito: es el parser más laxo (se guía por el correlativo, no
  // por una estructura de tabla), así que nunca debe desplazar a un documento que sí se pudo leer
  // como planilla — solo cubre el caso en que NINGÚN documento dio nada.
  for (const doc of docs) {
    if (!doc.texto || doc.texto.length < 40) continue;
    if (!esCandidato(doc)) continue;
    const r = parsearItemizadoPdf(doc);
    if (!r) continue;
    if (!mejor || r.items.length > mejor.items.length) mejor = r;
  }
  return mejor;
}
