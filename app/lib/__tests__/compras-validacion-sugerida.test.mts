// Pre-relleno de "Validación técnica real" desde el Auditor Técnico: solo se afirma lo respaldado.
//   npx tsx --test app/lib/__tests__/compras-validacion-sugerida.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sugerirValidacionTecnica, type CaracteristicaAuditor } from '../compras-validacion-sugerida';

const car = (o: Partial<CaracteristicaAuditor> = {}): CaracteristicaAuditor => ({
  veredicto: 'CUMPLE', origen: 'ficha', fundamentoDocumento: 'Ficha tecnica original LS-150.pdf', pendienteConfirmacionProveedor: false, ...o,
});
const linea = (titulo: string, cs: CaracteristicaAuditor[]) => ({ titulo, caracteristicas: cs });

test('todo cumple y hay ficha: propone Sí en ficha real, fabricante y producto correcto', () => {
  const s = sugerirValidacionTecnica({ lineas: [linea('Línea 1 — Luminancímetros', [car(), car(), car()])], sitiosDelCosteo: ['sensing.konicaminolta.us'] });
  assert.equal(s.hayDatos, true);
  assert.equal(s.registro.producto, 'Luminancímetros');
  assert.equal(s.registro.ficha_real, 'Sí');
  assert.equal(s.registro.fabricante, 'Sí');
  assert.equal(s.registro.producto_correcto, 'Sí');
  assert.match(s.registro.fuente, /Ficha tecnica original LS-150\.pdf/);
  assert.match(s.registro.fuente, /sensing\.konicaminolta\.us/);
  assert.match(s.registro.observaciones, /3 de 3/);
});

test('sin ficha cargada NO afirma fabricante ni ficha real, y lo dice', () => {
  const s = sugerirValidacionTecnica({ lineas: [linea('Línea 1 — Proyector', [car({ origen: 'manual', fundamentoDocumento: null })])], sitiosDelCosteo: [] });
  assert.equal(s.registro.ficha_real, undefined);
  assert.equal(s.registro.fabricante, undefined);
  assert.ok(s.avisos.some(a => /ficha técnica cargada/.test(a)));
});

test('una característica que no cumple: producto correcto = No, con aviso', () => {
  const s = sugerirValidacionTecnica({ lineas: [linea('Línea 1 — X', [car(), car({ veredicto: 'NO_CUMPLE' })])], sitiosDelCosteo: [] });
  assert.equal(s.registro.producto_correcto, 'No');
  assert.ok(s.avisos.some(a => /NO cumplen/.test(a)));
});

test('cumple con complemento o pendiente del proveedor: no se confirma "producto correcto"', () => {
  const s = sugerirValidacionTecnica({ lineas: [linea('Línea 1 — X', [car(), car({ veredicto: 'CUMPLE_CON_COMPLEMENTO' })])], sitiosDelCosteo: [] });
  assert.equal(s.registro.producto_correcto, undefined);
  const p = sugerirValidacionTecnica({ lineas: [linea('Línea 1 — X', [car({ pendienteConfirmacionProveedor: true })])], sitiosDelCosteo: [] });
  assert.equal(p.registro.producto_correcto, undefined);
});

test('sin características evaluadas no hay nada que proponer', () => {
  const s = sugerirValidacionTecnica({ lineas: [linea('Línea 1 — X', [])], sitiosDelCosteo: ['a.cl'] });
  assert.equal(s.hayDatos, false);
  assert.deepEqual(s.registro, {});
});

test('varias líneas: el producto las junta y no repite fichas', () => {
  const s = sugerirValidacionTecnica({ lineas: [linea('Línea 1 — Mesas', [car()]), linea('Línea 2 — Sillas', [car()])], sitiosDelCosteo: [] });
  assert.equal(s.registro.producto, 'Mesas; Sillas');
  assert.equal((s.registro.fuente.match(/LS-150/g) || []).length, 1);
});
