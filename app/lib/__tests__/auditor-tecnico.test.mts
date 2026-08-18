// Tests de las funciones deterministas del Agente Técnico (Auditor Técnico, Fase 1). Las
// funciones que llaman a la IA (clasificarCaracteristicasLinea, compararFichaProveedor,
// evaluarCaracteristicaConIA) no se testean aquí — solo lo que corre sin red.
// Correr con: npx tsx --test app/lib/__tests__/auditor-tecnico.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lineasTecnicasDelInforme, evaluarCaracteristicaDeterminista, resumenLinea, slugCaracteristica,
} from '../auditor-tecnico';
import { causalesDeBloqueo } from '../semaforo-auditor';

test('lineasTecnicasDelInforme: lee productos.items preservando caracteristicas/clasificacion/marca', () => {
  const informe = {
    productos: {
      items: [
        { linea: 1, nombre: 'Barredora vial', clasificacion: 'especifico', marca_modelo_referencia: 'Modelo X', admite_equivalente: false, caracteristicas: ['Capacidad 500 lts', 'Peso máximo 600 kg'], cantidad: 1, unidad_medida: 'un' },
        { linea: 2, nombre: 'Hidrolavadora', clasificacion: 'generico', admite_equivalente: true, caracteristicas: ['Presión mínima 2000 PSI'], cantidad: 2, unidad_medida: 'un' },
      ],
    },
  };
  const lineas = lineasTecnicasDelInforme(informe);
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0].linea, 1);
  assert.equal(lineas[0].clasificacion, 'especifico');
  assert.equal(lineas[0].admiteEquivalente, false);
  assert.equal(lineas[0].marcaModeloReferencia, 'Modelo X');
  assert.deepEqual(lineas[0].caracteristicas, ['Capacidad 500 lts', 'Peso máximo 600 kg']);
  assert.equal(lineas[1].clasificacion, 'generico');
});

test('lineasTecnicasDelInforme: sin productos.items, cae a manifiesto_productos (sin caracteristicas)', () => {
  const informe = { manifiesto_productos: [{ linea: 1, descripcion: 'Carpa 180m2', cantidad: 1, unidad_medida: 'un' }] };
  const lineas = lineasTecnicasDelInforme(informe);
  assert.equal(lineas.length, 1);
  assert.deepEqual(lineas[0].caracteristicas, [], 'el shape aplanado (manifiesto_productos) no trae caracteristicas');
});

test('lineasTecnicasDelInforme: dedup por número de línea (no repite si el informe repite la línea por sub-ítem)', () => {
  const informe = { productos: { items: [
    { linea: 1, nombre: 'A', caracteristicas: ['x'] },
    { linea: 1, nombre: 'A (sub-ítem)', caracteristicas: ['y'] },
    { linea: 2, nombre: 'B', caracteristicas: ['z'] },
  ] } };
  const lineas = lineasTecnicasDelInforme(informe);
  assert.equal(lineas.length, 2);
});

test('evaluarCaracteristicaDeterminista: PISO cumple con mismo valor/unidad', () => {
  const r = evaluarCaracteristicaDeterminista({
    tipo: 'PISO', valorRequeridoNumero: 500, valorRequeridoNumeroMax: null, unidadRequerida: 'l',
    valorOfertadoNumero: 600, unidadOfertadaOriginal: 'l',
  });
  assert.ok(r);
  assert.equal(r!.veredicto, 'CUMPLE');
});

test('evaluarCaracteristicaDeterminista: PISO no cumple por debajo del mínimo', () => {
  const r = evaluarCaracteristicaDeterminista({
    tipo: 'PISO', valorRequeridoNumero: 500, valorRequeridoNumeroMax: null, unidadRequerida: 'l',
    valorOfertadoNumero: 400, unidadOfertadaOriginal: 'l',
  });
  assert.equal(r!.veredicto, 'NO_CUMPLE');
});

test('evaluarCaracteristicaDeterminista: TECHO cumple igual o por debajo del máximo', () => {
  const r = evaluarCaracteristicaDeterminista({
    tipo: 'TECHO', valorRequeridoNumero: 500, valorRequeridoNumeroMax: null, unidadRequerida: 'kg',
    valorOfertadoNumero: 500, unidadOfertadaOriginal: 'kg',
  });
  assert.equal(r!.veredicto, 'CUMPLE');
});

test('evaluarCaracteristicaDeterminista: TECHO no cumple por sobre el máximo (con conversión kg←ton)', () => {
  const r = evaluarCaracteristicaDeterminista({
    tipo: 'TECHO', valorRequeridoNumero: 500, valorRequeridoNumeroMax: null, unidadRequerida: 'kg',
    valorOfertadoNumero: 0.6, unidadOfertadaOriginal: 'ton',
  });
  assert.ok(r);
  assert.equal(r!.valorConvertidoNumero, 600);
  assert.equal(r!.veredicto, 'NO_CUMPLE');
});

test('evaluarCaracteristicaDeterminista: convierte unidades de la misma familia (mm → m)', () => {
  const r = evaluarCaracteristicaDeterminista({
    tipo: 'PISO', valorRequeridoNumero: 1, valorRequeridoNumeroMax: null, unidadRequerida: 'm',
    valorOfertadoNumero: 1200, unidadOfertadaOriginal: 'mm',
  });
  assert.ok(r);
  assert.equal(r!.valorConvertidoNumero, 1.2);
  assert.equal(r!.veredicto, 'CUMPLE');
});

test('evaluarCaracteristicaDeterminista: RANGO cumple dentro de los límites', () => {
  const r = evaluarCaracteristicaDeterminista({
    tipo: 'RANGO', valorRequeridoNumero: 0.7, valorRequeridoNumeroMax: 1.1, unidadRequerida: 'm',
    valorOfertadoNumero: 90, unidadOfertadaOriginal: 'cm',
  });
  assert.ok(r);
  assert.equal(r!.valorConvertidoNumero, 0.9);
  assert.equal(r!.veredicto, 'CUMPLE');
});

test('evaluarCaracteristicaDeterminista: EXACTO no cumple con valor distinto', () => {
  const r = evaluarCaracteristicaDeterminista({
    tipo: 'EXACTO', valorRequeridoNumero: 220, valorRequeridoNumeroMax: null, unidadRequerida: null,
    valorOfertadoNumero: 110, unidadOfertadaOriginal: null,
  });
  assert.equal(r!.veredicto, 'NO_CUMPLE');
});

test('evaluarCaracteristicaDeterminista: unidad desconocida o de otra familia → null (cae a IA)', () => {
  const r1 = evaluarCaracteristicaDeterminista({
    tipo: 'PISO', valorRequeridoNumero: 500, valorRequeridoNumeroMax: null, unidadRequerida: 'l',
    valorOfertadoNumero: 600, unidadOfertadaOriginal: 'kg',   // volumen vs peso — no comparable
  });
  assert.equal(r1, null);

  const r2 = evaluarCaracteristicaDeterminista({
    tipo: 'PISO', valorRequeridoNumero: 500, valorRequeridoNumeroMax: null, unidadRequerida: 'furlong',
    valorOfertadoNumero: 600, unidadOfertadaOriginal: 'furlong',   // unidad no en la tabla
  });
  assert.equal(r2, null);
});

test('evaluarCaracteristicaDeterminista: falta el valor ofertado o requerido → null', () => {
  assert.equal(evaluarCaracteristicaDeterminista({
    tipo: 'PISO', valorRequeridoNumero: 500, valorRequeridoNumeroMax: null, unidadRequerida: 'l',
    valorOfertadoNumero: null, unidadOfertadaOriginal: 'l',
  }), null);
});

test('evaluarCaracteristicaDeterminista: exige unidad requerida y no sabemos en cuál viene lo ofertado → null', () => {
  assert.equal(evaluarCaracteristicaDeterminista({
    tipo: 'PISO', valorRequeridoNumero: 500, valorRequeridoNumeroMax: null, unidadRequerida: 'l',
    valorOfertadoNumero: 600, unidadOfertadaOriginal: null,
  }), null);
});

test('evaluarCaracteristicaDeterminista: sin unidad requerida, compara los números directo', () => {
  const r = evaluarCaracteristicaDeterminista({
    tipo: 'PISO', valorRequeridoNumero: 10, valorRequeridoNumeroMax: null, unidadRequerida: null,
    valorOfertadoNumero: 12, unidadOfertadaOriginal: null,
  });
  assert.equal(r!.veredicto, 'CUMPLE');
});

test('resumenLinea: cuenta cada categoría correctamente', () => {
  const r = resumenLinea([
    { veredicto: 'CUMPLE', pendiente_confirmacion_proveedor: false },
    { veredicto: 'CUMPLE', pendiente_confirmacion_proveedor: false },
    { veredicto: 'NO_CUMPLE', pendiente_confirmacion_proveedor: false },
    { veredicto: 'CUMPLE_CON_COMPLEMENTO', pendiente_confirmacion_proveedor: false },
    { veredicto: null, pendiente_confirmacion_proveedor: false },
    { veredicto: null, pendiente_confirmacion_proveedor: true },
  ]);
  assert.equal(r.total, 6);
  assert.equal(r.cumplen, 2);
  assert.equal(r.noCumplen, 1);
  assert.equal(r.conComplemento, 1);
  assert.equal(r.sinEvaluar, 2);
  assert.equal(r.pendientesProveedor, 1);
});

test('slugCaracteristica: normaliza tildes, mayúsculas y símbolos a una clave estable', () => {
  assert.equal(slugCaracteristica('Capacidad estanque ≥ 500 lts'), 'capacidad_estanque_500_lts');
  assert.equal(slugCaracteristica('Peso máximo (kg)'), 'peso_maximo_kg');
});

// BUG REAL (18-ago-2026, 2296-48-LE26): la licitación cerró a las 13:00 y a las 14:06 el Auditor
// Técnico seguía mostrando "Quedan menos de 24 horas para el cierre". El cálculo del backend estaba
// BIEN (horasRestantes = -1.10 → "El plazo de cierre ya venció"); el popup de la UI tenía el texto
// fijo y nunca leía la causal. Estos tests fijan el contrato del que depende la UI: el código es
// siempre el mismo, y la DESCRIPCIÓN es la que distingue vencido de por vencer.
test('CIERRE_INMINENTE: distingue "ya venció" de "quedan menos de 24 horas"', () => {
  const base = {
    bloqueantesPendientes: 0, itemsNoCumpleSinResolver: 0, itemsPendientesProveedor: 0,
    bloqueTecnicoAprobado: true, bloqueComercialAprobado: true,
  };
  const causalDe = (horasRestantes: number | null) =>
    causalesDeBloqueo({ ...base, horasRestantes }).find(c => c.codigo === 'CIERRE_INMINENTE');

  // Ya venció: la UI se apoya en esta redacción para cambiar el mensaje del popup.
  assert.match(causalDe(-1.1)!.descripcion, /ya venci/i);
  assert.match(causalDe(-72)!.descripcion, /ya venci/i);
  // Todavía no vence.
  assert.match(causalDe(5)!.descripcion, /menos de 24 horas/i);
  assert.doesNotMatch(causalDe(5)!.descripcion, /ya venci/i);
  // Con más de 24 horas no hay causal de cierre, y sin fecha publicada tampoco se inventa una.
  assert.equal(causalDe(48), undefined);
  assert.equal(causalDe(null), undefined);
});
