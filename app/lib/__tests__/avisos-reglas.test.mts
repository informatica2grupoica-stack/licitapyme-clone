// Regla única de «a quién le llega cada alerta» (correo y WhatsApp). Puro, sin BD.
import test from 'node:test';
import assert from 'node:assert/strict';
import { elegirPersonas, equipoDe, normalizarArea, alertaAplicaAPerfil, REGLAS, type Persona } from '../avisos-reglas';

const p = (o: Partial<Persona> & { id: number }): Persona => ({ nombre: 'X', rol: 'usuario', activo: 1, area: null, ...o });
const equipo = [
  p({ id: 1 }), p({ id: 2 }), p({ id: 3, rol: 'admin' }),
  p({ id: 4, area: 'Compras' }), p({ id: 6, area: 'Mercado Público' }), p({ id: 7, area: 'MP' }), p({ id: 8, area: 'Ventas' }),
  p({ id: 9, rol: 'admin', activo: 0 }),
];
const ids = (r: Persona[]) => r.map(x => x.id);

test('el Área se reconoce sin tildes, mayúsculas ni espacios de más', () => {
  assert.equal(normalizarArea('  Mercado   Público '), 'mercado publico');
  assert.equal(equipoDe('COMPRAS'), 'compras');
  assert.equal(equipoDe('Compras y Logística'), 'compras');
  assert.equal(equipoDe('mercado publico'), 'mp');
  assert.equal(equipoDe('MP'), 'mp');
  assert.equal(equipoDe('Ventas'), null);
  assert.equal(equipoDe(null), null);
});

test('tabla de destinatarios por alerta', () => {
  assert.deepEqual(ids(elegirPersonas('ganada', equipo, [1])), [1, 3, 4]);
  assert.deepEqual(ids(elegirPersonas('perdida', equipo, [2])), [2, 3, 4]);
  assert.deepEqual(ids(elegirPersonas('estado_mp', equipo, [1])), [1, 3, 4]);
  assert.deepEqual(ids(elegirPersonas('apertura', equipo, [1])), [1, 4, 6, 7]);
  assert.deepEqual(ids(elegirPersonas('oc', equipo, [1, 2])), [1, 2, 4, 6, 7]);
  assert.deepEqual(ids(elegirPersonas('oc_vencer', equipo, [1])), [1, 4, 6, 7]);
  assert.deepEqual(ids(elegirPersonas('cierra_pronto', equipo, [1])), [1, 6, 7]);
  assert.deepEqual(ids(elegirPersonas('radar', equipo, [])), [3]);
});

test('un asistente nunca recibe lo de otro asistente; la cuenta desactivada tampoco', () => {
  assert.ok(!ids(elegirPersonas('ganada', equipo, [1])).includes(2));
  assert.ok(!ids(elegirPersonas('radar', equipo, [])).includes(9));
});

test('sin encargado (licitación sin asignar) solo quedan los grupos por rol o Área', () => {
  assert.deepEqual(ids(elegirPersonas('cierra_pronto', equipo, [])), [6, 7]);
  assert.deepEqual(ids(elegirPersonas('ganada', equipo, [null, undefined])), [3, 4]);
});

test('el selector del perfil solo muestra los avisos que le corresponden', () => {
  const aplica = (rol: string, area?: string) => (Object.keys(REGLAS) as Array<keyof typeof REGLAS>).filter(a => alertaAplicaAPerfil(a, { rol, area }));
  assert.deepEqual(aplica('usuario'), ['ganada', 'perdida', 'estado_mp', 'apertura', 'oc', 'oc_vencer', 'cierra_pronto']); // sin radar
  assert.ok(aplica('admin').includes('radar'));
  assert.deepEqual(aplica('externo'), ['ganada', 'perdida', 'estado_mp', 'apertura', 'oc', 'oc_vencer', 'cierra_pronto']);
});
