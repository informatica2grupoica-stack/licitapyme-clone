// Tests del verificador de costo con IA (Prompt 5 v2.0): el modelo solo agrega alertas y ayuda, y cada hallazgo exige una cita LITERAL del documento.
// Correr con: npx tsx --test app/lib/__tests__/auditor-costo-ia.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluarCostoIA } from '../auditor-costo-ia-core';
import type { Alerta } from '../auditor-compras-core';

const TEXTO = `COTIZACIÓN 5173. Proyector Epson PowerLite E24 $520.000 + IVA. Despacho a regiones no incluido, se cotiza aparte.
Instalación y puesta en marcha: $45.000 por equipo. Plazo de entrega: 25 a 30 días hábiles. Precios válidos por 15 días.`;

test('V5: un costo oculto con cita literal se acepta como ALERTA (nunca como bloqueo)', () => {
  const r = evaluarCostoIA({ verificaciones: { V5_costos_ocultos: [{ tipo: 'cargo_adicional', detalle: 'Instalación y puesta en marcha', monto: '$45.000 por equipo', cita: 'Instalación y puesta en marcha: $45.000 por equipo' }] } }, TEXTO, [], true);
  assert.equal(r.alertas.length, 1);
  assert.equal(r.alertas[0].codigo, 'V5');
  assert.equal(r.alertas[0].nivel, 'amarillo');
  assert.equal(r.descartados.length, 0);
});

test('guardarraíl: un hallazgo sin cita, o con una cita que NO está en el documento, se descarta y queda registrado', () => {
  const r = evaluarCostoIA({ verificaciones: { V5_costos_ocultos: [
    { tipo: 'despacho', detalle: 'flete a Coquimbo', monto: '$80.000', cita: 'el flete a Coquimbo cuesta $80.000' },
    { tipo: 'accesorio', detalle: 'Soporte de techo obligatorio', cita: '' },
  ] } }, TEXTO, [], true);
  assert.equal(r.alertas.length, 0);
  assert.equal(r.descartados.length, 2);
  assert.match(r.descartados[0], /no figura en el documento/);
  assert.match(r.descartados[1], /sin cita/);
});

test('no repite lo que el código ya avisó', () => {
  const yaCodigo: Alerta[] = [{ codigo: 'V5', nivel: 'amarillo', mensaje: 'Costo aparte en el documento: Instalación y puesta en marcha ($45.000). Suma al costo real de compra.' }];
  const r = evaluarCostoIA({ verificaciones: { V5_costos_ocultos: [{ tipo: 'cargo_adicional', detalle: 'Instalación y puesta en marcha', cita: 'Instalación y puesta en marcha: $45.000 por equipo' }] } }, TEXTO, yaCodigo, true);
  assert.equal(r.alertas.length, 0);
});

test('V1: producto distinto → alerta roja + evento; V2 con cita → alerta; V8 plazo → info', () => {
  const r = evaluarCostoIA({ verificaciones: {
    V1_identidad: { estado: 'NO_COINCIDE', marca_respaldo: 'Epson', modelo_respaldo: 'PowerLite E24', cita: 'Proyector Epson PowerLite E24' },
    V2_unidad: { estado: 'ERROR', detalle: 'el precio es por equipo instalado, no por unidad sola', cita: 'Instalación y puesta en marcha: $45.000 por equipo' },
    V8_plazo: { plazo_proveedor: '25 a 30 días hábiles', tipo_dias: 'habiles', cita: 'Plazo de entrega: 25 a 30 días hábiles' },
  } }, TEXTO, [], true);
  assert.deepEqual(r.alertas.map(a => a.codigo).sort(), ['V1', 'V2', 'V8']);
  assert.equal(r.alertas.find(a => a.codigo === 'V1')!.nivel, 'rojo');
  assert.deepEqual(r.productoCambiado, { marca: 'Epson', modelo: 'PowerLite E24' });
});

test('ayuda: solo cuando la opción NO quedó verificada (nunca a un CUMPLE)', () => {
  const ayuda = { diagnostico: 'El respaldo no separa el precio del equipo del de la instalación.', causa_probable: 'Cotización con servicio incluido.', pregunta_proveedor: '¿Cuánto cuesta solo el equipo Epson PowerLite E24?', accion_concreta: 'Pedir la cotización sin instalación.', datos_para_impacto: '$45.000 por equipo' };
  assert.equal(evaluarCostoIA({ ayuda }, TEXTO, [], false).ayuda, null);
  const r = evaluarCostoIA({ ayuda }, TEXTO, [], true);
  assert.equal(r.ayuda?.accionConcreta, 'Pedir la cotización sin instalación.');
  assert.match(r.ayuda!.preguntaProveedor, /Epson PowerLite E24/);
});

test('respuesta vacía o rara del modelo no rompe nada', () => {
  const r = evaluarCostoIA({}, TEXTO, [], true);
  assert.deepEqual([r.alertas.length, r.ayuda, r.productoCambiado, r.descartados.length], [0, null, null, 0]);
});
