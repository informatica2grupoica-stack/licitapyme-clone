// WhatsApp propio de cada empresa-cliente: límite de frecuencia para pedir el QR (cada pedido recrea la instancia en Evolution).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esperaParaQr, reservarQr, SEGUNDOS_ENTRE_QR } from '../whatsapp-empresa';
import { instanciaEmisor } from '../whatsapp';

test('cada empresa tiene su propia instancia de WhatsApp; ICA conserva la suya', () => {
  assert.equal(instanciaEmisor(1), 'emisor-ica');
  assert.equal(instanciaEmisor(4), 'emisor-c4');
  assert.notEqual(instanciaEmisor(2), instanciaEmisor(4));
});

test('esperaParaQr: la primera vez no espera y dentro de la ventana avisa los segundos que faltan', () => {
  assert.equal(esperaParaQr(undefined, 1_000_000), 0);
  assert.equal(esperaParaQr(1_000_000, 1_000_000), SEGUNDOS_ENTRE_QR);
  assert.equal(esperaParaQr(1_000_000, 1_000_000 + 5_000), SEGUNDOS_ENTRE_QR - 5);
  assert.equal(esperaParaQr(1_000_000, 1_000_000 + SEGUNDOS_ENTRE_QR * 1000), 0);
});

test('reservarQr: el segundo pedido seguido de la MISMA empresa espera; otra empresa no se ve afectada', () => {
  const t = 5_000_000;
  assert.equal(reservarQr(901, t), 0);
  assert.ok(reservarQr(901, t + 1_000) > 0);
  assert.equal(reservarQr(902, t + 1_000), 0);
  assert.equal(reservarQr(901, t + SEGUNDOS_ENTRE_QR * 1000), 0);
});
