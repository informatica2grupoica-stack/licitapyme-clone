// Avisos por WhatsApp: quién recibe qué y cómo se redacta (puro, sin BD).
// Regla (09-nov-2026): el destinatario sale de avisos-reglas.ts (el mismo criterio que el correo) y además el perfil tiene que
// tener el aviso activado. Compras y Mercado Público se reconocen por el «Área» del perfil.
import test from 'node:test';
import assert from 'node:assert/strict';
import { elegirDestinatarios, redactarAviso, porDefecto, claveAviso, type Destinatario } from '../whatsapp-avisos-core';

const u = (o: Partial<Destinatario> & { id: number }): Destinatario => ({ nombre: 'Alexis Tobar', rol: 'usuario', activo: 1, telefono: '+56 9 7792 2875', area: null, ...o });
const sinPrefs = new Map<number, any>();
const ids = (r: Array<{ id: number }>) => r.map(x => x.id);

// Equipo de ejemplo: 1 y 2 son asistentes (cada uno con SUS licitaciones), 3 admin, 4 y 5 Compras, 6 Mercado Público.
const equipo = [
  u({ id: 1 }), u({ id: 2 }), u({ id: 3, rol: 'admin' }),
  u({ id: 4, area: 'Compras' }), u({ id: 5, area: ' compras ' }), u({ id: 6, area: 'Mercado Público' }),
];

test('ganada y perdida: encargado de la licitación, admins y Compras; otro asistente NO', () => {
  assert.deepEqual(ids(elegirDestinatarios('ganada', 1, equipo, sinPrefs)), [1, 3, 4, 5]);
  assert.deepEqual(ids(elegirDestinatarios('perdida', 2, equipo, sinPrefs)), [2, 3, 4, 5]);
});

test('apertura: encargado, Compras y Mercado Público; los admins no', () => {
  assert.deepEqual(ids(elegirDestinatarios('apertura', 1, equipo, sinPrefs)), [1, 4, 5, 6]);
});

test('los avisos nuevos nacen apagados: hay que activarlos en el perfil (cerrada/revocada/desierta, OC, cierra pronto, radar)', () => {
  assert.deepEqual(elegirDestinatarios('estado_mp', 1, equipo, sinPrefs), []);
  assert.deepEqual(elegirDestinatarios('oc', 1, equipo, sinPrefs), []);
  assert.deepEqual(elegirDestinatarios('cierra_pronto', 1, equipo, sinPrefs), []);
  assert.deepEqual(elegirDestinatarios('radar', null, equipo, sinPrefs), []);
});

test('orden de compra: Compras, Mercado Público y los encargados (comercial y de Compras); admins y otros asistentes no', () => {
  const prefs = new Map<number, any>(equipo.map(p => [p.id, { oc: true }]));
  // encargados: asistente 1 (comercial) y asistente 2 (encargado de Compras de ese negocio)
  assert.deepEqual(ids(elegirDestinatarios('oc', [1, 2], equipo, prefs)), [1, 2, 4, 5, 6]);
  const prefsVencer = new Map<number, any>(equipo.map(p => [p.id, { oc_vencer: true }]));
  assert.deepEqual(ids(elegirDestinatarios('oc_vencer', [1], equipo, prefsVencer)), [1, 4, 5, 6]);
});

test('cierra pronto: el encargado y Mercado Público; admins y Compras no', () => {
  const prefs = new Map<number, any>(equipo.map(p => [p.id, { cierra_pronto: true }]));
  assert.deepEqual(ids(elegirDestinatarios('cierra_pronto', 1, equipo, prefs)), [1, 6]);
});

test('radar: solo administradores', () => {
  const prefs = new Map<number, any>(equipo.map(p => [p.id, { radar: true }]));
  assert.deepEqual(ids(elegirDestinatarios('radar', 1, equipo, prefs)), [3]);
});

test('resumen por persona (omitirAudiencia): el llamador ya eligió; se respetan perfil, cuenta y celular', () => {
  const prefs = new Map<number, any>([[3, { radar: true }]]);
  assert.deepEqual(ids(elegirDestinatarios('radar', null, [equipo[2]], prefs, { omitirAudiencia: true })), [3]);
  assert.deepEqual(ids(elegirDestinatarios('radar', null, [equipo[2]], sinPrefs, { omitirAudiencia: true })), []);
});

test('el externo solo recibe lo que lleva él', () => {
  const ext = u({ id: 9, rol: 'externo', area: 'Compras' });
  assert.deepEqual(ids(elegirDestinatarios('ganada', 9, [ext], sinPrefs)), [9]);
  assert.deepEqual(ids(elegirDestinatarios('ganada', 1, [ext], sinPrefs)), []);
});

test('el selector del perfil manda: apagar un aviso lo corta aunque le corresponda', () => {
  const prefs = new Map<number, any>([[1, { ganada: false }], [4, { ganada: false }]]);
  assert.deepEqual(ids(elegirDestinatarios('ganada', 1, equipo, prefs)), [3, 5]);
});

test('sin celular válido o con la cuenta desactivada no se manda', () => {
  const cand = [u({ id: 1, telefono: null }), u({ id: 2, telefono: '12345' }), u({ id: 3, activo: 0, rol: 'admin' }), u({ id: 4, rol: 'admin' })];
  assert.deepEqual(ids(elegirDestinatarios('ganada', [1, 2], cand, sinPrefs)), [4]);
});

test('el celular sale normalizado y sin repetir a una persona que es encargada y admin a la vez', () => {
  const r = elegirDestinatarios('ganada', 2, [u({ id: 2, rol: 'admin' }), u({ id: 2, rol: 'admin' })], sinPrefs);
  assert.equal(r.length, 1);
  assert.equal(r[0].telefonoNormalizado, '+56977922875');
});

test('el mensaje de orden de compra lleva el código de la orden y el monto', () => {
  const t = redactarAviso({ tipo: 'oc', codigo: '2415-19-LE26', ordenCodigo: '2415-88-SE26', licitacionNombre: 'Materiales', monto: 1190000, nombreDestinatario: 'Consuelo Ramirez', urlBase: 'https://app.licitank.cl' });
  assert.match(t, /^🧾 \*Licitank · Orden de compra recibida\*/);
  assert.match(t, /Orden de compra: 2415-88-SE26/);
  assert.match(t, /Monto: \$1\.190\.000/);
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

test('mensajes de los avisos nuevos: estado, OC por vencer y resúmenes', () => {
  const base = { codigo: 'X-1', licitacionNombre: 'Camillas', nombreDestinatario: 'Carolina Gonzalez', urlBase: 'http://localhost:3000' };
  const e = redactarAviso({ ...base, tipo: 'estado_mp', detalle: 'Revocada' });
  assert.match(e, /Cambio de estado en Mercado Público/);
  assert.match(e, /Estado: Revocada/);
  const v = redactarAviso({ ...base, tipo: 'oc_vencer', ordenCodigo: '77-1-SE26', detalle: 'Vence en menos de 3 horas (límite 10-11 17:00).' });
  assert.match(v, /Orden de compra: 77-1-SE26/);
  assert.match(v, /Vence en menos de 3 horas/);
  const r = redactarAviso({ ...base, tipo: 'radar', detalle: '3 licitaciones nuevas que calzan con tus palabras clave:\n• A (1)' });
  assert.match(r, /^📡 \*Licitank · Licitaciones nuevas en el radar\*/);
  assert.match(r, /• A \(1\)/);
  assert.match(r, /\/radar$/);
  assert.match(redactarAviso({ ...base, tipo: 'cierra_pronto', detalle: '• B (2) — cierra 10/11' }), /\/negocios$/);
});

test('valores por defecto y clave de deduplicación', () => {
  assert.equal(porDefecto('admin', 'ganada'), true);
  assert.equal(porDefecto('admin', 'apertura'), true);
  assert.equal(porDefecto('usuario', 'perdida'), true);
  for (const t of ['oc', 'oc_vencer', 'estado_mp', 'cierra_pronto', 'radar'] as const) assert.equal(porDefecto('admin', t), false);
  assert.equal(claveAviso('ganada', '2415-19-LE26', 7), 'ganada:2415-19-LE26:7');
});
