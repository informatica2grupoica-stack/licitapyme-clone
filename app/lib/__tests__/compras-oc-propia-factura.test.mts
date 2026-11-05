import test from 'node:test';
import assert from 'node:assert/strict';
import { parsearFacturaXml } from '../factura-xml';
import { emparejarFacturaConOc, rutComparable } from '../compras-oc-propia-factura';

// XML con la estructura de un DTE del SII (armado para la prueba: folios y montos inventados, RUT reales de las dos empresas del grupo).
const xml = (o: { emisor?: string; receptor?: string; neto?: number; refs?: Array<[string, string]> } = {}) => `<?xml version="1.0" encoding="ISO-8859-1"?>
<DTE version="1.0"><Documento ID="F1"><Encabezado>
  <IdDoc><TipoDTE>33</TipoDTE><Folio>4521</Folio><FchEmis>2026-11-05</FchEmis></IdDoc>
  <Emisor><RUTEmisor>${o.emisor ?? '76902659-2'}</RUTEmisor><RznSoc>INVERSIONES CLARO ARZ SPA</RznSoc></Emisor>
  <Receptor><RUTRecep>${o.receptor ?? '78388175-6'}</RUTRecep><RznSocRecep>COMERCIAL MP SPA</RznSocRecep></Receptor>
  <Totales><MntNeto>${o.neto ?? 18900000}</MntNeto><TasaIVA>19</TasaIVA><IVA>3591000</IVA><MntTotal>22491000</MntTotal></Totales>
</Encabezado>
<Detalle><NroLinDet>1</NroLinDet><NmbItem>VACUOLAVADORA DB51</NmbItem><QtyItem>3</QtyItem><PrcItem>6300000</PrcItem><MontoItem>18900000</MontoItem></Detalle>
${(o.refs ?? []).map(([t, f]) => `<Referencia><TpoDocRef>${t}</TpoDocRef><FolioRef>${f}</FolioRef><FchRef>2026-11-04</FchRef></Referencia>`).join('')}
</Documento></DTE>`;

const OC = { folio: 'MP-2026-0001', proveedorRut: '76.902.659-2', empresaRut: '78.388.175-6', neto: 18900000 };
const leer = (s: string) => { const f = parsearFacturaXml(s); assert.ok(f); return f; };

test('RUT comparable ignora puntos, guion y la k minúscula', () => {
  assert.equal(rutComparable('76.902.659-2'), rutComparable('76902659-2'));
  assert.equal(rutComparable('12.345.678-k'), '12345678K');
});

test('la factura cita la OC (referencia 801) → se empareja sola, aunque el folio venga sin ceros', () => {
  assert.equal(emparejarFacturaConOc(leer(xml({ refs: [['801', 'MP-2026-0001']] })), OC).tipo, 'REFERENCIA');
  assert.equal(emparejarFacturaConOc(leer(xml({ refs: [['801', 'mp-2026-1']] })), OC).tipo, 'REFERENCIA');
});

test('sin referencia pero con el mismo neto → hay que confirmarla', () => {
  const r = emparejarFacturaConOc(leer(xml()), OC);
  assert.equal(r.tipo, 'MONTO');
  assert.match(r.motivos[0], /Confírmalo/);
});

test('una referencia que no es 801 (ej. guía 52 con el mismo número) no cuenta como cita de la OC', () => {
  assert.equal(emparejarFacturaConOc(leer(xml({ refs: [['52', 'MP-2026-0001']], neto: 100 })), OC).tipo, 'NO');
});

test('cita otra OC y el neto no calza → no corresponde, y dice por qué', () => {
  const r = emparejarFacturaConOc(leer(xml({ refs: [['801', 'MP-2026-0002']], neto: 17000000 })), OC);
  assert.equal(r.tipo, 'NO');
  assert.match(r.motivos.join(' '), /MP-2026-0002/);
  assert.match(r.motivos.join(' '), /no coincide/);
});

test('la emite otra empresa o va a otro receptor → no corresponde aunque cite la OC', () => {
  assert.equal(emparejarFacturaConOc(leer(xml({ emisor: '11111111-1', refs: [['801', 'MP-2026-0001']] })), OC).tipo, 'NO');
  assert.equal(emparejarFacturaConOc(leer(xml({ receptor: '76902659-2', refs: [['801', 'MP-2026-0001']] })), OC).tipo, 'NO');
});
