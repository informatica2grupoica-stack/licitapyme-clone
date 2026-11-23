// Cálculos del módulo «Competencia y mercado» (fase 1) con datos armados a mano.
// Correr con:  npx tsx --test app/lib/__tests__/competencia-core.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularCompetencia, universoResuelto, type NegocioComp, type AdjComp } from '../competencia-core';

const neg = (codigo: string, estado: string, empresa = 'Claro'): NegocioComp & { id: number } =>
  ({ id: Number(codigo.replace(/\D/g, '')) || 1, licitacion_codigo: codigo, licitacion_nombre: `Lic ${codigo}`, estado_pipeline: estado, empresa_nombre: empresa });

const ADJ: Record<string, AdjComp> = {
  // Ganada: una línea nuestra.
  G1: { esAdjudicada: true, ganamos: true, montoNuestro: 1_000_000, adjudicacion: { numeroOferentes: 3 },
        lineasAdjudicadas: [{ montoUnitario: 1_000_000, cantidad: 1, rutProveedor: '76.111.111-1', proveedor: 'Nosotros', esNuestra: true }] },
  // Perdida: dos líneas del mismo competidor (RUT escrito de dos formas) y una de otro.
  P1: { esAdjudicada: true, ganamos: false, fechaAdjudicacion: '2026-10-01', adjudicacion: { numeroOferentes: 5 },
        lineasAdjudicadas: [
          { montoUnitario: 100, cantidad: 10, rutProveedor: '12.345.678-5', proveedor: 'Veloso SpA' },
          { montoUnitario: 50, cantidad: 2, rutProveedor: '12345678-5', proveedor: 'VELOSO SPA' },
          { montoUnitario: 200, cantidad: 1, rutProveedor: '99.999.999-9', proveedor: 'Otro Ltda' }] },
  // Perdida con acta pero sin detalle por línea: cuenta como perdida, no entra al ranking.
  P2: { esAdjudicada: true, ganamos: false, lineasAdjudicadas: [] },
};

test('efectividad, montos y competidores se calculan por RUT normalizado', () => {
  const r = calcularCompetencia([neg('G1', 'ADJUDICADA'), neg('P1', 'PERDIDA'), neg('P2', 'PERDIDA')], ADJ);
  assert.equal(r.resumen.ganadas, 1);
  assert.equal(r.resumen.perdidas, 2);
  assert.equal(r.resumen.efectividad, 1 / 3);
  assert.equal(r.resumen.montoGanado, 1_000_000);
  assert.equal(r.resumen.competidoresDistintos, 2);
  assert.equal(r.resumen.perdidasSinDetalle, 1);
  assert.equal(r.resumen.perdidasConDetalle, 1);
  // 100×10 + 50×2 + 200×1 = 1.300
  assert.equal(r.resumen.montoAdjudicadoATerceros, 1_300);
  const veloso = r.competidores.find(c => c.clave === '12345678-5');
  assert.ok(veloso, 'las dos formas del RUT cuentan como un solo competidor');
  assert.equal(veloso.licitaciones, 1);
  assert.equal(veloso.detalle[0].lineas, 2);
  assert.equal(veloso.detalle[0].lineasTotal, 3);
  assert.equal(veloso.monto, 1_100);
});

test('mediana de oferentes usa solo las licitaciones que traen el dato', () => {
  const r = calcularCompetencia([neg('G1', 'ADJUDICADA'), neg('P1', 'PERDIDA'), neg('P2', 'PERDIDA')], ADJ);
  assert.equal(r.resumen.oferentesConDato, 2);
  assert.equal(r.resumen.oferentesMediana, 4);
});

test('sin resueltas no inventa efectividad', () => {
  const r = calcularCompetencia([neg('X1', 'POSTULADA')], { X1: { esAdjudicada: false } });
  assert.equal(r.resumen.resueltas, 0);
  assert.equal(r.resumen.efectividad, null);
  assert.equal(r.resumen.oferentesMediana, null);
});

test('si falta el acta manda el estado ya promovido', () => {
  const r = calcularCompetencia([neg('A1', 'ADJUDICADA'), neg('A2', 'PERDIDA')], {});
  assert.equal(r.resumen.ganadas, 1);
  assert.equal(r.resumen.perdidas, 1);
});

test('efectividad por empresa propia', () => {
  const r = calcularCompetencia([neg('G1', 'ADJUDICADA', 'Claro'), neg('P1', 'PERDIDA', 'Comercial MP')], ADJ);
  const claro = r.porEmpresa.find(e => e.empresa === 'Claro');
  const mp = r.porEmpresa.find(e => e.empresa === 'Comercial MP');
  assert.equal(claro?.efectividad, 1);
  assert.equal(mp?.efectividad, 0);
});

test('universoResuelto deja una fila por código (la de id mayor) y solo estados válidos', () => {
  const u = universoResuelto([
    { ...neg('2408-1', 'ADJUDICADA'), id: 10 }, { ...neg('2408-1', 'ADJUDICADA'), id: 20 },
    { ...neg('3000-1', 'RADAR'), id: 5 },
  ]);
  assert.equal(u.length, 1);
  assert.equal(u[0].id, 20);
});
