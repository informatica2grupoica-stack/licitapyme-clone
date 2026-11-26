// Alta autónoma con aprobación (2026-11-26): validación del formulario público y topes anti-abuso. Sin base de datos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarSolicitud, decidirGuardado, limpiarTexto, TOPES_SOLICITUD, type FuncionesRut } from '../solicitud-alta-core';

// Mismo módulo 11 que evaluar-empresa-rut.ts, local para no arrastrar la IA ni la BD a la prueba.
const plano = (r: string) => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();
const rut: FuncionesRut = {
  valido: (r) => {
    const s = plano(r);
    if (!/^\d{7,8}[\dK]$/.test(s)) return false;
    let suma = 0, mult = 2;
    for (const d of s.slice(0, -1).split('').reverse()) { suma += Number(d) * mult; mult = mult === 7 ? 2 : mult + 1; }
    const dv = 11 - (suma % 11);
    return s.slice(-1) === (dv === 11 ? '0' : dv === 10 ? 'K' : String(dv));
  },
  formatear: (r) => { const s = plano(r); return `${s.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${s.slice(-1)}`; },
};

const buena = { razonSocial: 'Comercial Ejemplo SpA', rut: '78388175-6', contactoNombre: 'Ana Pérez', contactoEmail: 'Ana@Ejemplo.cl', contactoTelefono: '+56 9 1234 5678', mensaje: 'Vendemos equipos de frío', web: '' };

test('una solicitud correcta se normaliza (RUT con formato, correo en minúsculas)', () => {
  const r = validarSolicitud(buena, rut);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.datos.rut, '78.388.175-6');
    assert.equal(r.datos.contactoEmail, 'ana@ejemplo.cl');
    assert.equal(r.datos.contactoTelefono, '+56 9 1234 5678');
  }
});

test('RUT con dígito verificador malo, correo inválido y nombres vacíos se rechazan con un mensaje claro', () => {
  for (const [campo, valor] of [['rut', '78388175-5'], ['rut', ''], ['contactoEmail', 'sin-arroba'], ['contactoEmail', 'a@b'], ['razonSocial', 'ab'], ['contactoNombre', ''], ['contactoTelefono', 'abc']] as const) {
    const r = validarSolicitud({ ...buena, [campo]: valor }, rut);
    assert.equal(r.ok, false, `${campo}=${valor} debía rechazarse`);
    if (!r.ok) assert.ok(r.error.length > 10);
  }
});

test('el campo trampa lleno marca un robot (se finge éxito sin guardar)', () => {
  const r = validarSolicitud({ ...buena, web: 'http://spam.example' }, rut);
  assert.equal(r.ok, false);
  assert.ok('robot' in r && r.robot === true);
});

test('el texto se limpia: sin caracteres de control, espacios colapsados y con tope de largo', () => {
  assert.equal(limpiarTexto('  hola \u0000\n\t  mundo  ', 50), 'hola mundo');
  assert.equal(limpiarTexto('x'.repeat(500), 20).length, 20);
  assert.equal(limpiarTexto(null, 10), '');
});

test('decidirGuardado: guarda solo si no es cliente, no está repetida y no se pasan los topes', () => {
  const base = { solicitudesDeLaIp24h: 0, pendientesTotal: 0, yaHayPendientePorRutOCorreo: false, yaEsCliente: false };
  assert.deepEqual(decidirGuardado(base), { guardar: true });
  assert.equal(decidirGuardado({ ...base, yaEsCliente: true }).guardar, false);
  assert.equal(decidirGuardado({ ...base, yaHayPendientePorRutOCorreo: true }).guardar, false);
  assert.equal(decidirGuardado({ ...base, solicitudesDeLaIp24h: TOPES_SOLICITUD.porIp24h }).guardar, false);
  assert.equal(decidirGuardado({ ...base, solicitudesDeLaIp24h: TOPES_SOLICITUD.porIp24h - 1 }).guardar, true);
  assert.equal(decidirGuardado({ ...base, pendientesTotal: TOPES_SOLICITUD.pendientesTotal }).guardar, false);
});
