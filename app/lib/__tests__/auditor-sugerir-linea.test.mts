import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretarSugerencias } from '../auditor-sugerir-linea';

const lineas = [{ item: 5, filaId: 'f5', detalle: 'PROYECTOR', cantidad: 17, costoNeto: 400000 }, { item: 9, filaId: 'f9', detalle: 'SET AMPLIFICACIÓN', cantidad: 3, costoNeto: 290000 }];
const prods = [1, 2, 3, 4].map(idx => ({ idx, nombre: 'p' + idx, precioNeto: 1, cantidad: 1, proveedor: 'x' }));

test('sugerir línea: alta con motivo se conserva; alta sin motivo baja a media; línea inexistente o null = ninguna; baja = ninguna', () => {
  const r = interpretarSugerencias({ productos: [
    { idx: 1, linea: 5, confianza: 'alta', motivo: 'es un proyector de tiro' },
    { idx: 2, linea: 9, confianza: 'alta', motivo: '' },
    { idx: 3, linea: 99, confianza: 'alta', motivo: 'línea que no existe' },
    { idx: 4, linea: null, confianza: 'media', motivo: 'accesorio' },
  ] }, prods, lineas);
  assert.deepEqual(r.map(x => [x.idx, x.item, x.confianza]), [[1, 5, 'alta'], [2, 9, 'media'], [3, null, 'baja'], [4, null, 'baja']]);
  assert.equal(r[0].filaId, 'f5'); assert.equal(r[2].filaId, null);
});

test('sugerir línea: un producto que el modelo no menciona queda como «ninguna», nunca inventa una línea', () => {
  const r = interpretarSugerencias({ productos: [] }, prods.slice(0, 1), lineas);
  assert.equal(r[0].filaId, null); assert.equal(r[0].item, null);
});
