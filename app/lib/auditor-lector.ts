// app/lib/auditor-lector.ts
// AUDITOR · LECTOR DE RESPALDOS (PROMPT 6 v1.0). Lee UN documento (cotización, proforma, ficha…) una
// sola vez y lo convierte en campos con cita; NO evalúa nada. Los verificadores (técnico y de costo)
// trabajan sobre esta extracción, no sobre el documento crudo. Spec: docs/PROMPT_6_Lector_Respaldos_v1_0.md
//
// Pasos: (1) transcribir el archivo a texto (pdf-parse si tiene capa de texto; si no, GLM-OCR y como
// respaldo Tesseract local) → (2) una llamada de IA con el prompt del Lector → (3) guardar la salida
// en auditor_extraccion junto con el texto transcrito (para poder verificar citas después).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { ocrImagenConGlmOcr, extraerTextoPdfPorUrlConGlmOcr } from '@/app/lib/zai-ocr';
import { ocrPdfLocalTesseract, ocrImagenLocalTesseract } from '@/app/lib/tesseract-ocr';
import * as P from '@/app/lib/auditor-lector-prompts';

export type ModoLector = 'completo' | 'comercial';
const MODELO_LECTOR = 'glm-4.7';
const MAX_CHARS_TEXTO = 40_000;

// ── Forma de la salida del Lector (subconjunto de PROMPT_6 Parte V.1 que usa el código) ────────────
export interface DatoConCita { valor?: string; cita?: string }
export interface ProductoLector {
  es_producto_principal?: boolean;
  comercial?: {
    precios?: Array<{ valor?: string; condicion?: string; detalle_condicion?: string; variante?: string; seleccionada?: boolean; cita?: string; numero_ambiguo?: boolean }>;
    moneda?: string; unidad_precio?: string; contenido_empaque?: string; unidades_por_empaque?: string;
    iva?: 'incluido' | 'neto' | 'no_declarado'; iva_texto_literal?: string;
    moq?: string; stock?: string; plazo_entrega?: string; tipo_dias?: string; despacho?: string; incoterm?: string;
    costos_adicionales?: Array<{ detalle?: string; monto?: string; cita?: string }>;
    garantia?: string; condiciones_generales?: Array<{ texto?: string; cita?: string }>;
  };
  producto?: {
    tipo?: string; marca?: string; modelo?: string; version?: string; sku_fabricante?: string; sku_proveedor?: string; ean?: string; procedencia?: string;
    peso?: string; largo?: string; ancho?: string; alto?: string; unidad_peso?: string; unidad_dimensiones?: string;
    accesorios_estandar?: Array<{ item?: string; texto_original?: string; cita?: string }>;
    accesorios_opcionales?: Array<{ item?: string; texto_original?: string; cita?: string }>;
    normas?: Array<{ norma?: string; texto_original?: string; cita?: string }>;
  };
  caracteristicas?: Array<{ nombre?: string; valor?: string; unidad?: string; texto_original?: string; cita?: string }>;
}
export interface SalidaLector {
  modo?: string;
  documento?: {
    tipo?: string; emisor?: string; formalidad?: 'formal' | 'informal'; fecha_emision?: string; vigencia?: string;
    numero?: string; idioma?: string; es_listado_web?: boolean; legibilidad?: 'completa' | 'parcial' | 'nula'; no_legible_detalle?: string;
  };
  proveedor?: {
    razon_social?: DatoConCita; nombre_fantasia?: DatoConCita; rut?: DatoConCita; id_tributario_extranjero?: DatoConCita;
    giro?: DatoConCita; direccion?: DatoConCita; comuna?: DatoConCita; region?: DatoConCita; pais?: DatoConCita;
    direccion_bodega?: DatoConCita; vendedor?: DatoConCita; telefono?: DatoConCita; celular?: DatoConCita;
    email?: DatoConCita; website?: DatoConCita; condiciones_pago?: DatoConCita;
    transferencia?: { banco?: string; tipo_cuenta?: string; numero_cuenta?: string; titular?: string; rut_titular?: string; cita?: string };
  };
  productos?: ProductoLector[];
  no_pude_leer?: Array<{ que?: string; donde?: string }>;
  observaciones?: string[];
}
/** Lo que se guarda en auditor_extraccion.extraccion_json. */
export interface ExtraccionGuardada { modo: ModoLector; salida: SalidaLector; texto: string; metodoTexto: string }

// ── 1) Transcribir el archivo ────────────────────────────────────────────────────────────────────
function mimeDe(url: string, contentType: string | null): string {
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  if (ct && ct !== 'application/octet-stream') return ct;
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
  return ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string, string>)[ext] || 'application/octet-stream';
}

/** Marca con la que empieza el texto cuando trae DOS transcripciones OCR del mismo archivo (re-análisis). */
export const MARCA_OCR_COMBINADO = 'TRANSCRIPCIÓN 1 (GLM-OCR';
function unirTranscripciones(glm: string, tesseract: string): string {
  return `${MARCA_OCR_COMBINADO}: conserva la estructura del documento pero puede perder textos, p. ej. cifras grandes o de color)\n${glm.trim() || '(no entregó texto)'}\n\nTRANSCRIPCIÓN 2 (Tesseract: texto suelto, sin estructura; las columnas de una tabla quedan en una misma línea, en el mismo orden que en el documento)\n${tesseract.trim() || '(no entregó texto)'}`;
}

/** @param opts.combinar re-análisis: para imágenes y PDFs escaneados junta GLM-OCR y Tesseract, porque cada uno pierde cosas distintas
 *  (caso real: una lista de precios donde GLM-OCR perdió los precios vigentes y Tesseract los tenía todos). */
export async function transcribirDocumento(url: string, opts: { combinar?: boolean } = {}): Promise<{ texto: string; metodo: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`no se pudo descargar el documento (HTTP ${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error('el archivo quedó vacío al subirlo (0 bytes): elimínalo y vuelve a subirlo en Documentos');
  const mime = mimeDe(url, res.headers.get('content-type'));
  const esPdf = mime === 'application/pdf';

  if (esPdf) {
    // 1º capa de texto real (exacta y gratis).
    try {
      const pdfParse = (await import('pdf-parse')).default;
      const t = ((await pdfParse(buffer)).text || '').trim();
      if (t.length >= 150) return { texto: t, metodo: 'pdf-parse' };
    } catch (e) { console.warn('[auditor-lector] pdf-parse falló:', String(e).slice(0, 120)); }
    if (opts.combinar) {
      const [g, t] = await Promise.all([
        extraerTextoPdfPorUrlConGlmOcr(url, 0).catch(() => ''),
        ocrPdfLocalTesseract(buffer).catch(() => ''),
      ]);
      if ((g + t).trim().length >= 50) return { texto: unirTranscripciones(g, t), metodo: 'glm-ocr+tesseract' };
    }
    // 2º GLM-OCR por URL pública (escaneados), 3º Tesseract local.
    try {
      const t = (await extraerTextoPdfPorUrlConGlmOcr(url, 0)).trim();
      if (t.length >= 50) return { texto: t, metodo: 'glm-ocr' };
    } catch (e) { console.warn('[auditor-lector] GLM-OCR (pdf) falló:', String(e).slice(0, 120)); }
    const t = (await ocrPdfLocalTesseract(buffer).catch(() => '')).trim();
    if (t.length >= 50) return { texto: t, metodo: 'tesseract' };
    throw new Error('no se pudo leer el PDF (sin texto y el OCR no transcribió nada)');
  }

  if (mime.startsWith('image/')) {
    if (opts.combinar) {
      const [g, t] = await Promise.all([ocrImagenConGlmOcr(buffer, mime).catch(() => ''), ocrImagenLocalTesseract(buffer).catch(() => '')]);
      if ((g + t).trim().length >= 20) return { texto: unirTranscripciones(g, t), metodo: 'glm-ocr+tesseract' };
      throw new Error('no se pudo leer la imagen (ningún OCR transcribió texto legible)');
    }
    const g = (await ocrImagenConGlmOcr(buffer, mime).catch(() => '')).trim();
    if (g.length >= 20) return { texto: g, metodo: 'glm-ocr' };
    const t = (await ocrImagenLocalTesseract(buffer).catch(() => '')).trim();
    if (t.length >= 20) return { texto: t, metodo: 'tesseract' };
    throw new Error('no se pudo leer la imagen (el OCR no transcribió texto legible)');
  }
  throw new Error(`formato no soportado por el Lector (${mime})`);
}

// ── 2) Prompt + llamada ──────────────────────────────────────────────────────────────────────────
function promptSistema(modo: ModoLector, esWeb = false): string {
  const instruccionModo = modo === 'comercial'
    ? `MODO: COMERCIAL. Extrae los bloques A, B y C completos y, del bloque D, solo tipo de producto, marca, modelo, versión, SKU del fabricante y SKU del proveedor. En "productos[].caracteristicas" deja SIEMPRE una lista vacía (no las extraigas en este modo).`
    : `MODO: COMPLETO. Extrae los bloques A, B, C, D y E.`;
  return [
    P.PARTE_I,
    ...(esWeb ? [`REGLAS PARA PÁGINAS WEB (PARTE II del prompt) — lo que recibes es la captura de texto de UNA página:\n${P.PARTE_II}`] : []),
    `LOS BLOQUES QUE EXTRAES (PARTE III del prompt):\n${P.PARTE_III}`,
    instruccionModo,
    `FORMATO DE SALIDA — responde SOLO con un objeto JSON válido con esta forma (campos vacíos = ""; listas vacías = []):\n${P.JSON_COMPLETO_COMERCIAL}`,
    `REGLAS DE FORMATO ADICIONALES:
- Cada cita es CORTA (ej. "p.1 tabla ítem 3"). No copies párrafos enteros.
- Cotizaciones con muchos ítems: un elemento de "productos" por cada ítem cotizado, con SU precio y SU cantidad; nunca mezcles datos de dos ítems. La cantidad cotizada de cada ítem va en "comercial.unidades_por_empaque" SOLO si el documento habla de empaques; la cantidad pedida NO es contenido del empaque — en ese caso anótala en "comercial.condiciones_generales" con el texto "cantidad cotizada: N".
- Un flete, despacho, instalación o envío cobrado como línea aparte NO es un producto: va en "costos_adicionales" del producto al que corresponde o, si es general, en "observaciones".
- Los números se copian tal como aparecen en el documento (no los conviertas); los montos en pesos chilenos usan punto de miles.
- Para acortar la salida, OMITE del JSON todo campo que esté vacío ("" o []): el sistema interpreta un campo ausente igual que uno vacío.
- IVA: marca "incluido" o "neto" SOLO si el documento lo dice con palabras ("IVA incluido", "+ IVA", "neto", "afecto"), y copia esa frase en "iva_texto_literal". Un pie con "I.V.A 19%" o un total de IVA no dice si los precios unitarios lo incluyen: en ese caso "no_declarado".
- No agregues texto fuera del JSON.`,
    P.PARTE_VI,
  ].join('\n\n');
}

const NOTA_OCR_COMBINADO = `NOTA: este documento trae DOS transcripciones OCR del MISMO archivo. Una puede haber perdido texto que la otra conserva (por ejemplo precios grandes o de color): usa lo que aparezca en CUALQUIERA de las dos y no inventes nada que no esté en ninguna. En una lista de precios por columnas (cada modelo o capacidad es una columna), la transcripción 2 deja los valores de una misma fila en una sola línea, en el orden de las columnas: asigna cada valor a SU columna. Un precio precedido por "ANTES" o tachado es el precio anterior, no el vigente: el vigente es el otro de esa columna. Si una columna no tiene precio vigente legible, déjalo sin precio.`;

async function llamarLector(texto: string, nombre: string, modo: ModoLector, esWeb = false): Promise<SalidaLector> {
  const system = promptSistema(modo, esWeb);
  const combinado = texto.startsWith(MARCA_OCR_COMBINADO);
  const user = `${esWeb ? 'PÁGINA WEB' : 'DOCUMENTO'}: ${nombre}\n\n${combinado ? NOTA_OCR_COMBINADO + '\n\n' : ''}${esWeb ? 'TEXTO CAPTURADO DE LA PÁGINA' : 'TEXTO TRANSCRITO DEL DOCUMENTO'}:\n${texto.slice(0, MAX_CHARS_TEXTO)}`;
  let ultimo = '';
  for (let intento = 1; intento <= 2; intento++) {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0, stream: false, max_tokens: 12_000, response_format: { type: 'json_object' },
    }, { timeoutMs: 240_000, modeloPreferido: MODELO_LECTOR, soloGlm: true });
    const contenido = String(completion.choices?.[0]?.message?.content ?? '');
    const parsed = parseJsonIA<SalidaLector>(contenido);
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return parsed;
    ultimo = `finish=${completion.choices?.[0]?.finish_reason} largo=${contenido.length}`;
    console.warn(`[auditor-lector] intento ${intento}: respuesta no interpretable (${ultimo})`);
  }
  throw new Error(`el modelo no devolvió una respuesta interpretable (${ultimo})`);
}

// ── 3) Leer y guardar ────────────────────────────────────────────────────────────────────────────
/** Lee un documento con el Lector y guarda la extracción (o el error) en auditor_extraccion. Devuelve el
 *  id de la extracción. Nunca lanza: si la lectura falla, queda una fila con `error` para que la pantalla
 *  muestre por qué y permita reintentar. */
export async function leerYGuardarDocumento(params: {
  negocioId: number; url: string; nombre: string; modo?: ModoLector;
  opcionId?: number | null; respaldoId?: number | null;
  /** Re-análisis: transcribe con los dos OCR y los junta (ver transcribirDocumento). */
  combinarOCR?: boolean;
}): Promise<{ id: number; error: string | null }> {
  const { negocioId, url, nombre, modo = 'comercial', opcionId = null, respaldoId = null, combinarOCR = false } = params;
  const ahora = ahoraChileSQL();
  try {
    const { texto, metodo } = await transcribirDocumento(url, { combinar: combinarOCR });
    const salida = await llamarLector(texto, nombre, modo);
    const guardada: ExtraccionGuardada = { modo, salida, texto: texto.slice(0, MAX_CHARS_TEXTO), metodoTexto: metodo };
    const [ins] = await pool.query(
      `INSERT INTO auditor_extraccion (negocio_id, documento_url, documento_nombre, opcion_id, respaldo_id, modo, extraccion_json, motor, creado_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [negocioId, url, nombre, opcionId, respaldoId, modo, JSON.stringify(guardada), MODELO_LECTOR, ahora],
    ) as any;
    return { id: ins.insertId as number, error: null };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 480);
    console.error('[auditor-lector] falló la lectura de', nombre, '→', msg);
    const [ins] = await pool.query(
      `INSERT INTO auditor_extraccion (negocio_id, documento_url, documento_nombre, opcion_id, respaldo_id, modo, extraccion_json, motor, error, creado_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
      [negocioId, url, nombre, opcionId, respaldoId, modo, MODELO_LECTOR, msg, ahora],
    ) as any;
    return { id: ins.insertId as number, error: msg };
  }
}

/** Igual que leerYGuardarDocumento pero para el TEXTO de una captura de link (el modelo no navega: el sistema ya visitó
 *  la página y guardó la captura). La extracción queda ligada a la opción y al respaldo del link. */
export async function leerYGuardarPaginaWeb(params: {
  negocioId: number; url: string; titulo: string; texto: string; modo?: ModoLector; opcionId?: number | null; respaldoId?: number | null;
}): Promise<{ id: number; error: string | null }> {
  const { negocioId, url, titulo, texto, modo = 'completo', opcionId = null, respaldoId = null } = params;
  const ahora = ahoraChileSQL();
  try {
    if (!texto || texto.trim().length < 80) throw new Error('la página no entregó texto legible (¿bloquea navegadores automáticos o pide iniciar sesión?)');
    const salida = await llamarLector(texto, `${titulo || url} (${url})`, modo, true);
    const guardada: ExtraccionGuardada = { modo, salida, texto: texto.slice(0, MAX_CHARS_TEXTO), metodoTexto: 'captura-web' };
    const [ins] = await pool.query(
      `INSERT INTO auditor_extraccion (negocio_id, documento_url, documento_nombre, opcion_id, respaldo_id, modo, extraccion_json, motor, creado_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [negocioId, url.slice(0, 1000), (titulo || url).slice(0, 300), opcionId, respaldoId, modo, JSON.stringify(guardada), MODELO_LECTOR, ahora]) as any;
    return { id: ins.insertId as number, error: null };
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 480);
    console.error('[auditor-lector] falló la lectura de la página', url, '→', msg);
    const [ins] = await pool.query(
      `INSERT INTO auditor_extraccion (negocio_id, documento_url, documento_nombre, opcion_id, respaldo_id, modo, extraccion_json, motor, error, creado_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
      [negocioId, url.slice(0, 1000), (titulo || url).slice(0, 300), opcionId, respaldoId, modo, MODELO_LECTOR, msg, ahora]) as any;
    return { id: ins.insertId as number, error: msg };
  }
}

export async function extraccionPorId(id: number): Promise<{ id: number; negocioId: number | null; documentoUrl: string | null; documentoNombre: string | null; error: string | null; creadoAt: string; data: ExtraccionGuardada | null } | null> {
  const [rows] = await pool.query(
    `SELECT id, negocio_id, documento_url, documento_nombre, extraccion_json, error, creado_at FROM auditor_extraccion WHERE id = ?`, [id]) as any;
  const r = (rows as any[])[0];
  if (!r) return null;
  let data: ExtraccionGuardada | null = null;
  try { const j = JSON.parse(r.extraccion_json); data = j?.salida ? j : null; } catch { /* legado / vacío */ }
  return { id: r.id, negocioId: r.negocio_id, documentoUrl: r.documento_url, documentoNombre: r.documento_nombre, error: r.error, creadoAt: String(r.creado_at), data };
}

/** Varias extracciones en UNA consulta (el panel del Auditor las necesita todas: una consulta por extracción contra la base remota tardaba segundos). */
export async function extraccionesPorIds(ids: number[]): Promise<Map<number, { documentoUrl: string | null; documentoNombre: string | null; data: ExtraccionGuardada | null }>> {
  const out = new Map<number, { documentoUrl: string | null; documentoNombre: string | null; data: ExtraccionGuardada | null }>();
  const unicos = [...new Set(ids.filter(n => Number.isFinite(n)))];
  if (unicos.length === 0) return out;
  const [rows] = await pool.query(`SELECT id, documento_url, documento_nombre, extraccion_json FROM auditor_extraccion WHERE id IN (?)`, [unicos]) as any;
  for (const r of rows as any[]) {
    let data: ExtraccionGuardada | null = null;
    try { const j = JSON.parse(r.extraccion_json); data = j?.salida ? j : null; } catch { /* legado / vacío */ }
    out.set(r.id, { documentoUrl: r.documento_url, documentoNombre: r.documento_nombre, data });
  }
  return out;
}
