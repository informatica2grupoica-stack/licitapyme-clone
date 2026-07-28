// app/lib/anexos-doc-legacy.ts
// Puente hacia el microservicio conversor-doc/ (contenedor aparte, mismo docker-compose que la
// app) que convierte .doc (Word 97-2003, binario OLE) a .docx con LibreOffice headless. En
// producción DOC_CONVERSOR_URL apunta a la red interna de compose (http://conversor-doc:8091).
// Sin esa variable configurada, un anexo .doc simplemente no se puede rellenar — se avisa con
// un mensaje claro, nunca en silencio.
const TIMEOUT_MS = 45_000;

export async function convertirDocADocx(bufferDoc: Buffer): Promise<Buffer> {
  const url = process.env.DOC_CONVERSOR_URL;
  const secreto = process.env.DOC_CONVERSOR_SECRET;
  if (!url || !secreto) {
    throw new Error(
      'Este anexo viene en formato .doc (Word antiguo) y el conversor a .docx no está configurado ' +
      '(falta DOC_CONVERSOR_URL/DOC_CONVERSOR_SECRET). Conviértelo a .docx manualmente mientras tanto.',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/convertir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/msword', 'x-conversor-secret': secreto },
      body: new Uint8Array(bufferDoc),
      signal: controller.signal,
    });
    if (!res.ok) {
      const texto = await res.text().catch(() => '');
      throw new Error(`El conversor de .doc respondió ${res.status}: ${texto.slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('El conversor de .doc no respondió a tiempo');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
