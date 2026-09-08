// Tests de la FICHA TÉCNICA PROPIA — el documento que presentamos, armado desde las exigencias.
// Correr con:
//   npx tsx --test app/lib/__tests__/ficha-tecnica.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  textoRequisito, textoOfertado, especificacionesSinCompletar, productosSinConfirmar, construirFichaTecnicaHtml,
  imagenProducto,
  type EspecificacionFicha, type LineaFicha, type EmpresaFicha, type ProductoFicha,
} from '../ficha-tecnica';

const spec = (o: Partial<EspecificacionFicha>): EspecificacionFicha => ({
  descripcion: 'Potencia', tipo: null, valorRequeridoTexto: null, valorRequeridoNumero: null,
  valorRequeridoNumeroMax: null, unidadRequerida: null, valorOfertadoTexto: null,
  valorOfertadoNumero: null, unidadOfertada: null, ...o,
});

/** Un producto de ficha con lo mínimo; se sobreescribe lo que cada test necesite. */
const prod = (o: Partial<ProductoFicha>): ProductoFicha => ({
  nombre: 'Producto', marca: null, modelo: null, fabricante: null, paisFabricacion: null,
  anioFabricacion: null, garantiaMeses: null, especificaciones: [], cantidad: null, unidad: null, ...o,
});

// ─── EL REQUISITO SE TRANSCRIBE, NO SE REESCRIBE ──────────────────────────────────────────────
// La cita textual de las bases manda siempre. Es un documento que se presenta a evaluación:
// reescribir con nuestras palabras lo que exigió el organismo es un riesgo que no aporta nada.
test('si hay cita textual de las bases, se usa esa tal cual', () => {
  assert.equal(
    textoRequisito(spec({ valorRequeridoTexto: 'Potencia 1.200 W o superior', tipo: 'PISO', valorRequeridoNumero: 1200, unidadRequerida: 'W' })),
    'Potencia 1.200 W o superior',
  );
});

test('sin cita, se arma la frase según el tipo clasificado', () => {
  assert.equal(textoRequisito(spec({ tipo: 'PISO', valorRequeridoNumero: 1200, unidadRequerida: 'W' })), 'Mínimo 1200 W');
  assert.equal(textoRequisito(spec({ tipo: 'TECHO', valorRequeridoNumero: 30, unidadRequerida: 'kg' })), 'Máximo 30 kg');
  assert.equal(textoRequisito(spec({ tipo: 'EXACTO', valorRequeridoNumero: 82, unidadRequerida: 'piezas' })), '82 piezas');
  assert.equal(
    textoRequisito(spec({ tipo: 'RANGO', valorRequeridoNumero: 10, valorRequeridoNumeroMax: 20, unidadRequerida: 'm' })),
    'Entre 10 y 20 m',
  );
});

test('un RANGO sin máximo no inventa el tope', () => {
  assert.equal(textoRequisito(spec({ tipo: 'RANGO', valorRequeridoNumero: 10, unidadRequerida: 'm' })), 'Desde 10 m');
});

test('sin ningún dato el requisito queda vacío, no con un texto de relleno', () => {
  assert.equal(textoRequisito(spec({})), '');
});

// ─── NO INVENTAR: lo ofertado sale vacío mientras no exista ───────────────────────────────────
test('sin dato ofertado la casilla va vacía', () => {
  assert.equal(textoOfertado(spec({})), '');
});

// El error que convertiría el documento en una declaración falsa ante un organismo público.
test('el valor exigido NO se copia como si fuera lo ofertado', () => {
  const e = spec({ valorRequeridoTexto: 'Mínimo 1.200 W', valorRequeridoNumero: 1200, unidadRequerida: 'W' });
  assert.equal(textoOfertado(e), '');
  assert.notEqual(textoOfertado(e), textoRequisito(e));
});

test('con dato ofertado se muestra con su unidad original', () => {
  assert.equal(textoOfertado(spec({ valorOfertadoNumero: 1500, unidadOfertada: 'W' })), '1500 W');
  assert.equal(textoOfertado(spec({ valorOfertadoTexto: 'Sí, fotosensible' })), 'Sí, fotosensible');
});

test('se cuentan las casillas en blanco para poder avisar antes de presentar', () => {
  const lineas: LineaFicha[] = [{
    linea: 7, titulo: 'Esmeril angular',
    productos: [prod({
      nombre: 'Esmeril angular',
      especificaciones: [
        spec({ valorOfertadoNumero: 1500, unidadOfertada: 'W' }),
        spec({ descripcion: 'Disco' }),
        spec({ descripcion: 'Peso' }),
      ],
    })],
  }];
  assert.equal(especificacionesSinCompletar(lineas), 2);
});

// Con varios productos se suman las casillas de TODOS — antes se contaban solo las de la línea.
test('las casillas en blanco se cuentan sumando todos los productos de la línea', () => {
  const lineas: LineaFicha[] = [{
    linea: 1, titulo: '2 productos',
    productos: [
      prod({ nombre: 'A', especificaciones: [spec({ descripcion: 'X' })] }),
      prod({ nombre: 'B', especificaciones: [spec({ descripcion: 'Y' }), spec({ descripcion: 'Z', valorOfertadoTexto: 'sí' })] }),
    ],
  }];
  assert.equal(especificacionesSinCompletar(lineas), 2);
});

// ─── EL DOCUMENTO ─────────────────────────────────────────────────────────────────────────────
const EMPRESA: EmpresaFicha = {
  razonSocial: 'Inversiones Claro ARZ SPA', rut: '76.902.659-2',
  giro: 'Venta de Maquinaria', direccion: 'Barros Arana N°492, Concepción',
  email: 'ventas@grupoica.cl', telefono: '+569 3146 2445',
  representanteNombre: 'Santiago Osvaldo López Palavecino', representanteRut: '15.875.453-3',
  representanteCargo: 'Ingeniero Constructor',
  logoDataUri: 'data:image/png;base64,AAA', firmaDataUri: 'data:image/png;base64,BBB',
  timbreDataUri: null,
};

const ficha = (lineas: LineaFicha[]) => construirFichaTecnicaHtml({
  licitacionCodigo: 'X', licitacionNombre: null, organismo: null, empresa: EMPRESA,
  lineas, generadoPor: null, fechaTexto: '27 de agosto de 2026',
});

const html = () => construirFichaTecnicaHtml({
  licitacionCodigo: '986278-14-LE26',
  licitacionNombre: 'PROYECTO EQUIPAMIENTO Y MOBILIARIO',
  organismo: 'Servicio de Salud', empresa: EMPRESA,
  lineas: [{
    linea: 7, titulo: 'Esmeril angular',
    productos: [prod({
      nombre: 'Esmeril angular', marca: 'Bosch', modelo: 'GWS-1400', cantidad: 2, unidad: 'un',
      especificaciones: [
        spec({ descripcion: 'Potencia', valorRequeridoTexto: 'Mínimo 1.200 W', valorOfertadoNumero: 1500, unidadOfertada: 'W' }),
        spec({ descripcion: 'Disco' }),
      ],
    })],
  }],
  generadoPor: 'Alexis Tobar', fechaTexto: '26 de agosto de 2026',
});

test('la ficha lleva los datos de la empresa, el logo y la firma', () => {
  const h = html();
  assert.ok(h.includes('Inversiones Claro ARZ SPA'));
  assert.ok(h.includes('76.902.659-2'));
  assert.ok(h.includes('data:image/png;base64,AAA'), 'falta el logo');
  assert.ok(h.includes('data:image/png;base64,BBB'), 'falta la firma');
  assert.ok(h.includes('Santiago Osvaldo López Palavecino'));
});

// FORMATO (pedido explícito con el ejemplo de Tecnomaq): nombre del producto grande, marca/modelo
// debajo, y la tabla con lo que OFERTAMOS. Lo exigido por las bases no va en el documento que se
// presenta — eso es la planilla de auditoría, y vive en el modal del Auditor Técnico.
test('la ficha titula con el producto, su marca/modelo y lo ofertado', () => {
  const h = html();
  assert.ok(h.includes('Esmeril angular'));
  assert.ok(h.includes('Bosch GWS-1400'), 'marca y modelo van como subtítulo de la ficha');
  assert.ok(h.includes('Cantidad: 2 un'));
  assert.ok(h.includes('1500 W'));
  assert.ok(/Ficha técnica 01/i.test(h), 'cada producto se numera como una ficha');
});

test('lo EXIGIDO por las bases no se imprime en el documento que se presenta', () => {
  assert.ok(!html().includes('Mínimo 1.200 W'));
});

test('la casilla sin completar se marca para que se vea que falta', () => {
  assert.ok(html().includes('class="vacia"'));
});

// El HTML va a chromium con setContent y sin red: una URL externa saldría como imagen rota y el
// PDF se generaría igual, sin logo y sin avisar. Por eso las imágenes viajan como data: URI.
test('no quedan referencias a imágenes externas', () => {
  assert.ok(!/<img[^>]+src="https?:/i.test(html()));
});

test('el contenido se escapa: un título con < > no rompe el documento', () => {
  const h = ficha([{ linea: 1, titulo: 'L', productos: [prod({ nombre: 'Cable <2mm> & "especial"' })] }]);
  assert.ok(h.includes('Cable &lt;2mm&gt; &amp; &quot;especial&quot;'));
  assert.ok(!h.includes('<2mm>'));
});

test('un producto sin especificaciones lo dice, no finge una tabla vacía', () => {
  const h = ficha([{ linea: 3, titulo: 'Caldera', productos: [prod({ nombre: 'Caldera' })] }]);
  assert.ok(h.includes('Sin especificaciones técnicas registradas'));
});

// Antes de que alguien valide una línea, las exigencias vienen del informe como texto suelto, sin
// clasificar: la especificación completa ES la descripción. La tabla de 2 columnas funciona igual
// en ese caso — la frase entera va en la columna izquierda. Caso real que lo destapó:
// 1057922-23-LE26, 9 líneas y 139 especificaciones sin clasificar.
test('sin clasificar: la especificación completa va en la columna de la izquierda', () => {
  const h = ficha([{
    linea: 6, titulo: 'Romana',
    productos: [prod({ nombre: 'Romana', especificaciones: [
      spec({ descripcion: 'Peso máximo soportado: al menos 1 [Ton]' }),
      spec({ descripcion: 'Resolución: 100 [gr]' }),
    ] })],
  }]);
  assert.ok(h.includes('Peso máximo soportado: al menos 1 [Ton]'));
  assert.ok(h.includes('Resolución: 100 [gr]'));
});

// ─── "INFORMACIÓN DE LA OFERTA" — fabricante/país/año/garantía ────────────────────────────────
// Marca y modelo NO van acá: ya son el subtítulo de la ficha, repetirlos sería ruido.
test('sin fabricante/país/año/garantía no se imprime la sección', () => {
  const h = ficha([{ linea: 1, titulo: 'Romana', productos: [prod({ nombre: 'Romana', marca: 'Acme' })] }]);
  assert.ok(!/Información de la oferta/i.test(h));
});

test('con fabricante/país/garantía, se imprime la sección', () => {
  const h = ficha([{
    linea: 8, titulo: 'Set',
    productos: [prod({ nombre: 'Set', fabricante: 'Konica Minolta', paisFabricacion: 'Japón', garantiaMeses: 12 })],
  }]);
  assert.ok(/Información de la oferta/i.test(h));
  assert.ok(h.includes('Konica Minolta'));
  assert.ok(h.includes('Japón'));
  assert.ok(h.includes('12 meses'));
});

// BUG REAL (08-sep-2026, pedido explícito del usuario): este documento es el que se PRESENTA al
// organismo — antes, un dato sin confirmar imprimía ACÁ MISMO un aviso interno ("⚠ … revisar antes
// de presentar", en letra ámbar) que viajaba dentro del PDF oficial. Ahora el PDF nunca lleva ese
// aviso (esté confirmado o no) — el control de "¿ya lo revisaron?" se movió a productosSinConfirmar,
// que alimenta un aviso EN LA PANTALLA antes de descargar, nunca dentro del documento.
test('marca/modelo sin confirmar se imprime igual, SIN ningún aviso dentro del documento', () => {
  const h = ficha([{
    linea: 8, titulo: 'Set',
    productos: [prod({ nombre: 'Set', marca: 'Konica Minolta', confirmado: false })],
  }]);
  assert.ok(h.includes('Konica Minolta'));
  assert.ok(!/revisar antes de presentar/i.test(h));
  assert.ok(!/sin.confirmar/i.test(h));
});

test('marca/modelo confirmados se imprimen igual (mismo resultado, confirmado o no)', () => {
  const h = ficha([{
    linea: 8, titulo: 'Set',
    productos: [prod({ nombre: 'Set', marca: 'Konica Minolta', confirmado: true })],
  }]);
  assert.ok(h.includes('Konica Minolta'));
  assert.ok(!/revisar antes de presentar/i.test(h));
});

// ─── FOTO DEL PRODUCTO — siempre con el mismo pie neutro, esté confirmada o no ─────────────────
// Verificado con fichas reales (27-ago-2026): la extracción automática a veces trae la imagen
// EQUIVOCADA (una textura decorativa, una franja de logos de certificación) en vez del producto —
// pero ese riesgo se controla ANTES de presentar (productosSinConfirmar), no con un aviso impreso
// en el documento que se entrega al organismo.
test('sin imagenDataUri, no imprime nada', () => {
  assert.equal(imagenProducto(prod({})), '');
  assert.equal(imagenProducto(null), '');
  assert.equal(imagenProducto(undefined), '');
});

test('imagen SIN confirmar: sale igual como "Imagen referencial", sin ningún aviso interno', () => {
  const h = imagenProducto(prod({ imagenDataUri: 'data:image/png;base64,AAA', imagenConfirmada: false }));
  assert.ok(h.includes('data:image/png;base64,AAA'));
  assert.ok(h.includes('>Imagen referencial<'));
  assert.ok(!/confirmar que corresponde al equipo/i.test(h));
});

test('imagen CONFIRMADA por una persona: mismo pie neutro', () => {
  const h = imagenProducto(prod({ imagenDataUri: 'data:image/png;base64,AAA', imagenConfirmada: true }));
  assert.ok(h.includes('>Imagen referencial<'));
});

// ─── productosSinConfirmar — el aviso se movió a la PANTALLA, no al documento ──────────────────
test('productosSinConfirmar cuenta marca/modelo sin confirmar', () => {
  const lineas: LineaFicha[] = [{ linea: 1, titulo: 'L1', productos: [prod({ marca: 'Acme', confirmado: false })] }];
  assert.equal(productosSinConfirmar(lineas), 1);
});

test('productosSinConfirmar cuenta la foto sin confirmar, independiente del texto (migración 81)', () => {
  const lineas: LineaFicha[] = [{
    linea: 1, titulo: 'L1',
    productos: [prod({ marca: 'Acme', confirmado: true, imagenDataUri: 'data:image/png;base64,AAA', imagenConfirmada: false })],
  }];
  assert.equal(productosSinConfirmar(lineas), 1);
});

test('productosSinConfirmar en 0 cuando todo está confirmado (o no hay nada que confirmar)', () => {
  const lineas: LineaFicha[] = [
    { linea: 1, titulo: 'L1', productos: [prod({ marca: 'Acme', confirmado: true })] },
    { linea: 2, titulo: 'L2', productos: [prod({})] },
  ];
  assert.equal(productosSinConfirmar(lineas), 0);
});

// ─── LÍNEA-PAQUETE: UNA FICHA POR PRODUCTO, cada una con LO SUYO ──────────────────────────────
// Caso real 2446-240-LE26: la "Línea 1" junta una Hidrolavadora H300 y una Vacuolavadora DB51
// Dimer. El bug que esto cierra: salían las DOS fotos juntas arriba y después una sola tabla con
// las 31 características de ambos equipos revueltas, sin forma de saber cuál era de cuál.
const LINEA_PAQUETE: LineaFicha[] = [{
  linea: 1, titulo: '2 productos: Hidrolavadora + Vacuolavadora',
  productos: [
    prod({
      nombre: 'Hidrolavadora peatonal H300', marca: 'Tecnomaq', modelo: 'H300',
      imagenDataUri: 'data:image/png;base64,HIDRO', imagenConfirmada: true,
      especificaciones: [spec({ descripcion: 'Presión de servicio', valorOfertadoTexto: '285 bar' })],
    }),
    prod({
      nombre: 'Vacuolavadora de empuje DB51', marca: 'Dimer', modelo: 'DB51',
      imagenDataUri: 'data:image/png;base64,VACUO', imagenConfirmada: true,
      especificaciones: [spec({ descripcion: 'Motor del cepillo', valorOfertadoTexto: '550 W' })],
    }),
  ],
}];

test('cada producto es su PROPIA ficha numerada, con su nombre y su marca/modelo', () => {
  const h = ficha(LINEA_PAQUETE);
  assert.ok(/Ficha técnica 01/i.test(h));
  assert.ok(/Ficha técnica 02/i.test(h));
  assert.ok(h.includes('Hidrolavadora peatonal H300'));
  assert.ok(h.includes('Vacuolavadora de empuje DB51'));
  assert.ok(h.includes('Tecnomaq H300'));
  assert.ok(h.includes('Dimer DB51'), 'la marca del SEGUNDO producto también se imprime');
});

test('cada ficha lleva SU foto y SUS especificaciones, en ese orden', () => {
  const h = ficha(LINEA_PAQUETE);
  const iHidro = h.indexOf('Hidrolavadora peatonal H300');
  const iFotoHidro = h.indexOf('base64,HIDRO');
  const iSpecHidro = h.indexOf('Presión de servicio');
  const iVacuo = h.indexOf('Vacuolavadora de empuje DB51');
  const iFotoVacuo = h.indexOf('base64,VACUO');
  const iSpecVacuo = h.indexOf('Motor del cepillo');

  // Todo lo de la Hidrolavadora ANTES de que empiece la Vacuolavadora — el orden que se rompía:
  // antes salían las dos fotos juntas y después las características de ambos mezcladas.
  assert.ok(iHidro < iFotoHidro, 'la foto va después del nombre');
  assert.ok(iFotoHidro < iSpecHidro, 'las especificaciones van después de la foto');
  assert.ok(iSpecHidro < iVacuo, 'las specs de la Hidrolavadora terminan ANTES del segundo producto');
  assert.ok(iVacuo < iFotoVacuo && iFotoVacuo < iSpecVacuo, 'el segundo producto repite el mismo orden');
});

test('cada ficha arranca en su propia página (una ficha por hoja, como el formato de referencia)', () => {
  assert.ok(ficha(LINEA_PAQUETE).includes('page-break-before: always'));
});
