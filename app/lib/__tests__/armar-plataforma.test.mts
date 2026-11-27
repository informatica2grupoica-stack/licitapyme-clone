// Plataforma armada desde el RUT y requisitos para recibir un cliente nuevo (2026-11-27).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { puedeArmarse, palabrasASacar, datosDeProveedor } from '../armar-plataforma-core';
import { cupoViabilidadInicial, CUPO_VIABILIDAD_INICIAL } from '../crear-empresa-cliente';

const virgen = { estado: 'LISTO', confirmada: false, yaArmada: false, conPerfil: false, palabras: 0 };

test('solo se arma sola una empresa sin nada propio y con la evaluación lista', () => {
  assert.equal(puedeArmarse(virgen), true);
  for (const cambio of [{ estado: 'ERROR' }, { confirmada: true }, { yaArmada: true }, { conPerfil: true }, { palabras: 3 }])
    assert.equal(puedeArmarse({ ...virgen, ...cambio }), false, JSON.stringify(cambio));
});

test('al confirmar se quita lo desmarcado o cambiado de lista, y nada más', () => {
  const s = palabrasASacar({ palabras: ['horno', 'camilla', 'silla'], negativas: ['arriendo', 'obra civil'] }, ['horno', 'arriendo', 'nueva'], ['obra civil']);
  assert.deepEqual(s, [{ keyword: 'camilla', negativa: 0 }, { keyword: 'silla', negativa: 0 }, { keyword: 'arriendo', negativa: 1 }]);
});

test('de la OC solo se toman datos de la EMPRESA propia, nunca los del contacto ni de otro RUT', () => {
  const oc = { Proveedor: { RutSucursal: '76.123.456-0', Actividad: ' Venta  de muebles ', Direccion: 'Calle 1', Comuna: 'Ñuñoa', Region: 'Metropolitana', NombreContacto: 'Persona', MailContacto: 'x@y.cl', FonoContacto: '123' } };
  assert.deepEqual(datosDeProveedor(oc, new Set(['761234560'])), { rut: '761234560', giro: 'Venta de muebles', direccion: 'Calle 1, Ñuñoa', region: 'Metropolitana' });
  assert.equal(datosDeProveedor(oc, new Set(['999999999'])), null);
  assert.equal(datosDeProveedor({}, new Set(['761234560'])), null);
});

test('una empresa con viabilidad contratada nace con cupo; sin ella, en cero', () => {
  assert.equal(cupoViabilidadInicial('PRO', []), CUPO_VIABILIDAD_INICIAL);
  assert.equal(cupoViabilidadInicial('BASICO', []), 0);
  assert.equal(cupoViabilidadInicial('BASICO', ['viabilidad']), CUPO_VIABILIDAD_INICIAL);
});

test('guardia: ninguna consulta de palabras del radar corre sin el filtro de empresa vigente', () => {
  for (const f of ['app/lib/radar-matching.ts', 'app/api/cron/alertas/route.ts']) {
    const s = readFileSync(f, 'utf8');
    const consultas = s.match(/FROM palabras_clave pk\s+JOIN usuarios u[^\n]*\n\s+WHERE [^\n]*/g) ?? [];
    assert.ok(consultas.length >= 2, f);
    for (const c of consultas) assert.match(c, /SQL_EMPRESA_DE_LA_PALABRA_VIGENTE/, f);
  }
});

test('guardia: lo que se arma solo no restringe por región, monto ni reglas redactadas por la IA', () => {
  assert.match(readFileSync('app/lib/armar-plataforma.ts', 'utf8'), /guardarPerfil\(clienteId, \{ \.\.\.r\.perfil, regiones: '', monto_min: null, monto_max: null, reglas: '' \}\)/);
});

test('guardia: la espera de la IA da señales de vida y un intento atrasado no pisa una evaluación lista', () => {
  const s = readFileSync('app/lib/evaluar-empresa-rut.ts', 'utf8');
  assert.match(s, /setInterval\([\s\S]{0,200}SET updated_at = NOW\(\)[\s\S]{0,400}proponerConIA\([^\n]*\.finally\(\(\) => clearInterval\(senal\)\)/);
  assert.match(s, /'ERROR', String\(\(e as Error\)\?\.message \|\| e\), \{ cursor: null, salvoLista: true \}/);
});
