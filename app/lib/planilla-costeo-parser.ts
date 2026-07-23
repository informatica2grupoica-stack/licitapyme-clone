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
    // CLUSTER: distinto/diferente/varios + oferente/proveedor/adjudicatario, cerca de línea/lote
    // (en cualquier orden, ventana amplia) — cubre "distintos proveedores por línea", "puede
    // resultar adjudicada a diferentes oferentes por lote", "no necesariamente al mismo proveedor".
    /(?:distint[oa]s?|diferentes?|vari[oa]s)\s+(?:oferentes?|proveedores?|adjudicatarios?)[\s\S]{0,150}?\b(?:l[ií]neas?|lotes?)\b/i,
    /\b(?:l[ií]neas?|lotes?)\b[\s\S]{0,150}?(?:no\s+necesariamente\s+(?:al?|el)\s+mismo\s+(?:oferente|proveedor)|distint[oa]s?\s+(?:oferentes?|proveedores?|adjudicatarios?)|m[aá]s\s+de\s+un\s+adjudicatario)/i,
    // Mismo cluster, orden invertido (el calificativo de independencia puede venir ANTES de
    // mencionar línea/lote, no siempre después): "no necesariamente al mismo oferente... cada línea".
    /(?:no\s+necesariamente\s+(?:al?|el)\s+mismo\s+(?:oferente|proveedor)|distint[oa]s?\s+(?:oferentes?|proveedores?|adjudicatarios?)|m[aá]s\s+de\s+un\s+adjudicatario)[\s\S]{0,150}?\b(?:l[ií]neas?|lotes?)\b/i,
    // DECLARACIÓN DIRECTA a secas (sin "múltiple"/"independiente"/"distintos oferentes" cerca):
    // "podrá adjudicarse por línea de oferta", "se adjudicará por lote", "adjudicar por ítem".
    /adjudicar(?:se|á|an|a)?\s+por\s+(?:cada\s+)?(?:l[ií]neas?|lotes?|[ií]tems?)\b/i,
    // Forma nominal: "la adjudicación se realizará/hará por línea/lote/ítem".
    /adjudicaci[oó]n\s+se\s+(?:realizar[aá]|har[aá]|efectuar[aá])\s+por\s+(?:cada\s+)?(?:l[ií]neas?|lotes?|[ií]tems?)\b/i,
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
  const re = /ofertar\s+(?:por\s+)?(?:la\s+)?l[ií]nea\s+de\s+producto|(?:pudiendo\s+(?:los\s+)?(?:proponentes|oferentes)?\s*)?(?:podr[aá]n?\s+|pueden\s+)?ofertar\s+(?:en\s+)?(?:una\s+o\s+m[aá]s|por)\s+l[ií]neas?|se\s+evaluar[aá]n?\s+por\s+l[ií]neas?(?:\s+de\s+producto)?|se\s+evaluar[aá]\s+cada\s+l[ií]nea(?:\s+de\s+manera\s+individual)?|cada\s+l[ií]nea\s+(?:se\s+evaluar[aá]|ser[aá]\s+evaluada)\s+de\s+manera\s+individual|se\s+evaluar[aá]n?\s+(?:[uú]nicamente\s+)?las\s+l[ií]neas\s+que|omitir\s+l[ií]neas\s+de\s+producto|completar\s+seg[uú]n\s+la\s+l[ií]nea|l[ií]nea\s+a\s+la\s+cual\s+postula|s[oó]lo\s+deber[aá]\s+completar\s+los\s+campos\s+en\s+aquellas\s+l[ií]neas|(?:campos\s+de\s+)?las\s+dem[aá]s\s+l[ií]neas\s+(?:deber[aá]\s+)?mantener|mantener\w*\s+en\s+blanco\s+(?:los\s+campos\s+de\s+)?las\s+dem[aá]s\s+l[ií]neas/i;
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
  const re = /ofertar\s+(?:por\s+)?(?:la\s+)?l[ií]nea\s+de\s+producto|(?:pudiendo\s+(?:los\s+)?(?:proponentes|oferentes)?\s*)?(?:podr[aá]n?\s+|pueden\s+)?ofertar\s+(?:en\s+)?(?:una\s+o\s+m[aá]s|m[aá]s\s+de\s+(?:un|una)|por)\s+l[ií]neas?|omitir\s+l[ií]neas\s+de\s+producto|completar\s+seg[uú]n\s+la\s+l[ií]nea|l[ií]nea\s+a\s+la\s+cual\s+postula|s[oó]lo\s+deber[aá]\s+completar\s+los\s+campos\s+en\s+aquellas\s+l[ií]neas|(?:campos\s+de\s+)?las\s+dem[aá]s\s+l[ií]neas\s+(?:deber[aá]\s+)?mantener|mantener\w*\s+en\s+blanco\s+(?:los\s+campos\s+de\s+)?las\s+dem[aá]s\s+l[ií]neas/i;
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
    /ofert\w+\s+(?:a|por|en)\s+(?:uno|una|dos)\s+o\s+m[aá]s\s+(?:[ií]tems?|l[ií]neas?)/i,
    // "podrán/pueden ofertar a|por|en {una|varias} [o más] {líneas|ítems}"
    /(?:podr[aá]n?|puede[n]?|pudiendo)\s+(?:\w+\s+){0,4}ofertar\s+(?:a|por|en)\s+(?:uno|una|varios|varias)\s+(?:o\s+m[aá]s\s+)?(?:[ií]tems?|l[ií]neas?)/i,
    // "ofertar a|por {una|varias|algunas} [o más] {líneas|ítems}"
    /ofertar\s+(?:a|por)\s+(?:uno|una|varios|varias|algunos|algunas)\s+(?:o\s+m[aá]s\s+)?(?:[ií]tems?|l[ií]neas?)/i,
    // Orden invertido "más de una/uno": "ofertar en más de una línea de servicio" (caso real
    // 1389488-29-LE26). Los patrones de arriba esperan "una o más"; este cubre "más de una".
    /(?:podr[aá]n?|puede[n]?|pudiendo)?\s*(?:\w+\s+){0,3}ofertar\s+(?:a|por|en)\s+m[aá]s\s+de\s+(?:un|uno|una)\s+(?:[ií]tems?|l[ií]neas?)/i,
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
    if (totalesPorLinea >= 2 || etiquetasLinea >= 2 || lineasConMonto >= 2) {
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
  const re = /l[ií]nea\s*n[°ºo]?\s*(\d{1,3})\s*<\/td>\s*<td[^>]*>\s*\d+\s*<\/td>\s*<td[^>]*>\s*[^<]*?<\/td>\s*<td[^>]*>\s*\$?\s*([\d][\d.,]*)\s*<\/td>/gi;
  for (const d of docs) {
    if (!d.texto || !/<tr[\s>]/i.test(d.texto)) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(d.texto)) !== null) {
      const linea = parseInt(m[1], 10);
      const monto = parseInt(m[2].replace(/[.,]/g, ''), 10);
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
export function extraerSeccionesLineaProducto(docs: { nombre?: string; texto?: string | null }[]): { linea: number; nombre: string; texto: string }[] {
  const re = /(?:(\d{1,2})\.(\d{1,2})\.?\s*)?L[ÍI]NEA\s+DE\s+PRODUCTO\s+N[°º]\s*(\d{1,2})\s*[:–\-]?\s*([^\n]{0,60})/gi;
  let mejor: { linea: number; nombre: string; texto: string }[] = [];
  let mejorPiso = 0;
  for (const d of docs) {
    const t = d.texto || '';
    if (t.length < 200) continue;
    const heads: { idx: number; linea: number; nombre: string }[] = [];
    let m: RegExpExecArray | null;
    // El nombre de sección puede venir seguido de comas CSV colgando (celdas vacías del Excel
    // exportado a texto, ej. `Mobiliario Urbano",,,,,,,`) — se recortan por prolijidad (no afecta
    // la extracción de ítems, que usa `texto`, solo la etiqueta que se muestra).
    while ((m = re.exec(t)) !== null) heads.push({ idx: m.index, linea: parseInt(m[3], 10), nombre: (m[4] || '').replace(/["'\s,]+$/, '').trim() });
    re.lastIndex = 0;
    if (heads.length < 2) continue;
    // Un mismo documento puede repetir el mismo número de línea varias veces (portada + tabla de
    // presupuesto + tabla de tiempos = 3 apariciones de "Línea N°1"), cada aparición mucho más chica
    // que la sección real. Nos quedamos SOLO con la aparición MÁS GRANDE de cada número de línea:
    // así una mención suelta de una línea no arrastra al piso hacia abajo si esa MISMA línea tiene
    // en otra parte del documento su sección real y grande.
    const porLinea = new Map<number, { linea: number; nombre: string; texto: string }>();
    for (let i = 0; i < heads.length; i++) {
      const start = heads[i].idx;
      let end = i + 1 < heads.length ? heads[i + 1].idx : t.length;
      // Última sección: cortar en el próximo título numerado "N.M TÍTULO" (FORMA DE ENTREGA, etc.).
      if (i + 1 >= heads.length) {
        const mNext = t.slice(start + 1, end).match(/\n\s*\d{1,2}\.\d{1,2}\.?\s+[A-ZÁÉÍÓÚ]{4,}/);
        if (mNext && mNext.index != null) end = start + 1 + mNext.index;
      }
      const texto = t.slice(start, Math.min(end, start + 16000));
      const prev = porLinea.get(heads[i].linea);
      if (!prev || texto.length > prev.texto.length) {
        porLinea.set(heads[i].linea, { linea: heads[i].linea, nombre: heads[i].nombre, texto });
      }
    }
    const out = [...porLinea.values()].sort((a, b) => a.linea - b.linea);
    if (out.length < 2) continue;
    const piso = Math.min(...out.map(s => s.texto.length));
    if (piso > mejorPiso) { mejorPiso = piso; mejor = out; }
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
  // otro número. Cantidad = 1 (catálogo de precios unitarios; el Excel necesita una cantidad base).
  const porNumero = new Map<number, ItemPlanilla>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const numero = parseInt(m[1], 10);
    const desc = limpiarCelda(m[3]).replace(/\s+/g, ' ');
    if (desc.length < 3 || !/[a-záéíóúñ]/i.test(desc)) continue;
    if (PALABRAS_NO_ITEM.test(desc)) continue;
    if (!porNumero.has(numero)) {
      porNumero.set(numero, { linea: 1, categoria: null, numero, descripcion: desc, unidad: 'Unidad', cantidad: 1 });
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
    // OCR ("25 MTS", "01 ROLLO", "04 Tineta").
    const cantRaw = col.cant >= 0 ? limpiarCelda(celdas[col.cant] || '') : '';
    const mCant = cantRaw.match(/^(\d{1,5})\s*(.*)$/);
    const cantidad = mCant ? parseInt(mCant[1], 10) : null;
    let unidad = col.unidad >= 0 ? limpiarCelda(celdas[col.unidad] || '') : '';
    if (!unidad && mCant && mCant[2]) unidad = mCant[2].trim();

    // Sin correlativo NI cantidad: puede ser una nota/observación arrastrada ("DEBERÁ MENCIONAR EL
    // TIEMPO DE ENTREGA…") o una fila de CATÁLOGO sin cantidades. FIRMA DEL CATÁLOGO: solo la celda
    // de descripción (y a lo más la de unidad) trae contenido y el resto viene VACÍO — las tablas
    // administrativas (etapas, puntajes, formularios) llenan varias columnas y quedan fuera.
    if (numero == null && cantidad == null) {
      const soloDescripcion = celdas.every((c, i) => i === col!.desc || i === col!.unidad || !limpiarCelda(c));
      if (soloDescripcion && desc.length <= 90) {
        catalogo.push({ linea: 1, categoria: null, numero: null, descripcion: desc, unidad: unidad || 'Unidad', cantidad: 1 });
      }
      continue;
    }

    const item: ItemPlanilla = { linea: 1, categoria: null, numero, descripcion: desc, unidad, cantidad };
    // Dedupe por correlativo (la tabla suele venir repetida: resumen + anexo económico).
    if (numero != null) {
      if (!porNumero.has(numero)) { porNumero.set(numero, item); items.push(item); }
    } else {
      items.push(item);
    }
  }

  // MODO CATÁLOGO: hubo header de planilla ("Bienes o Servicios Requeridos | Cantidad | …") pero
  // casi ninguna fila trajo correlativo/cantidad → es un catálogo de suministro (contrato marco de
  // ferretería/construcción): cada fila ES un producto a costear con cantidad base 1. Se exige un
  // volumen alto (≥15 tras dedupe) para no confundir notas sueltas con un catálogo real.
  if (vistoHeader && items.length < 8 && catalogo.length >= 15) {
    const vistos = new Set<string>();
    const itemsCat = catalogo.filter(i => {
      const k = i.descripcion.toUpperCase();
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
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

function parsearDoc(doc: DocTexto): PlanillaParseResult | null {
  const lineas = doc.texto.split(/\r?\n/);
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
  return /detalle|descrip/i.test(doc.texto) && /\bcant/i.test(doc.texto);
}

// Recorre los documentos candidatos y devuelve el MEJOR resultado (más ítems; a igualdad,
// el que detecte líneas y luego categorías). Si ninguno califica → null.
export function parsearPlanillaCosteo(docs: DocTexto[]): PlanillaParseResult | null {
  let mejor: PlanillaParseResult | null = null;
  for (const doc of docs) {
    if (!doc.texto || doc.texto.length < 40) continue;
    if (!esCandidato(doc)) continue;
    // Orden: tablas HTML (GLM-OCR de escaneados) → catálogo valor unitario → parser tabular normal.
    const r = parsearTablasHtml(doc) || parsearCatalogoValorUnitario(doc) || parsearDoc(doc);
    if (!r) continue;
    const mejorScore = (m: PlanillaParseResult) => m.items.length * 100 + m.lineas.length * 10 + m.categorias.length;
    if (!mejor || mejorScore(r) > mejorScore(mejor)) mejor = r;
  }
  return mejor;
}
