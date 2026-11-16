import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textoPdfSinPrecios } from '../compras-cotizacion-ocr';

// 3789-30-LE26, INSTRU PRODUCTOS #324: el texto del PDF era solo membrete; la tabla de precios venía como imagen.
const MEMBRETE_INSTRU = `INSTRU PRODUCTOS SP A\nRut. 7 6.569.669 - 0\nPortal 2 4512\nPeñalolén\nSantiago - Chile\nFono: +56 977424367\nCliente | : Inversiones Claro ARZ SPA\nFecha | : 1 3 - 11 - 2026\nOBSERVACIONES :\nCONDICIONES :\nDATOS DE TRANSFERENCIA:\nBANCO DE CHILE CUENTA CORRIENTE\n00 - 901 - 45698 - 05\nCONSIDERACIONES:\n1. Los valores indicados están expresados en pesos .\n2. Validez de la oferta 5 dias.`;

test('membrete sin tabla de precios → hay que leer la imagen', () => {
  assert.equal(textoPdfSinPrecios(MEMBRETE_INSTRU), true);
});
test('cotización con tabla en texto → no se lee de nuevo', () => {
  assert.equal(textoPdfSinPrecios('Cantidad Producto | Precio | Precio total\n200 Lijas | 4.250 | 850.000\nTotal neto: | 1.004.000'), false);
  assert.equal(textoPdfSinPrecios('SILLON PODOLOGICO | $ 158.000 | 2 | $ 316.000'), false);
});
test('el texto leído de la imagen con precios sí cuenta como tabla', () => {
  assert.equal(textoPdfSinPrecios('2 Lija 180# autoadhesiva. Bolsa 100 unidades UNI 80 $ 4.622 $ 369.720\nSub Total $ 544.544'), false);
});
