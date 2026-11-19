import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pareceFichaTecnicaSinCotizacion } from '../compras-cotizacion-specs-core';

// Texto real de «Maquina Polifusor 20-63.pdf» (negocio 727202-72-LP26): una página de características, sin proveedor ni precio.
const POLIFUSOR = `Máquina Termofusora 20-63mm
Características Técnicas
 Potencia: 800Watts
 Voltaje: 220V+- 10%
 Frecuencia: 50-60Hz
 Temperatura de trabajo: 25-350ºC
 Maletin de transporte
 Luz frontal para iluminar la superficie a soldar.
 2 luces "OK", cuando llega a la Tº de trabajo y "OUT" cuando aun no la alcanza.
Información adicional
 Garantía 6 meses.
 Procedencia China`;

test('la ficha de la Polifusor se reconoce como ficha técnica, no como cotización', () => {
  assert.equal(pareceFichaTecnicaSinCotizacion(POLIFUSOR), true);
});

test('una cotización con precios NO es ficha, aunque traiga especificaciones', () => {
  assert.equal(pareceFichaTecnicaSinCotizacion(`${POLIFUSOR}\nPrecio unitario $ 189.000 + IVA`), false);
  assert.equal(pareceFichaTecnicaSinCotizacion(`${POLIFUSOR}\nCOTIZACIÓN N° 4521 Proveedor Ferretería X RUT 76.123.456-7`), false);
  assert.equal(pareceFichaTecnicaSinCotizacion(`${POLIFUSOR}\nValor 189000`.replace('Valor', 'Total')), false);
});

test('una cotización cuya tabla es una imagen (solo el membrete) NO se confunde con ficha', () => {
  assert.equal(pareceFichaTecnicaSinCotizacion('INSTRU PRODUCTOS SpA\nCOTIZACIÓN\nCliente: Grupo ICA\nFecha: 16-11-2026\nCondiciones de pago contado. Despacho incluido.'), false);
});

test('texto corto, vacío o sin datos técnicos: no es ficha', () => {
  assert.equal(pareceFichaTecnicaSinCotizacion(''), false);
  assert.equal(pareceFichaTecnicaSinCotizacion(null), false);
  assert.equal(pareceFichaTecnicaSinCotizacion('Gracias por su preferencia, quedamos atentos a sus comentarios y a una próxima oportunidad de trabajo conjunto.'), false);
});

test('validación: preguntar solo si parece ficha y nadie contestó; al contestar (sí o no) deja de preguntar y limpia el aviso', async () => {
  const { fichaPorValidar, notasTrasValidarFicha, MARCA_FICHA_VALIDADA } = await import('../compras-cotizacion-specs-core');
  const aviso = 'Pago contado · Ficha técnica: este documento no es una cotización (no trae precio ni proveedor).';
  assert.equal(fichaPorValidar(POLIFUSOR, aviso), true);
  const no = notasTrasValidarFicha(aviso, false);
  assert.ok(no.includes('Pago contado') && !no.includes('Ficha técnica: este') && no.includes(MARCA_FICHA_VALIDADA) && /no, es otro documento/.test(no));
  assert.equal(fichaPorValidar(POLIFUSOR, no), false);
  assert.equal(fichaPorValidar(POLIFUSOR, notasTrasValidarFicha(aviso, true)), false);
  assert.equal(fichaPorValidar('Total $ 1.000', null), false);
});
