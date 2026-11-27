// Dominio de envío del correo: EHLO y firma salen del remitente, no del usuario SMTP (2026-11-26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dominioDe, nombreEhlo } from '../email-dominio';

test('dominioDe saca el dominio de «Nombre <correo>» o de un correo suelto', () => {
  assert.equal(dominioDe('LICITANK <avisos@licitank.cl>'), 'licitank.cl');
  assert.equal(dominioDe('avisos@LiciTank.CL'), 'licitank.cl');
  assert.equal(dominioDe('"Licitaciones, ICA" <notificaciones@sociedadcomercialmp.cl>'), 'sociedadcomercialmp.cl');
});
test('dominioDe devuelve undefined si no hay un correo', () => {
  for (const v of ['resend', '', undefined, null, 'sin arroba']) assert.equal(dominioDe(v as any), undefined);
});
test('nombreEhlo prefiere el remitente: con Resend (usuario «resend») o Brevo (usuario de otro dominio) no usa el del usuario', () => {
  assert.equal(nombreEhlo('LICITANK <avisos@licitank.cl>', 'resend'), 'licitank.cl');
  assert.equal(nombreEhlo('LICITANK <avisos@licitank.cl>', 'a1b2c3@smtp-brevo.com'), 'licitank.cl');
});
test('nombreEhlo sin remitente cae al usuario (comportamiento de antes) y si nada sirve da undefined', () => {
  assert.equal(nombreEhlo(undefined, 'notificaciones@sociedadcomercialmp.cl'), 'sociedadcomercialmp.cl');
  assert.equal(nombreEhlo('', 'resend'), undefined);
});
