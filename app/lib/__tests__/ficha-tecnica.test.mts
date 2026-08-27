// Tests de la FICHA TÉCNICA PROPIA — el documento que presentamos, armado desde las exigencias.
// Correr con:
//   npx tsx --test app/lib/__tests__/ficha-tecnica.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  textoRequisito, textoOfertado, especificacionesSinCompletar, construirFichaTecnicaHtml,
  type EspecificacionFicha, type LineaFicha, type EmpresaFicha,
} from '../ficha-tecnica';

const spec = (o: Partial<EspecificacionFicha>): EspecificacionFicha => ({
  descripcion: 'Potencia', tipo: null, valorRequeridoTexto: null, valorRequeridoNumero: null,
  valorRequeridoNumeroMax: null, unidadRequerida: null, valorOfertadoTexto: null,
  valorOfertadoNumero: null, unidadOfertada: null, ...o,
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

// ─── LO OFERTADO NUNCA SE INVENTA ─────────────────────────────────────────────────────────────
// Es LA regla de este documento: una ficha que se autocompleta con valores plausibles es
// justamente lo que no se puede presentar a un organismo público.
test('sin dato ofertado la casilla va vacía', () => {
  assert.equal(textoOfertado(spec({ valorRequeridoNumero: 1200, unidadRequerida: 'W' })), '');
});

test('el valor exigido NO se copia como si fuera lo ofertado', () => {
  const e = spec({ tipo: 'PISO', valorRequeridoNumero: 1200, unidadRequerida: 'W', valorRequeridoTexto: 'Mínimo 1.200 W' });
  assert.equal(textoOfertado(e), '');
  assert.notEqual(textoOfertado(e), textoRequisito(e));
});

test('con dato ofertado se muestra con su unidad original', () => {
  assert.equal(textoOfertado(spec({ valorOfertadoNumero: 1500, unidadOfertada: 'W' })), '1500 W');
  assert.equal(textoOfertado(spec({ valorOfertadoTexto: 'Sí, fotosensible' })), 'Sí, fotosensible');
});

test('se cuentan las casillas en blanco para poder avisar antes de presentar', () => {
  const lineas: LineaFicha[] = [{
    linea: 7, titulo: 'Esmeril angular', cantidad: 2, unidad: 'un',
    especificaciones: [
      spec({ valorOfertadoNumero: 1500, unidadOfertada: 'W' }),
      spec({ descripcion: 'Disco' }),
      spec({ descripcion: 'Peso' }),
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

const html = () => construirFichaTecnicaHtml({
  licitacionCodigo: '986278-14-LE26',
  licitacionNombre: 'PROYECTO EQUIPAMIENTO Y MOBILIARIO',
  organismo: 'Servicio de Salud', empresa: EMPRESA,
  lineas: [{
    linea: 7, titulo: 'Esmeril angular', cantidad: 2, unidad: 'un',
    especificaciones: [
      spec({ descripcion: 'Potencia', valorRequeridoTexto: 'Mínimo 1.200 W', valorOfertadoNumero: 1500, unidadOfertada: 'W' }),
      spec({ descripcion: 'Disco' }),
    ],
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

test('la ficha muestra la línea, lo exigido y lo ofertado', () => {
  const h = html();
  assert.ok(h.includes('Línea 7 — Esmeril angular'));
  assert.ok(h.includes('Mínimo 1.200 W'));
  assert.ok(h.includes('1500 W'));
});

test('la casilla sin completar se marca para que se vea que falta', () => {
  assert.ok(html().includes('of vacia'));
});

// El HTML va a chromium con setContent y sin red: una URL externa saldría como imagen rota y el
// PDF se generaría igual, sin logo y sin avisar. Por eso las imágenes viajan como data: URI.
test('no quedan referencias a imágenes externas', () => {
  assert.ok(!/<img[^>]+src="https?:/i.test(html()));
});

test('el contenido se escapa: un título con < > no rompe el documento', () => {
  const h = construirFichaTecnicaHtml({
    licitacionCodigo: 'X', licitacionNombre: null, organismo: null, empresa: EMPRESA,
    lineas: [{ linea: 1, titulo: 'Cable <2mm> & "especial"', cantidad: null, unidad: null, especificaciones: [] }],
    generadoPor: null, fechaTexto: '26 de agosto de 2026',
  });
  assert.ok(h.includes('Cable &lt;2mm&gt; &amp; &quot;especial&quot;'));
  assert.ok(!h.includes('<2mm>'));
});

test('una línea sin especificaciones lo dice, no finge una tabla vacía', () => {
  const h = construirFichaTecnicaHtml({
    licitacionCodigo: 'X', licitacionNombre: null, organismo: null, empresa: EMPRESA,
    lineas: [{ linea: 3, titulo: 'Caldera', cantidad: null, unidad: null, especificaciones: [] }],
    generadoPor: null, fechaTexto: '26 de agosto de 2026',
  });
  assert.ok(h.includes('Sin especificaciones técnicas registradas'));
});

// ─── DOS FORMAS DE TABLA SEGÚN LO QUE SE SEPA ─────────────────────────────────────────────────
// Antes de que alguien valide una línea, las exigencias vienen del informe como texto suelto, sin
// clasificar. Ahí la especificación completa ES la exigencia: separarla en "Característica" +
// "Exigido" dejaría una columna entera en blanco en todas las filas, que se lee como si faltara un
// dato. Caso real que lo destapó: 1057922-23-LE26, 9 líneas y 139 especificaciones sin clasificar.
const fichaCon = (especificaciones: ReturnType<typeof spec>[]) => construirFichaTecnicaHtml({
  licitacionCodigo: 'X', licitacionNombre: null, organismo: null, empresa: EMPRESA,
  lineas: [{ linea: 6, titulo: 'Romana', cantidad: null, unidad: null, especificaciones }],
  generadoPor: null, fechaTexto: '26 de agosto de 2026',
});

test('sin clasificar: tabla de 3 columnas, la especificación completa en una sola', () => {
  const h = fichaCon([
    spec({ descripcion: 'Peso máximo soportado: al menos 1 [Ton]' }),
    spec({ descripcion: 'Resolución: 100 [gr]' }),
  ]);
  assert.ok(h.includes('Especificación exigida en las bases'));
  assert.ok(!h.includes('<th>Exigido en las bases</th>'), 'no debe quedar la columna que iría vacía');
  assert.ok(h.includes('Peso máximo soportado: al menos 1 [Ton]'));
  assert.ok(h.includes('Resolución: 100 [gr]'));
});

test('clasificada: vuelve la tabla de 4 columnas con el exigido aparte', () => {
  const h = fichaCon([spec({ descripcion: 'Potencia', valorRequeridoTexto: 'Mínimo 1.200 W' })]);
  assert.ok(h.includes('<th>Exigido en las bases</th>'));
  assert.ok(h.includes('Mínimo 1.200 W'));
  assert.ok(!h.includes('Especificación exigida en las bases'));
});

test('basta UNA especificación clasificada en la línea para usar las 4 columnas', () => {
  const h = fichaCon([
    spec({ descripcion: 'Potencia', valorRequeridoTexto: 'Mínimo 1.200 W' }),
    spec({ descripcion: 'Estructura metálica o material equivalente' }),
  ]);
  assert.ok(h.includes('<th>Exigido en las bases</th>'));
  assert.ok(h.includes('Estructura metálica o material equivalente'));
});

test('la casilla "Ofertado" existe en las dos formas de tabla', () => {
  assert.ok(fichaCon([spec({ descripcion: 'A' })]).includes('of vacia'));
  assert.ok(fichaCon([spec({ descripcion: 'A', valorRequeridoTexto: 'Mínimo 1' })]).includes('of vacia'));
});

// ─── TABLA "INFORMACIÓN DE LA OFERTA" — marca/modelo/fabricante/país/año/garantía ─────────────
// Es el mismo dato que se captura al subir la ficha del proveedor (producto-ofertado.ts) y que se
// confirma en el modal de comparación. Se imprime por línea, no una vez por documento: en una
// licitación por línea cada línea es un producto distinto.
test('sin producto ofertado no se imprime la tabla de oferta', () => {
  const h = construirFichaTecnicaHtml({
    licitacionCodigo: 'X', licitacionNombre: null, organismo: null, empresa: EMPRESA,
    lineas: [{ linea: 1, titulo: 'Romana', cantidad: null, unidad: null, especificaciones: [], productoOfertado: null }],
    generadoPor: null, fechaTexto: '26 de agosto de 2026',
  });
  assert.ok(!h.includes('table class="oferta"'));
});

test('con producto ofertado, imprime marca/modelo/fabricante', () => {
  const h = construirFichaTecnicaHtml({
    licitacionCodigo: 'X', licitacionNombre: null, organismo: null, empresa: EMPRESA,
    lineas: [{
      linea: 8, titulo: 'Set contenedores', cantidad: null, unidad: null, especificaciones: [],
      productoOfertado: {
        marca: 'Konica Minolta', modelo: 'LS-150', fabricante: 'Konica Minolta',
        paisFabricacion: 'Japón', anioFabricacion: null, garantiaMeses: 12, confirmado: true,
      },
    }],
    generadoPor: null, fechaTexto: '26 de agosto de 2026',
  });
  assert.ok(h.includes('Konica Minolta'));
  assert.ok(h.includes('LS-150'));
  assert.ok(h.includes('Japón'));
  assert.ok(h.includes('12 meses'));
});

// Un dato leído automáticamente y no confirmado por una persona sale con aviso: presentarlo sin
// revisar es un riesgo, no un detalle cosmético.
test('sin confirmar, avisa que hay que revisarlo antes de presentar', () => {
  const h = construirFichaTecnicaHtml({
    licitacionCodigo: 'X', licitacionNombre: null, organismo: null, empresa: EMPRESA,
    lineas: [{
      linea: 8, titulo: 'Set contenedores', cantidad: null, unidad: null, especificaciones: [],
      productoOfertado: { marca: 'Konica Minolta', modelo: null, fabricante: null, paisFabricacion: null, anioFabricacion: null, garantiaMeses: null, confirmado: false },
    }],
    generadoPor: null, fechaTexto: '26 de agosto de 2026',
  });
  assert.ok(h.includes('sin-confirmar'));
  assert.ok(/revisar antes de presentar/i.test(h));
});

test('confirmado por una persona, NO muestra el aviso', () => {
  const h = construirFichaTecnicaHtml({
    licitacionCodigo: 'X', licitacionNombre: null, organismo: null, empresa: EMPRESA,
    lineas: [{
      linea: 8, titulo: 'Set contenedores', cantidad: null, unidad: null, especificaciones: [],
      productoOfertado: { marca: 'Konica Minolta', modelo: null, fabricante: null, paisFabricacion: null, anioFabricacion: null, garantiaMeses: null, confirmado: true },
    }],
    generadoPor: null, fechaTexto: '26 de agosto de 2026',
  });
  // OJO: "sin-confirmar" también aparece SIEMPRE en el <style> (la clase CSS existe se use o no) —
  // hay que comprobar el TEXTO visible del aviso, no el nombre de la clase.
  assert.ok(!/revisar antes de presentar/i.test(h));
});

// Sin ningún campo con dato, tampoco se imprime la tabla vacía.
test('un objeto productoOfertado sin ningún dato no imprime tabla', () => {
  const h = construirFichaTecnicaHtml({
    licitacionCodigo: 'X', licitacionNombre: null, organismo: null, empresa: EMPRESA,
    lineas: [{
      linea: 8, titulo: 'Set contenedores', cantidad: null, unidad: null, especificaciones: [],
      productoOfertado: { marca: null, modelo: null, fabricante: null, paisFabricacion: null, anioFabricacion: null, garantiaMeses: null },
    }],
    generadoPor: null, fechaTexto: '26 de agosto de 2026',
  });
  assert.ok(!h.includes('table class="oferta"'));
});
