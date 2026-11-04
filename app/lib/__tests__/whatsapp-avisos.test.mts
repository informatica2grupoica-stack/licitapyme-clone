// Avisos por WhatsApp: quién recibe qué y cómo se redacta (puro, sin BD).
import test from 'node:test';
import assert from 'node:assert/strict';
import { elegirDestinatarios, redactarAviso, porDefecto, claveAviso, type Destinatario } from '../whatsapp-avisos-core';

const u = (o: Partial<Destinatario> & { id: number }): Destinatario => ({ nombre: 'Alexis Tobar', rol: 'usuario', activo: 1, telefono: '+56 9 7792 2875', ...o });
const sinPrefs = new Map<number, any>();

test('el responsable recibe sus tres avisos; el admin solo las ganadas de toda la empresa', () => {
  const cand = [u({ id: 1 }), u({ id: 2, rol: 'admin' })];
  assert.deepEqual(elegirDestinatarios('ganada', 1, cand, sinPrefs).map(x => x.id), [1, 2]);
  assert.deepEqual(elegirDestinatarios('perdida', 1, cand, sinPrefs).map(x => x.id), [1]);
  assert.deepEqual(elegirDestinatarios('apertura', 1, cand, sinPrefs).map(x => x.id), [1]);
});

test('quien no es el responsable ni admin no recibe nada aunque tenga el aviso activado', () => {
  const cand = [u({ id: 3 })];
  assert.deepEqual(elegirDestinatarios('ganada', 1, cand, new Map([[3, { ganada: true }]])), []);
});

test('el selector del perfil manda: un admin puede activar perdidas y un responsable apagar ganadas', () => {
  const cand = [u({ id: 1 }), u({ id: 2, rol: 'admin' })];
  const prefs = new Map<number, any>([[2, { perdida: true, ganada: false }], [1, { ganada: false }]]);
  assert.deepEqual(elegirDestinatarios('perdida', 1, cand, prefs).map(x => x.id), [1, 2]);
  assert.deepEqual(elegirDestinatarios('ganada', 1, cand, prefs).map(x => x.id), []);
});

test('sin celular válido o con la cuenta desactivada no se manda', () => {
  const cand = [u({ id: 1, telefono: null }), u({ id: 2, telefono: '12345' }), u({ id: 3, activo: 0, rol: 'admin' }), u({ id: 4, rol: 'admin' })];
  assert.deepEqual(elegirDestinatarios('ganada', 1, cand, sinPrefs).map(x => x.id), [4]);
});

test('el celular sale normalizado y sin repetir a una persona que es responsable y admin a la vez', () => {
  const r = elegirDestinatarios('ganada', 2, [u({ id: 2, rol: 'admin' }), u({ id: 2, rol: 'admin' })], sinPrefs);
  assert.equal(r.length, 1);
  assert.equal(r[0].telefonoNormalizado, '+56977922875');
});

test('el mensaje es profesional: emoji de encabezado, con negritas, datos y enlace a la licitación', () => {
  const t = redactarAviso({ tipo: 'ganada', codigo: '2415-19-LE26', licitacionNombre: 'Adquisicion de Materiales de construccion', organismo: 'Municipalidad de X', monto: 10979880, nombreDestinatario: 'Alexis Tobar', urlBase: 'https://app.licitank.cl/' });
  assert.match(t, /^🏆 \*Licitank · Licitación adjudicada\*/);
  assert.match(t, /Hola Alexis, /);
  assert.match(t, /Código: 2415-19-LE26/);
  assert.match(t, /Monto adjudicado: \$10\.979\.880/);
  assert.match(t, /Ver en Licitank: https:\/\/app\.licitank\.cl\/licitacion\/2415-19-LE26$/);
});

test('en perdida y apertura no se muestra monto y el texto cambia', () => {
  const base = { codigo: 'X-1', licitacionNombre: null, monto: 5000, nombreDestinatario: null, urlBase: 'http://localhost:3000' };
  assert.doesNotMatch(redactarAviso({ ...base, tipo: 'perdida' }), /Monto/);
  assert.match(redactarAviso({ ...base, tipo: 'perdida' }), /adjudicada a otro proveedor/);
  assert.match(redactarAviso({ ...base, tipo: 'apertura' }), /apertura/);
  assert.match(redactarAviso({ ...base, tipo: 'apertura' }), /^📂 \*Licitank · Apertura de ofertas\*\n\nHola, /);
});

test('valores por defecto y clave de deduplicación', () => {
  assert.equal(porDefecto('admin', 'ganada'), true);
  assert.equal(porDefecto('admin', 'apertura'), false);
  assert.equal(porDefecto('usuario', 'perdida'), true);
  assert.equal(claveAviso('ganada', '2415-19-LE26', 7), 'ganada:2415-19-LE26:7');
});
