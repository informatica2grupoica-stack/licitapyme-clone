import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seccionesDeEquipos } from '../caracteristicas-seccion';
import { filasDeTrozos } from '../pdf-texto-por-filas';

const relleno = (n: number) => Array.from({ length: n }, (_, i) => `Requisito número ${i} con su valor mínimo exigido`).join('\n');

test('cada equipo recibe su sección completa, sin pisar al siguiente', () => {
  const texto = `Índice\na) CAMION ALZAHOMBRES\n\n4.2 Vehículos\na) CAMION ALZAHOMBRES (Presupuesto Estimado: $1)\nANTECEDENTES GENERALES\n${relleno(30)}\nb) CAMIÓN CISTERNA PARA COMBUSTIBLE (Presupuesto Estimado: $2)\nAdquirir un camión cisterna para combustible\n${relleno(30)}\n4.3 Generalidades\ntexto`;
  const m = seccionesDeEquipos(texto, ['Camión Alzahombres', 'Camión Cisterna para Combustible']);
  assert.equal(m.size, 2);
  assert.ok(m.get('Camión Alzahombres')!.includes('Requisito número 29'));
  assert.ok(!m.get('Camión Alzahombres')!.includes('CISTERNA'));
  assert.ok(!m.get('Camión Cisterna para Combustible')!.includes('Generalidades'));
});

test('filas del PDF: etiqueta, unidad y valor quedan en la misma fila aunque vengan en bloques', () => {
  const t = (s: string, x: number, y: number) => ({ s, x, y, w: s.length * 5, h: 10 });
  const out = filasDeTrozos([t('Cilindrada', 10, 700), t('Potencia', 10, 680), t('L', 120, 700), t('HP', 120, 680), t('2.23', 200, 700), t('60', 200, 680)]);
  assert.equal(out, 'Cilindrada | L | 2.23\nPotencia | HP | 60');
});
