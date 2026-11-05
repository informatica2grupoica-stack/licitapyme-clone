// Feedback loop del Anexo Creator: la parte PURA, la que decide si una corrección del experto se
// puede convertir en una regla que el motor determinista aplique sola.
//
// POR QUÉ EXISTE (auditoría 28-ago-2026): hasta ese día la corrección solo producía texto para un
// prompt apagado, así que no había nada que testear ni nada que se aplicara. Estos tests fijan los
// dos guardarraíles del circuito nuevo: de qué etiquetas se puede aprender, y que el campo se
// deduzca de la ficha REAL en vez de confiar en el texto guardado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esEtiquetaAprendible, campoDeLaFichaConEsteValor } from '../anexos-feedback';

const FICHA = {
  razon_social: 'Comercial Los Robles SpA',
  rut: '76.902.659-2',
  direccion: 'Av. Alemania 0671, Temuco',
  representante_nombre: 'Lidia Valenzuela Soto',
  representante_rut: '6.736.698-0',
  representante_cargo: 'Gerente General',
  tipo_persona_juridica: 'SpA',
  banco_numero: null,
  firma_url: 'https://r2.example/firma.png',
};

test('esEtiquetaAprendible: rechaza el placeholder de un blanco sin contexto', () => {
  // Es el caso peligroso de verdad: la pantalla manda "(sin contexto)" para un blanco inline sin
  // texto alrededor. Aprender de ahí haría que CUALQUIER blanco pelado de CUALQUIER anexo se
  // rellenara con ese dato — en un documento legal, en un lugar al azar.
  assert.equal(esEtiquetaAprendible('(sin contexto)'), false);
  assert.equal(esEtiquetaAprendible('(SIN CONTEXTO)'), false);
  assert.equal(esEtiquetaAprendible('—'), false);
  assert.equal(esEtiquetaAprendible('  '), false);
  assert.equal(esEtiquetaAprendible('12'), false, 'sin ninguna palabra real no hay de qué aprender');
});

test('esEtiquetaAprendible: acepta una etiqueta real de anexo', () => {
  assert.equal(esEtiquetaAprendible('RAZÓN SOCIAL EMPRESA'), true);
  assert.equal(esEtiquetaAprendible('Denominación mercantil'), true);
  assert.equal(esEtiquetaAprendible('N° DE RUT'), true);
});

test('campoDeLaFichaConEsteValor: reconoce el campo que el experto quiso poner', () => {
  assert.equal(campoDeLaFichaConEsteValor('Comercial Los Robles SpA', FICHA), 'razon_social');
  assert.equal(campoDeLaFichaConEsteValor('Lidia Valenzuela Soto', FICHA), 'representante_nombre');
  // El RUT se escribe con y sin puntos según el organismo — es el mismo dato.
  assert.equal(campoDeLaFichaConEsteValor('76902659-2', FICHA), 'rut');
  assert.equal(campoDeLaFichaConEsteValor('6736698-0', FICHA), 'representante_rut');
});

test('campoDeLaFichaConEsteValor: si el valor no es un dato de la ficha, no se inventa un campo', () => {
  // Casos reales de la tabla anexos_feedback: recortes a mano y datos de esa licitación puntual.
  // La corrección se guarda igual, pero NO se aprende una regla — y la pantalla lo dice.
  assert.equal(campoDeLaFichaConEsteValor('Barros Arana N°492 Of.78,', FICHA), null);
  assert.equal(campoDeLaFichaConEsteValor('+562', FICHA), null);
  assert.equal(campoDeLaFichaConEsteValor('Comercial MP', FICHA), null, 'parecido no es igual');
  assert.equal(campoDeLaFichaConEsteValor('', FICHA), null);
  assert.equal(campoDeLaFichaConEsteValor('Comercial Los Robles SpA', null), null);
});

test('campoDeLaFichaConEsteValor: las imágenes y los valores muy cortos quedan fuera', () => {
  // Una URL de firma no es texto que se escriba en una casilla.
  assert.equal(campoDeLaFichaConEsteValor('https://r2.example/firma.png', FICHA), null);
  // "SpA" (3 caracteres) sí califica por largo, pero el corte protege de calzar con "1"/"SI".
  assert.equal(campoDeLaFichaConEsteValor('SpA', FICHA), 'tipo_persona_juridica');
  assert.equal(campoDeLaFichaConEsteValor('S', FICHA), null);
});

// Auditoría 5-nov-2026: 16 correcciones guardadas, ninguna con campo; varias no enseñaban nada.
test('esCorreccionAprendible: rechaza montos, plazos y correcciones que no cambian nada', async () => {
  const { esCorreccionAprendible } = await import('../anexos-feedback');
  // monto de UNA licitación (viene del costeo)
  assert.equal(esCorreccionAprendible('GRÚA HORQUILLA — Valor total de la Oferta IVA incluido ($)', '$32.000.000', '27070418').ok, false);
  assert.equal(esCorreccionAprendible('Valor total', null, '$27.070.418').ok, false);
  // plazo de UNA licitación (viene del Auditor)
  assert.equal(esCorreccionAprendible('3.- PLAZO ENTREGA.', '20 días hábiles', '8 días hábiles').ok, false);
  // el valor no cambió
  assert.equal(esCorreccionAprendible('RAZON SOCIAL EMPRESA', 'Comercial MP SpA', 'Comercial MP SpA').ok, false);
  assert.equal(esCorreccionAprendible('Cuenta con programa de integridad — Marcar alternativa', 'SÍ', 'sí').ok, false);
  // sin nombre propio
  assert.equal(esCorreccionAprendible('(sin contexto)', 'x', 'Santiago').ok, false);
});

test('esCorreccionAprendible: deja pasar una corrección real de etiqueta → dato de la ficha', async () => {
  const { esCorreccionAprendible } = await import('../anexos-feedback');
  assert.equal(esCorreccionAprendible('Número de calle:', 'Lidia Valenzuela', '575 N° 6').ok, true);
  assert.equal(esCorreccionAprendible('Domicilio', 'Barros Arana N°492 Of.78, Concepción', 'Barros Arana N°492 Of.78,').ok, true);
  assert.equal(esCorreccionAprendible('Ciudad:', 'Comuna Talagante', 'Santiago').ok, true);
});
