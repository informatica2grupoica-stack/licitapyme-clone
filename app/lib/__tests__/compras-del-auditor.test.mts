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

test('un producto sin línea del costeo (el biombo, una parte aparte) guarda su ficha con id propio; un servicio no', async () => {
  const { filaDeProducto, esFilaSinLinea, filaDeProductoSinLinea, lineaRealDe } = await import('../compras-fichas');
  const lineas: any[] = [{ id: 'abc12345', lineaReal: 2, detalle: 'Unidad Podológico' }];
  const prod = (o: any) => ({ id: 682, correlativo: 9, descripcion: 'Biombo hospitalario', productoPadreId: null, esServicio: false, ...o });
  assert.equal(filaDeProducto(prod({ correlativo: 2, descripcion: 'Unidad Podológico', id: 562 }) as any, lineas), 'abc12345');   // con línea: como siempre
  assert.equal(filaDeProducto(prod({}) as any, lineas), 'prod:682');
  assert.equal(esFilaSinLinea('prod:682'), true); assert.equal(esFilaSinLinea('abc12345'), false); assert.equal(esFilaSinLinea('prod:x'), false);
  assert.equal(filaDeProductoSinLinea(7), 'prod:7');
  assert.equal(filaDeProducto(prod({ esServicio: true }) as any, lineas), null);
  assert.equal(lineaRealDe(prod({}) as any, lineas), 9);                         // sin línea: el correlativo del acta busca los requisitos de las bases
  assert.equal(lineaRealDe(prod({ productoPadreId: 562 }) as any, lineas), null);   // una parte aparte no hereda requisitos que no se sabe si le tocan
});

test('el motor de fichas ya no exige línea del costeo para asignar ni comparar', () => {
  const src = readFileSync(new URL('../compras-fichas.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Este producto no tiene una línea en el Costeo/);
  assert.doesNotMatch(src, /Ese producto no tiene línea en el Costeo/);
  assert.match(src, /filaCmp\(fila\)/);
});

test('al ganar, lo que cargó el asistente pasa solo a Compras: una vez, nunca en pre-compra, sin bloquear la asignación', () => {
  const src = readFileSync(new URL('../compras-del-auditor.ts', import.meta.url), 'utf8');
  assert.match(src, /export async function traspasarDelAuditorAlGanar/);
  assert.match(src, /esPrecompra\(negocioId\)\) return null/);                  // en pre-compra espera la adjudicación firme
  assert.match(src, /!opts\.forzar && \(await ultimoTraspaso/);                  // una sola vez por negocio
  assert.match(src, /i\.tipo === 'ficha' \|\| !panel\.compraAprobada/);          // con la compra aprobada solo fichas
  assert.match(src, /pausa\(1500\)/);                                            // sin lanzar decenas de auditorías de golpe
  assert.match(src, /catch \(e\) \{\s*\n?\s*console\.error\(`\[compras-del-auditor\] traspaso al ganar falló/);   // nunca lanza
  const compras = readFileSync(new URL('../compras.ts', import.meta.url), 'utf8');
  assert.equal((compras.match(/traspasarDelAuditorAlGanar\(negocioId\)/g) || []).length, 2);   // al asignar encargado (productos recién creados) y al confirmar la pre-compra
  assert.match(compras, /if \(!\(yaTeniaProductos as any\[\]\)\.length\) void import/);        // reasignar encargado no lo repite
});

test('el resumen del trabajo del asistente sale en el panel (líneas elegidas, quiénes trabajaron, último traspaso)', () => {
  const src = readFileSync(new URL('../compras-del-auditor.ts', import.meta.url), 'utf8');
  for (const k of ['conElegida', 'sinElegida', 'sinOpcion', 'trabajo', 'ultimoAt', 'traspaso', 'diffPct']) assert.ok(src.includes(k), k);
  const ui = readFileSync(new URL('../../compras/[negocioId]/RevisadoDelAuditorCard.tsx', import.meta.url), 'utf8');
  assert.match(ui, /Lo que hizo el asistente en el Auditor/);
  assert.match(ui, /data-testid="traspaso-auditor"/);
});
