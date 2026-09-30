// Tests de la posición de precio del AUDITOR (puro: elige la opción representante de cada línea y arma lo que calcula la posición).
// Correr con: npx tsx --test app/lib/__tests__/auditor-posicion.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opcionRepresentante, auditadasDesdePanel } from '../auditor-posicion';
import { calcularPosicionPrecio, type LineaCosteo } from '../auditor-compras-core';

const op = (id: number, estado: string, costo: number | null, extra: any = {}): any => ({ id, estado, verificacion: costo == null ? null : { costoNetoUnitario: costo }, mercado: null, ...extra });
const linea = (filaId: string, opciones: any[], noOfertada = false): any => ({ filaId, opciones, noOfertada });

test('representante: la firmada manda; sin firma, la más avanzada y, a igual estado, la más barata (provisoria)', () => {
  assert.deepEqual([opcionRepresentante(linea('a', [op(1, 'verificada', 100), op(2, 'definitiva', 150)]))?.opcion.id, opcionRepresentante(linea('a', [op(1, 'verificada', 100), op(2, 'definitiva', 150)]))?.provisoria], [2, false]);
  const r = opcionRepresentante(linea('a', [op(1, 'tanteo', 50), op(2, 'verificada', 120), op(3, 'verificada', 110)]))!;
  assert.equal(r.opcion.id, 3); assert.equal(r.provisoria, true);
  assert.equal(opcionRepresentante(linea('a', [op(1, 'descartada', 10), op(2, 'tanteo', null)])), null);
});

test('auditadasDesdePanel: ignora líneas no ofertadas y cuenta las provisorias; lleva la mediana del mercado', () => {
  const mercado = { medianaReferencias: 90, referencias: [{ precioNeto: 90 }, { precioNeto: 95 }], mercadoPublico: null };
  const { auditadas, provisorias } = auditadasDesdePanel([
    linea('f1', [op(1, 'definitiva', 100, { mercado })]),
    linea('f2', [op(2, 'tanteo', 200)]),
    linea('f3', [op(3, 'definitiva', 300)], true),
  ]);
  assert.deepEqual(Object.keys(auditadas).sort(), ['f1', 'f2']);
  assert.equal(provisorias, 1);
  assert.equal((auditadas.f1 as any).sistema.refMediana, 90);
  assert.equal((auditadas.f1 as any).sistema.verificadoNeto, 100);
});

test('calcularPosicionPrecio: los costos asociados suben el costo y bajan el espacio de maniobra', () => {
  const l: LineaCosteo = { id: 'f1', item: 1, lineaReal: 1, grupo: 'C', detalle: 'X', unidad: 'Unidad', sku: '', cantidad: 10, valorConIva: 0, costoRealUnitario: null, links: [], esGastoExtra: false, ofertamos: true, costoEstimadoNeto: 100, costoRegistradoNeto: 100, precioVentaUnitario: 150 };
  const { auditadas } = auditadasDesdePanel([linea('f1', [op(1, 'definitiva', 100)])]);
  const sin = calcularPosicionPrecio([l], auditadas, { neto: 2_000, nivel: 'proyecto', fuente: 'test' });
  const con = calcularPosicionPrecio([l], auditadas, { neto: 2_000, nivel: 'proyecto', fuente: 'test' }, 300);
  assert.equal(sin.costo_verificado.monto_neto, 1_000);
  assert.equal(con.costo_verificado.monto_neto, 1_300);
  assert.equal(con.espacio_maniobra.monto, 700);
});
