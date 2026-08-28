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
  // <w:pBdr><w:bottom .../></w:pBdr> — la "raya" de firma en varios anexos de Los Vilos NO es
  // texto (`_____`), es un borde inferior puesto en párrafos vacíos consecutivos. BUG REAL
  // (3713-7-LE26): sin esto, detectarLineasFirma no distinguía un párrafo vacío CON raya (donde
  // corresponde estampar — la firma queda "sobre la línea", que es el estándar en estos anexos) de
  // un párrafo vacío SIN raya que solo es espaciado suelto — y a veces elegía el segundo.
  bordeInferior: boolean;
  // Ver rangosTapadosPorCuadroOpaco: este párrafo es contenido NORMAL del cuerpo que queda tapado
  // detrás de un cuadro de texto flotante opaco dibujado encima — el XML lo trae como texto
  // legible, pero ningún humano lo ve al abrir el documento en Word.
  tapadoPorCuadroOpaco: boolean;
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

  // Un w14:paraId DUPLICADO entre dos párrafos del documento ORIGINAL (posible tras una edición
  // manual descuidada del organismo — copy/paste de una fila de tabla que arrastra el mismo id) es
  // un riesgo real y silencioso: todas las funciones de escritura (rellenarCeldaVacia,
  // rellenarFinDeParrafo, rellenarRunPorIndice) buscan el paraId con `.match()` (primer resultado,
  // no todos) — si dos párrafos lo comparten, el valor puede terminar escrito en el PRIMERO que
  // aparezca en el XML, no necesariamente el que el detector identificó como candidato. Se
  // reasigna un id nuevo a partir de la SEGUNDA aparición de cada duplicado — el primero conserva
  // el suyo, que es el que ya vio el resto del pipeline al detectar candidatos.
  const vistos = new Set<string>();
  xml = xml.replace(/<w:p\b([^>]*)>/g, (m, attrs) => {
    const existente = /w14:paraId="([0-9A-Fa-f]+)"/.exec(attrs);
    if (!existente) {
      agregados++;
      return `<w:p${attrs} w14:paraId="${idAleatorio()}" w14:textId="77777777">`;
    }
    const id = existente[1].toUpperCase();
    if (vistos.has(id)) {
      agregados++;
      return m.replace(existente[0], `w14:paraId="${idAleatorio()}"`);
    }
    vistos.add(id);
    return m;
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

// ── Cuadros de texto flotantes MÁS ALTOS QUE UNA PÁGINA ──────────────────────────────────
// BUG REAL (4777-24-LE26, ANEXO_2.docx de la Municipalidad de La Unión): un cuadro de texto
// flotante de 7,6" x 11,1" (más alto que la página completa, relleno blanco sólido, posicionado
// con offset NEGATIVO respecto a la columna) trae adentro una copia duplicada del propio "ANEXO
// N°2" MÁS el formulario completo de "ANEXO N°1-A" pegado al final — contenido que Word (probado
// exportando a PDF con Word COM real) NUNCA muestra en la página visible: al abrir el documento
// normal, el humano solo ve la tabla de "ANEXO N°2" bien puesta; el cuadro gigante queda fuera de
// la vista, casi seguro un resto de un copy-paste mal hecho al armar la plantilla. Nuestro
// detector, que lee el XML como texto plano, SÍ veía ese contenido y ofrecía sus casillas
// ("A.NOMBRE COMPLETO DEL PROPONENTE…") como si fueran reales — confundiendo al usuario con
// campos de un anexo que ni siquiera existe en la página que va a firmar.
//
// El umbral (5 pulgadas) separa este caso de un cuadro de firma/sello LEGÍTIMO y chico (ej.
// 1227338-6-LE26, "FIRMA REPRESENTANTE LEGAL" en un cuadro de unas pocas líneas) — esos SIGUEN
// procesándose normal, solo se excluye lo que estructuralmente no puede ser un cuadro de firma.
const ALTURA_MAXIMA_CUADRO_NORMAL_EMU = 4572000; // 5" — 914400 EMU = 1 pulgada

interface CuadroFlotanteGrande { inicio: number; fin: number; opacoYEnFrente: boolean }

function cuadrosFlotantesGrandes(xml: string): CuadroFlotanteGrande[] {
  const out: CuadroFlotanteGrande[] = [];
  const reApertura = /<w:txbxContent\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = reApertura.exec(xml))) {
    const inicioTag = m.index;
    const cierre = xml.indexOf('</w:txbxContent>', inicioTag);
    if (cierre < 0) continue;
    const fin = cierre + '</w:txbxContent>'.length;
    // La altura del cuadro vive en el <wp:extent>/<a:ext> MÁS CERCANO antes de esta apertura —
    // es el tamaño del cuadro (wps:txbx/w:drawing) que lo envuelve. 4000 caracteres alcanza de
    // sobra: entre <wp:anchor>/<wp:extent> y <w:txbxContent> solo hay spPr/prstGeom/relleno/borde.
    const antes = xml.slice(Math.max(0, inicioTag - 4000), inicioTag);
    const extents = [...antes.matchAll(/\b(?:wp:extent|a:ext)\b[^>]*\bcy="(\d+)"/g)];
    const alturaEmu = extents.length ? Number(extents[extents.length - 1][1]) : 0;
    if (alturaEmu > ALTURA_MAXIMA_CUADRO_NORMAL_EMU) {
      // opacoYEnFrente: ver rangosTapadosPorCuadroOpaco — solo un cuadro RELLENO (no transparente)
      // y dibujado EN FRENTE del texto (behindDoc="0", el default de Word) puede tapar visualmente
      // el contenido normal que sigue. behindDoc="1" (detrás) o relleno "noFill" dejan ver lo de
      // abajo — ahí no hay nada que ocultar.
      const behindDoc = antes.match(/\bbehindDoc="(\d)"/);
      const opacoYEnFrente = behindDoc?.[1] !== '1' && /<a:solidFill\b/.test(antes) && !/<a:noFill\b/.test(antes);
      out.push({ inicio: inicioTag, fin, opacoYEnFrente });
    }
    reApertura.lastIndex = fin;
  }
  return out;
}

export function rangosDeCuadrosFlotantesGrandes(xml: string): { inicio: number; fin: number }[] {
  return cuadrosFlotantesGrandes(xml).map(({ inicio, fin }) => ({ inicio, fin }));
}

// ── Contenido normal TAPADO por un cuadro flotante opaco ─────────────────────────────────
// BUG REAL (4777-24-LE26, ANEXO_2.docx de la Municipalidad de La Unión): un cuadro de texto
// flotante de 7,6" x 11,1" (más alto que la página, relleno BLANCO SÓLIDO, dibujado EN FRENTE del
// texto — behindDoc="0") trae adentro el formulario completo y bien formado de "ANEXO N°2" — ESE
// es el que un humano ve al abrir el documento en Word (verificado exportando a PDF con Word COM
// real). El cuerpo normal del documento, DEBAJO del cuadro, sigue trayendo su propio contenido
// ("ANEXO N°1-A" completo, con sus propias casillas) — pero un cuadro opaco dibujado encima lo
// tapa por completo, así que ese contenido normal NUNCA se ve. Al revés de lo que parece a
// primera vista: no es el contenido DENTRO del cuadro el que hay que ignorar (ese es justo el que
// SÍ se ve) — es el contenido normal que queda tapado DETRÁS.
//
// El tramo tapado va desde donde cierra el cuadro hasta el próximo salto de página real
// (`<w:br w:type="page"/>`) o `<w:sectPr>` — un cuadro flotante no empuja el flujo normal, así
// que todo lo que venga después, en la MISMA página, queda bajo su sombra; un salto de página
// real sí saca el contenido de debajo del cuadro.
export function rangosTapadosPorCuadroOpaco(xml: string): { inicio: number; fin: number }[] {
  const cuadros = cuadrosFlotantesGrandes(xml).filter(c => c.opacoYEnFrente);
  return cuadros.map(c => {
    const reLimite = /<w:br\b[^>]*w:type="page"[^>]*\/?>|<w:sectPr\b/g;
    reLimite.lastIndex = c.fin;
    const limite = reLimite.exec(xml);
    return { inicio: c.fin, fin: limite ? limite.index : xml.length };
  });
}

// Se compara el RANGO completo del match (no solo dónde empieza) contra el tramo tapado: un
// párrafo que arranca justo antes de que cierre el cuadro (ej. comparte <w:p> con el ancla de OTRO
// elemento) pero cuyo cierre real cae ya en el tramo tapado cuenta igual como tapado — su texto
// vive ahí.
const seSuperponeConAlgunRango = (inicio: number, fin: number, rangos: { inicio: number; fin: number }[]) =>
  rangos.some(r => inicio < r.fin && fin > r.inicio);

// ── Lectura: lista todos los párrafos del documento, en orden ────────────────────────────
export function listarParrafos(xml: string): Parrafo[] {
  const matches = [...xml.matchAll(/<w:p\b[^>]*w14:paraId="([0-9A-Fa-f]+)"[^>]*>([\s\S]*?)<\/w:p>/g)];
  const rangosTapados = rangosTapadosPorCuadroOpaco(xml);
  return matches.map((match, indice) => {
    const [, paraId, cuerpo] = match;
    return {
      paraId,
      texto: textoDeRuns(cuerpo).trim(),
      vacio: parrafoEstaVacio(cuerpo),
      indice,
      centrado: /<w:jc\s+w:val="center"/.test(cuerpo),
      bordeInferior: /<w:pBdr>[\s\S]*?<w:bottom\b/.test(cuerpo),
      tapadoPorCuadroOpaco: seSuperponeConAlgunRango(match.index!, match.index! + match[0].length, rangosTapados),
    };
  });
}

export function contarParrafos(xml: string): number {
  return (xml.match(/<w:p\b/g) || []).length;
}

// ── Tablas: delimitación con anidamiento (una tabla dentro de una celda de otra) ────────────
// BUG REAL que esto reemplaza (encontrado en anexos-dividir.ts, "Formularios.docx"): el regex
// no-greedy `<w:tbl…>[\s\S]*?<\/w:tbl>` que usaban varias funciones cierra la tabla EXTERIOR en el
// PRIMER `</w:tbl>` que encuentra — que es el cierre de la INTERIOR cuando hay una tabla anidada
// dentro de una celda. La tabla exterior queda cortada a la mitad y todo lo que viene después de
// la anidada (más filas, más campos reales) desaparece de esa tabla sin ningún aviso — nunca "cero
// matches", así que el bug pasa desapercibido en cualquier prueba que solo mire "¿encontró algo?"
// en vez de "¿encontró lo correcto?". `anexos-dividir.ts` ya resolvía esto para su propio uso
// (contar anidamiento con pila) — esta es la MISMA lógica, compartida en vez de duplicada, para que
// detección estructural y división del documento nunca puedan divergir (misma lección que evitó
// que la vista previa reimplementara su propio detector de blancos inline — ver el comentario de
// `listarBlancosInline` en anexos-documento-ui.ts).
export function finDeTabla(xml: string, desde: number): number {
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

// `indexCuerpo` es el offset ABSOLUTO (dentro del xml completo) donde arranca `cuerpo` — mismo
// valor que antes se recalculaba en cada función con `tabla.index! + tabla[0].indexOf(cuerpoTabla)`,
// ahora entregado directo (no hay que volver a buscarlo).
export interface TablaXml { index: number; indexCuerpo: number; fullMatch: string; cuerpo: string }

// Todas las tablas del documento, en CUALQUIER profundidad de anidamiento, cada una con su rango
// calculado desde SU PROPIA apertura (nunca la de otra) — sustituye a
// `xml.matchAll(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g)` en las funciones de anexos-detectar.ts que
// necesitan examinar cada tabla como su propia entidad (incluidas las anidadas: una tabla dentro
// de una celda puede traer su propio encabezado y sus propios campos, y así se espera que aparezca
// en la vista previa — ver `tablasPorIndice` en anexos-documento-ui.ts). Cuando una tabla puntual
// queda mal formada (`finDeTabla` devuelve -1) se salta SOLO esa: no bloquea el resto del barrido.
export function* iterarTablas(xml: string): Generator<TablaXml> {
  const reApertura = /<w:tbl\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = reApertura.exec(xml))) {
    const index = m.index;
    const fin = finDeTabla(xml, index);
    if (fin < 0) continue;
    const indexCuerpo = index + m[0].length;
    const fullMatch = xml.slice(index, fin);
    const cuerpo = xml.slice(indexCuerpo, fin - '</w:tbl>'.length);
    yield { index, indexCuerpo, fullMatch, cuerpo };
    // A propósito NO se salta al final de `fin`: la siguiente vuelta de reApertura sigue buscando
    // justo después de ESTA apertura, así que una tabla anidada dentro de `cuerpo` también sale
    // como su propia entrada, con su rango correcto (nunca el de la exterior que la contiene).
  }
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
const RE_LETRA = /[A-Za-zÀ-ÿ]/;

// Solo para el paréntesis (ver RE_MARCADORES más abajo): a diferencia de "[...]"/"<<...>>" (raros
// en prosa legal chilena normal), "(...)" es MUY común para incisos legítimos — "(en adelante, 'el
// Oferente')", "(Ley N° 19.886)", "(IVA incluido)", enumeraciones "(a)", "(b)" — así que aceptar
// CUALQUIER paréntesis con una letra adentro (el único filtro que basta para los otros tres
// delimitadores) inundaría cada documento de falsos positivos. Se reconoce cuando el contenido
// EMPIEZA por un nombre de campo real (nunca por descarte de lo que NO es) — lo que venga después
// no se exige con una gramática fija, porque ahí es donde vive la variación real entre organismos.
//
// BUG REAL (28-ago-2026, ANEXO N°2B "DECLARACIÓN JURADA... UTP", 2928-17-LE26): la versión anterior
// exigía un MATCH COMPLETO contra una gramática rígida ("razón social" + opcionalmente " de la
// empresa", nada más) — y CADA UNO de los 6 marcadores de este documento real le agrega una palabra
// que esa gramática no esperaba: "nombre COMPLETO representante legal", "RUN representante legal"
// (RUN no estaba en la lista), "razón social DE LAS empresa QUE REPRESENTA", "RUT empresaS"
// (plural), "indique dirección, comuna y región" (verbo + tres campos). Con match completo, los 6
// fallaban y el documento entero salía "sin marcas de relleno" — 0 candidatos, ni uno solo
// pendiente. Con "empieza por", los 6 matchean por su primera palabra (nombre/run/razón social/
// rut/dirección) y el resto de la frase, que es exactamente donde cada organismo redacta distinto,
// deja de importar. Un verbo de instrucción pegado adelante ("indique", "señale") se pela antes de
// probar — es ruido de redacción, no parte del nombre del campo.
const RE_INSTRUCCION_LEVE_ANTES = /^(?:indique|indicar|se[ñn]ale|se[ñn]alar|escriba|ingrese|complete|completar|anote|detalle)\s+/i;
const RE_BASE_CAMPO_ENTRE_PARENTESIS = /^(nombres?(\s+completos?)?|apellidos?|run|r\.?\s*u\.?\s*t\.?|c[ée]dula(\s+de\s+identidad)?|raz[óo]n\s+social|domicilio|direcci[óo]n|comuna|ciudad|regi[óo]n|cargo|giro|fecha|correo(\s+electr[óo]nico)?|e-?mail|tel[ée]fono|fono|celular|representante(\s+legal)?)\b/i;
function esCampoEntreParentesis(dentro: string): boolean {
  return RE_BASE_CAMPO_ENTRE_PARENTESIS.test(dentro.replace(RE_INSTRUCCION_LEVE_ANTES, ''));
}

const RE_MARCADORES: { re: RegExp; valido: (dentro: string) => boolean }[] = [
  { re: /<<([^<>]{2,200}?)>>/g, valido: (d) => RE_LETRA.test(d) },      // <<NOMBRE PERSONA NATURAL O PERSONA JURIDICA>>
  // BUG REAL (18-ago-2026, 1247197-54-LE26, "DECLARACIÓN JURADA PARA CONTRATAR"): el organismo usa
  // UN SOLO par de ángulos, no dos — "Yo, <nombre de representante legal o persona natural según
  // corresponda>, cédula de identidad N° <RUT representante legal o persona natural>". El patrón de
  // arriba exige "<<" y "»" el de abajo, así que esos dos campos eran INVISIBLES: ni automáticos ni
  // pendientes, el anexo se veía "sin nada que llenar" cuando en realidad pedía los dos datos más
  // básicos. Va DESPUÉS del de "<<…>>" a propósito: ese ya consumió su tramo cuando existe, así que
  // este no puede robarle el interior. Exige una LETRA adentro (igual que los otros), lo que
  // descarta comparaciones numéricas sueltas del tipo "<5" o "<=100" que no son marcadores.
  { re: /<([^<>]{2,200}?)>/g, valido: (d) => RE_LETRA.test(d) },        // <nombre del representante legal>
  { re: /«([^«»]{2,200}?)»/g, valido: (d) => RE_LETRA.test(d) },        // variante tipográfica de lo mismo
  { re: /\{\{([^{}]{2,200}?)\}\}/g, valido: (d) => RE_LETRA.test(d) },  // {{razon_social}} — plantillas
  { re: /\[([^[\]]{2,200}?)\]/g, valido: (d) => RE_LETRA.test(d) },     // [Insertar RUT] / [fecha] / [indicar "en esta casilla"…]
  // BUG REAL (10-ago-2026, declaración jurada corrida: "Yo (nombre), cédula de identidad Nº
  // (RUT)…, (razón social empresa), RUT N° (RUT empresa), con domicilio en (domicilio),
  // (comuna), (ciudad), declaro bajo juramento que:"): el organismo usa PARÉNTESIS en vez de
  // "[...]" para decir qué va en cada casilla — antes esa frase entera (7 marcadores) era
  // invisible: cero blancos detectados, ni auto ni pendiente, nada.
  { re: /\(([^()]{2,60}?)\)/g, valido: (d) => esCampoEntreParentesis(d.trim()) },
];

// Blancos "de raya": guiones bajos (lo de siempre) y líneas de puntos/elipsis. El umbral de los
// guiones bajos es 4 (nadie escribe "____" salvo para dejar una línea para llenar).
const RE_RAYAS = /_{4,}/g;

// Línea de puntos: puntos ASCII (".") y/o el carácter ELIPSIS "…" (U+2026, UN SOLO carácter que
// Word/el usuario tipea como "..." y autocorrige a un glifo) — MEZCLADOS entre sí, nunca
// homogéneos. BUG REAL (4928-15-LE26, "EMPRESA……………(Indicar)"): Word reparte la línea de puntos en
// varios <w:r> (revisión ortográfica) y, una vez que RE_TRAMO_PUNTOS (más abajo) los junta de vuelta
// en un solo run, el resultado trae tramos de "." sueltos intercalados con tramos de "…" (nunca un
// solo carácter repetido) — tratar "." y "…" como dos patrones separados con umbral propio (como
// antes: 6 puntos ASCII O 2 elipsis) cortaba esa mezcla en 3-5 rayas distintas AUNQUE ya vivieran en
// el mismo run, mismo bug de fondo un nivel más abajo. Se mide en PESO visual sobre CUALQUIER
// corrida de "." y "…" mezclados (cada "…" vale 3 puntos, igual que se ve en pantalla) y se exige
// un peso mínimo de 6 — el mismo umbral de siempre (6 puntos ASCII, o 2 elipsis, o cualquier
// combinación que sume 6): tres puntos son puntos suspensivos y cuatro pueden ser un "etc...." mal
// escrito, pero seis puntos (en la mezcla que sea) solo se escriben para dejar una línea para llenar.
const RE_CORRIDA_PUNTOS = /[.…]+/g;
const UMBRAL_PESO_PUNTOS = 6;
function pesoPuntos(corrida: string): number {
  let peso = 0;
  for (const ch of corrida) peso += ch === '…' ? 3 : 1;
  return peso;
}

// Tramo de puntos/elipsis que puede venir partido entre varios <w:r> — CASO REAL (4928-15-LE26,
// "EMPRESA……………………………(Indicar)"): Word reparte una sola línea de puntos en 8-9 runs distintos
// (cada uno con 1 a 5 caracteres, separados por <w:proofErr> de revisión ortográfica). Individual-
// mente casi ningún run alcanza el umbral de RE_RAYAS, así que detectarBlancosInline (que mira UN
// run a la vez) encontraba 4-9 "blancos" separados para lo que en el papel es UNA sola casilla —
// el usuario veía la misma respuesta repetida varias veces, partida por puntos sueltos entre medio.
// Se une ACÁ, antes de detectar, con el MISMO mecanismo que ya usa RE_MARCADORES más abajo: no hay
// umbral (ni falta hace — el umbral real lo aplica RE_RAYAS DESPUÉS de unir, sobre el run ya
// completo), así que unir un par de puntos sueltos que no llegan a ser raya no cambia nada visible.
const RE_TRAMO_PUNTOS = /[.…]{2,}/g;

// MISMO bug que RE_TRAMO_PUNTOS, con guiones bajos — el caso MÁS común de todos, y por eso el más
// caro. BUG REAL (13-ago-2026, 1063538-204-LE26, FORMULARIO N°5): "Mediante el presente Formulario,
// la empresa________________________________" es UNA sola raya en el papel, pero Word la reparte en
// 3 runs ("…la empresa" + 28 guiones / "______" / "______"). detectarBlancosInline mira UN run a la
// vez, así que veía TRES casillas independientes y el motor de IA llenaba cada una con un campo
// DISTINTO: "la empresa Comercial MP SpA 78.388.175-6 Lidia Valenzuela" — razón social, RUT y
// representante legal concatenados en la misma línea, cuando la oración pide solo el nombre de la
// empresa. No era un error de criterio del modelo (cada casilla, vista aislada, es plausible): era
// que se le preguntaba tres veces por la misma casilla. Se une antes de detectar, igual que los
// puntos; el umbral real (RE_RAYAS, `_{4,}`) se aplica DESPUÉS sobre el run ya completo, así que
// juntar un par de guiones sueltos que no llegan a ser raya no cambia nada visible.
const RE_TRAMO_RAYAS = /_{2,}/g;

// Encuentra, en un <w:t> YA DECODIFICADO (ver decodificarXml), cada blanco con su contexto previo.
export function listarBlancosInline(textoRun: string): BlancoInline[] {
  const crudos: { pos: number; largo: number; textoMarcador?: string }[] = [];
  for (const m of textoRun.matchAll(RE_RAYAS)) crudos.push({ pos: m.index!, largo: m[0].length });
  for (const m of textoRun.matchAll(RE_CORRIDA_PUNTOS)) {
    if (pesoPuntos(m[0]) < UMBRAL_PESO_PUNTOS) continue;
    crudos.push({ pos: m.index!, largo: m[0].length });
  }
  for (const { re, valido } of RE_MARCADORES) {
    for (const m of textoRun.matchAll(re)) {
      const dentro = m[1].trim();
      if (!valido(dentro)) continue;
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
    for (const { re, valido } of RE_MARCADORES) {
      for (const m of completo.matchAll(re)) {
        if (!valido(m[1].trim())) continue;
        const primerRun = runDe(m.index!);
        if (primerRun === runDe(m.index! + m[0].length - 1)) continue; // ya vive entero en un run
        tramos.push({ desde: m.index!, hasta: m.index! + m[0].length, run: primerRun });
      }
    }
    // RE_TRAMO_PUNTOS va DESPUÉS: si un marcador entre corchetes trae puntos adentro
    // ("[indicar…]"), el tramo de marcador (agregado arriba) ya cubre esas posiciones y gana por
    // ser el primero en el array — el `tramos.find` de más abajo se queda con el primero que
    // encuentra para cada posición.
    for (const m of completo.matchAll(RE_TRAMO_PUNTOS)) {
      const primerRun = runDe(m.index!);
      if (primerRun === runDe(m.index! + m[0].length - 1)) continue; // ya vive entero en un run
      tramos.push({ desde: m.index!, hasta: m.index! + m[0].length, run: primerRun });
    }
    // Guiones bajos partidos entre runs — ver RE_TRAMO_RAYAS. Mismo tratamiento que los puntos.
    for (const m of completo.matchAll(RE_TRAMO_RAYAS)) {
      const primerRun = runDe(m.index!);
      if (primerRun === runDe(m.index! + m[0].length - 1)) continue; // ya vive entero en un run
      tramos.push({ desde: m.index!, hasta: m.index! + m[0].length, run: primerRun });
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
  // El texto que el DETECTOR vio en este run (CandidatoInline.textoRunOriginal). Opcional para no
  // romper llamadores viejos, pero cuando viene es el cinturón de seguridad de todo el módulo.
  textoRunEsperado?: string,
): string {
  const matches = [...xml.matchAll(/<w:t([^>]*)>([^<]*)<\/w:t>/g)];
  const m = matches[indiceRun];
  if (!m) throw new Error(`No se encontró el run de índice ${indiceRun}`);
  const [entero, attrs, textoCrudo] = m;

  // CINTURÓN DE SEGURIDAD (28-ago-2026). `indiceRun` es un número que viaja desde la detección
  // hasta acá, y si las dos puntas numeran distinto el resultado NO es una casilla vacía: es el
  // dato escrito ENCIMA de otro texto del documento, sin que nadie se entere. Eso pasó de verdad
  // (ver detectarBlancosInline en anexos-detectar.ts: los <w:p> anidados de un cuadro de texto
  // corrían el conteo) y dejó "Santiago Osvaldo López Palavecino o>" en medio de un párrafo ajeno.
  //
  // El bug de origen ya está arreglado; esto es para que la clase entera de fallo no pueda
  // repetirse en silencio: si el run que hay en este índice no es el que vio el detector, se
  // aborta la escritura. El llamador lo convierte en un aviso y la casilla queda para llenar a
  // mano — mil veces preferible a un documento legal con datos en el lugar equivocado.
  if (textoRunEsperado != null && decodificarXml(textoCrudo) !== textoRunEsperado) {
    throw new Error(
      `El run ${indiceRun} no es el que se detectó (se esperaba "${textoRunEsperado.slice(0, 40)}" `
      + `y hay "${decodificarXml(textoCrudo).slice(0, 40)}") — no se escribe nada ahí.`,
    );
  }
  // Se edita sobre el texto DECODIFICADO — las posiciones de las ediciones vienen de
  // detectarBlancosInline, que también lee decodificado. Sin esto, un párrafo con entidades tenía
  // los offsets corridos y el resultado quedaba doble-escapado (ver decodificarXml).
  const textoOriginal = decodificarXml(textoCrudo);

  // Carácter límite en el RUN VECINO (mismo párrafo) — CASO REAL (4928-15-LE26): Word suele partir
  // "ETIQUETA" y su raya de puntos en dos <w:r> distintos aunque en el papel sean una sola frase
  // corrida ("PLAZO DE ENTREGA" en un run, "…….…" en el siguiente). Cuando el blanco ocupa el run
  // ENTERO por ese lado (pos=0 a la izquierda, o llega hasta el final del run a la derecha), el
  // carácter límite real vive en el run vecino, no en este — sin mirarlo, el chequeo de abajo
  // siempre veía "" y nunca anteponía el espacio: salía "PLAZO DE ENTREGA30" pegado. Se mira el
  // vecino SOLO si sigue dentro del mismo <w:p>: cruzar a otro párrafo o celda daría un espacio
  // basado en texto que no tiene nada que ver con este blanco.
  const mismoParrafo = (desde: number, hasta: number) => !xml.slice(desde, hasta).includes('</w:p>');
  const charLimite = (lado: 'antes' | 'despues'): string => {
    const vecino = matches[indiceRun + (lado === 'antes' ? -1 : 1)];
    if (!vecino) return '';
    const dentro = lado === 'antes'
      ? mismoParrafo((vecino.index ?? 0) + vecino[0].length, m.index ?? 0)
      : mismoParrafo((m.index ?? 0) + entero.length, vecino.index ?? 0);
    if (!dentro) return '';
    const texto = decodificarXml(vecino[2]);
    return lado === 'antes' ? (texto[texto.length - 1] || '') : (texto[0] || '');
  };

  let textoNuevo = textoOriginal;
  for (const { pos, largo, valor } of [...ediciones].sort((a, b) => b.pos - a.pos)) {
    const charPrevio = pos > 0 ? (textoNuevo[pos - 1] || '') : charLimite('antes');
    const charSiguiente = pos + largo < textoNuevo.length ? (textoNuevo[pos + largo] || '') : charLimite('despues');
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

// Ancho de TEXTO imprimible (twips: 1/20 de punto) del documento — pgSz menos los márgenes
// izquierdo y derecho del último <w:sectPr> real (mismo criterio de "el ÚLTIMO es el que manda"
// que usa dividirPorFormularios, ver su comentario). Sirve como posición de una tabulación DERECHA
// que empuje contenido al borde derecho SIN importar el ancho de página de este documento en
// particular — un offset fijo (lo que arrastrar una imagen con el mouse en Word deja grabado)
// solo sirve para el documento donde se midió; este número se recalcula por documento.
const ANCHO_TEXTO_FALLBACK_TWIPS = 9000; // ~15.9cm, típico de A4/Carta con márgenes de ~2.2-2.5cm
function calcularAnchoTextoTwips(xml: string): number {
  const sectPrMatches = [...xml.matchAll(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g)];
  const sectPr = sectPrMatches.length ? sectPrMatches[sectPrMatches.length - 1][0] : '';
  const anchoPagina = Number(sectPr.match(/<w:pgSz\b[^>]*\bw:w="(\d+)"/)?.[1]);
  const pgMar = sectPr.match(/<w:pgMar\b[^>]*\/>/)?.[0] || '';
  const margenIzq = Number(pgMar.match(/\bw:left="(\d+)"/)?.[1]);
  const margenDer = Number(pgMar.match(/\bw:right="(\d+)"/)?.[1]);
  if (!anchoPagina || !margenIzq || !margenDer) return ANCHO_TEXTO_FALLBACK_TWIPS;
  const ancho = anchoPagina - margenIzq - margenDer;
  return ancho > 0 ? ancho : ANCHO_TEXTO_FALLBACK_TWIPS;
}

// Agrega una parada de tabulación DERECHA en `posicionTwips` al <w:pPr> del párrafo — el <w:tab/>
// que separa el texto de la imagen (ver columnaDerecha en insertarImagenEnParrafo) salta hasta ahí,
// nunca al tab por defecto de Word (~cada 1.25cm). Mismo respeto al orden del esquema OOXML que
// conAlineacion/marcarKeepNext: `tabs` va DESPUÉS de `pBdr`/`keepNext` y ANTES de `jc`/`rPr` —
// insertarlo en el lugar equivocado es XML que el propio esquema de Word puede rechazar.
function conTabDerecha(cuerpo: string, posicionTwips: number): string {
  const tabsXml = `<w:tabs><w:tab w:val="right" w:pos="${posicionTwips}"/></w:tabs>`;
  const pPr = cuerpo.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
  if (!pPr) return `<w:pPr>${tabsXml}</w:pPr>${cuerpo}`;
  if (/<w:tabs\b/.test(pPr[1])) return cuerpo; // ya trae sus propias tabulaciones, no se pisan
  const dentro = pPr[1];
  const pBdrMatch = dentro.match(/<w:pBdr>[\s\S]*?<\/w:pBdr>/);
  let nuevoDentro: string;
  if (pBdrMatch) nuevoDentro = dentro.replace(pBdrMatch[0], pBdrMatch[0] + tabsXml);
  else if (/<w:jc\b[^>]*\/>/.test(dentro)) nuevoDentro = dentro.replace(/(<w:jc\b[^>]*\/>)/, `${tabsXml}$1`);
  else if (/<w:rPr>/.test(dentro)) nuevoDentro = dentro.replace('<w:rPr>', `${tabsXml}<w:rPr>`);
  else nuevoDentro = dentro + tabsXml;
  return cuerpo.replace(pPr[0], `<w:pPr>${nuevoDentro}</w:pPr>`);
}

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
  // `nombreDebajo`: cuando la leyenda pide "Nombre y Firma..." (no solo la firma — caso real
  // 1057678-2-LE26, "Nombre y Firma del Oferente o su Representante Legal", repetido en 6 anexos
  // del mismo documento), se escribe el nombre del representante como texto justo debajo de la
  // imagen (un <w:br/> separa las dos líneas dentro del MISMO párrafo — nunca se agrega un <w:p>
  // nuevo, la regla intocable de todo este módulo). Antes solo se estampaba la firma y el "Nombre"
  // que la leyenda pedía se quedaba sin ningún dato en ningún lugar del documento.
  // Acepta un array (caso real 1426039-8-LE26: "Nombre, RUT y Firma Representante Legal" pide DOS
  // datos aparte de la imagen) — cada elemento es SU PROPIA línea, un <w:br/> por elemento. Un
  // string suelto se sigue aceptando tal cual (mismo comportamiento de siempre para todo llamador
  // existente).
  // `saltoAntesDeImagen`: con `conservar`, el dibujo SIEMPRE se agrega al FINAL del párrafo — bien
  // para el timbre (va PEGADO al lado de la firma que ya se estampó ahí) pero mal cuando lo que ya
  // hay es una LEYENDA que describe la firma ("Nombre, RUT y Firma Representante Legal", caso real
  // 1426039-8-LE26): ahí la imagen tiene que quedar ANTES de la leyenda (línea → firma → etiqueta →
  // nombre/RUT, el orden que se lee en el papel), no después. Con esto, la imagen se antepone (con
  // un <w:r><w:br/></w:r> justo después) y la leyenda existente queda intacta a continuación;
  // `nombreDebajo` (si lo hay) se agrega al FINAL de todo, después de la leyenda — nunca pegado a
  // la imagen. Nunca se activa para el timbre (que no lo pide), así que firma+timbre lado a lado
  // sigue exactamente igual.
  // `flotarSobreLinea`: pedido explícito del usuario (1426039-8-LE26, 10-ago-2026, tercera vez que
  // insiste) — la firma tiene que quedar VISUALMENTE arriba del borde de la celda, no solo primera
  // en el flujo del párrafo (que sigue quedando debajo del borde, límite real de OOXML para
  // contenido inline). Cambia el dibujo de `<wp:inline>` a `<wp:anchor>` con posición flotante y
  // desplazamiento vertical negativo — ver el comentario junto a OFFSET_FLOTANTE_EMU. Es una
  // aproximación (el desplazamiento es un valor fijo, ajustado a ojo contra el documento real, no
  // calculado por fila) — puede necesitar retoque si aparece un documento con una fila mucho más
  // alta o más baja que la de este caso.
  // `columnaDerecha`: pedido explícito del usuario (13-ago-2026, caso 1063538-204-LE26) — en vez
  // del layout apilado de siempre (imagen, nombre debajo, RUT debajo, timbre debajo), nombreDebajo
  // va en UNA sola línea de texto a la IZQUIERDA del párrafo y firma+timbre quedan lado a lado a la
  // DERECHA, en la MISMA línea — el layout que el usuario armó a mano en Word arrastrando las
  // imágenes con coordenadas absolutas (`wp:anchor` con `posOffset` fijo). Coordenadas absolutas no
  // sirven acá: este motor procesa anexos de organismos distintos con anchos de página/márgenes
  // distintos, y un offset fijo calcado de un documento se ve corrido (o directo fuera de la hoja)
  // en cualquier otro. En vez de eso, se usa una TABULACIÓN DERECHA (`<w:tabs><w:tab val="right">`)
  // calculada del `<w:sectPr>` real de ESTE documento (ver calcularAnchoTextoTwips) — la misma
  // técnica que usa cualquier plantilla de Word para alinear algo al margen derecho sin importar el
  // ancho de página, y no agrega ningún <w:p> nuevo (la regla intocable de este módulo).
  {
    anchoCm = 3.5, etiqueta = 'firma', conservar = false, alineacion, nombreDebajo, saltoAntesDeImagen = false,
    flotarSobreLinea = false, columnaDerecha = false,
  }: {
    anchoCm?: number; etiqueta?: string; conservar?: boolean; alineacion?: 'izquierda' | 'centro' | 'derecha';
    saltoAntesDeImagen?: boolean;
    flotarSobreLinea?: boolean;
    columnaDerecha?: boolean;
    nombreDebajo?: string | string[];
  } = {},
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
  const picXml = `<pic:pic><pic:nvPicPr><pic:cNvPr id="${idDocPr}" name="${etiqueta}_${idDocPr}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${nuevoId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${anchoEmu}" cy="${altoEmu}"/></a:xfrm>`
    + `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`;
  // `flotarSobreLinea` (ver más abajo): en vez de `<wp:inline>` (fluye DENTRO del párrafo, nunca
  // puede quedar más arriba que el borde de la celda que lo contiene — límite real de OOXML, no
  // hay forma de esquivarlo con contenido en línea), se usa `<wp:anchor>` — una imagen FLOTANTE
  // con posición propia, `relativeFrom="paragraph"` y un desplazamiento vertical NEGATIVO, que
  // sale del flujo normal y puede dibujarse por ENCIMA de donde el párrafo empieza (y por lo
  // tanto, por encima del borde de la celda). `layoutInCell="1"` es obligatorio para que la
  // referencia sea la CELDA que la contiene y no la página entera.
  const drawingInline = `<w:r><w:drawing><wp:inline${declsDibujo} distT="0" distB="0" distL="0" distR="0">`
    + `<wp:extent cx="${anchoEmu}" cy="${altoEmu}"/>`
    + `<wp:effectExtent l="0" t="0" r="0" b="0"/>`
    + `<wp:docPr id="${idDocPr}" name="${etiqueta}_${idDocPr}"/>`
    + `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">${picXml}</a:graphicData></a:graphic>`
    + `</wp:inline></w:drawing></w:r>`;
  const OFFSET_FLOTANTE_EMU = -Math.round(2.6 * EMU_POR_CM); // ajustado a ojo (ver comentario de flotarSobreLinea)
  const drawingAnchor = `<w:r><w:drawing><wp:anchor${declsDibujo} distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${idDocPr}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">`
    + `<wp:simplePos x="0" y="0"/>`
    + `<wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH>`
    + `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${OFFSET_FLOTANTE_EMU}</wp:posOffset></wp:positionV>`
    + `<wp:extent cx="${anchoEmu}" cy="${altoEmu}"/>`
    + `<wp:effectExtent l="0" t="0" r="0" b="0"/>`
    + `<wp:wrapNone/>`
    + `<wp:docPr id="${idDocPr}" name="${etiqueta}_${idDocPr}"/>`
    + `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">${picXml}</a:graphicData></a:graphic>`
    + `</wp:anchor></w:drawing></w:r>`;
  const drawing = flotarSobreLinea ? drawingAnchor : drawingInline;
  // <w:br/> separa la imagen de cada línea (nombre, RUT…) EN EL MISMO párrafo/run — nunca un
  // <w:p> nuevo (la regla intocable del conteo de párrafos, ver el encabezado del archivo).
  const lineasDebajo = nombreDebajo == null ? [] : Array.isArray(nombreDebajo) ? nombreDebajo : [nombreDebajo];
  const lineasConTexto = lineasDebajo.filter(l => l && l.trim());
  const runNombre = lineasConTexto
    .map(l => `<w:r><w:br/><w:t xml:space="preserve">${xmlEscape(l)}</w:t></w:r>`)
    .join('');
  // `columnaDerecha`: el texto (nombre + RUT, unidos con espacio) va ANTES de la imagen, en la
  // MISMA línea, separado por un <w:tab/> que la tabulación derecha (ver más abajo) empuja hasta el
  // margen — layout completo: "Lidia Valenzuela   6.736.698-0[TAB][firma][timbre]".
  const runNombreEnLinea = lineasConTexto.length
    ? `<w:r><w:t xml:space="preserve">${lineasConTexto.map(xmlEscape).join('    ')}</w:t></w:r>`
    : '';
  // Sin lineasConTexto (la llamada del TIMBRE, que nunca pasa nombreDebajo) no hay nada que
  // tabular — se pega la imagen directa, sea cual sea el modo, para que quede al lado de la firma
  // ya estampada (ver el branch `conservar` más abajo, que decide si además necesita un salto).
  const drawingCompleto = !lineasConTexto.length
    ? drawing
    : columnaDerecha
      ? runNombreEnLinea + '<w:r><w:tab/></w:r>' + drawing
      : drawing + runNombre;

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
  const esRunDeSoloRaya = (r: string) => {
    const textoRun = [...r.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join('');
    return /^_{10,}$/.test(textoRun.trim());
  };
  const runRaya = runs.find(r => {
    const textoRun = [...r[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join('');
    return /^_{10,}/.test(textoRun.trim());
  });
  // BUG REAL (1057678-2-LE26): un párrafo puede traer la raya partida en DOS runs — el primero
  // (con texto adicional o no) es el que arriba se detecta y reemplaza por el dibujo; un SEGUNDO
  // run, más adelante en el mismo párrafo, con OTRA tanda de guiones bajos sueltos (a veces detrás
  // de un <w:tab/>, doble ancho de la misma raya visual) sobrevivía intacto — con `nombreDebajo` se
  // volvió visible: "Lidia Valenzuela ___________________________________" en vez de solo el
  // nombre. Cualquier run de raya ADICIONAL al ya reemplazado se limpia (texto vacío, se conserva
  // el run por si trae <w:tab/> u otro contenido no textual antes de los guiones).
  const rayasSobrantes = runs.filter(r => r !== runRaya && esRunDeSoloRaya(r[0]));

  let nuevoCuerpo: string;
  if (conservar) {
    if (saltoAntesDeImagen) {
      // TODO el bloque de la firma —imagen, nombre y RUT si la leyenda los pide— va JUNTO y
      // ANTES de la leyenda; la leyenda ("Nombre, RUT y Firma Representante Legal") queda sola
      // DESPUÉS, como un pie que describe el bloque de arriba, nunca mezclada en el medio. BUG
      // REAL (1426039-8-LE26, 10-ago-2026, tercera vuelta): la segunda versión de este fix ya
      // dejaba la imagen antes de la leyenda, pero nombreDebajo seguía agregándose DESPUÉS de
      // ella (pegado al final) — "me dejaste la firma arriba y el RUT y el nombre abajo": el
      // usuario pidió que si la leyenda pide nombre+RUT+firma, LOS TRES vayan juntos arriba, sea
      // cual sea la combinación que pida (solo firma, firma+nombre, o firma+nombre+RUT).
      nuevoCuerpo = drawing + runNombre + '<w:r><w:br/></w:r>' + cuerpo;
    } else {
      // Si el párrafo YA trae una imagen (la firma, recién estampada — con nombreDebajo, en SUS
      // PROPIAS líneas separadas por <w:br/>), pegar el timbre directo al final del último <w:t>
      // lo deja en la MISMA línea que la última ("6.736.698-0" o el nombre si no hay RUT) — una
      // imagen de ~2.8cm ahí se dibuja mucho más alta que una línea de texto y visualmente TAPA
      // las líneas de arriba en vez de quedar junto a la firma como se pretendía ("timbre al lado
      // de la firma", el comentario original de este código, cierto solo cuando no hay
      // nombreDebajo de por medio). BUG REAL (13-ago-2026, caso 1063538-204-LE26): en los 3
      // anexos generados el timbre quedaba flotando ENTRE el nombre y el RUT del representante
      // legal. Con el salto, el timbre pasa a su PROPIA línea, debajo del RUT — nunca se toca el
      // caso sin imagen previa (la firma con `sinRaya`, ver arriba), que sigue igual.
      // En modo `columnaDerecha` NO corresponde el salto: el timbre tiene que quedar PEGADO al
      // lado de la firma, ambos ya empujados al margen derecho por el <w:tab/> que puso la llamada
      // anterior (la de la firma) — un salto acá los separaría en dos líneas distintas, deshaciendo
      // justo el layout "lado a lado" que columnaDerecha existe para lograr.
      //
      // BUG REAL (17-ago-2026, encontrado inspeccionando un anexo ya generado): la condición
      // original disparaba el salto con CUALQUIER imagen previa en el párrafo — no solo cuando esa
      // imagen traía nombre/RUT debajo (el caso 1063538-204-LE26 que el salto vino a arreglar). El
      // caso más común, "FIRMA Y TIMBRE REPRESENTANTE LEGAL" SIN nombre ni RUT de por medio (que
      // nunca pasa nombreDebajo), también tenía `yaTieneImagen=true` apenas se estampaba la firma,
      // así que el timbre igual saltaba a una línea aparte — quedaban "uno arriba y otro abajo" en
      // vez de al lado, que es como se pidió desde el principio. El salto solo tiene sentido si
      // hay TEXTO (nombre/RUT) después de la imagen — eso es lo único que el timbre podría tapar.
      const cuerpoTrasUltimaImagen = cuerpo.slice(cuerpo.lastIndexOf('</w:drawing>'));
      const tieneTextoTrasImagen = /<w:t[ >]/.test(cuerpoTrasUltimaImagen);
      const necesitaSalto = tieneTextoTrasImagen && !columnaDerecha;
      nuevoCuerpo = cuerpo + (necesitaSalto ? '<w:r><w:br/></w:r>' : '') + drawingCompleto;
    }
  } else if (runRaya) {
    const textoRunCompleto = [...runRaya[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(t => t[1]).join('');
    // BUG REAL (1057678-2-LE26): un run de raya puede traer ESPACIOS ANTES de los guiones
    // ("                  ___________..." — indentación con espacios en vez de <w:tab/>). El
    // regex viejo (`^_+\s*`) solo comía guiones al inicio; con espacios primero no matcheaba nada,
    // así que restoTexto quedaba con el string COMPLETO (espacios + guiones) y ese "resto" se
    // trataba como leyenda real a conservar — la raya entera sobrevivía intacta al lado del dibujo.
    const restoTexto = textoRunCompleto.replace(/^\s*_+\s*/, '');
    if (restoTexto.trim()) {
      const rPrMatch = runRaya[0].match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
      const runLeyenda = `<w:r>${rPrMatch ? rPrMatch[0] : ''}<w:t xml:space="preserve">${xmlEscape(restoTexto)}</w:t></w:r>`;
      nuevoCuerpo = cuerpo.replace(runRaya[0], drawingCompleto + runLeyenda);
    } else {
      nuevoCuerpo = cuerpo.replace(runRaya[0], drawingCompleto);
    }
    for (const sobrante of rayasSobrantes) {
      nuevoCuerpo = nuevoCuerpo.replace(sobrante[0], sobrante[0].replace(/<w:t[^>]*>[^<]*<\/w:t>/, '<w:t/>'));
    }
  } else {
    nuevoCuerpo = cuerpo.replace(/<w:r\b[\s\S]*?<\/w:r>/g, '') + drawingCompleto; // fallback: no se identificó un run puntual
  }

  // Sin esto, el <w:tab/> que separa el texto de la imagen (ver drawingCompleto) no tiene ninguna
  // parada de tabulación que lo empuje al margen — Word lo trataría como el tab por defecto (cada
  // ~1.25cm), y la firma+timbre quedarían pegadas justo después del texto en vez de alineadas al
  // borde derecho. Solo se agrega en la llamada que REALMENTE tabuló (la de la firma, con texto);
  // la del timbre reutiliza el mismo párrafo, que ya la tiene.
  if (columnaDerecha && lineasConTexto.length) {
    nuevoCuerpo = conTabDerecha(nuevoCuerpo, calcularAnchoTextoTwips(xmlConNamespaces));
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

// Marca un párrafo con <w:keepNext/> — le dice a Word "no pongas un salto de página entre este
// párrafo y el siguiente". BUG REAL (3713-7-LE26, "Los Vilos"): la leyenda de firma y el párrafo
// vacío donde se estampa la imagen son DOS párrafos distintos (Casos C/D de detectarLineasFirma);
// sin nada que los ate, Word los paginaba donde cayeran — la leyenda quedaba sola al fondo de una
// página (se leía como "no se firmó") y la firma+nombre aparecían solos al principio de la
// siguiente. Se llama con el paraId de la leyenda Y con el de la firma (ver
// LineaFirma.paraIdLeyenda) para que toda la fila quede pegada. Igual que `conAlineacion`, respeta
// el orden del esquema OOXML: `keepNext` va CASI al principio del `pPr` (después de `pStyle` si
// existe, antes de cualquier otra cosa).
export function marcarKeepNext(xml: string, paraId: string): string {
  const re = new RegExp(`(<w:p\\b[^>]*w14:paraId="${paraId}"[^>]*>)([\\s\\S]*?)(<\\/w:p>)`);
  const m = xml.match(re);
  if (!m) return xml;
  const [entero, apertura, cuerpo, cierre] = m;
  const pPr = cuerpo.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
  let nuevoCuerpo: string;
  if (!pPr) {
    nuevoCuerpo = `<w:pPr><w:keepNext/></w:pPr>${cuerpo}`;
  } else if (/<w:keepNext\b/.test(pPr[1])) {
    nuevoCuerpo = cuerpo; // ya lo tiene
  } else {
    const dentro = pPr[1];
    const pStyleMatch = dentro.match(/^(<w:pStyle[^>]*\/>)/);
    const nuevoDentro = pStyleMatch ? dentro.replace(pStyleMatch[1], `${pStyleMatch[1]}<w:keepNext/>`) : `<w:keepNext/>${dentro}`;
    nuevoCuerpo = cuerpo.replace(pPr[0], `<w:pPr>${nuevoDentro}</w:pPr>`);
  }
  return xml.slice(0, m.index) + apertura + nuevoCuerpo + cierre + xml.slice((m.index ?? 0) + entero.length);
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
