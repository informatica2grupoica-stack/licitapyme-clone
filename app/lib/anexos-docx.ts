// app/lib/anexos-docx.ts
// Frente E.1 — utilidades de bajo nivel para rellenar un anexo .docx REAL (bajado de Mercado
// Público) SIN alterar su formato. Consolida lo validado con 4 documentos reales de 4
// organismos distintos (ver docs/BITACORA-CAMBIOS-VIABILIDAD.md, entrada Frente E):
//
//   · Un .docx es un ZIP con XML adentro (word/document.xml). Rellenar = editar SOLO ese
//     archivo, dejando estilos/tema/fuentes/imágenes exactamente iguales (se verifica con
//     hash, no "se ve parecido").
//   · Regla crítica intocable del plan: el conteo de párrafos antes y después debe ser
//     IDÉNTICO — nunca se agrega ni se quita un <w:p>, solo se le mete un <w:r> adentro (a
//     uno vacío) o se edita el texto de uno que ya tenía contenido.
//   · No todos los .docx reales traen w14:paraId (1 de 4 documentos probados no lo traía) —
//     normalizarParaIds() lo agrega antes de procesar, de forma segura (agregar un atributo
//     no cambia nada visible ni el conteo).
//
// Tres patrones de "blanco" encontrados en documentos reales — cada uno tiene su función:
//   1. Celda de tabla vacía junto a una etiqueta         → rellenarCeldaVacia()
//   2. Subrayado (____) dentro de una misma oración      → rellenarInline()
//   3. Opción a marcar ("es ____ / no es ____")          → rellenarOpcion() — SIEMPRE
//      categoría B: nunca se autocompleta sola una declaración jurada.
import JSZip from 'jszip';

export interface Parrafo {
  paraId: string;
  texto: string;
  vacio: boolean;   // sin ningún <w:r> adentro (candidato a "celda para rellenar")
  indice: number;   // posición en el documento, en orden de aparición
  centrado: boolean; // <w:jc w:val="center"> — señal de encabezado/título, no de etiqueta de campo
}

function xmlEscape(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// El inverso de xmlEscape: lo que hay DENTRO de un <w:t> viene escapado, así que el texto crudo
// del regex no es el texto que ve el usuario en Word.
//
// BUG REAL (1057480-41-LP26, anexos 2/3/4): el marcador que el organismo dejó para que el oferente
// escriba su nombre es literalmente "<<NOMBRE PERSONA NATURAL O PERSONA JURIDICA>>" — en el XML,
// "&lt;&lt;NOMBRE …&gt;&gt;". Sin decodificar, ningún patrón que busque "<<" lo encuentra nunca.
// Y hay un segundo daño, más silencioso: las POSICIONES. detectarBlancosInline calcula el offset
// del blanco sobre el texto crudo (donde "&amp;" ocupa 5 caracteres) y rellenarRunPorIndice
// escribía sobre ese mismo texto crudo para después RE-escaparlo entero — o sea que cualquier
// párrafo con una entidad terminaba con "&amp;lt;" (doble escape) visible en el Word entregado.
// Decodificar al leer y escapar UNA sola vez al escribir cierra los dos problemas de una.
export function decodificarXml(s: string): string {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');   // SIEMPRE al final: "&amp;lt;" es el texto literal "&lt;", no "<"
}

// Texto plano de una lista de <w:t> ya extraídos del XML — el mismo criterio en todos los lugares
// que leen texto (párrafos, celdas, runs) para que ninguno vea entidades sin decodificar.
export function textoDeRuns(cuerpo: string): string {
  return decodificarXml([...cuerpo.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join(''));
}

// ── Namespaces: declararlos EN LA RAÍZ, que es el único alcance que cubre todo el documento ──
// BUG REAL encontrado y corregido acá: antes se preguntaba `/xmlns:a=/.test(xml)` sobre TODO el
// XML. Los documentos con dibujos propios declaran el prefijo LOCALMENTE en el elemento que lo usa
// (`<a:graphic xmlns:a="…">`) y NADA en la raíz — lo hace LibreOffice al convertir un .doc y también
// Word en sus .docx (verificado en los dos casos reales: 4291-38-LP26 venía de .doc convertido,
// 1738-18-LE26 era un .docx hecho con Word; ambos con xmlns:a solo local). El chequeo
// global veía esa declaración local, concluía "ya está" y dejaba la raíz intacta — así que nuestro
// <a:graphicFrameLocks>, insertado en OTRO párrafo, quedaba fuera del alcance de esa declaración:
// prefijo sin definir y Word rechazaba el archivo completo ("Namespace prefix a on
// graphicFrameLocks is not defined"). Verificar que las etiquetas calcen NO detecta esto — hay que
// validar los namespaces. Regresión fijada en __tests__/anexos-docx-namespaces.test.mts.
function declararNamespacesEnRaiz(xml: string, ns: Record<string, string>): string {
  const raiz = xml.match(/<w:document\b[^>]*>/);
  if (!raiz || raiz.index === undefined) return xml;
  // `xmlns:a\s*=` no calza con `xmlns:a16=` — el \s*= exige que el prefijo termine ahí.
  const faltantes = Object.entries(ns).filter(([p]) => !new RegExp(`xmlns:${p}\\s*=`).test(raiz[0]));
  if (!faltantes.length) return xml;
  const decls = faltantes.map(([p, uri]) => ` xmlns:${p}="${uri}"`).join('');
  const raizNueva = raiz[0].replace(/^<w:document\b/, `<w:document${decls}`);
  return xml.slice(0, raiz.index) + raizNueva + xml.slice(raiz.index + raiz[0].length);
}

// ── Normalización: agrega w14:paraId a los párrafos que no lo traigan ────────────────────
export function normalizarParaIds(xml: string): { xml: string; agregados: number } {
  const usados = new Set(
    [...xml.matchAll(/w14:paraId="([0-9A-Fa-f]+)"/g)].map(m => m[1].toUpperCase()),
  );
  let agregados = 0;
  const idAleatorio = () => {
    let id: string;
    do { id = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8, '0'); }
    while (usados.has(id));
    usados.add(id);
    return id;
  };

  xml = declararNamespacesEnRaiz(xml, { w14: 'http://schemas.microsoft.com/office/word/2010/wordml' });

  // Un párrafo VACÍO puede venir AUTOCERRADO (<w:p w:rsidR="0034565C" w:rsidRDefault="0034565C"/>)
  // — caso real en 2 de 40 documentos de la base. Se expande a <w:p …></w:p> antes de tocar nada.
  // BUG REAL que esto corrige: el replace de abajo lo tomaba como apertura y dejaba el "/" en medio
  // (`<w:p …/ w14:paraId="…">`), XML que Word rechaza igual que el de los namespaces; y además el
  // resto del módulo (listarParrafos, listarBloquesCrudos en anexos-dividir) asume que todo <w:p>
  // tiene su </w:p>, así que un autocerrado desalineaba los índices de párrafo hacia adelante. No
  // altera la verificación de integridad: contarParrafos() cuenta aperturas <w:p, y sigue habiendo
  // una sola. Para Word un párrafo vacío autocerrado y uno con cierre vacío son idénticos.
  xml = xml.replace(/<w:p\b([^>]*)\/>/g, '<w:p$1></w:p>');

  xml = xml.replace(/<w:p\b([^>]*)>/g, (m, attrs) => {
    if (/w14:paraId=/.test(attrs)) return m;
    agregados++;
    return `<w:p${attrs} w14:paraId="${idAleatorio()}" w14:textId="77777777">`;
  });
  return { xml, agregados };
}

// ── ¿Está vacío este párrafo (es un blanco a rellenar)? ──────────────────────────────────
// "Vacío" = SIN TEXTO, no "sin runs".
//
// BUG REAL encontrado el 30-jul-2026, y la razón por la que el relleno andaba en las pruebas
// locales pero no en producción: la regla anterior era `!/<w:r[ >]/` —no tiene ningún <w:r>—, que
// vale para el XML que genera Word, donde una celda vacía no trae runs. LibreOffice (el conversor
// de .doc del VPS, o sea TODOS los .doc reales) escribe esas mismas celdas con un `<w:r>` que
// carga el formato pero ningún `<w:t>`. Con ese XML no se veía ni una celda vacía en todo el
// documento: cero candidatos, la vista de tabla desaparecía y no se autocompletaba nada — solo
// sobrevivían los patrones que no dependen de celdas (blanco inline y "Etiqueta:"), que es
// exactamente lo que se veía en pantalla. Medido con los dos XML lado a lado: 2 candidatos contra 0.
//
// Un párrafo que contiene una IMAGEN u objeto tampoco tiene texto, pero no es un blanco: es, entre
// otras cosas, donde ya se estampó una firma. Se excluye explícitamente para no escribir encima.
const RE_CONTENIDO_NO_TEXTUAL = /<w:(drawing|pict|object)\b/;

export function parrafoEstaVacio(cuerpo: string): boolean {
  if (RE_CONTENIDO_NO_TEXTUAL.test(cuerpo)) return false;
  return [...cuerpo.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('').trim() === '';
}

// ── Lectura: lista todos los párrafos del documento, en orden ────────────────────────────
export function listarParrafos(xml: string): Parrafo[] {
  const matches = [...xml.matchAll(/<w:p\b[^>]*w14:paraId="([0-9A-Fa-f]+)"[^>]*>([\s\S]*?)<\/w:p>/g)];
  return matches.map(([, paraId, cuerpo], indice) => ({
    paraId,
    texto: textoDeRuns(cuerpo).trim(),
    vacio: parrafoEstaVacio(cuerpo),
    indice,
    centrado: /<w:jc\s+w:val="center"/.test(cuerpo),
  }));
}

export function contarParrafos(xml: string): number {
  return (xml.match(/<w:p\b/g) || []).length;
}

// ── Cuadros de texto flotantes con respaldo VML duplicado ───────────────────────────────
// Word declara CADA cuadro de texto flotante (firma, sello, leyenda superpuesta) DOS VECES: una
// versión moderna (`<mc:Choice Requires="wps">`, DrawingML) y una versión VML antigua
// (`<mc:Fallback>`) por si el programa que abre el archivo no entiende la moderna — la norma de
// compatibilidad de Office dice usar SOLO UNA, nunca las dos a la vez, y cualquier Word real
// ignora el Fallback en cuanto entiende el Choice (siempre, en cualquier versión moderna).
//
// BUG REAL (1227338-6-LE26, "FIRMA REPRESENTANTE LEGAL"): como el resto de este módulo no sabe
// de esta regla, veía las DOS copias del mismo texto como si fueran contenido real y distinto —
// (a) la vista previa del anexo mostraba el bloque de firma DOS VECES, y (b) al dividir el
// documento por formulario (ver anexos-dividir.ts) el corte a veces caía a mitad de una de las
// dos copias y el archivo quedaba corrupto ("Word detectó un error de contenido").
// Se elimina el `<mc:Fallback>` completo y se desenvuelve el `<mc:Choice>` que queda —ya no hace
// falta el envoltorio de "elegir" si no hay entre qué elegir—, dejando SOLO la copia moderna.
// Mismo resultado visual que abrir el .docx en cualquier Word real: nunca se pierde contenido
// que se vería, solo el duplicado que ningún programa real muestra.
//
// Se aplica ANTES de normalizarParaIds/contar párrafos —en las DOS rutas, análisis y
// generación— para que la comparación de integridad (verificarParrafos) mida desde esta MISMA
// base achicada, y no contra el original con el duplicado todavía adentro (que marcaría como
// "perdido" un párrafo que nunca fue contenido real).
export function eliminarRespaldoVmlDuplicado(xml: string): string {
  return xml.replace(
    /<mc:AlternateContent\b[^>]*>\s*<mc:Choice\b[^>]*>([\s\S]*?)<\/mc:Choice>\s*<mc:Fallback\b[^>]*>[\s\S]*?<\/mc:Fallback>\s*<\/mc:AlternateContent>/g,
    '$1',
  );
}

// ── Patrón 1: celda de tabla vacía ───────────────────────────────────────────────────────
// Inserta el valor DENTRO del <w:p> vacío identificado por su paraId — nunca agrega/quita
// párrafo. Reutiliza el rPr existente para heredar la misma fuente que el resto del formulario.
//
// Un párrafo "vacío" puede venir de dos formas según quién generó el .docx (ver parrafoEstaVacio):
// sin ningún run (Word) o con un run que carga el formato pero sin <w:t> (LibreOffice). Los dos
// casos se rellenan; en el segundo el <w:t> se mete DENTRO del run que ya está, que es lo que
// preserva el formato original de esa celda.
export function rellenarCeldaVacia(xml: string, paraId: string, valor: string): string {
  const re = new RegExp(`(<w:p\\b[^>]*w14:paraId="${paraId}"[^>]*>)([\\s\\S]*?)(<\\/w:p>)`);
  const m = xml.match(re);
  if (!m) throw new Error(`No se encontró el párrafo w14:paraId="${paraId}"`);
  const [entero, apertura, cuerpo, cierre] = m;
  // El guard mira el TEXTO, no los runs: con la regla vieja, un párrafo de LibreOffice con un run
  // vacío se tomaba por "ya tiene contenido" y el relleno moría con una excepción.
  if (!parrafoEstaVacio(cuerpo)) throw new Error(`El párrafo ${paraId} ya tiene contenido — no se pisa un dato existente`);

  const texto = `<w:t xml:space="preserve">${xmlEscape(valor)}</w:t>`;
  let cuerpoNuevo: string;
  // OJO con el nombre de la etiqueta: `<w:t[^>]*/>` NO significa "un <w:t/> vacío", significa
  // "cualquier etiqueta que EMPIECE con <w:t" — y en WordprocessingML eso incluye <w:tab/>,
  // <w:tblPr/>, <w:tcW/>, <w:top/>, <w:trHeight/>… BUG REAL (1058086-43-LP26, FORMULARIO N°1): los
  // párrafos vacíos del formulario traen <w:pPr><w:tabs><w:tab w:val="left" w:pos="567"/></w:tabs>,
  // así que el relleno pisaba la DEFINICIÓN DE TABULACIÓN con <w:t>Razón Social</w:t>. El XML queda
  // bien formado (por eso pasaba el chequeo y hasta python-docx lo abría), pero es inválido contra
  // el esquema —un <w:t> no puede vivir dentro de <w:tabs>— y Word se niega a abrir el archivo
  // entero: "Word detectó un error al intentar abrir el archivo". Solo N1 se veía afectado porque
  // es el único formulario con párrafos vacíos con tabulaciones declaradas.
  // El `(?:\s[^>]*)?` exige que después de `w:t` venga un espacio (o el cierre directo), que es lo
  // que separa la etiqueta <w:t> de toda la familia <w:tXxx>.
  const conTVacio = cuerpo.match(/<w:t(?:\s[^>]*)?\/>|<w:t(?:\s[^>]*)?><\/w:t>/);
  const runs = [...cuerpo.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)];
  if (conTVacio) {
    cuerpoNuevo = cuerpo.replace(conTVacio[0], texto);            // ya hay un <w:t> vacío: se llena
  } else if (runs.length) {
    // Run sin <w:t> (LibreOffice). El texto va DENTRO de ese run para heredar su formato; si el
    // run no trae rPr propio se le presta el de la marca de párrafo (<w:pPr><w:rPr>), que es el
    // formato de la celda — sin esto el valor puede salir con la fuente por defecto del documento
    // en vez de la del formulario.
    const ultimo = runs[runs.length - 1][0];
    const rPrPropio = /<w:rPr>/.test(ultimo);
    const rPrParrafo = cuerpo.match(/<w:pPr>[\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:pPr>/);
    const conFormato = rPrPropio || !rPrParrafo
      ? ultimo.replace(/<\/w:r>$/, `${texto}</w:r>`)
      : ultimo.replace(/^<w:r\b([^>]*)>/, `<w:r$1>${rPrParrafo[1]}`).replace(/<\/w:r>$/, `${texto}</w:r>`);
    cuerpoNuevo = cuerpo.replace(ultimo, conFormato);
  } else {
    const rPrMatch = cuerpo.match(/<w:pPr>[\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:pPr>/);
    cuerpoNuevo = `${cuerpo}<w:r>${rPrMatch ? rPrMatch[1] : ''}${texto}</w:r>`; // sin runs (Word)
  }
  return xml.slice(0, m.index) + apertura + cuerpoNuevo + cierre + xml.slice((m.index ?? 0) + entero.length);
}

// ── Patrón 5: etiqueta que termina en ":" y el valor va A CONTINUACIÓN, en la misma línea ──
// Distinto de rellenarCeldaVacia (párrafo vacío al lado de la etiqueta) y del blanco inline (una
// raya de guiones que se sobrescribe): acá el párrafo TIENE texto —la etiqueta— y no hay ni celda
// ni raya, solo el espacio después de los dos puntos.
//
// Caso real 4291-38-LP26, FORMULARIO N°2 (oferta económica): "Nombre o Razón Social       :" y
// "RUT:" son párrafos sueltos, uno detrás del otro, sin celda vacía ni subrayado. Ninguno de los
// patrones anteriores los veía, así que el formulario 2 se entregaba sin identificar al oferente
// aunque el sistema tuviera el dato — el reclamo de "lo automático no llega a todos los anexos".
//
// Agrega un run al final del párrafo (nunca un <w:p>: el conteo de párrafos debe quedar idéntico,
// regla intocable del módulo) heredando el formato del último run existente, para que el valor se
// vea con la misma letra que la etiqueta.
export function rellenarFinDeParrafo(xml: string, paraId: string, valor: string): string {
  const re = new RegExp(`(<w:p\\b[^>]*w14:paraId="${paraId}"[^>]*>)([\\s\\S]*?)(<\\/w:p>)`);
  const m = xml.match(re);
  if (!m) throw new Error(`No se encontró el párrafo w14:paraId="${paraId}"`);
  const [entero, apertura, cuerpo, cierre] = m;
  const runs = [...cuerpo.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)];
  const rPrMatch = runs.length ? runs[runs.length - 1][0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) : null;
  const run = `<w:r>${rPrMatch ? rPrMatch[0] : ''}<w:t xml:space="preserve"> ${xmlEscape(valor)}</w:t></w:r>`;
  return xml.slice(0, m.index) + apertura + cuerpo + run + cierre + xml.slice((m.index ?? 0) + entero.length);
}

// ── Patrones 2 y 3: blancos DENTRO de un mismo <w:t> (subrayado inline / opción a marcar) ─
export interface BlancoInline {
  posEnTexto: number;   // posición del inicio del blanco, dentro del <w:t> YA DECODIFICADO
  largo: number;        // cuántos caracteres ocupa el blanco (guiones, puntos, o el marcador entero)
  contexto: string;     // texto inmediatamente anterior (para mostrarle al humano de qué campo se trata)
  // Solo para los blancos con MARCADOR (patrón 2b, ver abajo): lo que el organismo escribió
  // adentro, sin los delimitadores — "Insertar Nombre o Razón Social", "fecha", "indicar en esta
  // casilla el número del documento…". Es la instrucción literal de qué va ahí, así que vale más
  // que cualquier contexto inferido: se le pasa tal cual al motor de IA y se le muestra al humano.
  textoMarcador?: string;
}

// ── Patrón 2b: MARCADORES de relleno (no todo blanco es una raya de guiones) ──────────────
// Caso real 1057480-41-LP26 (Hospital San José de Melipilla): sus 11 anexos no usan "____" casi en
// ninguna parte. Usan cuatro formas distintas de decir "acá escribe tú", y NINGUNA la veía el
// patrón 2, que solo conocía "_{4,}" — así que los anexos 2, 3, 4, 10 y 11 completos entraban al
// motor con CERO casillas detectadas y salían idénticos al original:
//   · "<<NOMBRE PERSONA NATURAL O PERSONA JURIDICA>>"   (anexos 2, 3 y 4)
//   · "[Insertar RUT]", "[Nombre Completo del Representante Legal]", "[fecha]"   (anexos 4 y 11)
//   · "[indicar “en esta casilla” número o nombre del documento…]"   (anexo 6 — instrucción, la
//     llena el humano; lo importante es que APAREZCA como pendiente, no que se autocomplete)
//   · "Yo, ..............RUT N°.............."   (anexo 10, línea de puntos en vez de guiones)
//
// Condiciones para no barrer texto legal normal: el marcador debe traer al menos una LETRA adentro
// (descarta notas al pie "[1]", referencias "[2-4]") y no puede anidar otro delimitador del mismo
// tipo. Un falso positivo acá no escribe nada malo en el documento: la casilla queda como pendiente
// para que la vea un humano, que es exactamente el peor caso aceptable.
const RE_MARCADORES = [
  /<<([^<>]{2,200}?)>>/g,        // <<NOMBRE PERSONA NATURAL O PERSONA JURIDICA>>
  /«([^«»]{2,200}?)»/g,          // variante tipográfica de lo mismo
  /\{\{([^{}]{2,200}?)\}\}/g,    // {{razon_social}} — plantillas
  /\[([^[\]]{2,200}?)\]/g,       // [Insertar RUT] / [fecha] / [indicar “en esta casilla”…]
];
const RE_LETRA = /[A-Za-zÀ-ÿ]/;

// Blancos "de raya": guiones bajos (lo de siempre), líneas de PUNTOS, y líneas del carácter
// ELIPSIS "…" (U+2026, UN SOLO carácter que Word/el usuario tipea como "..." y autocorrige a un
// glifo). BUG REAL (3713-7-LE26): "Plazo de entrega" / "Garantía" rellenan con "…………………" (7
// elipsis seguidos) — invisibles para este regex hasta ahora, así que NI se ofrecían para
// autocompletar NI aparecían pendientes para rellenar a mano: el campo entero desaparecía. El
// umbral de los puntos ASCII es más alto (6) que el de los guiones (4) a propósito: tres puntos
// son puntos suspensivos y cuatro pueden ser un "etc...." mal escrito, mientras que nadie escribe
// seis puntos seguidos salvo para dejar una línea para llenar — mismo criterio en elipsis: 2+
// (cada glifo ya "vale" 3 puntos, así que 2 equivalen al umbral de 6).
const RE_RAYAS = /_{4,}|\.{6,}|…{2,}/g;

// Encuentra, en un <w:t> YA DECODIFICADO (ver decodificarXml), cada blanco con su contexto previo.
export function listarBlancosInline(textoRun: string): BlancoInline[] {
  const crudos: { pos: number; largo: number; textoMarcador?: string }[] = [];
  for (const m of textoRun.matchAll(RE_RAYAS)) crudos.push({ pos: m.index!, largo: m[0].length });
  for (const re of RE_MARCADORES) {
    for (const m of textoRun.matchAll(re)) {
      const dentro = m[1].trim();
      if (!RE_LETRA.test(dentro)) continue;
      crudos.push({ pos: m.index!, largo: m[0].length, textoMarcador: dentro });
    }
  }
  // Un marcador puede contener una raya adentro ("[fecha: ____]") y dos marcadores nunca se
  // solapan entre sí — se ordena por posición y se descarta cualquier blanco que caiga DENTRO de
  // otro ya aceptado, para no ofrecer la misma casilla dos veces ni pisar una edición con otra.
  crudos.sort((a, b) => a.pos - b.pos || b.largo - a.largo);
  const out: BlancoInline[] = [];
  let finAceptado = -1;
  let ultimo = 0;
  for (const c of crudos) {
    if (c.pos < finAceptado) continue;
    const previo = textoRun.slice(ultimo, c.pos);
    const contexto = (previo.split(/[,.;]|\(\*+\)/).pop() || previo).trim().slice(-40);
    out.push({ posEnTexto: c.pos, largo: c.largo, contexto, ...(c.textoMarcador ? { textoMarcador: c.textoMarcador } : {}) });
    finAceptado = c.pos + c.largo;
    ultimo = finAceptado;
  }
  return out;
}

// ── Pre-paso obligatorio del patrón 2b: juntar en UN solo <w:t> los marcadores partidos ──
// Word parte un párrafo en varios <w:r> por cualquier motivo cosmético (revisión ortográfica,
// un cambio de idioma, un rsid distinto). En el documento real 1057480-41-LP26 eso deja el MISMO
// marcador repartido entre runs:
//     anexo 3 → run1="<<NOMBRE PERSONA NATURAL O PERSONA JURIDICA"  run2=">>, declara…"
//     anexo 4 → run4=" <<"  run5="NOMBRE PERSONA NATURAL O PERSONA JURIDICA"  run6=">>, integrante…"
// El resto del módulo (detectarBlancosInline → rellenarRunPorIndice) trabaja SIEMPRE dentro de un
// run: es lo que garantiza que se edita texto existente y nunca se agrega ni se quita un <w:p>. Un
// marcador partido, por lo tanto, es invisible para la detección y no habría forma de reemplazarlo
// con una sola edición.
//
// Esto lo resuelve ANTES de detectar, moviendo caracteres entre <w:t> hermanos: el marcador entero
// queda en el PRIMER run que lo tocaba y se borra de los siguientes. NO se agregan ni se quitan
// runs (el conteo de <w:t> queda idéntico, así que los índices globales siguen valiendo) y el texto
// total del párrafo tampoco cambia — solo cambia en qué run vive cada carácter. El formato que
// pierde la cola del marcador da igual: ese texto se reemplaza entero por el dato real.
export function unificarRunsDeMarcadores(xml: string): string {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, parrafo => {
    const runs = [...parrafo.matchAll(/<w:t([^>]*)>([^<]*)<\/w:t>/g)];
    if (runs.length < 2) return parrafo;

    const textos = runs.map(r => decodificarXml(r[2]));
    const completo = textos.join('');
    const inicios: number[] = [];
    let acc = 0;
    for (const t of textos) { inicios.push(acc); acc += t.length; }
    const runDe = (pos: number) => {
      let k = 0;
      for (let i = 0; i < inicios.length; i++) if (pos >= inicios[i]) k = i;
      return k;
    };

    // Tramos de marcador que cruzan runs. Se juntan TODOS primero y recién después se reparte el
    // texto: reescribir run por run sobre la marcha dejaría los offsets del siguiente marcador
    // corridos respecto del texto original.
    const tramos: { desde: number; hasta: number; run: number }[] = [];
    for (const re of RE_MARCADORES) {
      for (const m of completo.matchAll(re)) {
        if (!RE_LETRA.test(m[1])) continue;
        const primerRun = runDe(m.index!);
        if (primerRun === runDe(m.index! + m[0].length - 1)) continue; // ya vive entero en un run
        tramos.push({ desde: m.index!, hasta: m.index! + m[0].length, run: primerRun });
      }
    }
    if (!tramos.length) return parrafo;

    // Cada carácter va al run que le toca por posición, salvo los que caen dentro de un tramo:
    // esos se acumulan todos en el primer run del tramo. El texto total no cambia nunca.
    const nuevos: string[] = textos.map(() => '');
    for (let pos = 0; pos < completo.length; pos++) {
      const tramo = tramos.find(t => pos >= t.desde && pos < t.hasta);
      nuevos[tramo ? tramo.run : runDe(pos)] += completo[pos];
    }

    // Se reescribe de atrás hacia adelante para que los offsets de los runs anteriores no se corran.
    let salida = parrafo;
    for (let k = runs.length - 1; k >= 0; k--) {
      if (nuevos[k] === textos[k]) continue;
      const r = runs[k];
      const attrs = /xml:space=/.test(r[1]) ? r[1] : `${r[1]} xml:space="preserve"`;
      salida = salida.slice(0, r.index) + `<w:t${attrs}>${xmlEscape(nuevos[k])}</w:t>` + salida.slice(r.index! + r[0].length);
    }
    return salida;
  });
}

// Reemplaza, DENTRO de un <w:t> concreto (identificado por su texto original exacto, que
// debe ser único en el documento — normalmente lo es porque son oraciones largas), la
// corrida de guiones en `pos`/`largo` por `valor`. Si el carácter justo antes NO es espacio,
// antepone uno (si no, queda pegado: "Yo____" → "YoJuan" en vez de "Yo Juan" — bug real
// encontrado y corregido en las pruebas).
export function rellenarInline(xml: string, textoRunOriginal: string, pos: number, largo: number, valor: string): string {
  const charPrevio = textoRunOriginal[pos - 1] || '';
  const valorFinal = /[A-Za-zÀ-ÿ0-9]/.test(charPrevio) ? ' ' + valor : valor;
  const textoNuevo = textoRunOriginal.slice(0, pos) + valorFinal + textoRunOriginal.slice(pos + largo);

  const patronRun = new RegExp(`<w:t([^>]*)>${escaparRegex(textoRunOriginal)}</w:t>`);
  const m = xml.match(patronRun);
  if (!m) throw new Error('No se encontró el run original — el texto pudo haber cambiado');
  // BUG REAL (1058086-43-LP26, varios de los ANEXOS separados salían con "hay un problema con el
  // contenido" al abrir en Word): el run original YA trae `xml:space="preserve"` cuando el blanco
  // tiene espacios pegados (el caso normal), y esto lo agregaba OTRA VEZ sin chequear — el XML
  // quedaba con el atributo DUPLICADO (`<w:t xml:space="preserve" xml:space="preserve">`), que es
  // válido para un regex ingenuo pero NO para un parser XML estricto (Word lo rechaza de plano).
  // Mismo criterio que ya usaba unificarRunsDeMarcadores más abajo — nunca agregar el atributo si
  // ya está.
  const attrs = /xml:space=/.test(m[1]) ? m[1] : `${m[1]} xml:space="preserve"`;
  const runNuevo = `<w:t${attrs}>${xmlEscape(textoNuevo)}</w:t>`;
  return xml.replace(m[0], runNuevo);
}

// Patrón 3 (opción a marcar) usa la MISMA mecánica que rellenarInline: se le pasa "X" como
// valor y la posición/largo del blanco elegido. Se mantiene como alias con nombre propio
// porque semánticamente es una decisión distinta (ver anexos-detectar.ts: categoría B
// siempre, nunca se autocompleta una declaración jurada sin que un humano la confirme).
export const rellenarOpcion = rellenarInline;

// Variante para la pantalla real: ubica el run por su POSICIÓN de aparición (indiceRun, el
// mismo índice que produce detectarBlancosInline al iterar todos los <w:t> del documento) en
// vez de buscarlo por el texto que contenía. rellenarInline() busca por texto y solo reemplaza
// la primera coincidencia — ambiguo si la misma frase se repite en el documento (ej. "Firma
// representante legal:____" aparece una vez por anexo). Por índice no hay ambigüedad posible.
//
// Recibe TODAS las ediciones de un mismo run juntas y las aplica de derecha a izquierda (mayor
// `pos` primero): si se aplicaran de a una con re-búsqueda por texto, la primera edición
// cambiaría el texto y la segunda ya no encontraría su posición original.
export function rellenarRunPorIndice(
  xml: string,
  indiceRun: number,
  ediciones: { pos: number; largo: number; valor: string }[],
): string {
  const matches = [...xml.matchAll(/<w:t([^>]*)>([^<]*)<\/w:t>/g)];
  const m = matches[indiceRun];
  if (!m) throw new Error(`No se encontró el run de índice ${indiceRun}`);
  const [entero, attrs, textoCrudo] = m;
  // Se edita sobre el texto DECODIFICADO — las posiciones de las ediciones vienen de
  // detectarBlancosInline, que también lee decodificado. Sin esto, un párrafo con entidades tenía
  // los offsets corridos y el resultado quedaba doble-escapado (ver decodificarXml).
  const textoOriginal = decodificarXml(textoCrudo);

  let textoNuevo = textoOriginal;
  for (const { pos, largo, valor } of [...ediciones].sort((a, b) => b.pos - a.pos)) {
    const charPrevio = textoNuevo[pos - 1] || '';
    const charSiguiente = textoNuevo[pos + largo] || '';
    // Separación por los DOS lados. La de la izquierda ya estaba; la de la derecha se agregó al ver
    // el resultado real del anexo 10 de 1057480-41-LP26, cuyos blancos son líneas de puntos pegadas
    // a la palabra que sigue ("Yo, ............RUT N°............"): sin ella el documento salía con
    // "Inversiones Claro ARZ SPARUT N°76.902.659-2" todo junto.
    // "°"/"º" cuentan como letra para esto: "RUT N°76.902.659-2" es el mismo defecto visual.
    const valorFinal = (/[A-Za-zÀ-ÿ0-9°º]/.test(charPrevio) ? ' ' : '')
      + valor
      + (/[A-Za-zÀ-ÿ0-9]/.test(charSiguiente) ? ' ' : '');
    textoNuevo = textoNuevo.slice(0, pos) + valorFinal + textoNuevo.slice(pos + largo);
  }

  // BUG REAL (1058086-43-LP26): mismo problema que rellenarInline — el run original casi siempre
  // YA trae `xml:space="preserve"` (cualquier blanco con espacios alrededor lo fuerza), así que
  // agregarlo sin chequear deja el atributo DUPLICADO y Word rechaza el .docx entero al abrirlo
  // ("hay un problema con el contenido"). Esta es la función que usa generarAnexoFinal para TODO
  // blanco inline, así que el bug afectaba cualquier anexo con al menos un blanco de ese tipo.
  const attrsFinal = /xml:space=/.test(attrs) ? attrs : `${attrs} xml:space="preserve"`;
  const runNuevo = `<w:t${attrsFinal}>${xmlEscape(textoNuevo)}</w:t>`;
  return xml.slice(0, m.index) + runNuevo + xml.slice((m.index ?? 0) + entero.length);
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Verificación de integridad: conteo de párrafos + hash de todo lo que NO es texto ──────
export interface ReporteIntegridad { parrafosIguales: boolean; parrafosAntes: number; parrafosDespues: number; }

export function verificarParrafos(xmlAntes: string, xmlDespues: string): ReporteIntegridad {
  const parrafosAntes = contarParrafos(xmlAntes);
  const parrafosDespues = contarParrafos(xmlDespues);
  return { parrafosIguales: parrafosAntes === parrafosDespues, parrafosAntes, parrafosDespues };
}

// Chequeo liviano de buen-formado XML — sin parser real (mismo criterio que el resto del módulo:
// ver comentario de patrón 1b en anexos-detectar.ts sobre por qué se prefiere regex a un parser
// completo). Pensado para atrapar EXACTAMENTE el tipo de corrupción que ya rompió un documento
// real: un regex de extracción (el <w:sectPr> final en anexos-dividir.ts) que se comía un rango
// de tags de más, dejando una etiqueta de cierre sin su apertura — Word literalmente se negaba a
// abrir el archivo. verificarParrafos (arriba) solo compara CANTIDAD de párrafos del documento
// COMBINADO antes de dividir — no alcanza a detectar que un FRAGMENTO ya dividido quedó mal
// formado, que es justo donde pasó el bug real. Recorre TODAS las aperturas/cierres de tag con
// una pila; si algo no calza, el documento no es XML válido y no debe subirse.
//
// SEGUNDO BUG REAL, y la razón de que este chequeo ahora valide NAMESPACES además de las
// etiquetas: un .docx puede tener todas las etiquetas perfectamente calzadas y aun así ser XML
// inválido si usa un prefijo que no está declarado en ningún ancestro. Pasó con la firma
// (<a:graphicFrameLocks> sin xmlns:a en la raíz — ver declararNamespacesEnRaiz arriba): este gate
// daba el visto bueno, el archivo se subía, y Word lo rechazaba entero ("Namespace prefix a on
// graphicFrameLocks is not defined"). Cualquier validador con namespaces (python-docx/lxml) lo veía
// de inmediato; el chequeo de etiquetas por definición no puede. Se lleva la pila de declaraciones
// xmlns en paralelo a la de etiquetas — mismo recorrido, sin dependencias nuevas.
export function verificarXmlBienFormado(xml: string): { valido: boolean; error?: string } {
  const pila: string[] = [];
  const scopes: Record<string, string>[] = []; // una capa de declaraciones xmlns: por elemento abierto
  // `xml:` (xml:space="preserve") es predefinido por la norma y nunca se declara; `xmlns:` no es
  // un prefijo. Una declaración con URI vacío (xmlns:a="") NO cuenta como declarar el prefijo.
  const declarado = (p: string) => p === 'xml' || p === 'xmlns' || scopes.some(s => !!s[p]);
  const reTag = /<(\/?)([a-zA-Z0-9_:.-]+)((?:\s+[^<>]*?)?)(\/?)>/g;
  // Comilla doble o simple: ambas son válidas en XML y no todos los generadores usan la misma
  // (Word usa dobles; conviene no depender de eso para no rechazar un documento legítimo).
  const reDecl = /xmlns:([a-zA-Z0-9_.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  const reAttr = /([a-zA-Z0-9_:.-]+)\s*=\s*["']/g;
  let m: RegExpExecArray | null;
  while ((m = reTag.exec(xml))) {
    const [, cierre, nombre, attrs, autocierre] = m;

    if (cierre) {
      const esperado = pila.pop();
      scopes.pop();
      if (esperado !== nombre) {
        return { valido: false, error: `se esperaba cerrar "${esperado}" pero se encontró "</${nombre}>" en la posición ${m.index}` };
      }
      continue;
    }

    // El scope del propio elemento incluye lo que él mismo declara (un elemento puede declarar el
    // namespace de su propio prefijo: <wp:inline xmlns:wp="…"> es válido y es lo que usa Word).
    const propio: Record<string, string> = {};
    for (const d of attrs.matchAll(reDecl)) propio[d[1]] = d[3] ?? d[4] ?? '';
    scopes.push(propio);

    const usados = [nombre, ...[...attrs.matchAll(reAttr)].map(a => a[1])];
    for (const usado of usados) {
      const prefijo = usado.includes(':') ? usado.slice(0, usado.indexOf(':')) : '';
      if (prefijo && !declarado(prefijo)) {
        return {
          valido: false,
          error: `el prefijo de namespace "${prefijo}" (en "${usado}", posición ${m.index}) no está declarado en ningún ancestro — Word rechaza el archivo`,
        };
      }
    }

    // TERCER BUG REAL (1058086-43-LP26): etiquetas calzadas, namespaces declarados… y Word igual se
    // negaba a abrir el FORMULARIO N°1. El XML era bien formado pero inválido contra el ESQUEMA: un
    // <w:t> había quedado dentro de <w:pPr><w:tabs> (ver rellenarCeldaVacia). Validar el esquema
    // completo es imposible acá, pero esta regla puntual cubre la única forma en que este módulo
    // puede romperlo: <w:t> lo inserta SIEMPRE este código, y su único padre legal es <w:r>.
    if (nombre === 'w:t' && pila[pila.length - 1] !== 'w:r') {
      return {
        valido: false,
        error: `<w:t> colgando de <${pila[pila.length - 1] ?? 'nada'}> en la posición ${m.index} — su único padre válido es <w:r>; Word rechaza el archivo`,
      };
    }

    if (autocierre) scopes.pop(); // <tag .../> no abre nada que cerrar
    else pila.push(nombre);
  }
  if (pila.length > 0) return { valido: false, error: `quedaron ${pila.length} tag(s) sin cerrar: ${pila.slice(-3).join(', ')}` };
  return { valido: true };
}

// ── Firma escaneada: inserta una IMAGEN real (no texto) en la línea de firma ─────────────
// Distinto a todo lo de arriba: ahí se edita texto dentro de un run que ya existía; acá se
// agrega un archivo nuevo al zip (word/media/), se registra su relación
// (word/_rels/document.xml.rels) y su tipo MIME ([Content_Types].xml), y se referencia desde
// un <w:drawing> — el mecanismo real de OOXML para incrustar una imagen, no un atajo.
function leerDimensionesImagen(buf: Buffer): { anchoPx: number; altoPx: number } | null {
  // PNG: firma de 8 bytes + chunk IHDR con ancho/alto en los bytes 16-23 (big-endian).
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { anchoPx: buf.readUInt32BE(16), altoPx: buf.readUInt32BE(20) };
  }
  // JPEG: recorre marcadores hasta el primer SOFn (0xC0-0xC3), que trae alto/ancho.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marcador = buf[i + 1];
      if (marcador >= 0xc0 && marcador <= 0xc3) {
        return { altoPx: buf.readUInt16BE(i + 5), anchoPx: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

const EMU_POR_CM = 360000;

// Inserta la imagen DENTRO del párrafo identificado por paraId — mismo principio que
// rellenarCeldaVacia: nunca se agrega/quita un <w:p>, solo se reemplaza lo que hay adentro (acá,
// la raya de subrayado por el dibujo). anchoCm fijo con alto proporcional a la imagen real (o
// 0.4:1 si no se pudo leer sus dimensiones — proporción típica de una firma escaneada).
export async function insertarImagenEnParrafo(
  zip: JSZip,
  xml: string,
  paraId: string,
  imagen: Buffer,
  extension: string,
  // `etiqueta` distingue firma de timbre: da el nombre del archivo dentro del .docx (dos imágenes
  // en el MISMO párrafo colisionaban en un único media/imagen_firma_<paraId>.png, y la segunda
  // pisaba a la primera). `conservar` deja intacto lo que ya hay en el párrafo en vez de limpiarlo
  // — es lo que permite estampar el TIMBRE al lado de la firma sin borrarla: la leyenda real de
  // estos anexos es "FIRMA Y TIMBRE REPRESENTANTE LEGAL", las dos imágenes van juntas.
  // `alineacion` mueve la imagen a la izquierda / al centro / a la derecha del renglón. Es lo que
  // reemplaza al "arrastrarla con el mouse": un dibujo INLINE de Word no tiene coordenadas propias,
  // vive dentro del párrafo y se ubica como se ubica el texto de ese párrafo.
  {
    anchoCm = 3.5, etiqueta = 'firma', conservar = false, alineacion,
  }: { anchoCm?: number; etiqueta?: string; conservar?: boolean; alineacion?: 'izquierda' | 'centro' | 'derecha' } = {},
): Promise<string> {
  const dim = leerDimensionesImagen(imagen);
  const relacionAltoAncho = dim && dim.anchoPx > 0 ? dim.altoPx / dim.anchoPx : 0.4;
  const anchoEmu = Math.round(anchoCm * EMU_POR_CM);
  const altoEmu = Math.round(anchoEmu * relacionAltoAncho);

  const nombreImagen = `imagen_${etiqueta}_${paraId}.${extension}`;
  zip.file(`word/media/${nombreImagen}`, imagen);

  const relsPath = 'word/_rels/document.xml.rels';
  const relsFile = zip.file(relsPath);
  let relsXml = relsFile
    ? await relsFile.async('string')
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const idsExistentes = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map(m => Number(m[1]));
  const nuevoId = `rId${(idsExistentes.length ? Math.max(...idsExistentes) : 0) + 1}`;
  const nuevaRelacion = `<Relationship Id="${nuevoId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${nombreImagen}"/>`;
  // Un documento SIN relaciones previas trae <Relationships .../> autocerrado (no siempre hay
  // un </Relationships> literal que buscar) — hay que abrirlo antes de poder insertar adentro.
  relsXml = /<Relationships[^>]*\/>/.test(relsXml)
    ? relsXml.replace(/<Relationships([^>]*)\/>/, `<Relationships$1>${nuevaRelacion}</Relationships>`)
    : relsXml.replace('</Relationships>', `${nuevaRelacion}</Relationships>`);
  zip.file(relsPath, relsXml);

  const ctPath = '[Content_Types].xml';
  const ctFile = zip.file(ctPath);
  if (ctFile) {
    let ctXml = await ctFile.async('string');
    const extLower = extension.toLowerCase();
    if (!new RegExp(`Extension="${extLower}"`, 'i').test(ctXml)) {
      const mime = extLower === 'png' ? 'image/png' : /^jpe?g$/.test(extLower) ? 'image/jpeg' : `image/${extLower}`;
      ctXml = ctXml.replace('</Types>', `<Default Extension="${extLower}" ContentType="${mime}"/></Types>`);
      zip.file(ctPath, ctXml);
    }
  }

  // Namespaces del dibujo (wp/a/pic/r) — no todos los documentos los declaran de entrada (solo
  // hace falta si el documento ya trae imágenes propias); se agregan al <w:document> si faltan,
  // mismo mecanismo que normalizarParaIds() usa para w14.
  const NS: Record<string, string> = {
    wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  };
  const xmlConNamespaces = declararNamespacesEnRaiz(xml, NS);

  const idDocPr = Math.floor(Math.random() * 1_000_000) + 100;
  // Además de la raíz, el dibujo RE-DECLARA sus 4 prefijos en su propio <wp:inline> (misma URI,
  // re-declaración válida y lo que hacen Word y LibreOffice). Así el bloque es autosuficiente y no
  // depende de qué raíz le toque: dividirPorFormularios() reconstruye cada fragmento pegando este
  // XML bajo otro <w:document>, y un fragmento cuya firma dependiera solo de la raíz volvería a
  // romperse si esa raíz cambiara.
  const declsDibujo = Object.entries(NS).map(([p, uri]) => ` xmlns:${p}="${uri}"`).join('');
  const drawing = `<w:r><w:drawing><wp:inline${declsDibujo} distT="0" distB="0" distL="0" distR="0">`
    + `<wp:extent cx="${anchoEmu}" cy="${altoEmu}"/>`
    + `<wp:effectExtent l="0" t="0" r="0" b="0"/>`
    + `<wp:docPr id="${idDocPr}" name="${etiqueta}_${idDocPr}"/>`
    + `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${idDocPr}" name="${etiqueta}_${idDocPr}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${nuevoId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${anchoEmu}" cy="${altoEmu}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`
    + `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

  const re = new RegExp(`(<w:p\\b[^>]*w14:paraId="${paraId}"[^>]*>)([\\s\\S]*?)(<\\/w:p>)`);
  const m = xmlConNamespaces.match(re);
  if (!m) throw new Error(`No se encontró el párrafo w14:paraId="${paraId}" para insertar la firma`);
  const [entero, apertura, cuerpo, cierre] = m;

  // Si el párrafo trae SOLO la raya (patrón A), no hay nada más que preservar: se limpian
  // todos sus <w:r> y se deja el dibujo. Si la raya y la leyenda comparten párrafo (patrón B),
  // hay dos sub-casos reales encontrados:
  //   B1) raya y leyenda en RUNS separados → se ubica el run puntual de la raya y se reemplaza
  //       solo ese, la leyenda (en su propio run) queda intacta sin tocarla.
  //   B2) raya y leyenda van JUNTAS en el mismo <w:t> del mismo run (caso real: "____________
  //       Nombre Persona Natural...") → reemplazar el run entero se comería la leyenda también.
  //       Acá se separa en dos: el dibujo + un run de texto NUEVO (mismo rPr, para heredar el
  //       formato) que conserva solo la parte de leyenda.
  const runs = [...cuerpo.matchAll(/<w:r\b[\s\S]*?<\/w:r>/g)];
  const runRaya = runs.find(r => {
    const textoRun = [...r[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join('');
    return /^_{10,}/.test(textoRun.trim());
  });

  let nuevoCuerpo: string;
  if (conservar) {
    nuevoCuerpo = cuerpo + drawing;   // timbre al lado de la firma ya estampada — no se borra nada
  } else if (runRaya) {
    const textoRunCompleto = [...runRaya[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join('');
    const restoTexto = textoRunCompleto.replace(/^_+\s*/, '');
    if (restoTexto.trim()) {
      const rPrMatch = runRaya[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
      const runLeyenda = `<w:r>${rPrMatch ? rPrMatch[0] : ''}<w:t xml:space="preserve">${xmlEscape(restoTexto)}</w:t></w:r>`;
      nuevoCuerpo = cuerpo.replace(runRaya[0], drawing + runLeyenda);
    } else {
      nuevoCuerpo = cuerpo.replace(runRaya[0], drawing);
    }
  } else {
    nuevoCuerpo = cuerpo.replace(/<w:r\b[\s\S]*?<\/w:r>/g, '') + drawing; // fallback: no se identificó un run puntual
  }

  if (alineacion) nuevoCuerpo = conAlineacion(nuevoCuerpo, alineacion);

  return xmlConNamespaces.slice(0, m.index) + apertura + nuevoCuerpo + cierre
    + xmlConNamespaces.slice((m.index ?? 0) + entero.length);
}

// Fija el <w:jc> del párrafo (izquierda/centro/derecha). Respeta el ORDEN que exige el esquema de
// OOXML dentro de <w:pPr>: `jc` va después de `ind`/`spacing` y ANTES de `rPr`/`sectPr` — un
// <w:jc> puesto al final, después del <w:rPr>, es XML que Word puede rechazar.
function conAlineacion(cuerpo: string, alineacion: 'izquierda' | 'centro' | 'derecha'): string {
  const val = alineacion === 'centro' ? 'center' : alineacion === 'derecha' ? 'right' : 'left';
  const jc = `<w:jc w:val="${val}"/>`;
  const pPr = cuerpo.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
  if (!pPr) return `<w:pPr>${jc}</w:pPr>${cuerpo}`;   // sin pPr: se crea, siempre al principio del párrafo
  const dentro = pPr[1];
  const nuevoDentro = /<w:jc\b[^>]*\/>/.test(dentro)
    ? dentro.replace(/<w:jc\b[^>]*\/>/, jc)
    : (/<w:rPr>/.test(dentro) ? dentro.replace('<w:rPr>', `${jc}<w:rPr>`) : dentro + jc);
  return cuerpo.replace(pPr[0], `<w:pPr>${nuevoDentro}</w:pPr>`);
}

// ── Abrir / guardar el .docx completo (ZIP) ───────────────────────────────────────────────
export async function abrirDocx(buffer: Buffer): Promise<{ zip: JSZip; xml: string }> {
  const zip = await JSZip.loadAsync(buffer);
  const archivo = zip.file('word/document.xml');
  if (!archivo) throw new Error('No es un .docx válido (falta word/document.xml)');
  const xml = await archivo.async('string');
  return { zip, xml };
}

export async function guardarDocx(zip: JSZip, xmlFinal: string): Promise<Buffer> {
  zip.file('word/document.xml', xmlFinal);
  return zip.generateAsync({ type: 'nodebuffer' });
}
