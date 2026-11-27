// SSRF (QA 2026-11-27): lo que el servidor abre porque lo escribió una persona nunca puede ser una máquina interna.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { ipPublicaDe, destinoSmtpPermitido, abrirProxySeguro, argsConProxy } from '../salida-segura';

test('ipPublicaDe: rechaza direcciones y nombres internos', async () => {
  for (const h of ['127.0.0.1', '10.0.0.5', '172.18.0.2', '192.168.1.1', '169.254.169.254', '::1', '[::1]', 'localhost', 'LOCALHOST.', 'algo.internal', ''])
    assert.equal(await ipPublicaDe(h), null, h);
  assert.equal(await ipPublicaDe('8.8.8.8'), '8.8.8.8');
});

test('correo propio: solo puertos de correo y servidores públicos', async () => {
  await assert.rejects(destinoSmtpPermitido('8.8.8.8', 3306), /Puerto/);
  await assert.rejects(destinoSmtpPermitido('127.0.0.1', 587), /no se puede usar/);
  await assert.rejects(destinoSmtpPermitido('localhost', 25), /no se puede usar/);
  assert.equal(await destinoSmtpPermitido('8.8.8.8', 465), '8.8.8.8');
});

test('proxy del navegador: ni http ni túnel CONNECT llegan a una máquina interna', async () => {
  let toques = 0;
  const interno = http.createServer((_q, r) => { toques++; r.end('SECRETO'); });
  interno.on('connection', () => { toques++; });
  await new Promise<void>(ok => interno.listen(0, '127.0.0.1', ok));
  const pInterno = (interno.address() as net.AddressInfo).port;
  const proxy = await abrirProxySeguro();
  const pedir = (primeraLinea: string) => new Promise<string>((ok, mal) => {
    let t = '';
    const s = net.connect(proxy.puerto, '127.0.0.1', () => s.write(`${primeraLinea}\r\nHost: x\r\nConnection: close\r\n\r\n`));
    s.on('data', d => { t += d; if (/\r\n\r\n/.test(t)) { s.destroy(); ok(t); } });
    s.on('error', mal);
    s.on('close', () => ok(t));
  });
  try {
    for (const linea of [`GET http://127.0.0.1:${pInterno}/ HTTP/1.1`, `GET http://localhost:${pInterno}/ HTTP/1.1`, `CONNECT 127.0.0.1:${pInterno} HTTP/1.1`, `CONNECT [::1]:${pInterno} HTTP/1.1`]) {
      const r = await pedir(linea);
      assert.match(r, /^HTTP\/1\.1 403/, linea);
      assert.doesNotMatch(r, /SECRETO/, linea);
    }
    assert.equal(toques, 0);
  } finally { proxy.cerrar(); interno.close(); }
});

test('el navegador no puede saltarse el proxy ni para localhost', () => {
  assert.ok(argsConProxy(1234).includes('--proxy-bypass-list=<-loopback>'));
});

// Guardia: el Auditor tiene UN solo punto donde lanza el navegador (con proxy) y no descarga links con `fetch` suelto.
test('guardia: el Auditor no abre direcciones sin el filtro', () => {
  const captura = readFileSync('app/lib/auditor-compras-captura.ts', 'utf8');
  assert.equal(captura.match(/\.launch\(/g)?.length, 1);
  assert.match(captura, /argsConProxy\(proxy\.puerto\)/);
  for (const f of ['app/lib/auditor-compras-captura.ts', 'app/lib/auditor-lector.ts', 'app/lib/auditor-ficha-propia.ts', 'app/lib/auditor-opciones.ts'])
    assert.doesNotMatch(readFileSync(f, 'utf8'), /(?<![.\w])(fetch|fetchConTimeout|fetchRapido)\(/, f);
});
