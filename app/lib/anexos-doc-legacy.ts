// app/lib/anexos-doc-legacy.ts
// Puente hacia el microservicio conversor-doc/ (contenedor aparte, mismo docker-compose que la
// app) que convierte .doc (Word 97-2003, binario OLE) O .pdf a .docx con LibreOffice headless. En
// producción DOC_CONVERSOR_URL apunta a la red interna de compose (http://conversor-doc:8091).
// Sin esa variable configurada, un anexo .doc/.pdf simplemente no se puede procesar — se avisa
// con un mensaje claro, nunca en silencio.
//
// PDF (14-ago-2026, pedido explícito del usuario: "sacar los anexos de un PDF y dejarlos en
// Word", sin tocar el PDF original): mismo microservicio, mismo comando de LibreOffice — solo
// cambia el Content-Type que le avisa al conversor qué extensión de temporal escribir (ver
// server.mjs). Un PDF ESCANEADO (imagen, sin capa de texto real) convierte a un .docx vacío o con
// basura — LibreOffice no hace OCR — así que el caller (anexos-datos.ts) es responsable de NO
// mandar acá un PDF que necesitó OCR para leerse (ver metodo_extraccion en documentos_cache).
async function convertir(buffer: Buffer, contentType: string, timeoutMs: number, etiqueta: string): Promise<Buffer> {
  const url = process.env.DOC_CONVERSOR_URL;
  const secreto = process.env.DOC_CONVERSOR_SECRET;
  if (!url || !secreto) {
    throw new Error(
      `Este documento viene en formato ${etiqueta} y el conversor a .docx no está configurado ` +
      '(falta DOC_CONVERSOR_URL/DOC_CONVERSOR_SECRET). Conviértelo a .docx manualmente mientras tanto.',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/convertir`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'x-conversor-secret': secreto },
      body: new Uint8Array(buffer),
      signal: controller.signal,
    });
    if (!res.ok) {
      const texto = await res.text().catch(() => '');
      throw new Error(`El conversor de ${etiqueta} respondió ${res.status}: ${texto.slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error(`El conversor de ${etiqueta} no respondió a tiempo`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function convertirDocADocx(bufferDoc: Buffer): Promise<Buffer> {
  return convertir(bufferDoc, 'application/msword', 45_000, '.doc');
}

// Margen más largo que .doc: un PDF de varias decenas de páginas con tablas reales tarda más en
// re-maquetarse a OOXML que un .doc chico — medido no en vivo todavía (feature nueva), margen
// generoso a propósito para no cortar en el primer caso real grande.
export async function convertirPdfADocx(bufferPdf: Buffer): Promise<Buffer> {
  return convertir(bufferPdf, 'application/pdf', 90_000, '.pdf');
}
