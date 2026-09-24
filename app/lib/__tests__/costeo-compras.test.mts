// Edición del costeo por el perfil de Compras: solo costo real + links en filas ajenas, filas nuevas libres.
//   npx tsx --test app/lib/__tests__/costeo-compras.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fusionarEdicionCompras } from '../costeo-compras';

const fila = (id: string, extra: any = {}) => ({
  id, item: 1, lineaReal: 1, detalle: 'TELEVISOR 55"', unidad: 'Unidad', skuProveedor: '', cantidad: 19,
  valorConIva: 479990, costoRealUnitario: null, margenVenta: null, link1: '', link2: '', link3: '', ...extra,
});
const guardado = (): any => ({ modalidad: 'suma_alzada', margenVenta: 25.6, grupos: [{ nombre: 'Costeo', linea: null, ofertamos: true, filas: [fila('a'), fila('b', { item: 2, detalle: 'PROYECTOR' })] }] });

test('en una fila ajena solo entran costo real y links; lo demás se ignora', () => {
  const cliente = { grupos: [{ filas: [
    fila('a', { costoRealUnitario: 400000, link1: 'https://tienda.cl/tv', detalle: 'HACKEADO', cantidad: 1, valorConIva: 1, margenVenta: 99 }),
    fila('b'),
  ] }] };
  const r: any = fusionarEdicionCompras(guardado(), cliente);
  assert.equal(r.ok, true);
  const a = r.estado.grupos[0].filas[0];
  assert.equal(a.costoRealUnitario, 400000);
  assert.equal(a.link1, 'https://tienda.cl/tv');
  assert.equal(a.detalle, 'TELEVISOR 55"');
  assert.equal(a.cantidad, 19);
  assert.equal(a.valorConIva, 479990);
  assert.equal(a.margenVenta, null);
});

test('no puede borrar filas ajenas ni cambiar márgenes/hojas', () => {
  const r: any = fusionarEdicionCompras(guardado(), { grupos: [{ filas: [fila('a')] }] });
  assert.equal(r.estado.grupos[0].filas.length, 2);
  assert.equal(r.estado.margenVenta, 25.6);
});

test('agrega filas nuevas, marcadas y editables; luego puede editarlas y borrarlas', () => {
  let r: any = fusionarEdicionCompras(guardado(), { grupos: [{ filas: [fila('a'), fila('b'), fila('n1', { detalle: 'CABLE HDMI', cantidad: 5, valorConIva: 5000 })] }] });
  assert.equal(r.ok, true);
  const nueva = r.estado.grupos[0].filas[2];
  assert.equal(nueva.agregadoPorCompras, true);
  assert.equal(nueva.detalle, 'CABLE HDMI');
  assert.equal(nueva.item, 3);
  // edición posterior de SU fila
  r = fusionarEdicionCompras(r.estado, { grupos: [{ filas: [fila('a'), fila('b'), fila('n1', { detalle: 'CABLE HDMI 2M', cantidad: 6 })] }] });
  assert.equal(r.estado.grupos[0].filas[2].detalle, 'CABLE HDMI 2M');
  // borrado de SU fila
  r = fusionarEdicionCompras(r.estado, { grupos: [{ filas: [fila('a'), fila('b')] }] });
  assert.equal(r.estado.grupos[0].filas.length, 2);
});

test('costo real sin Link 1 → error; link inválido se descarta', () => {
  const sin: any = fusionarEdicionCompras(guardado(), { grupos: [{ filas: [fila('a', { costoRealUnitario: 100 }), fila('b')] }] });
  assert.equal(sin.ok, false);
  assert.match(sin.error, /Falta el link/);
  const malo: any = fusionarEdicionCompras(guardado(), { grupos: [{ filas: [fila('a', { costoRealUnitario: 100, link1: 'javascript:alert(1)' }), fila('b')] }] });
  assert.equal(malo.ok, false);
});

test('distinta cantidad de hojas → error claro; números negativos o basura → null', () => {
  assert.equal((fusionarEdicionCompras(guardado(), { grupos: [] }) as any).ok, false);
  const r: any = fusionarEdicionCompras(guardado(), { grupos: [{ filas: [fila('a', { costoRealUnitario: -5 }), fila('b', { costoRealUnitario: 'abc' })] }] });
  assert.equal(r.ok, true);
  assert.equal(r.estado.grupos[0].filas[0].costoRealUnitario, null);
  assert.equal(r.estado.grupos[0].filas[1].costoRealUnitario, null);
});
