// Aviso entre encargados de una licitación en Compras. Sin red ni base.
// Correr con: npx tsx --test app/lib/__tests__/compras-avance-aviso.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoriaDeAvance, destinatariosAvance, textoAvisoAvance } from '../compras-avance-aviso-core';

test('cargar, leer con IA o eliminar una cotización avisa; asignar productos o auditar no', () => {
  assert.equal(categoriaDeAvance('POST', 'cotizaciones', {}), 'cotizacion');
  assert.equal(categoriaDeAvance('POST', 'cotizaciones/extraer', {}), 'cotizacion');
  assert.equal(categoriaDeAvance('DELETE', 'cotizaciones/12', null), 'cotizacion');
  assert.equal(categoriaDeAvance('POST', 'cotizaciones/12/items', {}), null);
  assert.equal(categoriaDeAvance('POST', 'cotizaciones/12/auditar', {}), null);
  assert.equal(categoriaDeAvance('PATCH', 'cotizaciones/12', {}), null);
});

test('elegir compra, aprobar, SKU, OC y estado avisan; verificar SKU y buscar OC no', () => {
  assert.equal(categoriaDeAvance('POST', 'escenarios', {}), 'escenario');
  assert.equal(categoriaDeAvance('PATCH', 'aprobaciones', { decision: 'RECHAZAR' }), 'aprobacion');
  assert.equal(categoriaDeAvance('POST', 'sku', {}), 'sku');
  assert.equal(categoriaDeAvance('POST', 'sku/5/verificar-obuma', {}), null);
  assert.equal(categoriaDeAvance('POST', 'orden-compra-obuma', {}), 'oc');
  assert.equal(categoriaDeAvance('POST', 'orden-compra-obuma/proveedor', {}), null);
  assert.equal(categoriaDeAvance('POST', 'orden-compra/buscar', {}), null);
  assert.equal(categoriaDeAvance('PATCH', 'estado-compra', { estado: 'EN_PROCESO' }), 'estado');
  assert.equal(categoriaDeAvance('POST', 'gastos', {}), null);
});

test('una tarea avisa solo al cerrarla', () => {
  assert.equal(categoriaDeAvance('PATCH', '', { estado: 'HECHA' }, true), 'tarea');
  assert.equal(categoriaDeAvance('PATCH', '', { estado: 'EN_CURSO' }, true), null);
});

test('avisa al otro encargado, nunca a quien hizo la acción', () => {
  const a = { asignadoA: 21, asignadoNombre: 'Carolina', coencargados: [{ id: 20, nombre: 'Maria Elena' }] };
  assert.deepEqual(destinatariosAvance(a, { id: 21, nombre: 'Carolina' }, false), [{ id: 20, nombre: 'Maria Elena' }]);
  assert.deepEqual(destinatariosAvance(a, { id: 20, nombre: 'Maria Elena' }, false), [{ id: 21, nombre: 'Carolina' }]);
});

test('un admin que no es encargado avisa a los dos; con el freno (local) solo a sí mismo', () => {
  const a = { asignadoA: 21, asignadoNombre: 'Carolina', coencargados: [{ id: 20, nombre: 'Maria Elena' }] };
  assert.equal(destinatariosAvance(a, { id: 1, nombre: 'Alexis' }, false).length, 2);
  assert.deepEqual(destinatariosAvance(a, { id: 1, nombre: 'Alexis' }, true), [{ id: 1, nombre: 'Alexis' }]);
});

test('negocio con un solo encargado y él mismo actúa: no hay a quién avisar', () => {
  assert.deepEqual(destinatariosAvance({ asignadoA: 21, asignadoNombre: 'Carolina', coencargados: [] }, { id: 21, nombre: 'Carolina' }, false), []);
});

test('texto: frase fija para lo repetitivo, frase de la bitácora para lo demás', () => {
  assert.equal(textoAvisoAvance('cotizacion', 'Carolina', 'Registró una cotización', '1426039-8-LE26'), 'Carolina está cargando cotizaciones en 1426039-8-LE26. Mira el avance de la licitación.');
  assert.equal(textoAvisoAvance('escenario', 'Carolina', 'Eligió el escenario de compra', '1426039-8-LE26'), 'Carolina eligió el escenario de compra en 1426039-8-LE26. Mira el avance de la licitación.');
});
