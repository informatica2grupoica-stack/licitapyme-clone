// Viabilidad IA de las empresas-cliente: configuración propia y calce con lo que vende (migration-201). Parte pura (sin BD).
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluarCalce, efectoCalce, normalizarConfigEmpresa, raices, CONFIG_EMPRESA_POR_DEFECTO, type ResultadoCalce } from '../cv/viabilidad-empresa-core';
import { calcularNivel } from '../cv/score-viabilidad';
import { CONFIG_V4_DEFAULT } from '../cv/v4/config';

const perfilMobiliario = { productos_si: 'sillas, mesas escolares, mobiliario', rubros: 'mobiliario escolar', productos_no: 'computadores' };
const informe = (items: Array<{ nombre: string; familia: string }>, neto = 50_000_000) => ({
  presupuesto: { neto },
  productos: { items: items.map((it, i) => ({ ...it, linea: i + 1 })) },
  adjudicacion: { resultado: 'GLOBAL' },
  criterios_evaluacion: { criterios: [] },
  requisitos_admisibilidad: { requisitos: [] },
});
const ctx = (modo: any, perfil: any) => ({ codigo: '1000-1-LP26', calce: { modo, perfil } });

test('raíces: «sillas» y «silla» calzan; las palabras vacías no cuentan', () => {
  assert.ok(raices('Sillas escolares').has('silla'));
  assert.ok(raices('silla').has('silla'));
  assert.ok(!raices('para los equipos').has('equip'));
});

test('calce: todos / en parte / ninguno / sin datos', () => {
  const p = perfilMobiliario;
  assert.equal(evaluarCalce(p, [{ nombre: 'Silla escolar' }, { nombre: 'Mesa escolar' }], 5e7).coincidencia, 'SI');
  assert.equal(evaluarCalce(p, [{ nombre: 'Silla escolar' }, { nombre: 'Impresora láser' }], 5e7).coincidencia, 'PARCIAL');
  assert.equal(evaluarCalce(p, [{ nombre: 'Impresora láser' }], 5e7).coincidencia, 'NO');
  assert.equal(evaluarCalce({ productos_si: '', rubros: '' }, [{ nombre: 'Silla' }], 5e7).coincidencia, 'SIN_DATO');
  const no = evaluarCalce(p, [{ nombre: 'Computadores portátiles' }], 5e7);
  assert.equal(no.coincidencia, 'NO');
  assert.deepEqual(no.noDeseados, ['Computadores portátiles']);
});

test('calce: monto fuera de lo que la empresa busca', () => {
  assert.equal(evaluarCalce({ ...perfilMobiliario, monto_min: 20_000_000 }, [{ nombre: 'Silla' }], 10_000_000).montoFuera, 'BAJO_MINIMO');
  assert.equal(evaluarCalce({ ...perfilMobiliario, monto_max: 100_000_000 }, [{ nombre: 'Silla' }], 200_000_000).montoFuera, 'SOBRE_MAXIMO');
  assert.equal(evaluarCalce({ ...perfilMobiliario, monto_min: 1, monto_max: 100_000_000 }, [{ nombre: 'Silla' }], 50_000_000).montoFuera, null);
});

test('efecto del calce según el modo', () => {
  const no: ResultadoCalce = { coincidencia: 'NO', detalle: '', calzan: [], noDeseados: [], montoFuera: null };
  const parcial: ResultadoCalce = { ...no, coincidencia: 'PARCIAL' };
  assert.deepEqual(efectoCalce('ninguno', no), { escalones: 0, techoBajo: false });
  assert.deepEqual(efectoCalce('suave', no), { escalones: 1, techoBajo: false });
  assert.deepEqual(efectoCalce('normal', no), { escalones: 2, techoBajo: false });
  assert.deepEqual(efectoCalce('estricto', no), { escalones: 0, techoBajo: true });
  assert.deepEqual(efectoCalce('normal', parcial), { escalones: 1, techoBajo: false });
  assert.deepEqual(efectoCalce('suave', parcial), { escalones: 0, techoBajo: false });
});

test('nivel: sin calce (modo ninguno) no mira el perfil; con calce baja si no calza', () => {
  const inf = informe([{ nombre: 'Impresora láser multifuncional', familia: 'COMPUTACION' }]);
  const sin = calcularNivel(inf, CONFIG_V4_DEFAULT, ctx('ninguno', perfilMobiliario));
  const normal = calcularNivel(inf, CONFIG_V4_DEFAULT, ctx('normal', perfilMobiliario));
  const estricto = calcularNivel(inf, CONFIG_V4_DEFAULT, ctx('estricto', perfilMobiliario));
  assert.ok(normal.nivel_num < sin.nivel_num, `normal (${normal.nivel}) debe ser menor que sin calce (${sin.nivel})`);
  assert.equal(estricto.nivel, 'BAJO');
  assert.ok(normal.pasos.some(p => p.regla === 'Calce con tu empresa'));
  assert.equal(normal.calce?.coincidencia, 'NO');
  assert.equal(sin.calce, undefined);
});

test('nivel: si la licitación calza con lo que vende, el nivel no baja', () => {
  const inf = informe([{ nombre: 'Silla escolar', familia: 'MOBILIARIO' }, { nombre: 'Mesa escolar', familia: 'MOBILIARIO' }]);
  const sin = calcularNivel(inf, CONFIG_V4_DEFAULT, ctx('ninguno', perfilMobiliario));
  const normal = calcularNivel(inf, CONFIG_V4_DEFAULT, ctx('normal', perfilMobiliario));
  assert.equal(normal.nivel, sin.nivel);
  assert.equal(normal.calce?.coincidencia, 'SI');
  assert.match(normal.resumen_pantalla, /calza con lo que vendes/);
});

test('nivel: sin ctx.calce (como antes) el resultado es el de siempre', () => {
  const inf = informe([{ nombre: 'Silla escolar', familia: 'MOBILIARIO' }]);
  const a = calcularNivel(inf, CONFIG_V4_DEFAULT, { codigo: '1000-1-LP26' });
  assert.equal(a.calce, undefined);
  assert.ok(!a.pasos.some(p => p.regla === 'Calce con tu empresa'));
});

test('configuración de la empresa: valores por defecto y datos malos', () => {
  assert.deepEqual(normalizarConfigEmpresa(null), CONFIG_EMPRESA_POR_DEFECTO);
  assert.deepEqual(normalizarConfigEmpresa('no es json'), CONFIG_EMPRESA_POR_DEFECTO);
  assert.deepEqual(normalizarConfigEmpresa({ minimo_neto: 5000000, calce: 'estricto' }), { minimo_neto: 5000000, calce: 'estricto' });
  assert.equal(normalizarConfigEmpresa({ minimo_neto: -5 }).minimo_neto, null);
  assert.equal(normalizarConfigEmpresa({ calce: 'hackeo' }).calce, 'normal');
});
