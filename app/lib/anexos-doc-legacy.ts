// app/lib/anexos-doc-legacy.ts
// Puente hacia el microservicio conversor-doc/ (contenedor aparte, mismo docker-compose que la
// app) que convierte .doc (Word 97-2003, binario OLE) O .pdf a .docx, y .docx a .pdf, con
// LibreOffice headless. En producción DOC_CONVERSOR_URL apunta a la red interna de compose
// (http://conversor-doc:8091). Sin esa variable configurada, un anexo .doc/.pdf simplemente no se
// puede procesar — se avisa con un mensaje claro, nunca en silencio.
//
// PDF (14-ago-2026, pedido explícito del usuario: "sacar los anexos de un PDF y dejarlos en
// Word", sin tocar el PDF original): mismo microservicio, mismo comando de LibreOffice — solo
// cambia el Content-Type que le avisa al conversor qué extensión de temporal escribir (ver
// server.mjs). Un PDF ESCANEADO (imagen, sin capa de texto real) convierte a un .docx vacío o con
// basura — LibreOffice no hace OCR — así que el caller (anexos-datos.ts) es responsable de NO
// mandar acá un PDF que necesitó OCR para leerse (ver metodo_extraccion en documentos_cache).
// REINTENTOS (auditoría 28-ago-2026): este puente es un ÚNICO punto de falla para 866 archivos
// .doc de la base (uno de cada diez documentos Word de licitación). Un tropiezo suyo no degrada
// nada: el anexo entero no se puede ni abrir. Y varios de sus modos de falla son TRANSITORIOS —
// LibreOffice arranca en frío la primera conversión tras un rato inactivo, el contenedor puede
// estar reiniciándose (502/503/504), o la red interna de compose parpadea.
//
// Se reintenta SOLO lo transitorio. Un 4xx significa que el conversor miró el archivo y lo
// rechazó: reintentarlo da exactamente el mismo resultado y solo hace esperar al usuario.
const INTENTOS = 3;
const ESPERA_BASE_MS = 1_500;

function esTransitorio(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

const esperar = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Firma de salida por byte mágico — un .docx es un ZIP (siempre "PK"), un .pdf empieza literal
// con "%PDF-". Si el conversor devuelve 200 con un cuerpo que no lo es (una página de error de un
// proxy intermedio, un cuerpo vacío), dejarlo pasar convierte un fallo del conversor en un "el
// documento está corrupto" varias capas más arriba, donde ya no hay forma de saber de dónde salió.
const esDocxValido = (b: Buffer) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b;
const esPdfValido = (b: Buffer) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-';

async function unIntento(
  url: string, secreto: string, buffer: Buffer, contentType: string, timeoutMs: number,
  endpoint: string, validarSalida: (b: Buffer) => boolean, descripcionSalida: string,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; motivo: string; transitorio: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'x-conversor-secret': secreto },
      body: new Uint8Array(buffer),
      signal: controller.signal,
    });
    if (!res.ok) {
      const texto = await res.text().catch(() => '');
      return {
        ok: false, transitorio: esTransitorio(res.status),
        motivo: `el conversor respondió ${res.status}${texto ? `: ${texto.slice(0, 200)}` : ''}`,
      };
    }
    const convertido = Buffer.from(await res.arrayBuffer());
    if (!validarSalida(convertido)) {
      return { ok: false, transitorio: true, motivo: `el conversor devolvió ${convertido.length} byte(s) que no son un ${descripcionSalida} válido` };
    }
    return { ok: true, buffer: convertido };
  } catch (error: any) {
    // Timeout y errores de red son los dos casos transitorios clásicos: LibreOffice en frío tarda
    // más que de costumbre, o el contenedor todavía no termina de levantar.
    const esTimeout = error?.name === 'AbortError';
    return {
      ok: false, transitorio: true,
      motivo: esTimeout ? 'el conversor no respondió a tiempo' : `no se pudo llegar al conversor (${String(error?.message || error).slice(0, 120)})`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

interface OpcionesConversion {
  endpoint: string; validarSalida: (b: Buffer) => boolean; descripcionSalida: string;
}
const DESTINO_DOCX: OpcionesConversion = { endpoint: '/convertir', validarSalida: esDocxValido, descripcionSalida: '.docx' };

async function convertir(
  buffer: Buffer, contentType: string, timeoutMs: number, etiqueta: string, destino: OpcionesConversion = DESTINO_DOCX,
): Promise<Buffer> {
  const url = process.env.DOC_CONVERSOR_URL;
  const secreto = process.env.DOC_CONVERSOR_SECRET;
  if (!url || !secreto) {
    throw new Error(
      `Este documento viene en formato ${etiqueta} y el conversor a ${destino.descripcionSalida} no está configurado ` +
      '(falta DOC_CONVERSOR_URL/DOC_CONVERSOR_SECRET). Conviértelo manualmente mientras tanto.',
    );
  }

  let ultimoMotivo = '';
  for (let intento = 1; intento <= INTENTOS; intento++) {
    const r = await unIntento(url, secreto, buffer, contentType, timeoutMs, destino.endpoint, destino.validarSalida, destino.descripcionSalida);
    if (r.ok) {
      if (intento > 1) console.warn(`[anexos-doc-legacy] La conversión de ${etiqueta} funcionó recién en el intento ${intento}.`);
      return r.buffer;
    }
    ultimoMotivo = r.motivo;
    if (!r.transitorio) break; // el conversor rechazó ESTE archivo: reintentar da lo mismo
    if (intento < INTENTOS) {
      console.warn(`[anexos-doc-legacy] Conversión de ${etiqueta} fallida (intento ${intento}/${INTENTOS}) — ${r.motivo}. Reintentando…`);
      await esperar(ESPERA_BASE_MS * intento);
    }
  }
  // El mensaje dice QUÉ falló y QUÉ hacer: sin esto, todos los modos de falla del conversor
  // llegaban a la pantalla como una frase técnica distinta y ninguna accionable.
  throw new Error(
    `No se pudo convertir este documento ${etiqueta} a ${destino.descripcionSalida} después de ${INTENTOS} intento(s) — ${ultimoMotivo}. `
    + 'Es un problema del conversor, no del anexo: reintenta en un momento.',
  );
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

const DESTINO_PDF: OpcionesConversion = { endpoint: '/convertir-pdf', validarSalida: esPdfValido, descripcionSalida: '.pdf' };

// DOCX → PDF (29-ago-2026, pedido explícito del usuario): paso previo para poder posicionar la
// firma/timbre con precisión real — ver el comentario largo en conversor-doc/server.mjs. Entrada
// siempre `application/vnd...wordprocessingml.document` (el anexo YA generado con el texto
// puesto, antes de estampar ninguna imagen), nunca .doc/.pdf crudos.
export async function convertirDocxAPdf(bufferDocx: Buffer): Promise<Buffer> {
  return convertir(bufferDocx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 60_000, '.docx', DESTINO_PDF);
}
