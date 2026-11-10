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

test('filas del PDF: alto de pdf.js inflado (tamaño², PDF de Excel) no junta filas de la tabla (Comercial Gam 2057)', async () => {
  const { renderPaginaPorFilas } = await import('../pdf-texto-por-filas');
  // pdf.js da height 121/144 para letra 11/12 pt; las filas están a 28 pt.
  const it = (str: string, x: number, y: number, fs: number) => ({ str, width: str.length * 5, height: fs * fs, transform: [fs, 0, 0, fs, x, y] });
  const items = [
    it('63', 75, 732, 11), it('Silla sala cuna coigue', 114, 732, 11), it('$29.500', 415, 733, 12), it('$1.858.500', 491, 733, 12),
    it('123', 72, 704, 11), it('Sill sala cuna Junji', 114, 704, 11), it('$16.000', 415, 705, 12), it('$1.968.000', 491, 705, 12),
    it('70', 75, 676, 11), it('Silla párvulo coigue', 114, 676, 11), it('$28.000', 415, 677, 12), it('$1.960.000', 491, 677, 12),
  ];
  const out = await renderPaginaPorFilas({ getTextContent: async () => ({ items }) });
  assert.deepEqual(out.replace(/ ‖ /g, ' | ').split('\n'), [
    '63 | Silla sala cuna coigue | $29.500 | $1.858.500',
    '123 | Sill sala cuna Junji | $16.000 | $1.968.000',
    '70 | Silla párvulo coigue | $28.000 | $1.960.000',
  ]);
});
