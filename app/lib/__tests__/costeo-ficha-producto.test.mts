// Regresión del extractor de ficha técnica desde el link del costeo (costeo-ficha-producto.ts).
// Fixtures calcados de lo medido EN VIVO el 04-sep-2026 con los 3 links reales de 2446-249-LE26:
//   - Sodimac (Perno coche): __NEXT_DATA__ con 10 specs reales.
//   - Senaliza.cl (Poste Omega, Shopify): JSON-LD sin additionalProperty, descripción útil.
//   - Orbex.cl (Aluminio compuesto, Shopify): JSON-LD sin additionalProperty NI descripción útil.
//   npx tsx --test app/lib/__tests__/costeo-ficha-producto.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extraerDeSodimacNextData, extraerDeJsonLd, esShopify, slugArchivo, construirFichaProductoHtml,
  extraerSpecsDeTexto, extraerDeMetaTags, extraerImagenUrl,
  type FichaProductoExtraida,
} from '../costeo-ficha-producto';

function htmlSodimac(specs: { id: string; name: string; value: string }[]): string {
  const nextData = { props: { pageProps: { productData: { name: 'Perno coche c/tuerca y golilla acero inoxidable 1/4x2 1/2 2unid', attributes: { specifications: specs, topSpecifications: [] } } } } };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`;
}

function htmlJsonLd(product: Record<string, unknown>, shopify = true): string {
  const script = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org/', '@type': 'Product', ...product })}</script>`;
  return `<html><body>${shopify ? '<script src="https://cdn.shopify.com/s/foo.js"></script>' : ''}${script}</body></html>`;
}

test('extraerDeSodimacNextData: 10 specs reales del Perno coche', () => {
  const specsReales = [
    { id: '9_product_warranty', name: 'Detalle de la garantía', value: '1 año' },
    { id: '3510_tipo_de_perno', name: 'Tipo de perno', value: 'Perno coche' },
    { id: '2248_capacidad_de_carga', name: 'Capacidad de carga', value: '310 kg' },
    { id: '2324_material', name: 'Material', value: 'Acero inoxidable' },
    { id: '2282_diametro', name: 'Diámetro', value: '1/4 "' },
  ];
  const r = extraerDeSodimacNextData(htmlSodimac(specsReales));
  assert.ok(r);
  assert.equal(r!.nombreTienda, 'Perno coche c/tuerca y golilla acero inoxidable 1/4x2 1/2 2unid');
  assert.equal(r!.especificaciones.length, 5);
  assert.deepEqual(r!.especificaciones[3], { clave: 'Material', valor: 'Acero inoxidable' });
});

test('extraerDeSodimacNextData: sin specifications en el JSON, o sin __NEXT_DATA__ → null', () => {
  assert.equal(extraerDeSodimacNextData('<html><body>nada acá</body></html>'), null);
  assert.equal(extraerDeSodimacNextData(htmlSodimac([])), null);
});

test('extraerDeJsonLd: caso real Senaliza — sin additionalProperty, pero descripción con dato técnico real se conserva', () => {
  const html = htmlJsonLd({
    name: 'Poste Omega Galvanizado 2 Mts 2,5mm',
    description: 'Poste Omega de 2 metros, fabricado en acero galvanizado por inmersión con espesor de 2,5mm. Ideal para señalización vial, ofrece alta resistencia a la corrosión.',
    brand: { '@type': 'Brand', name: 'Señaliza SpA' },
  });
  const r = extraerDeJsonLd(html);
  assert.ok(r);
  assert.equal(r!.marca, 'Señaliza SpA');
  assert.equal(r!.especificaciones.length, 0);
  assert.match(r!.descripcion!, /galvanizado por inmersión/);
  assert.ok(esShopify(html));
});

test('extraerDeJsonLd: caso real Orbex — descripción de puro marketing (corta) → null, nada que ofrecer', () => {
  const html = htmlJsonLd({
    name: 'No Adelantar RPO-1a',
    description: 'Señaléticas cuya finalidad es notificar a los usuarios de las vías.',
    brand: { '@type': 'Brand', name: 'Señaliza Chile' },
  });
  assert.equal(extraerDeJsonLd(html), null);
});

test('extraerDeJsonLd: con additionalProperty (caso hipotético, no visto en los 3 reales pero el camino debe funcionar)', () => {
  const html = htmlJsonLd({
    name: 'Taladro percutor 750W',
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Potencia', value: '750 W' },
      { '@type': 'PropertyValue', name: 'Voltaje', value: '220 V' },
    ],
  });
  const r = extraerDeJsonLd(html);
  assert.ok(r);
  assert.equal(r!.especificaciones.length, 2);
  assert.deepEqual(r!.especificaciones[0], { clave: 'Potencia', valor: '750 W' });
});

test('extraerDeJsonLd: sin ningún bloque @type Product → null', () => {
  assert.equal(extraerDeJsonLd('<html><body><script type="application/ld+json">{"@type":"BreadcrumbList"}</script></body></html>'), null);
});

test('extraerDeJsonLd: additionalProperty de puro catálogo Shopify (Tags/Title) NO cuenta como spec real (regresión playplaza.cl, 1271359-92-LE26)', () => {
  const html = htmlJsonLd({
    name: 'Escaño Plaza Chilena 180 cm',
    description: 'Escaño Plaza Chilena 180 cm. Banca para plaza, parques.',
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Tags', value: ['Bancas y Escaños'] },
      { '@type': 'PropertyValue', name: 'Title', value: ['Default Title'] },
    ],
  });
  const r = extraerDeJsonLd(html);
  // La descripción real (48 chars, con dígito "180") sí pasa — pero Tags/Title no cuentan como specs.
  assert.ok(r);
  assert.equal(r!.especificaciones.length, 0);
});

test('extraerSpecsDeTexto: caso real ingequipos.cl — "Clave: valor" multilínea (regresión 1271359-92-LE26)', () => {
  const texto = `Locker Metálico, 5 Cuerpos, 15 Puertas L500-3
Medidas: Altura 170 * Ancho 137 * Profundidad 45 CM.
Volumen en caja: 0,0657 MT3
Material: Acero laminado en frío de grueso calibre
Recubrimiento: Pintura  Electroestática
Espesor: Estructura 0.6mm / Puertas 0.8mm`;
  const specs = extraerSpecsDeTexto(texto);
  assert.equal(specs.length, 5);
  assert.deepEqual(specs[0], { clave: 'Medidas', valor: 'Altura 170 * Ancho 137 * Profundidad 45 CM.' });
  assert.deepEqual(specs[2], { clave: 'Material', valor: 'Acero laminado en frío de grueso calibre' });
});

test('extraerSpecsDeTexto: una oración larga con ":" de casualidad NO se confunde con clave (guard de ≤4 palabras)', () => {
  const specs = extraerSpecsDeTexto('Para más información contactar a nuestro ejecutivo de ventas: fulano@x.cl');
  assert.equal(specs.length, 0);
});

test('extraerDeMetaTags: caso real ingequipos.cl — DOS <meta name="description"> (uno de marketing, otro con las specs); toma el que rinde más (regresión: el primer intento solo miraba el primer match)', () => {
  const html = `<html><head>
    <meta name="description" content="El Locker Metálico está fabricado en acero de alta calidad y durabilidad.">
    <meta name="description" content="Medidas: Altura 170 * Ancho 137 * Profundidad 45 CM.
Material: Acero laminado en frío de grueso calibre">
  </head><body></body></html>`;
  const r = extraerDeMetaTags(html);
  assert.ok(r);
  assert.equal(r!.especificaciones.length, 2);
  assert.equal(r!.descripcion, null);
});

test('extraerDeMetaTags: sin ningún meta de descripción → null', () => {
  assert.equal(extraerDeMetaTags('<html><head></head><body></body></html>'), null);
});

test('extraerImagenUrl: og:image (universal — medido 7/7 en los links reales de ambas licitaciones)', () => {
  const html = '<html><head><meta property="og:image" content="https://senaliza.cl/cdn/shop/files/Poste-Omega.jpg?v=1"></head></html>';
  assert.equal(extraerImagenUrl(html), 'https://senaliza.cl/cdn/shop/files/Poste-Omega.jpg?v=1');
});

test('extraerImagenUrl: sin og:image, cae al JSON-LD Product.image (string o array)', () => {
  const htmlArray = htmlJsonLd({ name: 'x', image: ['https://sodimac.cl/img1.jpg', 'https://sodimac.cl/img2.jpg'] });
  assert.equal(extraerImagenUrl(htmlArray), 'https://sodimac.cl/img1.jpg');
  const htmlString = htmlJsonLd({ name: 'x', image: 'https://orbex.cl/img.png' });
  assert.equal(extraerImagenUrl(htmlString), 'https://orbex.cl/img.png');
});

test('extraerImagenUrl: sin ninguna de las dos fuentes → null', () => {
  assert.equal(extraerImagenUrl('<html><body>nada</body></html>'), null);
});

test('construirFichaProductoHtml: con imagenDataUri arma el <img>, y sin ella no', () => {
  const ficha: FichaProductoExtraida = { nombreTienda: null, marca: null, descripcion: null, especificaciones: [], imagenUrl: 'https://x.cl/foto.jpg', fuente: 'solo_imagen', url: 'https://x.cl' };
  const conFoto = construirFichaProductoHtml({ detalle: 'Producto', ficha, fechaTexto: 'hoy', imagenDataUri: 'data:image/jpeg;base64,AAAA' });
  assert.match(conFoto, /<img src="data:image\/jpeg;base64,AAAA" \/>/);
  assert.match(conFoto, /Imagen referencial/);
  const sinFoto = construirFichaProductoHtml({ detalle: 'Producto', ficha, fechaTexto: 'hoy' });
  assert.doesNotMatch(sinFoto, /<img/);
});

test('slugArchivo: sin tildes, espacios a guion bajo, corta sin partir palabras', () => {
  assert.equal(slugArchivo('Poste Omega 3 mts. 2,5 mm'), 'Poste_Omega_3_mts_25_mm');
  const largo = slugArchivo('Aluminio compuesto 4 mm de 60 x 90 cm (Gráfica en vinilo fotoluminiscente y/o reflectante)', 30);
  assert.ok(largo.length <= 30);
  assert.ok(!largo.endsWith('_')); // no corta dejando un guion colgando
});

test('slugArchivo: texto vacío o sin caracteres válidos cae a "producto"', () => {
  assert.equal(slugArchivo('***'), 'producto');
  assert.equal(slugArchivo(''), 'producto');
});

test('construirFichaProductoHtml: con especificaciones arma tabla y NO el párrafo de descripción', () => {
  const ficha: FichaProductoExtraida = {
    nombreTienda: null, marca: 'Acme', descripcion: 'texto que no debería aparecer',
    especificaciones: [{ clave: 'Material', valor: 'Acero' }], imagenUrl: null,
    fuente: 'sodimac_nextdata', url: 'https://sodimac.cl/x',
  };
  const html = construirFichaProductoHtml({ detalle: 'Perno coche', ficha, fechaTexto: '04 de septiembre de 2026' });
  assert.match(html, /<table>/);
  assert.match(html, /Material/);
  assert.doesNotMatch(html, /texto que no debería aparecer/);
  assert.match(html, /Sodimac/);
});

test('construirFichaProductoHtml: sin especificaciones, usa el párrafo de descripción', () => {
  const ficha: FichaProductoExtraida = {
    nombreTienda: null, marca: null, descripcion: 'Fabricado en acero galvanizado, espesor 2,5mm.',
    especificaciones: [], imagenUrl: null, fuente: 'shopify_jsonld', url: 'https://senaliza.cl/x',
  };
  const html = construirFichaProductoHtml({ detalle: 'Poste Omega', ficha, fechaTexto: '04 de septiembre de 2026' });
  assert.doesNotMatch(html, /<table>/);
  assert.match(html, /acero galvanizado/);
});

test('construirFichaProductoHtml: escapa HTML del detalle (nunca inyecta markup del usuario)', () => {
  const ficha: FichaProductoExtraida = { nombreTienda: null, marca: null, descripcion: null, especificaciones: [], imagenUrl: null, fuente: 'jsonld_generico', url: 'https://x.cl' };
  const html = construirFichaProductoHtml({ detalle: '<script>alert(1)</script>', ficha, fechaTexto: 'hoy' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});
