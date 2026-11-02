// Guardián de URLs del servidor (SSRF): qué direcciones se consideran internas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esDireccionPrivada, urlPublicaSegura } from '../url-segura';

test('direcciones internas e IPv4 disfrazadas de IPv6 se rechazan', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.1.10', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', '::', 'fe80::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'no-es-ip'])
    assert.equal(esDireccionPrivada(ip), true, ip);
});
test('direcciones públicas pasan', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '2606:4700:4700::1111'])
    assert.equal(esDireccionPrivada(ip), false, ip);
});
test('URLs: protocolo raro, localhost, IP interna y host interno de Docker se rechazan sin salir a la red', async () => {
  for (const u of ['file:///etc/passwd', 'ftp://x.cl/a', 'http://localhost:3000/api/x', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data', 'http://2130706433/', 'http://app.localhost/', 'no es url'])
    assert.equal(await urlPublicaSegura(u), false, u);
});
test('una IP pública literal pasa sin consultar DNS', async () => {
  assert.equal(await urlPublicaSegura('https://8.8.8.8/x'), true);
});
