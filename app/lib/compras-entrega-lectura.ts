// app/lib/compras-entrega-lectura.ts
// Al subir el acta o la guía firmada se LEEN solas (OCR + IA) y llenan lo que falta en «Entrega y acta»: N° de la guía de despacho, quién recibió
// (nombre, RUT, cargo) y la fecha. Pedido del dueño 18-nov-2026: «con solo subir el acta ya estaría». Solo PROPONE: nunca pisa lo que ya estaba
// escrito y, si el documento no lo dice con claridad (la letra a mano es lo más difícil), el dato queda vacío — no se inventa. Se corrige en la pantalla.
import { ocrImagenConGlmOcr, extraerTextoPdfPorUrlConGlmOcr } from '@/app/lib/zai-ocr';
import { ocrPdfLocalTesseract, ocrImagenLocalTesseract } from '@/app/lib/tesseract-ocr';
import { crearChatIA as crearChatIABase } from '@/app/lib/gemini';
import { conModuloIA } from '@/app/lib/ia-uso';
import { parseJsonIA } from '@/app/lib/json-ia';
import { conCupo } from '@/app/lib/cupo-ia';
const crearChatIA = conModuloIA('compras', crearChatIABase);

export interface LecturaEntrega {
  guiaNumero: string | null; fecha: string | null; recibeNombre: string | null; recibeRut: string | null; recibeCargo: string | null;
}

const SISTEMA = `Lees un documento chileno de ENTREGA ya firmado (acta de entrega o guía de despacho electrónica), transcrito por OCR (la letra a mano sale con errores).
Devuelve SOLO un JSON con estas claves; usa null cuando el documento no lo diga con claridad (NUNCA inventes ni adivines):
{ "guiaNumero": "número de la guía de despacho (en el acta: «Guía Despacho N°»; en la guía: el «Nº» del recuadro rojo), solo el número",
  "fecha": "YYYY-MM-DD, fecha del acta o de emisión de la guía (en el acta, «Fecha»; si hay «Fecha Recepción» escrita, esa)",
  "recibeNombre": "nombre de la persona que RECIBIÓ, de la sección «Recepción conforme» o de la firma manuscrita; null si es ilegible",
  "recibeRut": "RUT de quien recibió, con puntos y guion (ej. 13.434.801-1); null si no está o no se lee",
  "recibeCargo": "cargo de quien recibió; null si no se lee" }
No uses como «quien recibió» a la empresa que vende (COMERCIAL MP, Inversiones Claro) ni al chofer o transportista.`;

async function textoDelDocumento(url: string, nombre: string, buffer: Buffer): Promise<string> {
  const esPdf = /\.pdf$/i.test(nombre);
  let texto = '';
  if (esPdf) {
    try { texto = ((await (await import('pdf-parse')).default(buffer)).text || '').trim(); } catch { /* escaneado: sin capa de texto */ }
    if (texto.length < 80) { try { texto = (await extraerTextoPdfPorUrlConGlmOcr(url, 0)) || ''; } catch (e) { console.warn('[compras-entrega-lectura] GLM-OCR falló:', String(e).slice(0, 120)); } }
    if (texto.trim().length < 20) { try { texto = await ocrPdfLocalTesseract(buffer); } catch (e) { console.warn('[compras-entrega-lectura] Tesseract falló:', String(e).slice(0, 120)); } }
  } else {
    const mime = /\.png$/i.test(nombre) ? 'image/png' : /\.webp$/i.test(nombre) ? 'image/webp' : 'image/jpeg';
    try { texto = await ocrImagenConGlmOcr(buffer, mime); } catch (e) { console.warn('[compras-entrega-lectura] GLM-OCR falló:', String(e).slice(0, 120)); }
    if (texto.trim().length < 20) { try { texto = await ocrImagenLocalTesseract(buffer); } catch { /* sin lectura */ } }
  }
  return texto.trim();
}

const limpio = (v: unknown, max: number) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max); return t && !/^(null|n\/a|ninguno|—|-)$/i.test(t) ? t : null; };

export async function leerDocumentoEntrega(url: string, nombre: string, buffer: Buffer): Promise<LecturaEntrega | null> {
  const texto = await textoDelDocumento(url, nombre, buffer);
  if (texto.length < 20) return null;
  const completion: any = await conCupo('compras-lectura', 3, () => crearChatIA({
    messages: [{ role: 'system', content: SISTEMA }, { role: 'user', content: texto.slice(0, 8_000) }],
    temperature: 0, stream: false, max_tokens: 600, response_format: { type: 'json_object' },
  }, { timeoutMs: 60_000, modeloPreferido: 'glm-4.7', soloGlm: true }));
  const p: any = parseJsonIA(String(completion.choices?.[0]?.message?.content ?? '')) || {};
  const guia = limpio(p.guiaNumero, 20)?.replace(/[^\dA-Za-z-]/g, '') || null;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(p.fecha || '')) && !Number.isNaN(Date.parse(p.fecha)) ? String(p.fecha) : null;
  const rut = limpio(p.recibeRut, 14); const rutOk = rut && /^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/.test(rut) ? rut : null;
  return { guiaNumero: guia, fecha, recibeNombre: limpio(p.recibeNombre, 120), recibeRut: rutOk, recibeCargo: limpio(p.recibeCargo, 80) };
}
