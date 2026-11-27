// Plataforma armada desde lo que la empresa cuenta que vende (sin ventas en Mercado Público).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validarDescripcion, resultadoDesdePropuesta, MAX_DESCRIPCION } from '../propuesta-descripcion-core';
import { puedeArmarse } from '../armar-plataforma-core';

test('la descripción tiene que describir algo', () => {
  for (const mala of ['', 'ferretería', 'a'.repeat(200), '.'.repeat(80), 'asd asd asd asd asd asd asd asd asd asd', null])
    assert.equal(validarDescripcion(mala).ok, false, String(mala).slice(0, 20));
  const v = validarDescripcion('  Vendemos   materiales de ferretería, cables\ny herramientas a municipios. ');
  assert.equal(v.ok && v.texto, 'Vendemos materiales de ferretería, cables y herramientas a municipios.');
  const larga = validarDescripcion('vendemos cables y herramientas '.repeat(200));
  assert.equal(larga.ok && larga.texto.length <= MAX_DESCRIPCION, true);
});

test('la propuesta no inventa ventas ni restringe, y una empresa virgen se puede armar con ella', () => {
  const r = resultadoDesdePropuesta({ modelo: 'x', resumen: 'r', sugeridas: ['cable eléctrico'], posibles: [], negativas: ['arriendo'], perfil: { descripcion: 'd', rubros: 'r', productos_si: 's', productos_no: 'n', reglas: '' } });
  assert.deepEqual([r.ordenes, r.lineas, r.diasRevisados, r.compradores, r.montoTipico], [0, 0, 0, [], { p10: null, p90: null }]);
  assert.deepEqual([r.perfil.regiones, r.perfil.monto_min, r.perfil.monto_max], ['', null, null]);
  assert.equal(puedeArmarse({ estado: 'LISTO', confirmada: false, yaArmada: false, conPerfil: false, palabras: 0 }), true);
});

test('guardia: la ruta es del admin de la empresa, con tope diario, y la evaluación sin ventas usa lo que dijo al pedir acceso', () => {
  const ruta = readFileSync('app/api/mi-empresa/configuracion/proponer/route.ts', 'utf8');
  assert.match(ruta, /adminDeCliente\(req/); assert.match(ruta, /MAX_PROPUESTAS_POR_DIA\) return/);
  assert.doesNotMatch(ruta, /b\.clienteId|body\.clienteId/);
  assert.equal(readFileSync('app/lib/evaluar-empresa-rut.ts', 'utf8').match(/return terminarSinVentas\(clienteId,/g)?.length, 2);
});
