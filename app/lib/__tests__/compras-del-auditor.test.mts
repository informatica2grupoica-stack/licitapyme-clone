// «Revisado del Auditor» (Compras): reglas de qué documento del Auditor se puede pasar a Compras, y que el puente no rompa la separación.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { respaldoQueSostiene, fichasUsables, origenDeArchivo, motivoCotizacionNoUsable, esElegida, textoCumple } from '../compras-del-auditor-core';

const r = (o: any) => ({ id: 1, tipo: 'cotizacion_formal', documentoUrl: 'https://r2/x.pdf', documentoNombre: 'x.pdf', url: null, precioDeclarado: null, precioIva: 'neto', vigente: true, sostieneCosto: false,
  cargadoAt: '', cargadoPorNombre: null, extraccionId: 10, productoIdx: 0, ...o }) as any;

test('sostiene el costo el respaldo marcado; si no, el vigente más reciente; una ficha nunca', () => {
  assert.equal(respaldoQueSostiene([r({ id: 1 }), r({ id: 2 })])?.id, 2);
  assert.equal(respaldoQueSostiene([r({ id: 1, sostieneCosto: true }), r({ id: 2 })])?.id, 1);
  assert.equal(respaldoQueSostiene([r({ id: 1, tipo: 'ficha_tecnica' })]), null);
  assert.equal(respaldoQueSostiene([r({ id: 1, vigente: false })]), null);
});

test('solo se ofrecen fichas con archivo y con la lectura del producto', () => {
  const ok = r({ id: 5, tipo: 'ficha_tecnica' });
  assert.deepEqual(fichasUsables([ok, r({ id: 6, tipo: 'ficha_tecnica', documentoUrl: null }), r({ id: 7, tipo: 'ficha_tecnica', extraccionId: null }), r({ id: 8, tipo: 'ficha_tecnica', vigente: false }), r({ id: 9 })]).map(x => x.id), [5]);
});

test('una cotización sin precio neto, sin archivo o que viene de un link no se pasa, y dice por qué', () => {
  assert.equal(motivoCotizacionNoUsable({ respaldo: r({}), precioNeto: 1000 }), null);
  assert.match(motivoCotizacionNoUsable({ respaldo: r({}), precioNeto: null })!, /precio neto/);
  assert.match(motivoCotizacionNoUsable({ respaldo: r({ tipo: 'link_web' }), precioNeto: 1000 })!, /link/);
  assert.match(motivoCotizacionNoUsable({ respaldo: r({ documentoUrl: null }), precioNeto: 1000 })!, /archivo/);
  assert.match(motivoCotizacionNoUsable({ respaldo: null, precioNeto: 1000 })!, /documento/);
});

test('origen según el archivo, y qué estados cuentan como «elegida»', () => {
  assert.equal(origenDeArchivo('foto.JPG', null), 'imagen');
  assert.equal(origenDeArchivo('cot.pdf', null), 'pdf');
  assert.equal(origenDeArchivo('', 'https://r2/a/b.png?x=1'), 'imagen');
  assert.equal(esElegida('aprobada'), true); assert.equal(esElegida('definitiva'), true); assert.equal(esElegida('tanteo'), false);
  assert.equal(textoCumple({ total: 12, cumple: 11, noCumple: 0, sinVeredicto: 1 }), 'Cumple 11 de 12');
  assert.equal(textoCumple(null), null);
});

test('el puente no mezcla los espacios: lee del Auditor, escribe solo con las funciones de Compras y nunca re-lee con IA', () => {
  const src = readFileSync(new URL('../compras-del-auditor.ts', import.meta.url), 'utf8');
  assert.match(src, /armarPanelAuditorCompartido/);                       // lee el panel del Auditor
  assert.match(src, /registrarCotizacion\(/);                             // escribe cotizaciones por la vía oficial de Compras
  assert.match(src, /asignarProductoDeFicha\(/);                          // y fichas por la vía oficial
  assert.match(src, /itemsManual:/);                                      // producto y precio ya asignados: no corre la homologación por IA
  assert.doesNotMatch(src, /INSERT INTO auditor_(opcion|respaldo)|UPDATE auditor_|DELETE FROM auditor_/);   // jamás escribe en las tablas del Auditor por su cuenta
  assert.doesNotMatch(src, /extraerDatosCotizacionDeDocumento|homologarCotizacionIA|leerYGuardarDocumento/);  // sin lecturas nuevas
  assert.match(src, /ConfirmarCompraAprobada/);                           // compra aprobada: pide confirmar
});

test('la ruta exige permiso de operar para pasar documentos y la bitácora lo anota', () => {
  const ruta = readFileSync(new URL('../../api/compras/[negocioId]/del-auditor/route.ts', import.meta.url), 'utf8');
  assert.match(ruta, /puedeOperarPreAprobacion/);
  assert.match(ruta, /conBitacoraCompras\(__POST/);
  assert.match(ruta, /status: 409/);
  const bit = readFileSync(new URL('../compras-bitacora.ts', import.meta.url), 'utf8');
  assert.match(bit, /case 'del-auditor'/);
});
