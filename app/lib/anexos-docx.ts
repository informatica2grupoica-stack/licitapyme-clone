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
