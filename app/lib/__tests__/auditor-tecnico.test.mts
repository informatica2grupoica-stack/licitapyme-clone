// Tests de las funciones deterministas del Agente Técnico (Auditor Técnico, Fase 1). Las
// funciones que llaman a la IA (clasificarCaracteristicasLinea, compararFichaProveedor,
// evaluarCaracteristicaConIA) no se testean aquí — solo lo que corre sin red.
// Correr con: npx tsx --test app/lib/__tests__/auditor-tecnico.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lineasTecnicasDelInforme, productosCrudosDeLinea, evaluarCaracteristicaDeterminista, resumenLinea, slugCaracteristica,
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

// (26-ago-2026, auditoría técnica, caso real 986278-14-LE26.) ANTES esta regla se llamaba "dedup"
// y DESCARTABA el segundo ítem asumiendo que era un "sub-ítem repetido" del mismo producto — pero
// una línea de licitación puede ser un PAQUETE de productos genuinamente distintos que comparten
// número de línea (la Línea 7 real: 11 herramientas de ferretería). Ahora se FUSIONAN, no se
// descartan: ambos nombres y ambas características sobreviven.
test('varios productos con la MISMA línea real se fusionan (no se descarta ninguno)', () => {
  const informe = { productos: { items: [
    { linea: 1, nombre: 'A', caracteristicas: ['x'] },
    { linea: 1, nombre: 'B', caracteristicas: ['y'] },
    { linea: 2, nombre: 'C', caracteristicas: ['z'] },
  ] } };
  const lineas = lineasTecnicasDelInforme(informe);
  assert.equal(lineas.length, 2, 'sigue habiendo 2 líneas REALES, no 3');
  assert.match(lineas[0].nombre, /A/);
  assert.match(lineas[0].nombre, /B/, 'el segundo producto no debe perderse del nombre');
  assert.deepEqual(lineas[0].caracteristicas, ['A: x', 'B: y'],
    'cada característica debe quedar trazada a SU producto — sin esto el Camino B no sabe a cuál aplica');
});

// El bug original no era de conteo, era de NUMERACIÓN: `Number("L5")` da NaN y el fallback caía al
// ÍNDICE del array, no al número real dentro del string. Caso real: 28 "líneas" (1 por producto)
// en vez de las 7 líneas reales de las bases — la "Línea 7" del checklist mostraba un producto
// que en realidad era el 7° del array (línea real L5), mientras los 11 productos reales de la
// línea 7 quedaban dispersos como líneas 18 a 28.
test('el número de línea se extrae del string "L5"/"L7", no de la posición en el array (regresión 986278-14-LE26)', () => {
  const informe = { productos: { items: [
    { linea: 'L1', nombre: 'Cámara de frío', caracteristicas: [] },
    { linea: 'L5', nombre: 'Termómetro', caracteristicas: [] },
    { linea: 'L5', nombre: 'Anemómetro', caracteristicas: [] },
    { linea: 'L7', nombre: 'Juego de dados', caracteristicas: [] },
    { linea: 'L7', nombre: 'Esmeril angular', caracteristicas: [] },
  ] } };
  const lineas = lineasTecnicasDelInforme(informe);
  assert.deepEqual(lineas.map(l => l.linea), [1, 5, 7], 'deben ser las líneas REALES (1,5,7), no la posición (1,2,3,4,5)');
  const l7 = lineas.find(l => l.linea === 7)!;
  assert.match(l7.nombre, /Juego de dados/);
  assert.match(l7.nombre, /Esmeril angular/);
});

// clasificacion/admiteEquivalente del paquete deben tomar el criterio MÁS EXIGENTE, no el del
// primer producto ni un promedio — perder que UN producto del paquete exige algo específico
// sería más grave que tratar de más a los genéricos del mismo paquete.
test('un paquete con productos mixtos (específico + genérico) hereda el criterio más exigente', () => {
  const informe = { productos: { items: [
    { linea: 7, nombre: 'Genérico', clasificacion: 'generico', admite_equivalente: true, caracteristicas: [] },
    { linea: 7, nombre: 'Específico', clasificacion: 'especifico', admite_equivalente: false, caracteristicas: [] },
  ] } };
  const [l7] = lineasTecnicasDelInforme(informe);
  assert.equal(l7.clasificacion, 'especifico', 'un solo producto específico basta para que la línea entera lo sea');
  assert.equal(l7.admiteEquivalente, false, 'un solo producto que NO admite equivalente basta para que la línea entera no lo admita');
});

// Cuando hay UN solo producto por línea (el caso normal, sin paquete) el comportamiento no debe
// cambiar en nada — cantidad/unidad siguen viniendo del producto, no se pierden por el camino de
// fusión que solo aplica a paquetes de 2+.
test('con un solo producto por línea, cantidad y unidad siguen presentes (sin cambios)', () => {
  const informe = { productos: { items: [
    { linea: 1, nombre: 'Barredora', cantidad: 3, unidad_medida: 'un', caracteristicas: [] },
  ] } };
  const [l1] = lineasTecnicasDelInforme(informe);
  assert.equal(l1.cantidad, 3);
  assert.equal(l1.unidadMedida, 'un');
});

// ─── productosCrudosDeLinea: para la ficha técnica PROPIA (migración 82) ──────────────────────
// A diferencia de lineasTecnicasDelInforme (que FUSIONA en un solo nombre para el checklist de
// cumplimiento), esto devuelve cada producto POR SEPARADO — caso real 2446-240-LE26: la "Línea 1"
// es "Hidrolavadora H300" + "Vacuolavadora DB51 Dimer", cada una con su propia marca/modelo/foto.
test('productosCrudosDeLinea: un solo producto por línea devuelve un array de 1', () => {
  const informe = { productos: { items: [
    { linea: 1, nombre: 'Barredora vial', cantidad: 3, unidad_medida: 'un' },
  ] } };
  const productos = productosCrudosDeLinea(informe, 1);
  assert.equal(productos.length, 1);
  assert.equal(productos[0].nombre, 'Barredora vial');
  assert.equal(productos[0].cantidad, 3);
  assert.equal(productos[0].unidadMedida, 'un');
});

test('productosCrudosDeLinea: una línea-paquete devuelve CADA producto SIN fusionar (caso real 2446-240-LE26)', () => {
  const informe = { productos: { items: [
    { linea: 'L1', nombre: 'Hidrolavadora peatonal equivalente a modelo H300 de Tecnomaq + 2 (Dos) plato de lavado 22" inoxidable', cantidad: 2, unidad_medida: 'Unidad', caracteristicas: ['Presión 285 bar', 'Peso 165 kg'] },
    { linea: 'L1', nombre: 'Vacuolavadora de empuje equivalente a modelo DB51 Dimer + 3 Rodillos + 3 Squeegee', cantidad: 3, unidad_medida: 'Unidad', caracteristicas: ['Motor 550W'] },
  ] } };
  const productos = productosCrudosDeLinea(informe, 1);
  assert.equal(productos.length, 2, 'los 2 productos deben sobrevivir SIN fusionarse');
  assert.match(productos[0].nombre, /Hidrolavadora/);
  assert.match(productos[1].nombre, /Vacuolavadora/);
  assert.equal(productos[0].cantidad, 2);
  assert.equal(productos[1].cantidad, 3, 'cada producto conserva SU PROPIA cantidad, no la de la línea fusionada');
  // Migración 83: cada producto trae SUS PROPIAS características, sin el prefijo del nombre que
  // usa lineasTecnicasDelInforme() — así se puede clasificar cada una por separado.
  assert.deepEqual(productos[0].caracteristicas, ['Presión 285 bar', 'Peso 165 kg']);
  assert.deepEqual(productos[1].caracteristicas, ['Motor 550W']);
});

test('productosCrudosDeLinea: línea sin productos en el informe devuelve array vacío (fallback a 1 genérico lo maneja el llamador)', () => {
  const informe = { productos: { items: [{ linea: 1, nombre: 'A' }] } };
  assert.deepEqual(productosCrudosDeLinea(informe, 99), []);
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
