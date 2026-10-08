import test from 'node:test';
import assert from 'node:assert/strict';
import { parsearFacturaXml } from '../factura-xml';

const XML = `<DTE version="1.0"><Documento ID="F27202T33"><Encabezado><IdDoc><TipoDTE>33</TipoDTE><Folio>27202</Folio><FchEmis>2026-10-01</FchEmis><FchVenc>2026-10-02</FchVenc></IdDoc>
<Emisor><RUTEmisor>77085964-6</RUTEmisor><RznSoc>ROHE STORE SPA</RznSoc><GiroEmis>COMERCIALIZADORA</GiroEmis><DirOrigen>FRANCISCO BILBAO 350</DirOrigen><CmnaOrigen>Providencia</CmnaOrigen><CiudadOrigen>Santiago</CiudadOrigen></Emisor>
<Receptor><RUTRecep>76902659-2</RUTRecep><RznSocRecep>INVERSIONES CLARO ARZ SPA</RznSocRecep><DirRecep>BARROS ARANA 492</DirRecep></Receptor>
<Totales><MntNeto>1426268</MntNeto><TasaIVA>19</TasaIVA><IVA>270991</IVA><MntTotal>1697259</MntTotal></Totales></Encabezado>
<Detalle><NroLinDet>1</NroLinDet><CdgItem><TpoCodigo>INT1</TpoCodigo><VlrCodigo>RHT3303</VlrCodigo></CdgItem><NmbItem>TELÓN &amp; TRÍPODE</NmbItem><QtyItem>1.0</QtyItem><PrcItem>65000.0</PrcItem><MontoItem>65000</MontoItem></Detalle>
<Detalle><NroLinDet>2</NroLinDet><NmbItem>TELÓN MOTORIZADO</NmbItem><QtyItem>12.0</QtyItem><PrcItem>113439.0</PrcItem><MontoItem>1361268</MontoItem></Detalle>
<Referencia><NroLinRef>1</NroLinRef><TpoDocRef>801</TpoDocRef><FolioRef>3967</FolioRef><FchRef>2026-10-01</FchRef></Referencia>
<TED version="1.0"><DD><RE>77085964-6</RE><IT1>TELÓN</IT1></DD></TED></Documento></DTE>`;

test('factura-xml · lee emisor, receptor, líneas, totales y referencia', () => {
  const f = parsearFacturaXml(XML)!;
  assert.equal(f.folio, '27202'); assert.equal(f.tipoNombre, 'Factura electrónica');
  assert.equal(f.emisor.razonSocial, 'ROHE STORE SPA'); assert.equal(f.emisor.direccion, 'FRANCISCO BILBAO 350, Providencia, Santiago');
  assert.equal(f.receptor.rut, '76902659-2');
  assert.equal(f.lineas.length, 2); assert.equal(f.lineas[0].descripcion, 'TELÓN & TRÍPODE'); assert.equal(f.lineas[1].cantidad, 12);
  assert.equal(f.totales.total, 1697259); assert.equal(f.totales.iva, 270991);
  assert.deepEqual(f.referencias, [{ tipoDoc: '801', folio: '3967', fecha: '2026-10-01' }]);
  // las líneas cuadran con el neto
  assert.equal(f.lineas.reduce((s, l) => s + (l.monto ?? 0), 0), f.totales.neto);
});
test('factura-xml · texto que no es un DTE → null', () => {
  assert.equal(parsearFacturaXml('<html>no</html>'), null);
  assert.equal(parsearFacturaXml(''), null);
});
