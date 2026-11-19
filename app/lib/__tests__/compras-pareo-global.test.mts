import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parearNegocio, validarPareoGlobal, lineasDelNegocio, conEquivalenciaNominal, choqueDeFamilia, declaradasEquivalentes, type CotizacionPareo, type ProductoPareo } from '../compras-pareo-global-core';

// Casos reales del negocio 727202-72-LP26 (docs/diseno-pareo-global-cotizaciones.md §7 y el comparativo del equipo). La IA se simula con una
// respuesta fija: lo que se prueba son las comprobaciones del código.
const doc = (lineas: Array<[string, number, number, string?]>) =>
  'LÍNEAS DEL DOCUMENTO (leídas y verificadas; el precio unitario ya trae el descuento de la línea):\n'
  + lineas.map(([d, q, pu, u], i) => `${i + 1}. ${d} | cantidad ${q}${u ? ' ' + u : ''} | precio unitario ${pu} | total ${q * pu}`).join('\n') + '\n\nTexto del PDF';
const cot = (id: number, proveedor: string, lineas: Array<[string, number, number, string?]>, extra: Partial<CotizacionPareo> = {}): CotizacionPareo => ({
  id, proveedor_nombre: proveedor, moneda: 'CLP', tipo_cambio_usado: null, notas: null, descuento_pct: null,
  precio_total: lineas.reduce((s, [, q, pu]) => s + q * pu, 0), flete_monto: null, descripcion_libre: doc(lineas), ...extra,
});
const ia = (r: any) => async () => ({ content: JSON.stringify(r), finishReason: 'stop' });
const P = (id: number, descripcion: string, cantidad: number, unidad = 'un'): ProductoPareo => ({ id, descripcion, cantidad, unidad });

test('7 máquinas DPS-22 en UNA línea → 7 ítems de electrofusión; la 8.ª no cabe y queda como alternativa', async () => {
  const productos = [P(1, 'Máquina de electrofusión EURO-JUNIOR.', 1), P(16, 'Máquina de electrofusión INGAP DPS-22.', 1), P(64, 'Máquina de electrofusión HDPE Elektra 1000.', 1),
    P(73, 'Máquina de fusión HDPE Hürner HST 300 Smart, 20-160 mm.', 1), P(83, 'Máquina de fusión HDPE Hürner HST 300 Smart,20-160mm.', 1),
    P(106, 'Máquina de fusión HDPE Hürner HST 300 Smart,20-160 mm.', 1), P(134, 'Máquina de electrofusiónINGAP DPS-22.', 1), P(200, 'Máquina de electrofusión extra', 1)];
  const c = cot(360, 'INGAP', [['Máquina electrofusión marca INGAP Modelo DPS-22 (3,5Kw)', 7, 1380000]]);
  const asign = productos.map((p, i) => ({ producto: `P${i + 1}`, linea: 'L1', cantidad: 1, precioUnitario: 1380000, confianza: i === 7 ? 'revisar' : 'alta' }));
  const r = await parearNegocio({ productos, cotizaciones: [c], llamarIA: ia({ asignaciones: asign }) });
  assert.equal(r.asignaciones.length, 7);
  assert.ok(!r.asignaciones.some(a => a.productoId === 200));
  assert.ok(r.alternativas.some(a => a.productoId === 200));
  assert.ok(r.asignaciones.every(a => a.precioUnitarioClp === 1380000));
  assert.equal(r.cuadres[0].cuadraLectura, true);
  assert.equal(r.cuadres[0].asignado, 7 * 1380000);
});

test('400 m de 63 mm = 300 m («tubería lisa» sin diámetro) + 100 m del producto «R/100»: la cantidad se lee en metros, no 100 rollos', async () => {
  const productos = [P(23, 'Tubería lisa HDPE PN10.', 300, 'm'), P(45, 'Tubería HDPE de 63 mm, PE100, PN10 (R/100).', 100, '·')];
  const c = cot(358, 'INGAP', [['Tuberia (Rollo 100 metros) PE100 PN10 d= 63 mm Coextruida', 400, 3222]]);
  const r = await parearNegocio({ productos, cotizaciones: [c], llamarIA: ia({ asignaciones: [
    { producto: 'P1', linea: 'L1', cantidad: 300, precioUnitario: 3222, confianza: 'media' },
    { producto: 'P2', linea: 'L1', cantidad: 100, precioUnitario: 322200, conversion: 100, confianza: 'alta' }] }) });
  const a45 = r.asignaciones.find(a => a.productoId === 45)!, a23 = r.asignaciones.find(a => a.productoId === 23)!;
  assert.equal(a23.precioUnitarioClp, 3222);
  assert.equal(a45.precioUnitarioClp, 3222);      // 100 m a $3.222 el metro, no 100 rollos de $322.200
  assert.equal(a45.factor, 1);
  assert.equal(r.sobrantes.length, 0);
});

test('línea pasada de cantidad: si sobra una asignación dudosa, sale ELLA; los rollos bien convertidos no se leen en metros', async () => {
  const c = cot(358, 'INGAP', [['Tuberia (Rollo 100 metros) PE100 PN16 d= 20 mm Coextruido', 300, 516]]);
  const productos = [P(127, 'Tubería HDPE de 1/2",unidades de 100m.', 3), P(23, 'Tubería lisa HDPE PN10.', 300, 'm')];
  const r = await parearNegocio({ productos, cotizaciones: [c], llamarIA: ia({ asignaciones: [
    { producto: 'P1', linea: 'L1', cantidad: 3, conversion: 100, confianza: 'alta' }, { producto: 'P2', linea: 'L1', cantidad: 3, confianza: 'media' }] }) });
  assert.deepEqual(r.asignaciones.map(a => [a.productoId, a.precioUnitarioClp, a.factor]), [[127, 51600, 100]]);
  assert.ok(r.descartes.some(d => d.producto === 23 && /cantidad/.test(d.motivo)));
});

test('Subline F14-17 × 4 = 2 + 2 (dos productos)', async () => {
  const productos = [P(39, 'Bomba de pozo Subline F14-17M, motor PM 4 HP, 220 V.', 2), P(70, 'Bomba sumergible F14-17 M, motor 4 HP, 220 V.', 2)];
  const c = cot(363, 'Protecnica', [['BOMBA POZO PROFUNDO SUBLINE F14-17 4 HP 220V', 4, 899360]]);
  const r = await parearNegocio({ productos, cotizaciones: [c], llamarIA: ia({ asignaciones: [
    { producto: 'P1', linea: 'L1', cantidad: 2, confianza: 'alta' }, { producto: 'P2', linea: 'L1', cantidad: 2, confianza: 'alta' }] }) });
  assert.equal(r.asignaciones.length, 2);
  assert.equal(r.sobrantes.length, 0);
});

test('1/2" = d20 en tubería (rollo de 100 m a $516 el metro = $51.600); 3/4" contra d20 NO (es menor)', async () => {
  const c = cot(358, 'INGAP', [['Tuberia (Rollo 100 metros) PE100 PN16 d= 20 mm Coextruido', 300, 516]]);
  const ok = await parearNegocio({ productos: [P(127, 'Tubería HDPE de 1/2",unidades de 100m.', 3)], cotizaciones: [c],
    llamarIA: ia({ asignaciones: [{ producto: 'P1', linea: 'L1', cantidad: 3, conversion: 100, confianza: 'media' }] }) });
  assert.equal(ok.asignaciones[0].precioUnitarioClp, 51600);
  assert.equal(ok.asignaciones[0].factor, 100);
  const no = await parearNegocio({ productos: [P(9, 'Tubería HDPE de 3/4", unidades de 100m.', 3)], cotizaciones: [c],
    llamarIA: ia({ asignaciones: [{ producto: 'P1', linea: 'L1', cantidad: 3, conversion: 100, confianza: 'media' }] }) });
  assert.equal(no.asignaciones.length, 0);
  assert.match(no.descartes[0].motivo, /otra medida/);
  assert.match(conEquivalenciaNominal('Tubería HDPE de 1/2"'), /20 mm/);
  assert.equal(conEquivalenciaNominal('Llave de paso de bronce de 1/2"'), 'Llave de paso de bronce de 1/2"');   // no es tubería: sin equivalencia
});

test('SS642/14: 30 HP pedido, la cotización dice 15 HP, MISMO modelo → se asigna con «revisar»; otro modelo con 15 HP NO', async () => {
  const c = cot(363, 'Protecnica', [['BOMBA POZO PROFUNDO FRANKLIN SS 642/14 15 HP 380V', 2, 2927264.5], ['BOMBA POZO PROFUNDO FRANKLIN SS 624/20 15 HP 380V', 1, 2638729]]);
  const productos = [P(34, 'Bomba de pozo Franklin SS642-14,30 HP,380V.', 1), P(57, 'Bomba de pozo de impulsión,30HP,380V.', 1)];
  const r = await parearNegocio({ productos, cotizaciones: [c], llamarIA: ia({ asignaciones: [
    { producto: 'P1', linea: 'L1', cantidad: 1, confianza: 'revisar' }, { producto: 'P2', linea: 'L2', cantidad: 1, confianza: 'media' }] }) });
  const a = r.asignaciones.find(x => x.productoId === 34)!;
  assert.equal(a.confianza, 'revisar');
  assert.ok(a.avisos.some(t => /HP/.test(t)));
  assert.ok(!r.asignaciones.some(x => x.productoId === 57));     // 15 HP de OTRO modelo para un producto de 30 HP: no
});

test('regla 7: la IA marca «revisar» un producto de OTRO modelo (martillo Bosch ← máquina DPS-22) → el código no lo asigna; con «media» sí pasa con aviso', async () => {
  const c = cot(360, 'INGAP', [['Máquina electrofusión marca INGAP Modelo DPS-22 (3,5Kw)', 7, 1380000]]);
  const productos = [P(17, 'Martillo demoledor eléctrico Bosch GSH-16-28.', 1), P(1, 'Máquina de electrofusión EURO-JUNIOR.', 1)];
  const r = await parearNegocio({ productos, cotizaciones: [c], llamarIA: ia({ asignaciones: [
    { producto: 'P1', linea: 'L1', cantidad: 1, confianza: 'revisar' }, { producto: 'P2', linea: 'L1', cantidad: 1, confianza: 'media' }] }) });
  assert.deepEqual(r.asignaciones.map(a => a.productoId), [1]);
  assert.match(r.descartes.find(d => d.producto === 17)!.motivo, /otro modelo/);
});

test('familia: una línea de TERMOfusión no puede ser un producto de ELECTROfusión', async () => {
  assert.ok(choqueDeFamilia('Máquina de electrofusión INGAP DPS-22', 'Termofusionadora Manual INGAP SHDS 160'));
  assert.equal(choqueDeFamilia('Máquina de fusión HDPE Hürner HST 300', 'Máquina electrofusión INGAP DPS-22'), null);   // genérico: decide la IA
  // con la equivalencia que fija la empresa (diccionario por empresa), el modelo dice el proceso
  assert.equal(choqueDeFamilia('Máquina de fusión Hürner HST 300', 'Termofusionadora SHDS 160', [{ patron: 'HST 300', familia: 'electrofusión' }]), 'electrofusión pedido, la línea es termofusión');
});

test('un principal por producto: entre dos cotizaciones gana la más barata que cumple; la otra queda de alternativa', async () => {
  const c1 = cot(1, 'Proveedor A', [['Codo 90° EF PE100 PN16 d= 90 mm', 20, 19078]]);
  const c2 = cot(2, 'Proveedor B', [['Codo electrofusión 90 mm', 20, 17479]]);
  const r = await parearNegocio({ productos: [P(2, 'Codo HDPE de 90 mm.', 20)], cotizaciones: [c1, c2], llamarIA: ia({ asignaciones: [
    { producto: 'P1', linea: 'L1', cantidad: 20, confianza: 'alta' }, { producto: 'P1', linea: 'L2', cantidad: 20, confianza: 'alta' }] }) });
  assert.equal(r.asignaciones.length, 1);
  assert.equal(r.asignaciones[0].precioUnitarioClp, 17479);
  assert.equal(r.alternativas[0].precioUnitarioClp, 19078);
});

test('toda línea con destino y cuadre: lo que nadie usa queda como sobrante; el envío como cargo; asignado + sobrante + cargos = lo leído', async () => {
  const c = cot(351, 'Improtek', [['L2000 - PQWT Detector de Fugas por Ultrasonido', 2, 1699900], ['PQ128C - PQWT Detector de Fugas', 1, 1799900], ['SHIPPING-COST - NACIONAL Costo de Envio', 1, 16000]]);
  const r = await parearNegocio({ productos: [P(14, 'Geófono detector de fugas por ultrasonido PQ128C-PQWT.', 1), P(81, 'Geófono para detección de fugas Terralog.', 1)],
    cotizaciones: [c], llamarIA: ia({ asignaciones: [{ producto: 'P1', linea: 'L2', cantidad: 1, confianza: 'alta' }, { producto: 'P2', linea: 'L1', cantidad: 1, confianza: 'media' }] }) });
  assert.deepEqual(r.sobrantes.map(s => [s.linea, s.cantidad]), [['L1', 1]]);
  assert.equal(r.cargos[0].monto, 16000);
  const q = r.cuadres[0];
  assert.equal(q.cuadraLectura, true);
  assert.equal(q.asignado + q.sobrante + q.cargos, q.sumaLineas);
});

test('lo inventado se descarta: producto o línea que no existen, flete como producto, y precio inventado (vale el de la línea)', () => {
  const c = cot(1, 'X', [['Bomba sumergible 1,5 HP', 1, 466948], ['DESPACHO', 1, 12000]]);
  const lineas = lineasDelNegocio([c]);
  const r = validarPareoGlobal({ productos: [P(1, 'Bomba sumergible Pedrollo 1,5 HP', 1)], lineas, cotizaciones: [c], equivalencias: [] }, { asignaciones: [
    { producto: 'P9', linea: 'L1' }, { producto: 'P1', linea: 'L7' }, { producto: 'P1', linea: 'L2' }, { producto: 'P1', linea: 'L1', precioUnitario: 999 }] });
  assert.equal(r.asignaciones.length, 1);
  assert.equal(r.asignaciones[0].precioUnitarioClp, 466948);
  assert.ok(r.asignaciones[0].avisos.some(t => /vale el de la línea/.test(t)));
  assert.equal(r.descartes.length, 3);
});

test('cotización en USD y con IVA incluido: todo se compara en CLP neto', () => {
  const usd = cot(352, 'Vorwerk', [['Máquina de Electrofusión Connect160 20-160 mm', 1, 1187.5]], { moneda: 'USD', tipo_cambio_usado: 998.56, precio_total: 1187.5 });
  const iva = cot(342, 'Makita', [['DGA454Z - Esmeril Angular 4-1/2" 18V', 1, 153990]], { notas: 'El documento informa precios con IVA incluido; se guardaron en neto (÷ 1,19).', precio_total: 129403 });
  const ls = lineasDelNegocio([usd, iva]);
  assert.equal(Math.round(ls[0].precioNeto!), 1185790);
  assert.equal(Math.round(ls[1].precioNeto!), 129403);
  const r = validarPareoGlobal({ productos: [], lineas: ls, cotizaciones: [usd, iva], equivalencias: [] }, {});
  assert.ok(r.cuadres.every(q => q.cuadraLectura));
});

test('plan de escritura: no toca productos aprobados ni cotizaciones de una persona; no pisa lo que ya está igual; quita lo que el documento no respalda', async () => {
  const { planificarEscrituraPareo } = await import('../compras-pareo-global-core');
  const c1 = cot(1, 'A', [['Bomba sumergible 1,5 HP', 3, 466948]]);
  const c2 = cot(2, 'B', [['Bomba sumergible 1,5 HP', 3, 480000]]);
  const productos = [P(10, 'Bomba sumergible Pedrollo 1,5 HP', 1), P(11, 'Bomba sumergible Pedrollo 1,5 HP', 1), P(12, 'Bomba sumergible Pedrollo 1,5 HP', 1), P(13, 'Otra cosa', 1)];
  const r = await parearNegocio({ productos, cotizaciones: [c1, c2], llamarIA: ia({ asignaciones: [
    { producto: 'P1', linea: 'L1', cantidad: 1, confianza: 'alta' }, { producto: 'P2', linea: 'L1', cantidad: 1, confianza: 'alta' }, { producto: 'P3', linea: 'L1', cantidad: 1, confianza: 'media', motivo: 'por cantidad' }] }) });
  const base = { resultado: r, respaldado: () => false, quitar: true };
  const plan = planificarEscrituraPareo({ ...base,
    productos: [{ id: 10, subestado: 'COTIZANDO' }, { id: 11, subestado: 'COMPRADO' }, { id: 12, subestado: 'PENDIENTE' }, { id: 13, subestado: 'COTIZANDO' }],
    itemsGuardados: [{ cotizacionId: 1, productoId: 10, precioBase: 466948 }, { cotizacionId: 1, productoId: 13, precioBase: 466948 }, { cotizacionId: 2, productoId: 13, precioBase: 500000 }],
    cotizacionesDeUnaPersona: new Set([2]) });
  assert.deepEqual(plan.escribir.map(x => [x.productoId, x.cumple]), [[12, 'INFERIOR_NEGOCIABLE']]);   // 10 ya estaba igual; 11 comprado
  assert.match(plan.escribir[0].detalle!, /por cantidad/);
  assert.deepEqual(plan.quitar, []);    // la IA no repitió el 13: no alcanza para quitarlo, se avisa
  assert.deepEqual(plan.sinRespaldo, [{ cotizacionId: 1, productoId: 13 }]);   // (el de la cotización 2, de una persona, ni se mira)
  // otra cotización con el mismo producto es una OPCIÓN de la comparación: aunque el pareo elija otra principal, no se quita
  const opcion = planificarEscrituraPareo({ ...base, productos: [{ id: 10, subestado: 'COTIZANDO' }], itemsGuardados: [{ cotizacionId: 2, productoId: 10, precioBase: 480000 }], cotizacionesDeUnaPersona: new Set() });
  assert.deepEqual(opcion.quitar, []);
  // el código rechazó justo ese par (bomba de 3 HP contra una línea de 1,5 HP): ahí sí se quita lo guardado
  const rech = await parearNegocio({ productos: [P(20, 'Bomba sumergible Pedrollo 3 HP', 1), P(21, 'Bomba sumergible Pedrollo 1,5 HP', 1)], cotizaciones: [c1], llamarIA: ia({ asignaciones: [{ producto: 'P1', linea: 'L1', cantidad: 1, confianza: 'media' }, { producto: 'P2', linea: 'L1', cantidad: 1, confianza: 'alta' }] }) });
  const conChoque = planificarEscrituraPareo({ resultado: rech, respaldado: () => false, quitar: true, productos: [{ id: 20, subestado: 'COTIZANDO' }, { id: 21, subestado: 'COTIZANDO' }], itemsGuardados: [{ cotizacionId: 1, productoId: 20, precioBase: 466948 }], cotizacionesDeUnaPersona: new Set() });
  assert.deepEqual(conChoque.quitar, [{ cotizacionId: 1, productoId: 20 }]);
  assert.ok(plan.saltados.some(s => s.productoId === 11));
  // el pareo automático no quita nada: solo agrega o cambia
  const auto = planificarEscrituraPareo({ ...base, quitar: false, productos: [{ id: 13, subestado: 'COTIZANDO' }], itemsGuardados: [{ cotizacionId: 1, productoId: 13, precioBase: 466948 }], cotizacionesDeUnaPersona: new Set() });
  assert.equal(auto.quitar.length, 0);
  // IA vacía: no se cambia nada
  const vacio = planificarEscrituraPareo({ ...base, resultado: { ...r, asignaciones: [] }, productos: [], itemsGuardados: [{ cotizacionId: 1, productoId: 13, precioBase: 1 }], cotizacionesDeUnaPersona: new Set() });
  assert.equal(vacio.quitar.length + vacio.escribir.length, 0);
});

test('una alternativa válida más barata pasa a principal aunque la IA la haya dejado de alternativa (1356: Dicran $13.040 vs INGAP $19.078)', async () => {
  const c1 = cot(359, 'INGAP', [['Codo 90° EF PE100 PN16 d= 90 mm', 20, 19078]]);
  const c2 = cot(371, 'Dicran', [['CODO HDPE E.F. 090X90º', 20, 13040]]);
  const r = await parearNegocio({ productos: [P(2, 'Codo HDPE de 90 mm.', 20)], cotizaciones: [c1, c2], llamarIA: ia({
    asignaciones: [{ producto: 'P1', linea: 'L1', cantidad: 20, confianza: 'alta' }], alternativas: [{ producto: 'P1', linea: 'L2', motivo: 'otra opción' }] }) });
  assert.equal(r.asignaciones.length, 1);
  assert.equal(r.asignaciones[0].precioUnitarioClp, 13040);
  assert.deepEqual(r.alternativas.map(a => a.precioUnitarioClp), [19078]);
});

test('regla 5: la línea que trae EL MODELO que nombra el producto gana aunque otra equivalente sea más barata (DPS-22 $1.380.000 vs Elektra $1.375.000)', async () => {
  const c1 = cot(360, 'INGAP', [['Máquina electrofusión marca INGAP Modelo DPS-22 (3,5Kw)', 7, 1380000]]);
  const c2 = cot(371, 'Dicran', [['MAQUINA ELECTROFUSION RITMO ELEKTRA LIGHT 160 mm. (20-125/160)', 7, 1375000]]);
  const r = await parearNegocio({ productos: [P(16, 'Máquina de electrofusión INGAP DPS-22.', 1)], cotizaciones: [c1, c2], llamarIA: ia({
    asignaciones: [{ producto: 'P1', linea: 'L1', cantidad: 1, confianza: 'alta' }], alternativas: [{ producto: 'P1', linea: 'L2', motivo: 'equivalente' }] }) });
  assert.equal(r.asignaciones[0].precioUnitarioClp, 1380000);
});

test('plan B por grupos: las líneas conservan su código global (antes se cruzaban al traducirlas por posición dentro del grupo)', async () => {
  // 20 bombas y 20 tubos: la línea de la bomba y las 2 líneas del tubo no comparten candidatos, así que salen dos grupos. El del tubo tiene L2 y L3:
  // «L2» NO es la posición 2 de su grupo (antes se leía así y se cruzaba con L3).
  const c1 = cot(1, 'A', [['Bomba sumergible Pedrollo 1 HP 220V', 1, 466948]]);
  const c2 = cot(2, 'B', [['Tubería HDPE PE100 PN10 d= 63 mm rollo 100 metros', 100, 3222], ['Tubería HDPE PE100 PN10 d= 63 mm rollo 100 metros alterna', 100, 3900]]);
  const productos = [
    ...Array.from({ length: 20 }, (_, i) => P(100 + i, `Bomba sumergible Pedrollo ${i + 1} HP, 220 V.`, 1)),
    ...Array.from({ length: 20 }, (_, i) => P(200 + i, `Tubería HDPE de 63 mm, PE100, PN10, modelo ${String.fromCharCode(65 + i)}.`, 100, 'm')),
  ];
  const llamadas: string[][] = [];
  const llamarIA = async (_s: string, user: string) => {
    const lins = [...user.matchAll(/^(L\d+) \|/gm)].map(m => m[1]);
    llamadas.push(lins);
    return { content: JSON.stringify({ asignaciones: [{ producto: 'P1', linea: lins[0], cantidad: 1, confianza: 'alta' }] }), finishReason: 'stop' };
  };
  const r = await parearNegocio({ productos, cotizaciones: [c1, c2], llamarIA, topeEntrada: 1 });
  assert.ok(llamadas.length >= 2, 'tenía que partir en grupos');
  const delTubo = llamadas.find(l => l.includes('L2'))!;
  assert.equal(delTubo[0], 'L2');
  assert.ok(r.asignaciones.some(a => a.linea === 'L2'), 'la línea L2 que nombró la IA tiene que quedar asignada como L2');
  assert.ok(!r.asignaciones.some(a => a.linea === 'L3'), 'L3 no se nombró: no se cruza con L2');
});


test('equivalencias de la empresa: «Easy Weld» declarada termofusión acepta la INGAP aunque el texto casi no se parezca; sin la equivalencia no', () => {
  const eq = [{ patron: 'Easy Weld', familia: 'termofusión a tope' }];
  const prod = 'Máquina de soldar HDPE Hürner Easy Weld 180.', lin = 'Termofusionadora Manual INGAP Modelo SHDS 160';
  assert.equal(declaradasEquivalentes(prod, lin, eq), true);
  assert.equal(declaradasEquivalentes(prod, lin, []), false);
  assert.equal(declaradasEquivalentes(prod, 'Bomba sumergible Pedrollo 1,5 HP', eq), false, 'una bomba no es termofusión');
  assert.equal(declaradasEquivalentes('Máquina HST 300 Smart', 'Electrofusora Elektra Light 160', [{ patron: 'HST 300', familia: 'electrofusión' }]), true);
});
