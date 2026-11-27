// Ruido del radar de empresas-cliente (casos reales de la prueba del 2026-11-27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pasaFiltroDeRuido, vendeSalud, filtroPorEmpresa } from '../radar-estricto-core';

const medico = 'Equipamiento y suministros médicos / Productos quirúrgicos / Dispositivos';
const ferre = 'Artículos para estructuras, obras y construcciones / Herramientas / Corte';

test('no arma la palabra juntando productos distintos', () => {
  const lic = { Nombre: 'ADQUISICIÓN DE VARIOS', Items: [{ NombreProducto: 'Disco duro externo', Categoria: 'Informática' }, { NombreProducto: 'Mesa de corte', Categoria: 'Muebles' }] };
  assert.equal(pasaFiltroDeRuido(lic, 'disco corte', false), false);
  assert.equal(pasaFiltroDeRuido({ ...lic, Items: [{ NombreProducto: 'Disco de corte metal 4,5', Categoria: ferre }] }, 'disco corte', false), true);
});

test('insumos médicos: fuera para quien no vende salud, dentro para quien sí', () => {
  const lic = { Nombre: 'CONVENIO INSUMOS NEUROQUIRURGICOS', Items: [{ NombreProducto: 'Dispositivo craneal', Descripcion: 'TORNILLO AUTOPERFORANTE 1.5 X 5 MM', Categoria: medico }] };
  assert.equal(pasaFiltroDeRuido(lic, 'tornillo autoperforante', false), false);
  assert.equal(pasaFiltroDeRuido(lic, 'tornillo autoperforante', true), true);
  assert.equal(vendeSalud(['cable eléctrico', 'pintura látex', 'artefacto sanitario']), false, '«sanitario» de ferretería no es salud');
  for (const k of ['desfibrilador', 'camilla', 'silla de rueda', 'insumo médico', 'modelo anatómico']) assert.equal(vendeSalud([k]), true, k);
});

test('ante la duda pasa: el título manda, y título + un producto se complementan', () => {
  assert.equal(pasaFiltroDeRuido({ Nombre: 'ADQUISICION DE CEMENTO', Items: [{ NombreProducto: 'x', Categoria: medico }] }, 'cemento', false), true);
  assert.equal(pasaFiltroDeRuido({ Nombre: 'GRUPO ELECTRÓGENO GENERADOR', Items: [{ NombreProducto: 'Equipo', Categoria: 'Maquinaria / Sistemas eléctricos' }] }, 'generador eléctrico', false), true);
  assert.equal(pasaFiltroDeRuido({ Nombre: 'ADQS LUMINARIAS', Items: [{ NombreProducto: 'Alumbrado público', Descripcion: 'cable y postes', Categoria: 'Artículos eléctricos y de iluminación / Iluminación' }] }, 'cable eléctrico', false), true);
  assert.equal(pasaFiltroDeRuido({ Nombre: 'Compra', Descripcion: 'Se requiere cable eléctrico para la obra.' }, 'cable eléctrico', false), true);
});

test('el radar de Grupo ICA no cambia, y la salud se decide empresa por empresa', () => {
  const lic = { Nombre: 'INSUMOS', Items: [{ NombreProducto: 'llave tres pasos', Categoria: medico }] };
  const f = filtroPorEmpresa([{ cliente_id: 1, keyword: 'llave paso' }, { cliente_id: 5, keyword: 'llave paso' }, { cliente_id: 9, keyword: 'llave paso' }, { cliente_id: 9, keyword: 'insumo médico' }]);
  assert.equal(f({ cliente_id: 1, keyword: 'llave paso' }, lic), true);
  assert.equal(f({ cliente_id: 5, keyword: 'llave paso' }, lic), false);
  assert.equal(f({ cliente_id: 9, keyword: 'llave paso' }, lic), true);
});

test('guardia: los dos caminos que crean alertas usan el filtro', () => {
  for (const f of ['app/lib/radar-matching.ts', 'app/api/cron/alertas/route.ts']) assert.match(readFileSync(f, 'utf8'), /!sinRuido\(kw, lic\)/, f);
});
