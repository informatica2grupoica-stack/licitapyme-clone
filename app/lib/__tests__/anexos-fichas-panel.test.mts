// fichasDesdePanel: del panel del Auditor a la ficha por línea del anexo técnico.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fichasDesdePanel } from '../anexos-datos';
import { textoEspecificacionDeFicha } from '../anexos-oferta-tecnica-tabla';

const fila = (n: number, texto: string, extra: Record<string, unknown> = {}) => ({
  n, requeridoTexto: texto, veredicto: 'CUMPLE', estadoCelda: 'CUMPLE', revisar: false, confirmada: null,
  partes: [{ ofertadoValor: '', citaOriginal: '' }], valorCorto: '', ...extra,
});
const panel = (filas: any[]) => ({
  lineas: [{
    noOfertada: false, detalle: 'Batería Litio NiMac', lineaReal: 1, item: 1,
    opciones: [{ estado: 'aprobada', marca: 'NiMac', modelo: 'LFP-100', producto: null, respaldos: [], tecnico: { resultado: { filas }, respaldosCelda: {} } }],
  }],
}) as any;

test('lo que el asistente escribió a mano al dar por cumplido un ❓ llega a la ficha del anexo como lo ofertado', () => {
  const [f] = fichasDesdePanel(panel([
    fila(1, 'Capacidad 100 Ah', { partes: [{ ofertadoValor: '100 Ah', citaOriginal: '' }] }),
    fila(2, 'Peso máximo 12 kg', { veredicto: 'SIN_VEREDICTO', estadoCelda: 'CUMPLE', confirmada: { por: 'Ana', at: '2026-11-09', valor: 'Peso 9,5 kg' } }),
  ]));
  assert.deepEqual(f.requisitos.map(r => [r.estado, r.ofertado]), [['CUMPLE', '100 Ah'], ['CUMPLE', 'Peso 9,5 kg']]);
  assert.equal(textoEspecificacionDeFicha(f), '100 Ah. Peso 9,5 kg.');
});

test('un ❓ sin cerrar queda FALTA_DATO y no entra a la especificación; confirmado sin valor tampoco inventa nada', () => {
  const [f] = fichasDesdePanel(panel([
    fila(1, 'Capacidad 100 Ah', { partes: [{ ofertadoValor: '100 Ah', citaOriginal: '' }] }),
    fila(2, 'Peso', { veredicto: 'SIN_VEREDICTO', estadoCelda: 'FALTA_DATO', partes: [{ ofertadoValor: '', citaOriginal: '' }] }),
    fila(3, 'Largo', { veredicto: 'SIN_VEREDICTO', estadoCelda: 'CUMPLE', confirmada: { por: 'Ana', at: '2026-11-09' } }),
  ]));
  assert.equal(f.requisitos[1].estado, 'FALTA_DATO');
  assert.equal(f.requisitos[2].ofertado, '');
  assert.equal(textoEspecificacionDeFicha(f), '100 Ah.');
});
