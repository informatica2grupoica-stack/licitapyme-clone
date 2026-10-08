import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lineasSinAsignar, lineasDesdeTabla, corregirAdicionalesConLineas, numeroDeTexto, numeroApareceEnTexto, normalizarLineas, proveedorDesdeTexto, esEmpresaPropia, tablaDeLineas } from '../compras-cotizacion-lineas';

// Textos REALES de las 6 cotizaciones del negocio 142 (07-oct-2026). Los PDF con texto digital se leen con el lector por filas;
// los escaneados salen del OCR.
const fx = (n: string) => readFileSync(new URL(`./fixtures/cotizaciones/${n}`, import.meta.url), 'utf8');
const PROPIAS = { nombres: ['INVERSIONES CLARO ARZ SPA', 'COMERCIAL MP SPA'], ruts: ['76.902.659-2', '78.388.175-6'] };

test('números con formato chileno, americano y de miles con coma', () => {
  assert.equal(numeroDeTexto('121.000,85'), 121000.85);
  assert.equal(numeroDeTexto('$ 329.990'), 329990);
  assert.equal(numeroDeTexto('$ 2,551,206'), 2551206);
  assert.equal(numeroDeTexto('134,5'), 134.5);
  assert.equal(numeroDeTexto('1.80'), 1.8);
  assert.equal(numeroDeTexto('abc'), null);
});

test('30464 (Electrónica Retail): el unitario final sale de total ÷ cantidad y el 10 % NO se descuenta dos veces', () => {
  const texto = fx('electronica-retail-30464.txt');
  // Lo que devolvió la IA en la prueba real: unitario BRUTO 134.445,38, 10 %, y el total ya descontado.
  const r = normalizarLineas([{ descripcion: 'MINI COMPONENTE JAZZ AUDIO DM-999', cantidad: 26, precioUnitario: 134445.38, descuentoPct: 10, total: 3146022 }], texto, 3146022);
  assert.equal(r.lineas.length, 1);
  assert.ok(Math.abs((r.lineas[0].precioUnitario as number) - 121000.85) < 0.05, `unitario final ${r.lineas[0].precioUnitario}`);
  assert.equal(r.lineas[0].total, 3146022);
  assert.equal(r.cuadra, true);
});

test('un precio de línea que no aparece en el documento (el "$109" de 121.000,85) se descarta', () => {
  const texto = fx('electronica-retail-30464.txt');
  assert.equal(numeroApareceEnTexto(109, texto), false);
  assert.equal(numeroApareceEnTexto(121000.85, texto), true);
  const r = normalizarLineas([{ descripcion: 'MINI COMPONENTE', cantidad: 26, precioUnitario: 121.00085, total: null }], texto, 3146022);
  assert.equal(r.lineas[0].precioUnitario, null);
  assert.ok(r.avisos.some(a => /no aparece/.test(a)));
});

test('399 (Impulzo): los unitarios impresos NO cuadran con sus subtotales; manda el subtotal (que suma el total con IVA) y queda un aviso', () => {
  const texto = fx('impulzo-399.txt');
  // El documento imprime "$ 329.990 × 3" pero su subtotal es $ 899.970 (= 299.990 × 3); el neto 975.555 es la suma de los subtotales.
  const r = normalizarLineas([
    { descripcion: 'Sistema de sonido Pro Bass Powerstage 215', cantidad: 3, precioUnitario: 329990, total: 899970 },
    { descripcion: 'Micrófono Inalámbrico doble Pro Bass UF 224', cantidad: 3, precioUnitario: 84990, total: 209970 },
    { descripcion: 'Cable para Parlante Speakon - Speakon de 10 Metros', cantidad: 3, precioUnitario: 16990, total: 50970 },
  ], texto, 975555);
  assert.deepEqual(r.lineas.map(l => l.precioUnitario), [299990, 69990, 16990]);
  assert.equal(r.suma, 1160910);        // = TOTAL con IVA del documento
  assert.equal(r.cuadra, true);
  assert.equal(r.base, 'bruto');         // los subtotales de línea ya incluyen IVA
  assert.equal(r.avisos.filter(a => /no cuadra con el total/.test(a)).length, 2);
  assert.match(tablaDeLineas(r.lineas), /1\. Sistema de sonido.*precio unitario 299990/);
});

test('17697 (ROHE): dos líneas; el proveedor sale del membrete aunque la IA no lo entregue', () => {
  const texto = fx('rohe-17697.txt');
  const r = normalizarLineas([
    { descripcion: 'TELÓN CON TRÍPODE PREMIUM', cantidad: 1, precioUnitario: 65000, total: 65000 },
    { descripcion: 'TELÓN DE PROYECCIÓN MOTORIZADO ESSENTIAL LINE 112"', cantidad: 12, precioUnitario: 113439, total: 1361268 },
  ], texto, 1426268);
  assert.equal(r.cuadra, true);
  const p = proveedorDesdeTexto(texto, PROPIAS);
  assert.equal(p?.nombre, 'ROHE STORE SPA');
  assert.match(p?.rut || '', /77\.085\.964-6/);
});

test('959 (Horizontal): números con coma de miles', () => {
  const texto = fx('horizontal-959.txt');
  const r = normalizarLineas([{ descripcion: 'Canon Eos Rebel T7', cantidad: 6, precioUnitario: 425201, total: 2551206 }], texto, 2551206);
  assert.equal(r.cuadra, true);
  assert.equal(proveedorDesdeTexto(texto, PROPIAS)?.nombre, 'HORIZONTAL SPA');
});

test('1552047 (imagen): "Empresa: INVERSIONES CLARO" es el CLIENTE; el proveedor es el de los datos de facturación', () => {
  const texto = fx('ricardo-rodriguez-1552047-ocr.txt');
  assert.equal(esEmpresaPropia('INVERSIONES CLARO ARZ SPA', '76902659-2', PROPIAS), true);
  assert.equal(esEmpresaPropia('Comercial MP SpA', null, PROPIAS), true);
  assert.equal(esEmpresaPropia('RICARDO RODRIGUEZ Y CIA. LTDA.', '89.912.300-K', PROPIAS), false);
  const p = proveedorDesdeTexto(texto, PROPIAS);
  assert.match(p?.nombre || '', /RICARDO RODRIGUEZ Y CIA/i);
  assert.equal((p?.rut || '').replace(/\./g, ''), '89912300-K');
});

test('nunca devuelve una empresa propia como proveedor', () => {
  assert.equal(proveedorDesdeTexto('COTIZACIÓN\nINVERSIONES CLARO ARZ SPA\nR.U.T: 76.902.659-2\n', PROPIAS), null);
});

test('Impulzo: los adicionales (micrófono y cables) toman cantidad y precio de la línea del documento, no 1/3 por set', () => {
  const texto = fx('impulzo-399.txt');
  const norm = normalizarLineas([
    { descripcion: 'Sistema de sonido Pro Bass Powerstage 215', cantidad: 3, precioUnitario: 329990, total: 899970 },
    { descripcion: 'Micrófono Inalámbrico doble Pro Bass UF 224', cantidad: 3, precioUnitario: 84990, total: 209970 },
    { descripcion: 'Cable para Parlant Speakon - Speakon de 10 Metros', cantidad: 3, precioUnitario: 16990, total: 50970 },
  ], texto, 975555);
  const descripcionLibre = tablaDeLineas(norm.lineas) + texto;
  const leidas = lineasDesdeTabla(descripcionLibre);
  assert.equal(leidas.length, 3);
  assert.equal(leidas[1].cantidad, 3);
  // Lo que devolvió la IA: cantidad 1 y precio neto ya convertido.
  const r = corregirAdicionalesConLineas([
    { concepto: 'Micrófono Inalámbrico doble Pro Bass UF 224', cantidad: 1, precioUnitario: 58815 },
    { concepto: 'Cable para Parlant Speakon - Speakon de 10 Metros Kirlin SBCV167K-10M (2 cables)', cantidad: 1, precioUnitario: 28555 },
  ], leidas);
  const a = r.adicionales as any[];
  assert.deepEqual(a.map(x => [x.cantidadLinea, x.precioUnitario]), [[3, 69990], [3, 16990]]);
  assert.equal(r.corregidos, 2);
});

test('líneas sin asignar: el micrófono inalámbrico queda cubierto por «SET MICRÓFONO»; una línea sin dueño se avisa', () => {
  const lineas = [
    { descripcion: 'Sistema de sonido Pro Bass Powerstage 215', cantidad: 3, precioUnitario: 299990, descuentoPct: null, total: 899970 },
    { descripcion: 'Micrófono Inalámbrico doble Pro Bass UF 224', cantidad: 3, precioUnitario: 69990, descuentoPct: null, total: 209970 },
    { descripcion: 'Cable para Parlant Speakon - Speakon de 10 Metros', cantidad: 3, precioUnitario: 16990, descuentoPct: null, total: 50970 },
  ];
  assert.deepEqual(lineasSinAsignar(lineas, ['SET AMPLIFICACIÓN sistema de sonido', 'SET MICRÓFONO', 'Cable para Parlant Speakon']).length, 0);
  const sin = lineasSinAsignar(lineas, ['SET AMPLIFICACIÓN sistema de sonido']);
  assert.deepEqual(sin.map(l => l.descripcion.slice(0, 5)), ['Micró', 'Cable']);
});
