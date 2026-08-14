// conversor-doc/server.mjs
// Microservicio interno: recibe un .doc (Word 97-2003) O un .pdf por POST y devuelve el mismo
// documento convertido a .docx (OOXML), usando LibreOffice headless (soffice) instalado en la
// imagen. Contenedor aparte del de "app" en el mismo docker-compose, para no cargar esa imagen
// con LibreOffice — se llega por la red interna de compose (http://conversor-doc:8091), nunca
// expuesto al público.
//
// PDF (14-ago-2026, pedido explícito del usuario): mismo comando de LibreOffice, distinta
// extensión de entrada — `soffice --convert-to docx` detecta el formato de origen por la
// extensión del archivo, así que basta con escribir el temporal como .pdf en vez de .doc.
// LibreOffice NO hace OCR: un PDF escaneado (imagen) convierte a un .docx vacío o con basura —
// el CALLER (anexos-doc-legacy.ts) es responsable de no mandar un PDF escaneado acá, este
// servicio no tiene forma de saberlo por sí solo.
//
// Un solo endpoint, sin framework (no hace falta express para esto):
//   POST /convertir   body = bytes crudos, Content-Type: application/msword (.doc) o
//                      application/pdf (.pdf), header x-conversor-secret = CONVERSOR_SECRET
//                      → 200 con los bytes del .docx (Content-Type OOXML)
//   GET  /salud        → 200 "ok" (para healthcheck de docker-compose)
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 8091);
const SECRET = process.env.CONVERSOR_SECRET || '';
const MAX_BYTES = 50 * 1024 * 1024; // 50MB — un anexo real nunca debería acercarse a esto
const TIMEOUT_MS = 60_000;

if (!SECRET) {
  console.error('[conversor-doc] ⚠️ CONVERSOR_SECRET no definido — el servicio rechazará TODAS las conversiones (401). Sin esto queda abierto a cualquiera que le pegue al puerto.');
}

async function leerBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new Error('Archivo demasiado grande');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function convertirADocx(bufferEntrada, extensionEntrada) {
  const id = randomUUID();
  const dir = await mkdtemp(join(tmpdir(), `conv-${id}-`));
  const perfilLO = join(tmpdir(), `lo-profile-${id}`); // perfil aislado: evita choques si dos conversiones caen a la vez
  const entrada = join(dir, `entrada.${extensionEntrada}`);
  await writeFile(entrada, bufferEntrada);

  try {
    await execFileAsync('soffice', [
      '--headless', '--norestore',
      `-env:UserInstallation=file://${perfilLO}`,
      '--convert-to', 'docx',
      '--outdir', dir,
      entrada,
    ], { timeout: TIMEOUT_MS });

    const salida = join(dir, 'entrada.docx');
    return await readFile(salida);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await rm(perfilLO, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/salud') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method !== 'POST' || req.url !== '/convertir') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('No encontrado');
    return;
  }

  if (!SECRET || req.headers['x-conversor-secret'] !== SECRET) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('No autorizado');
    return;
  }

  try {
    const bufferEntrada = await leerBody(req);
    if (bufferEntrada.length === 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Cuerpo vacío');
      return;
    }
    // Content-Type decide la extensión del temporal — de eso depende que LibreOffice detecte
    // bien el formato de origen. 'application/msword' es el default histórico (así llamaba el
    // único caller que existía antes del soporte PDF) — nunca romper esa compatibilidad.
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const extensionEntrada = contentType.includes('pdf') ? 'pdf' : 'doc';
    console.log(`[conversor-doc] Convirtiendo ${bufferEntrada.length} bytes (.${extensionEntrada})…`);
    const bufferDocx = await convertirADocx(bufferEntrada, extensionEntrada);
    console.log(`[conversor-doc] OK → ${bufferDocx.length} bytes`);
    res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    res.end(bufferDocx);
  } catch (error) {
    console.error('[conversor-doc] Falló la conversión:', error?.message || error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Error al convertir: ${error?.message || error}`);
  }
});

server.listen(PORT, () => {
  console.log(`[conversor-doc] Escuchando en :${PORT}`);
});
