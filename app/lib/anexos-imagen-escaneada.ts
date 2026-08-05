// app/lib/anexos-imagen-escaneada.ts
// Anexo (o una SECCIÓN de un anexo) pegado como FOTO/ESCANEO dentro del .docx, en vez de texto
// real de Word — caso real 1019-79-LP26, ANEXO N°7 "Autorización pagos a través de bancos": el
// organismo pegó el formulario escaneado, y el propio documento anota que ese anexo se descarga
// aparte del portal institucional (dcyf.mop.gob.cl), no se llena desde este Word.
//
// El resto del Anexo Creator (anexos-detectar.ts) solo lee <w:t> — una imagen no tiene texto, así
// que esa sección desaparecía en SILENCIO: ni se autocompletaba ni quedaba pendiente para llenar
// a mano, el usuario no tenía forma de saber que ahí faltaba algo.
//
// Este módulo NO escribe nada en el documento (no se puede editar una foto). Su único trabajo es:
// 1) encontrar las imágenes "sustanciales" (no logos ni líneas decorativas) dentro del .docx,
// 2) correrles OCR (GLM-OCR, con Tesseract local de respaldo),
// 3) preguntarle a la IA qué casillas pide el formulario y con qué dato de la ficha se llenaría,
// para MOSTRÁRSELO al usuario y que lo copie a mano (papel, o el portal externo si aplica).
import JSZip from 'jszip';
import { listarParrafos, type Parrafo } from '@/app/lib/anexos-docx';
import { ocrImagenConGlmOcr } from '@/app/lib/zai-ocr';
import { ocrImagenLocalTesseract } from '@/app/lib/tesseract-ocr';
import { identificarCamposDeSeccionEscaneada, type EmpresaCampos, type CampoSeccionEscaneada } from '@/app/lib/anexos-ia-motor';

const EMU_POR_CM = 360_000;
// Umbral de "imagen sustancial": descarta logos, timbres pequeños y líneas/barras decorativas
// (medido contra 1019-79-LP26: las decorativas miden desde 0.03cm hasta ~7cm de alto, el
// formulario escaneado real mide 14cm y 6.2cm — el corte en 4cm de alto separa bien los dos casos
// sin depender de un solo eje, ya que un logo ancho pero bajo no debe colarse).
const ANCHO_MIN_CM = 8;
const ALTO_MIN_CM = 4;

export interface ImagenEmbebida {
  buffer: Buffer; mimeType: string; cx: number; cy: number;
  // Párrafo (título de sección) inmediatamente anterior a la imagen, si lo hay — para nombrar
  // la sección en pantalla ("AUTORIZACIÓN PAGOS A TRAVÉS DE BANCOS") en vez de "Sección sin título".
  tituloCercano: string | null;
}

const MIME_POR_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
};

// Busca, ANTES de la posición dada, el párrafo con texto más cercano — mismo criterio que
// contextoDeRolCercano en anexos-detectar.ts, pero acá solo interesa el título/leyenda más
// próximo, no un rol específico.
function tituloAntesDe(parrafos: Parrafo[], indiceAntes: number): string | null {
  for (let i = indiceAntes - 1; i >= 0 && i >= indiceAntes - 6; i--) {
    const p = parrafos[i];
    if (p?.texto && p.texto.trim().length >= 3) return p.texto.trim().slice(0, 160);
  }
  return null;
}

// Extrae las imágenes EMBEBIDAS (r:embed de DrawingML) que sean lo bastante grandes como para
// ser un formulario/documento escaneado, no un logo. `xml` debe venir YA normalizado (con
// w14:paraId) — mismo requisito que listarParrafos.
export async function extraerImagenesGrandes(zip: JSZip, xml: string): Promise<ImagenEmbebida[]> {
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string') || '';
  const resolverTarget = (rId: string): string | null =>
    relsXml.match(new RegExp(`<Relationship\\s+Id="${rId}"[^>]*Target="([^"]+)"`))?.[1] || null;

  const parrafos = listarParrafos(xml);
  // Mismo regex de listarParrafos (con w14:paraId), en el MISMO orden — así el N-ésimo match de
  // párrafo acá es exactamente parrafos[N].
  const parrafosCrudos = [...xml.matchAll(/<w:p\b[^>]*w14:paraId="[0-9A-Fa-f]+"[^>]*>[\s\S]*?<\/w:p>/g)];

  const out: ImagenEmbebida[] = [];
  for (const d of xml.matchAll(/<w:drawing\b[^>]*>[\s\S]*?<\/w:drawing>/g)) {
    const extent = d[0].match(/<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"/);
    const embed = d[0].match(/r:embed="(rId\d+)"/);
    if (!extent || !embed) continue; // sin r:embed: es una forma/línea vectorial, no una foto
    const cx = Number(extent[1]), cy = Number(extent[2]);
    if (cx < ANCHO_MIN_CM * EMU_POR_CM || cy < ALTO_MIN_CM * EMU_POR_CM) continue; // logo/decoración

    const target = resolverTarget(embed[1]);
    if (!target) continue;
    const mediaPath = `word/${target.replace(/^(\.\.\/)+/, '')}`;
    const archivo = zip.file(mediaPath);
    if (!archivo) continue;
    const extension = (mediaPath.split('.').pop() || '').toLowerCase();
    const mimeType = MIME_POR_EXTENSION[extension];
    if (!mimeType) continue; // formato no soportado por el OCR (ej. .wmf/.emf vectorial)

    const buffer = await archivo.async('nodebuffer');
    // Párrafo que contiene esta imagen: el ÚLTIMO párrafo crudo cuyo rango empieza antes que la
    // imagen y la contiene — para ubicar el título de sección más cercano hacia atrás.
    let indiceParrafo = -1;
    for (let i = 0; i < parrafosCrudos.length; i++) {
      const m = parrafosCrudos[i];
      if (m.index! <= d.index! && d.index! < m.index! + m[0].length) { indiceParrafo = i; break; }
    }
    const tituloCercano = indiceParrafo >= 0 ? tituloAntesDe(parrafos, indiceParrafo) : null;
    out.push({ buffer, mimeType, cx, cy, tituloCercano });
  }
  return out;
}

// OCR de una imagen con respaldo: GLM-OCR primero (mejor calidad en formularios/tablas), si falla
// o no devuelve nada, Tesseract local (siempre disponible, sin costo ni saldo).
async function ocrConRespaldo(buffer: Buffer, mimeType: string): Promise<string> {
  try {
    const texto = await ocrImagenConGlmOcr(buffer, mimeType);
    if (texto) return texto;
  } catch { /* cae al respaldo */ }
  try {
    return await ocrImagenLocalTesseract(buffer);
  } catch (e) {
    console.warn('[anexos-imagen-escaneada] Tesseract también falló:', e instanceof Error ? e.message : e);
    return '';
  }
}

export interface SeccionEscaneada {
  titulo: string;
  campos: CampoSeccionEscaneada[];
  // El OCR no devolvió nada legible (imagen corrupta, o ambos motores fallaron) — se avisa igual
  // que la sección existe, en vez de omitirla en silencio.
  ocrFallido: boolean;
}

// Punto de entrada: dado el .docx YA abierto (zip + xml normalizado) y la ficha de empresa,
// encuentra las imágenes sustanciales, las OCR-ea, y le pregunta a la IA qué piden — todo de
// SOLO LECTURA, nunca escribe nada en el documento.
export async function analizarSeccionesEscaneadas(
  zip: JSZip, xml: string, empresa: EmpresaCampos,
): Promise<SeccionEscaneada[]> {
  const imagenes = await extraerImagenesGrandes(zip, xml);
  if (!imagenes.length) return [];

  const resultados = await Promise.all(imagenes.map(async (img, i): Promise<SeccionEscaneada> => {
    const titulo = img.tituloCercano || `Sección con imagen ${i + 1}`;
    const textoOcr = await ocrConRespaldo(img.buffer, img.mimeType);
    if (!textoOcr.trim()) return { titulo, campos: [], ocrFallido: true };
    const campos = await identificarCamposDeSeccionEscaneada(textoOcr, empresa);
    return { titulo, campos, ocrFallido: false };
  }));

  // Varias imágenes pueden ser páginas CONSECUTIVAS del mismo formulario (caso real: el bloque
  // "AUTORIZACIÓN PAGOS A TRAVÉS DE BANCOS" salió partido en 2 imágenes) — se agrupan por título
  // para no mostrarle al usuario la misma sección dos veces con campos repartidos.
  const porTitulo = new Map<string, SeccionEscaneada>();
  for (const r of resultados) {
    const previo = porTitulo.get(r.titulo);
    if (!previo) { porTitulo.set(r.titulo, r); continue; }
    previo.campos.push(...r.campos);
    previo.ocrFallido = previo.ocrFallido && r.ocrFallido;
  }
  return [...porTitulo.values()];
}
