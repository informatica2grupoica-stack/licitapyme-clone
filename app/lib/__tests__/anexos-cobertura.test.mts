// Autodiagnóstico del motor de anexos (18-ago-2026). Los dos casos "ciego" de acá son REALES y son
// la razón por la que este módulo existe: en los dos el sistema respondió "no hay nada que llenar",
// una respuesta indistinguible de la de un documento que de verdad no pide nada.
//   npx tsx --test app/lib/__tests__/anexos-cobertura.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticarCobertura } from '../anexos-cobertura';

const diag = (textoPlano: string, casillasDetectadas: number, casillasResueltas = 0) =>
  diagnosticarCobertura({ textoPlano, parrafosConTexto: textoPlano.split('\n').filter(Boolean).length, casillasDetectadas, casillasResueltas });

// CASO REAL 1247197-54-LE26: marcadores con UN par de ángulos. 7 marcadores en el texto, 0 casillas
// detectadas — el anexo se veía "sin nada que llenar" cuando pedía los datos más básicos.
test('CIEGO: el texto está lleno de marcadores y el detector no vio ninguna casilla', () => {
  const texto = 'Yo, <nombre de representante legal>, cédula de identidad N° <RUT representante legal>, '
    + 'con domicilio en <domicilio>, <comuna>, <ciudad> en representación de <razón social empresa>, '
    + 'RUT N° <RUT empresa>, declaro que:';
  const d = diag(texto, 0);
  assert.equal(d.severidad, 'ciego');
  assert.ok(d.totalSenales >= 7, `debe contar los 7 marcadores, contó ${d.totalSenales}`);
  assert.match(d.motivo, /no detectó ninguna casilla/);
});

// CASO REAL 2296-48-LE26: el pliego usa líneas de puntos como casilla.
test('CIEGO: rayas y líneas de puntos sin ninguna casilla detectada', () => {
  const texto = 'PROPONENTE:………………………………\nRUT o C.I:………………………………\nDOMICILIO:____________________\nTELÉFONO:____________________';
  const d = diag(texto, 0);
  assert.equal(d.severidad, 'ciego');
});

// Un documento de SOLO LECTURA (bases, decreto, resolución) no trae marcas de relleno: "0 casillas"
// es la respuesta correcta y no debe generar ruido. Es el caso más común de todos.
test('OK: un documento sin marcas de relleno no es un formulario — no avisa', () => {
  const texto = 'BASES ADMINISTRATIVAS\n1 OBJETO DE LA PRESENTE LICITACIÓN\n'
    + 'Las presentes Bases están destinadas a regular el proceso de adquisición.\n'
    + '3.5 El presupuesto disponible asciende a $26.500.000 IVA incluido.';
  const d = diag(texto, 0);
  assert.equal(d.severidad, 'ok');
  assert.equal(d.totalSenales, 0);
});

// Una raya suelta (un separador decorativo, la línea sobre la firma) no convierte un documento en
// formulario. Por debajo del mínimo de señales no se concluye nada.
test('OK: una o dos rayas sueltas no disparan el aviso', () => {
  const d = diag('Declaro bajo juramento lo anterior.\n____________________\nNOMBRE Y FIRMA', 0);
  assert.equal(d.severidad, 'ok');
});

test('REVISAR: detectó bastante menos casillas que marcas de relleno', () => {
  const texto = ['A:____________', 'B:____________', 'C:____________', 'D:____________',
    'E:____________', 'F:____________', 'G:____________', 'H:____________'].join('\n');
  const d = diag(texto, 2, 2);
  assert.equal(d.severidad, 'revisar');
  assert.match(d.motivo, /8 marca/);
});

// No es ceguera del detector: es el diccionario. La distinción importa porque el arreglo es otro.
test('REVISAR: detectó las casillas pero no supo completar ninguna', () => {
  const texto = ['Campo raro uno:____________', 'Campo raro dos:____________',
    'Campo raro tres:____________', 'Campo raro cuatro:____________'].join('\n');
  const d = diag(texto, 4, 0);
  assert.equal(d.severidad, 'revisar');
  assert.match(d.motivo, /no se pudo completar ninguna/);
});

test('OK: caso normal — se detectaron y se completaron', () => {
  const texto = ['NOMBRE O RAZÓN SOCIAL:____________', 'RUT:____________',
    'DOMICILIO:____________', 'TELÉFONO:____________'].join('\n');
  const d = diag(texto, 4, 3);
  assert.equal(d.severidad, 'ok');
  assert.match(d.motivo, /3 de 4/);
});

// El "que:" de una oración legal no es una etiqueta de campo: si contara, cualquier declaración
// jurada parecería un formulario lleno de casillas y el diagnóstico daría falsos positivos.
test('la línea larga que termina en ":" no cuenta como etiqueta', () => {
  const texto = 'El oferente que suscribe declara bajo juramento, para los efectos de esta licitación pública, que:';
  assert.equal(diag(texto, 0).totalSenales, 0);
});
