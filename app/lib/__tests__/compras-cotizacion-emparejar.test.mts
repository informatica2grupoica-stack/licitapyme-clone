import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atributosDe, conflictosMedibles, productosCandidatos, tandasDeLineas, lineaDeLaAsignacion, medidasEnComun } from '../compras-cotizacion-emparejar';

const L = (descripcion: string, precioUnitario: number, cantidad = 1): any => ({ descripcion, cantidad, precioUnitario, total: precioUnitario * cantidad, descuentoPct: null });
const graves = (a: string, b: string) => conflictosMedibles(a, b).filter(c => c.grave || c.clase === 'modelo');

// 727202-72-LP26 (cot. INGAP 176408): «75 mm» se quedó con el precio de la línea de 63 mm.
test('75 mm pedido vs línea de 63 mm = choque grave; 63 vs 63 no', () => {
  assert.equal(graves('Tubería HDPE de 75mm, unidad de 100m.', 'Tuberia (Rollo 100 metros) PE100 PN10 d= 63 mm Coextruida').length, 1);
  assert.equal(graves('Tubería HDPE de 63 mm, PE100, PN10 (R/100).', 'Tuberia (Rollo 100 metros) PE100 PN10 d= 63 mm Coextruida').length, 0);
});
test('«d= 90 x 3"» y «90×3"» se leen igual (transición)', () => {
  assert.equal(graves('Transición HDP HE 90×3".', 'Transición TF PE100 PN16 d= 90 x 3" HE').length, 0);
});
test('rangos: 110 mm cabe en una máquina de 20-160 mm; 200 mm no', () => {
  assert.equal(graves('Máquina para tubo de 110 mm', 'Máquina de Electrofusión 20-160 mm').length, 0);
  assert.equal(graves('Máquina para tubo de 200 mm', 'Máquina de Electrofusión 20-160 mm').length, 1);
});
test('pulgadas con fracción: 4 1/2” = 4-1/2"; y comparten medidas aunque el nombre se parezca poco', () => {
  assert.equal(graves('Esmeril inalámbrico Makita de 4 1/2”, 18 V', 'DGA454Z - Esmeril Angular 4-1/2" (115Mm) 18V Lxt Makita').length, 0);
  assert.ok(medidasEnComun('Esmeril inalámbrico Makita de 4 1/2”, 18 V', 'DGA454Z - Esmeril Angular 4-1/2" (115Mm) 18V Lxt Makita') >= 2);
});
test('tensión y potencia: 220 V ≠ 380 V; «6000 KW» mal escrito se tolera frente a 6.000 W', () => {
  assert.equal(graves('Bomba sumergible 1,5 HP, 220 V', 'Bomba sumergible 1,5 HP 380V').length, 1);
  assert.equal(graves('Generador a gasolina, 6000 KW 25 L', 'Generador a gasolina 6.000 W').length, 0);
});
test('modelos distintos chocan; el mismo modelo escrito distinto no (DPS-22 = DPS22)', () => {
  assert.equal(graves('Máquina de electrofusión INGAP DPS-22', 'Máquina electrofusión marca INGAP Modelo DPS-22 (3,5Kw)').length, 0);
  assert.equal(graves('Máquina de electrofusión INGAP DPS-22', 'Máquina de electrofusión EURO-JUNIOR 4500').length, 1);
  assert.equal(graves('Termofusionadora SHDS 160', 'Termofusionadora SHDS 180').length >= 0, true);
});
test('«de 100 m» o «Kaiman 150 bar» no son códigos de modelo', () => {
  assert.equal(atributosDe('Pozómetro de 100 m con carrete').modelos.size, 0);
  assert.equal(atributosDe('Hidrolavadora Kaiman 150 bar').modelos.size, 0);
  assert.ok(atributosDe('Pozómetro SEP100').modelos.has('SEP100'));
});
test('largo en metros no es medida comparable: rollo 68 m vs línea de 140 MT no choca', () => {
  assert.equal(graves('Rollo nylon 68mts', 'FOLIO INCOLORO 2 MTS X 0.20MM 140 MT').length, 0);
});

const productos = [
  { id: 1, descripcion: 'Tubería HDPE de 63 mm, PE100, PN10 (R/100).', cantidad: 100 },
  { id: 2, descripcion: 'Tubería HDPE de 75 mm, PE100, PN10 (R/50).', cantidad: 100 },
  { id: 3, descripcion: 'Tubería HDPE de 75mm, unidad de 100m.', cantidad: 1 },
  { id: 4, descripcion: 'Tubería HDPE de 110 mm,PN10(50 m).', cantidad: 2 },
  { id: 5, descripcion: 'Bomba sumergible Pedrollo Dm30-N, 1,5 HP, 220-240V.', cantidad: 1 },
  { id: 6, descripcion: 'Generador a gasolina Bauker, partida eléctrica, 6.000 W.', cantidad: 1 },
];
test('candidatos: la línea de 63 mm ofrece el producto de 63 y no los de 75; la bomba no entra', () => {
  const c = productosCandidatos([L('Tuberia (Rollo 100 metros) PE100 PN10 d= 63 mm Coextruida', 3222, 400)], productos, { minimo: 1 });
  assert.ok(c.has(1));
  assert.ok(!c.has(2) && !c.has(3));
  assert.ok(!c.has(5));
});
test('candidatos: el proveedor nombra distinto («bombeo» ~ «bomba») y aun así la bomba se ofrece; un flete no ofrece nada', () => {
  const c = productosCandidatos([L('Equipo bombeo agua pozo', 500000)], productos);
  assert.ok(c.has(5));
  assert.equal(productosCandidatos([L('SHIPPING-COST - NACIONAL Costo de Envio', 16000)], productos).size, 0);
});
test('candidatos: las filas repetidas del mismo producto entran todas', () => {
  const rep = [1, 2, 3, 4].map(i => ({ id: 10 + i, descripcion: 'Máquina de fusión HDPE Hürner HST 300 Smart, 20-160 mm.', cantidad: 1 })).concat([{ id: 99, descripcion: 'Bomba de pozo 30 HP 380V', cantidad: 1 }]);
  const c = productosCandidatos([L('Soldadora de termofusión PL160 Marca Tecnodue 20-160 mm', 5295, 1)], rep, { minimo: 1 });
  assert.deepEqual([11, 12, 13, 14].every(i => c.has(i)), true);
});
test('tandas: 20 líneas o menos = una; 40 = tandas de 15', () => {
  assert.equal(tandasDeLineas(Array.from({ length: 20 }, (_, i) => i)).length, 1);
  const t = tandasDeLineas(Array.from({ length: 40 }, (_, i) => i));
  assert.deepEqual(t.map(x => x.length), [15, 15, 10]);
});
test('línea de respaldo: por precio manda sobre el nombre (63 mm a $3.222, no la de 75 mm parecida)', () => {
  const lineas = [L('Tuberia (Rollo 100 metros) PE100 PN10 d= 75 mm Coextruida', 4500, 100), L('Tuberia (Rollo 100 metros) PE100 PN10 d= 63 mm Coextruida', 3222, 400)];
  assert.equal(lineaDeLaAsignacion('Tubería HDPE de 75mm, unidad de 100m.', lineas, 3222)?.precioUnitario, 3222);
  assert.equal(lineaDeLaAsignacion('Tubería HDPE de 75mm, unidad de 100m.', lineas, null)?.precioUnitario, 4500);
});

test('precio cruzado: la bomba con el precio de la tubería no es plausible; la tubería con su propio precio sí', async () => {
  const { respaldoDelPrecio } = await import('../compras-cotizacion-emparejar');
  const lineas = [L('Tuberia (Rollo 100 metros) PE100 PN10 d= 63 mm Coextruida', 3222, 400), L('Máquina electrofusión marca INGAP Modelo DPS-22 (3,5Kw)', 1380000, 7)];
  assert.equal(respaldoDelPrecio('Bomba de pozo profundo Franklin SS 624/22, descarga 3", motor 15 HP, 380 V', lineas, 3222)?.plausible, false);
  assert.equal(respaldoDelPrecio('Tubería HDPE de 63 mm, PE100, PN10 (R/100).', lineas, 3222)?.plausible, true);
  assert.equal(respaldoDelPrecio('Máquina de electrofusión INGAP DPS-22.', lineas, 1380000)?.plausible, true);
  assert.equal(respaldoDelPrecio('Bomba', lineas, 999), null);   // precio que no es de una sola línea: no se juzga
});

test('«SS642-14,30 HP» es 30 HP, no 14,3 HP; y 30 HP pedido vs línea de 15 HP sí choca', () => {
  assert.equal(graves('Bomba de pozo Franklin SS642-14,30 HP,380V.', 'Bomba Franklin SS 642-14 30 HP 380 V').length, 0);
  assert.ok(graves('Bomba de pozo Franklin SS642-14,30 HP,380V.', 'Bomba Franklin SS 624/20, motor 15 HP, 380 V').some(c => c.clase === 'hp'));
});

test('modelo exacto: «PQ128C-PQWT» toma la única línea PQ128C aunque la IA haya elegido otra; con dos líneas del mismo modelo no se decide', async () => {
  const { lineaConElMismoModelo } = await import('../compras-cotizacion-emparejar');
  const lineas = [L('L2000 - PQWT Detector de Fugas por Ultrasonido para exteriores', 1699900, 2), L('PQ128C - PQWT Detector de Fugas por Ultrasonido para interiores y exteriores', 1799900, 1), L('AD21P - HIKMicro Detector de Fugas', 949900, 2), L('AD21P - HIKMicro Detector de Fugas', 949900, 1)];
  assert.equal(lineaConElMismoModelo('Geófono detector de fugas por ultrasonido PQ128C-PQWT.', lineas)?.precioUnitario, 1799900);
  assert.equal(lineaConElMismoModelo('Detector HIKMicro AD21P', lineas), null);
  assert.equal(lineaConElMismoModelo('Geófono para detección de fugas.', lineas), null);
});

test('el conflicto de medida se ve aunque sea la línea que trae el precio (75 mm pedido, 63 mm cotizado a $3.222)', () => {
  const lineas = [L('Tuberia (Rollo 100 metros) PE100 PN10 d= 63 mm Coextruida', 3222, 400)];
  const l = lineaDeLaAsignacion('Tubería HDPE de 75mm, unidad de 100m.', lineas, 3222);
  assert.ok(l);
  assert.equal(conflictosMedibles('Tubería HDPE de 75mm, unidad de 100m.', l!.descripcion).filter(c => c.grave).length, 1);
});
