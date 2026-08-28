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
// DOCX → PDF (29-ago-2026, pedido explícito del usuario: firmar con precisión real requiere una
// página FIJA como imagen — un .docx es texto que fluye, no tiene coordenadas de píxel. El flujo:
// generar el anexo con el texto ya puesto (sin firma/timbre) → convertir ESE .docx a PDF acá →
// el usuario arrastra la firma/timbre sobre el PDF real en el navegador → se "quema" con pdf-lib
// en el servidor de la app (no acá, este microservicio solo convierte formatos, nunca edita
// contenido). Mismo comando de LibreOffice que ya existía, la extensión de SALIDA es la única
// diferencia — por eso queda como una ruta nueva en vez de una rama más de la que ya hay.
//
// Endpoints, sin framework (no hace falta express para esto):
//   POST /convertir       body = bytes crudos, Content-Type: application/msword (.doc) o
//                         application/pdf (.pdf), header x-conversor-secret = CONVERSOR_SECRET
//                         → 200 con los bytes del .docx (Content-Type OOXML)
//   POST /convertir-pdf   body = bytes crudos de un .docx (Content-Type OOXML), mismo secreto
//                         → 200 con los bytes del .pdf
//   GET  /salud            → 200 "ok" (para healthcheck de docker-compose)
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

async function convertirArchivo(bufferEntrada, extensionEntrada, formatoSalida) {
  const id = randomUUID();
  const dir = await mkdtemp(join(tmpdir(), `conv-${id}-`));
  const perfilLO = join(tmpdir(), `lo-profile-${id}`); // perfil aislado: evita choques si dos conversiones caen a la vez
  const entrada = join(dir, `entrada.${extensionEntrada}`);
  await writeFile(entrada, bufferEntrada);

  try {
    await execFileAsync('soffice', [
      '--headless', '--norestore',
      `-env:UserInstallation=file://${perfilLO}`,
      '--convert-to', formatoSalida,
      '--outdir', dir,
      entrada,
    ], { timeout: TIMEOUT_MS });

    const salida = join(dir, `entrada.${formatoSalida}`);
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

  if (req.method !== 'POST' || (req.url !== '/convertir' && req.url !== '/convertir-pdf')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('No encontrado');
    return;
  }

  if (!SECRET || req.headers['x-conversor-secret'] !== SECRET) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('No autorizado');
    return;
  }

  const aPdf = req.url === '/convertir-pdf';

  try {
    const bufferEntrada = await leerBody(req);
    if (bufferEntrada.length === 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Cuerpo vacío');
      return;
    }
    // /convertir-pdf SIEMPRE recibe un .docx de entrada (el anexo ya generado con el texto
    // puesto) — no hace falta mirar el Content-Type para decidir la extensión de entrada, a
    // diferencia de /convertir que sí acepta dos orígenes distintos (.doc/.pdf).
    const extensionEntrada = aPdf ? 'docx' : (String(req.headers['content-type'] || '').toLowerCase().includes('pdf') ? 'pdf' : 'doc');
    const formatoSalida = aPdf ? 'pdf' : 'docx';
    console.log(`[conversor-doc] Convirtiendo ${bufferEntrada.length} bytes (.${extensionEntrada} → .${formatoSalida})…`);
    const bufferSalida = await convertirArchivo(bufferEntrada, extensionEntrada, formatoSalida);
    console.log(`[conversor-doc] OK → ${bufferSalida.length} bytes`);
    res.writeHead(200, { 'Content-Type': aPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    res.end(bufferSalida);
  } catch (error) {
    console.error('[conversor-doc] Falló la conversión:', error?.message || error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Error al convertir: ${error?.message || error}`);
  }
});

server.listen(PORT, () => {
  console.log(`[conversor-doc] Escuchando en :${PORT}`);
});
