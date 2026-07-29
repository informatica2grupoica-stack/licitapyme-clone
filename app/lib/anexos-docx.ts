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

  if (!/xmlns:w14=/.test(xml)) {
    xml = xml.replace(/<w:document /, '<w:document xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ');
  }
  xml = xml.replace(/<w:p\b([^>]*)>/g, (m, attrs) => {
    if (/w14:paraId=/.test(attrs)) return m;
    agregados++;
    return `<w:p${attrs} w14:paraId="${idAleatorio()}" w14:textId="77777777">`;
  });
  return { xml, agregados };
}

// ── Lectura: lista todos los párrafos del documento, en orden ────────────────────────────
export function listarParrafos(xml: string): Parrafo[] {
  const matches = [...xml.matchAll(/<w:p\b[^>]*w14:paraId="([0-9A-Fa-f]+)"[^>]*>([\s\S]*?)<\/w:p>/g)];
  return matches.map(([, paraId, cuerpo], indice) => ({
    paraId,
    texto: [...cuerpo.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('').trim(),
    vacio: !/<w:r[ >]/.test(cuerpo),
    indice,
    centrado: /<w:jc\s+w:val="center"/.test(cuerpo),
  }));
}

export function contarParrafos(xml: string): number {
  return (xml.match(/<w:p\b/g) || []).length;
}

// ── Patrón 1: celda de tabla vacía (párrafo sin ningún <w:r>) ────────────────────────────
// Inserta el valor DENTRO del <w:p> vacío identificado por su paraId — nunca agrega/quita
// párrafo. Reutiliza el rPr del párrafo vacío (si trae uno) para heredar la misma fuente que
// el resto del formulario.
export function rellenarCeldaVacia(xml: string, paraId: string, valor: string): string {
  const re = new RegExp(`(<w:p\\b[^>]*w14:paraId="${paraId}"[^>]*>)([\\s\\S]*?)(<\\/w:p>)`);
  const m = xml.match(re);
  if (!m) throw new Error(`No se encontró el párrafo w14:paraId="${paraId}"`);
  const [entero, apertura, cuerpo, cierre] = m;
  if (/<w:r[ >]/.test(cuerpo)) throw new Error(`El párrafo ${paraId} ya tiene contenido — no se pisa un dato existente`);
  const rPrMatch = cuerpo.match(/<w:pPr>[\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:pPr>/);
  const rPr = rPrMatch ? rPrMatch[1] : '';
  const run = `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(valor)}</w:t></w:r>`;
  return xml.slice(0, m.index) + apertura + cuerpo + run + cierre + xml.slice((m.index ?? 0) + entero.length);
}

// ── Patrones 2 y 3: blancos DENTRO de un mismo <w:t> (subrayado inline / opción a marcar) ─
export interface BlancoInline {
  posEnTexto: number;   // posición del inicio de la corrida de guiones, dentro del <w:t>
  largo: number;        // cuántos guiones bajos tiene la corrida
  contexto: string;     // texto inmediatamente anterior (para mostrarle al humano de qué campo se trata)
}

// Encuentra, en un <w:t> puntual, cada corrida de 4+ guiones bajos con su contexto previo.
export function listarBlancosInline(textoRun: string): BlancoInline[] {
  const out: BlancoInline[] = [];
  let ultimo = 0;
  for (const m of textoRun.matchAll(/_{4,}/g)) {
    const previo = textoRun.slice(ultimo, m.index);
    const contexto = (previo.split(/[,.;]|\(\*+\)/).pop() || previo).trim().slice(-40);
    out.push({ posEnTexto: m.index!, largo: m[0].length, contexto });
    ultimo = m.index! + m[0].length;
  }
  return out;
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
  const runNuevo = `<w:t${m[1]} xml:space="preserve">${xmlEscape(textoNuevo)}</w:t>`;
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
  const [entero, attrs, textoOriginal] = m;

  let textoNuevo = textoOriginal;
  for (const { pos, largo, valor } of [...ediciones].sort((a, b) => b.pos - a.pos)) {
    const charPrevio = textoNuevo[pos - 1] || '';
    const valorFinal = /[A-Za-zÀ-ÿ0-9]/.test(charPrevio) ? ' ' + valor : valor;
    textoNuevo = textoNuevo.slice(0, pos) + valorFinal + textoNuevo.slice(pos + largo);
  }

  const runNuevo = `<w:t${attrs} xml:space="preserve">${xmlEscape(textoNuevo)}</w:t>`;
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
export function verificarXmlBienFormado(xml: string): { valido: boolean; error?: string } {
  const pila: string[] = [];
  const reTag = /<(\/?)([a-zA-Z0-9_:.-]+)(?:\s+[^<>]*?)?(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = reTag.exec(xml))) {
    const [, cierre, nombre, autocierre] = m;
    if (autocierre) continue; // <tag .../> no abre nada que cerrar
    if (!cierre) { pila.push(nombre); continue; }
    const esperado = pila.pop();
    if (esperado !== nombre) {
      return { valido: false, error: `se esperaba cerrar "${esperado}" pero se encontró "</${nombre}>" en la posición ${m.index}` };
    }
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
  anchoCm = 3.5,
): Promise<string> {
  const dim = leerDimensionesImagen(imagen);
  const relacionAltoAncho = dim && dim.anchoPx > 0 ? dim.altoPx / dim.anchoPx : 0.4;
  const anchoEmu = Math.round(anchoCm * EMU_POR_CM);
  const altoEmu = Math.round(anchoEmu * relacionAltoAncho);

  const nombreImagen = `imagen_firma_${paraId}.${extension}`;
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

  // Namespaces del dibujo (wp/a/pic/r) — no todos los documentos los declaran de entrada
  // (solo hace falta si el documento ya trae imágenes propias); se agregan al <w:document> si
  // faltan, mismo mecanismo que normalizarParaIds() usa para w14.
  let xmlConNamespaces = xml;
  const NS: Record<string, string> = {
    wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
    pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
    r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  };
  for (const [prefijo, uri] of Object.entries(NS)) {
    if (!new RegExp(`xmlns:${prefijo}=`).test(xmlConNamespaces)) {
      xmlConNamespaces = xmlConNamespaces.replace(/<w:document /, `<w:document xmlns:${prefijo}="${uri}" `);
    }
  }

  const idDocPr = Math.floor(Math.random() * 1_000_000) + 100;
  const drawing = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">`
    + `<wp:extent cx="${anchoEmu}" cy="${altoEmu}"/>`
    + `<wp:effectExtent l="0" t="0" r="0" b="0"/>`
    + `<wp:docPr id="${idDocPr}" name="Firma"/>`
    + `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${idDocPr}" name="Firma"/><pic:cNvPicPr/></pic:nvPicPr>`
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
  if (runRaya) {
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

  return xmlConNamespaces.slice(0, m.index) + apertura + nuevoCuerpo + cierre
    + xmlConNamespaces.slice((m.index ?? 0) + entero.length);
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
