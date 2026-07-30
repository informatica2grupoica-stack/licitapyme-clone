// Regresión del matching checklist↔archivo (Frente E.1 ↔ Auditor Técnico, 30-jul-2026). Correr con:
//   npx tsx --test app/lib/__tests__/anexos-match.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puntajeCoincidencia, ordenarPorCoincidencia, repartirArchivosGenerados } from '../anexos-match';

test('el número de anexo matchea aunque el resto del texto no se parezca en nada', () => {
  const p = puntajeCoincidencia('Anexo N°2-A - Declaración jurada simple (inhabilidades)', 'ANEXO_N2A_FORMULARIOS_OBLIGATORIOS.docx');
  assert.ok(p >= 100, `esperaba puntaje alto por número compartido, dio ${p}`);
});

test('sin número compartido, dos títulos completamente distintos no matchean', () => {
  const p = puntajeCoincidencia('Anexo N°6 - Programa de integridad', 'GARANTIA_SERIEDAD_OFERTA.pdf');
  assert.equal(p, 0);
});

test('ordenarPorCoincidencia deja primero al candidato con el número correcto', () => {
  const candidatos = [
    { id: 1, nombre: 'ANEXO_N1_FICHA_OFERENTE.docx' },
    { id: 2, nombre: 'ANEXO_N2A_DECLARACION_JURADA.docx' },
    { id: 3, nombre: 'FORMULARIOS_OBLIGATORIOS.doc' }, // bundle sin número propio, no debe ganarle al match exacto
  ];
  const ranking = ordenarPorCoincidencia('Anexo N°2-A - Declaración jurada simple (inhabilidades)', candidatos);
  assert.equal(ranking[0].id, 2);
  assert.ok(ranking[0].puntaje > ranking[1].puntaje);
});

test('repartirArchivosGenerados manda cada formulario dividido a SU punto, no todos al que abrió el modal', () => {
  const items = [
    { id: 10, titulo: 'Anexo N°1 - Ficha del Oferente' },
    { id: 11, titulo: 'Anexo N°2-A - Declaración jurada simple' },
    { id: 12, titulo: 'Anexo N°2-B - Declaración jurada simple (inhabilidades)' },
  ];
  const archivos = [
    { nombre: 'ANEXO_N1_FORMULARIOS_OBLIGATORIOS.docx', url: 'https://r2/1' },
    { nombre: 'ANEXO_N2A_FORMULARIOS_OBLIGATORIOS.docx', url: 'https://r2/2' },
    { nombre: 'ANEXO_N2B_FORMULARIOS_OBLIGATORIOS.docx', url: 'https://r2/3' },
  ];
  // El asistente hizo clic en "Generar" desde el ítem 11 (N°2-A), pero el documento fuente traía
  // los tres formularios pegados — los tres deben repartirse a SU propio punto.
  const reparto = repartirArchivosGenerados(archivos, items, 11);
  assert.deepEqual(reparto.get(10)?.map(a => a.nombre), ['ANEXO_N1_FORMULARIOS_OBLIGATORIOS.docx']);
  assert.deepEqual(reparto.get(11)?.map(a => a.nombre), ['ANEXO_N2A_FORMULARIOS_OBLIGATORIOS.docx']);
  assert.deepEqual(reparto.get(12)?.map(a => a.nombre), ['ANEXO_N2B_FORMULARIOS_OBLIGATORIOS.docx']);
});

test('un archivo sin número reconocible cae en el ítem de origen, nunca se pierde', () => {
  const items = [
    { id: 10, titulo: 'Anexo N°1 - Ficha del Oferente' },
    { id: 11, titulo: 'Anexo N°2-A - Declaración jurada simple' },
  ];
  const archivos = [{ nombre: 'ANEXO_documento_generico.docx', url: 'https://r2/1' }];
  const reparto = repartirArchivosGenerados(archivos, items, 11);
  assert.deepEqual(reparto.get(11)?.map(a => a.nombre), ['ANEXO_documento_generico.docx']);
  assert.equal(reparto.get(10), undefined);
});
