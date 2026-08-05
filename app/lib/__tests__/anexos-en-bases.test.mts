// Regresión del detector "los anexos vienen dentro del PDF de bases" (ago-2026). Correr con:
//   npx tsx --test app/lib/__tests__/anexos-en-bases.test.mts
//
// Todos los fragmentos de acá salen de documentos REALES ya cacheados: 1114-12-LE26 (el caso que
// lo motivó), 3095-8-LE26 y 1537592-4-LE26 (traen un índice de formularios ANTES de los
// formularios de verdad) y 2928-14-LR26 (menciones en prosa que el salto de línea del PDF parte
// por la mitad y parecían encabezados).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectarAnexosEnBases } from '../anexos-en-bases';

// Relleno para que el detector vea un documento de verdad: los anexos van SIEMPRE al final, así
// que hace falta cuerpo antes para que la tanda caiga en el último tramo.
const cuerpoBases = (n: number) => Array.from({ length: n }, (_, i) =>
  `[[PÁGINA ${i + 1}]]\nArtículo ${i + 1}. Las presentes bases regulan la licitación y sus Anexos.\n`).join('');

test('1114-12-LE26: reconoce la tanda de anexos y en qué página empieza cada uno', () => {
  const texto = cuerpoBases(33)
    + '[[PÁGINA 34]]\nANEXOS\nANEXO Nº 1\nDECLARACIÓN JURADA SIMPLE (ARTÍCULO 4° LEY N° 19.886)\n'
    + 'En [ciudad/país], a [fecha] de 2025, RUT: _________ - __, declara bajo juramento:\n'
    + '[[PÁGINA 35]]\nANEXO N° 2-A\nIDENTIFICACIÓN DEL OFERENTE PERSONA NATURAL\nNombre:\nRUT:\n'
    + 'ANEXO N° 2-B\nIDENTIFICACIÓN DEL OFERENTE PERSONA JURÍDICA\n'
    + '[[PÁGINA 41]]\nANEXO 6\nANEXO TRÁMITE DIGITAL DCyF\n';

  const d = detectarAnexosEnBases(texto);
  assert.equal(d.hay, true);
  assert.equal(d.paginaInicio, 34);
  const titulos = d.anexos.map(a => a.titulo);
  assert.deepEqual(titulos, ['ANEXO Nº 1', 'ANEXO N° 2-A', 'ANEXO N° 2-B', 'ANEXO 6', 'ANEXO TRÁMITE DIGITAL DCyF']);
  // La página tiene que ser la del anexo, no la del documento: es lo único que evita mandar al
  // usuario a hojear 47 páginas.
  assert.equal(d.anexos.find(a => a.titulo === 'ANEXO N° 2-B')?.pagina, 35);
  assert.equal(d.anexos.find(a => a.titulo === 'ANEXO 6')?.pagina, 41);
  // "ANEXO TRÁMITE DIGITAL DCyF" no trae número y la sigla lleva minúsculas: igual es un anexo.
  assert.equal(d.anexos.find(a => a.titulo === 'ANEXO TRÁMITE DIGITAL DCyF')?.pagina, 41);
});

test('menciones en prosa NO son anexos, aunque el PDF las corte en una línea propia', () => {
  const texto = cuerpoBases(19)
    + '[[PÁGINA 20]]\nEl oferente deberá acompañar lo indicado en el\nAnexo N° 6, al cual\n'
    + 'se hace referencia en el punto anterior.\n'
    + '[[PÁGINA 21]]\nDeberá completarse el\nAnexo N°7 (opción\nque elija el proponente).\n';
  // Reales, 2928-14-LR26: eran los dos únicos "anexos" que se detectaban ahí, y los dos eran falsos.
  assert.equal(detectarAnexosEnBases(texto).hay, false);
});

test('el ÍNDICE de formularios no reemplaza a los formularios reales', () => {
  const texto = cuerpoBases(11)
    + '[[PÁGINA 12]]\nFORMULARIOS DE ANTECEDENTES\n'
    + 'Formulario N°1: "Identificación completa del Oferente"\n'
    + 'Formulario N°2: "Declaración jurada"\n'
    + '[[PÁGINA 13]]\nFORMULARIO Nº 1\nIDENTIFICACIÓN DEL OFERENTE\nNombre:\nRUT:\n'
    + '[[PÁGINA 14]]\nFORMULARIO Nº 2\nDECLARACIÓN JURADA\n';

  const d = detectarAnexosEnBases(texto);
  const porTitulo = new Map(d.anexos.map(a => [a.titulo, a.pagina]));
  // Las líneas del índice traen el título en minúsculas después del número: no son encabezados.
  assert.ok(!porTitulo.has('Formulario N°1: "Identificación completa del Oferente"'), JSON.stringify([...porTitulo]));
  // Y el formulario de verdad manda con SU página (13), no con la del índice (12).
  assert.equal(porTitulo.get('FORMULARIO Nº 1'), 13);
  assert.equal(porTitulo.get('FORMULARIO Nº 2'), 14);
});

test('un solo anexo suelto no es una tanda, y las bases normales no disparan nada', () => {
  // Una licitación que publica sus anexos aparte solo los MENCIONA en el cuerpo.
  const normales = cuerpoBases(30) + 'Los oferentes deberán presentar el Anexo N° 1 firmado.\n';
  assert.equal(detectarAnexosEnBases(normales).hay, false);
  // Con un único encabezado tampoco: puede ser una referencia cualquiera.
  assert.equal(detectarAnexosEnBases(cuerpoBases(20) + '[[PÁGINA 21]]\nANEXO N° 1\nDECLARACIÓN\n').hay, false);
  // Y un texto vacío o mínimo nunca revienta.
  assert.equal(detectarAnexosEnBases('').hay, false);
  assert.equal(detectarAnexosEnBases('ANEXO N° 1\nANEXO N° 2\n').hay, false);
});
