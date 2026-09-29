// Tests del núcleo del VERIFICADOR DE COSTO "de mercado" del AUDITOR (Prompt 5 v2.0: V9, V10, V10-b, V10-c). Sin red ni IA.
// Correr con: npx tsx --test app/lib/__tests__/auditor-mercado.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarReferencias, evaluarMercado, aplicarEvaluacion, tokensDeIdentidad, esMismoProducto, type ResultadoMercado, type CandidataMercado } from '../auditor-mercado-core';
import type { ResultadoVerificacion } from '../auditor-opciones-core';

const cand = (o: Partial<CandidataMercado> = {}): CandidataMercado => ({ url: 'https://tienda.cl/p/1', nombre: 'Cámara Canon EOS Rebel T7 con lente 18-55', precioNeto: 420_000, precio: 499_800, tienda: 'tienda.cl', canal: 'retail', ...o });
const tokens = tokensDeIdentidad('Canon', 'Eos Rebel T7', null, []);
const mercado = (refs: number[], extra: Partial<ResultadoMercado> = {}): ResultadoMercado => ({
  consulta: 'Canon Eos Rebel T7', referencias: refs.map((p, i) => ({ tienda: `tienda${i + 1}.cl`, nombre: 'Canon EOS Rebel T7', url: `https://tienda${i + 1}.cl/p`, precioNeto: p, canal: 'retail' })),
  descartadas: [], competidor: null, mercadoPublico: null, error: null, creadoAt: '2026-09-29 12:00:00', ...extra,
});
const codigos = (xs: Array<{ codigo: string }>) => xs.map(x => x.codigo);

test('identidad: el modelo compacto y sus palabras con dígitos sirven de token, y la marca es obligatoria', () => {
  assert.ok(tokens.includes('eosrebelt7') && tokens.includes('t7'));
  assert.equal(esMismoProducto('Cámara Canon EOS Rebel T7 Kit 18-55mm', 'Canon', tokens), true);
  assert.equal(esMismoProducto('Disco SSD Samsung T7 Portable 1TB', 'Canon', tokens), false);   // mismo "T7", otra marca
  assert.equal(esMismoProducto('Cámara Canon EOS R50', 'Canon', tokens), false);                  // misma marca, otro modelo
  assert.equal(esMismoProducto('Lo que sea', 'Canon', []), false);                                // sin token de modelo no se puede afirmar
});

test('V10: solo valen las referencias del MISMO producto; un similar, la misma tienda y las sin precio se descartan con su motivo', () => {
  const { validas, descartadas } = clasificarReferencias([
    cand({ url: 'https://a.cl/1', tienda: 'a.cl' }),
    cand({ url: 'https://b.cl/2', tienda: 'b.cl', nombre: 'Cámara Canon EOS R50', precioNeto: 300_000 }),
    cand({ url: 'https://horizontalfoto.cl/3', tienda: 'horizontalfoto.cl' }),
    cand({ url: 'https://c.cl/4', tienda: 'c.cl', precioNeto: null }),
    cand({ url: 'https://a.cl/1', tienda: 'a.cl' }),                                              // repetida
  ], { marca: 'Canon', tokens }, 'horizontalfoto.cl');
  assert.equal(validas.length, 1);
  assert.equal(validas[0].tienda, 'a.cl');
  assert.equal(descartadas.length, 3);
  assert.ok(descartadas.some(d => d.motivo.includes('similar')));
  assert.ok(descartadas.some(d => d.motivo.includes('misma tienda')));
  assert.ok(descartadas.some(d => d.motivo.includes('precio')));
});

test('V10: una referencia ≥ 5% más barata BLOQUEA hasta que el asistente justifique; con justificación solo informa', () => {
  const m = mercado([400_000]);                                  // 400.000 vs 440.000 = 9,1% menos
  const sin = evaluarMercado(m, 440_000, 'Horizontal · Canon T7', false);
  assert.ok(codigos(sin.bloqueos).includes('V10'));
  assert.match(sin.bloqueos[0].salida, /Justifica/);
  assert.equal(sin.ahorroMaximoPct, 9.1);
  const con = evaluarMercado(m, 440_000, 'Horizontal · Canon T7', true);
  assert.equal(con.bloqueos.length, 0);
  assert.ok(con.alertas.some(a => a.codigo === 'V10' && a.mensaje.includes('justificó')));
});

test('V10: una referencia menos de 5% más barata solo informa como oportunidad de ahorro', () => {
  const r = evaluarMercado(mercado([430_000]), 440_000, 'x', false);   // 2,3%
  assert.equal(r.bloqueos.length, 0);
  assert.ok(r.alertas.some(a => a.mensaje.includes('Oportunidad de ahorro')));
});

test('V10: una referencia más CARA no genera nada; sin referencias del mismo producto se dice, no se rellena', () => {
  assert.equal(evaluarMercado(mercado([500_000]), 440_000, 'x', false).bloqueos.length, 0);
  const vacio = evaluarMercado(mercado([], { descartadas: [{ tienda: 'z', nombre: 'otro', url: 'u', motivo: 'm' }] }), 440_000, 'x', false);
  assert.ok(vacio.alertas.some(a => a.mensaje.includes('No se encontraron referencias del MISMO producto')));
});

test('V10-b: precios del mismo producto separados de la mediana más del 40% → OJO CON ESTE PRECIO (no se supone cuál está mal)', () => {
  const r = evaluarMercado(mercado([420_000, 430_000, 44_000]), 425_000, 'x', false);          // una referencia en otra moneda/unidad
  assert.equal(r.dispersion.activa, true);
  assert.ok(r.alertas.some(a => a.codigo === 'V10B' && a.mensaje.includes('OJO CON ESTE PRECIO') && a.mensaje.includes('tienda3.cl')));
  assert.equal(evaluarMercado(mercado([420_000, 430_000, 440_000]), 425_000, 'x', false).dispersion.activa, false);
});

test('V10-c: el comparador ordena las fuentes del mismo producto de menor a mayor costo neto', () => {
  const r = evaluarMercado(mercado([500_000, 400_000]), 440_000, 'La opción', false);
  assert.deepEqual(r.comparador.map(c => c.precioNeto), [400_000, 440_000, 500_000]);
  assert.equal(r.comparador[1].origen, 'opcion');
});

test('V9: un proveedor que vende al Estado alerta de competidor (informa, no bloquea); trae la limitación de la muestra', () => {
  const r = evaluarMercado(mercado([], { competidor: { venteAlEstado: true, nLicitaciones: 4, nOrdenesCompra: 9, rubros: ['proyector epson'], ejemplos: [], limitacion: 'muestra' } }), 440_000, 'x', false);
  assert.ok(r.alertas.some(a => a.codigo === 'V9' && a.mensaje.includes('vende directamente al Estado') && a.mensaje.includes('muestra')));
  assert.equal(r.bloqueos.length, 0);
});

test('aplicarEvaluacion: suma bloqueos/alertas y recalcula el veredicto con la misma matriz (no toca SIN RESPALDO)', () => {
  const base: ResultadoVerificacion = { veredicto: 'VERIFICADO', bloqueos: [], alertas: [], costoNetoUnitario: 440_000, costeadoNeto: 440_000, diffMonto: 0, diffPct: 0, direccion: 'IGUAL', margen: null, origenDato: 'RESPALDO_FORMAL', requiereHabilitacion: false, faltantesProveedor: [] };
  const conBloqueo = aplicarEvaluacion(base, evaluarMercado(mercado([400_000]), 440_000, 'x', false));
  assert.equal(conBloqueo.veredicto, 'NO_VERIFICADO');
  const soloAlerta = aplicarEvaluacion(base, { bloqueos: [], alertas: [{ codigo: 'V9', nivel: 'amarillo', mensaje: 'x' }] });
  assert.equal(soloAlerta.veredicto, 'VERIFICADO_CON_ALERTAS');
  const sin = { ...base, veredicto: 'SIN_RESPALDO' as const };
  assert.equal(aplicarEvaluacion(sin, { bloqueos: [], alertas: [] }).veredicto, 'SIN_RESPALDO');
  const informal = aplicarEvaluacion({ ...base, requiereHabilitacion: true }, { bloqueos: [], alertas: [] });
  assert.equal(informal.veredicto, 'REQUIERE_HABILITACION');
});
