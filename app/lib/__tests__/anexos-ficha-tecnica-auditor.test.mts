// Ficha de especificaciones del anexo técnico desde el Auditor nuevo (opción aprobada + comparador).
// Caso real: 1057922-28-LP26, «FORMULARIO N°2 ESPECIFICACIONES TÉCNICAS <EQUIPO>».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolverFichaTecnicaConAuditor, fichaDelDocumento, type DatosAuditorAnexo } from '../anexos-auditor-fuente';

const datos = (aprobada: boolean): DatosAuditorAnexo => ({
  lineasTecnicas: [], itemsComerciales: [],
  fichas: [{
    lineaNumero: 1, producto: 'Camilla de Transporte',
    opcion: aprobada ? { marca: 'Yongxin Med', modelo: 'YXZ-E-4L', fabricante: null, pais: null, anio: null, documento: 'Data sheet YXZ-E-4L.pdf' } : null,
    requisitos: aprobada ? [
      { texto: 'Capacidad de carga: al menos 200 [kg]', estado: 'CUMPLE', ofertado: '310 kg', cita: 'Safety Load 310 kg' },
      { texto: 'Ancho total: 75 [cm] ±5 [cm]', estado: 'NO_CUMPLE', ofertado: '850 mm', cita: 'Width Overall 850 mm' },
      { texto: 'Rudas direccionables o quinta rueda retráctil para direccionamiento', estado: 'FALTA_DATO', ofertado: '', cita: '' },
    ] : [],
    motivo: aprobada ? null : 'Línea 1 (Camilla de Transporte): 2 opción(es) en el Auditor, ninguna aprobada todavía.',
  }],
});
const TITULO = ['FORMULARIO N°2 ESPECIFICACIONES TÉCNICAS CAMILLA DE TRANSPORTE'];
const ETQ = [
  'Marca', 'Modelo', 'Fabricante', 'País/Año de Fabricación',
  'Capacidad de carga: al menos 200 [kg] — CUMPLE SI/NO',
  'Capacidad de carga: al menos 200 [kg] — CATÁLOGO/ PÁGINA PROVEEDOR/ DATASHEET',
  'Capacidad de carga: al menos 200 [kg] — OBSERVACIONES',
  'Ancho total: 75 [cm] ±5 [cm] — CUMPLE SI/NO',
  'Rudas direccionables o quinta rueda retráctil para direccionamiento — CUMPLE SI/NO',
];

test('con opción aprobada: marca, modelo y lo que CUMPLE se copia; NO cumple y falta dato quedan con motivo', () => {
  const { matches, motivos } = resolverFichaTecnicaConAuditor(ETQ, datos(true), TITULO);
  const v = Object.fromEntries(matches.map(m => [m.etiqueta, m.valor]));
  assert.equal(v['Marca'], 'Yongxin Med');
  assert.equal(v['Modelo'], 'YXZ-E-4L');
  assert.equal(v['Capacidad de carga: al menos 200 [kg] — CUMPLE SI/NO'], 'SI');
  assert.equal(v['Capacidad de carga: al menos 200 [kg] — CATÁLOGO/ PÁGINA PROVEEDOR/ DATASHEET'], 'Data sheet YXZ-E-4L.pdf');
  assert.equal(v['Capacidad de carga: al menos 200 [kg] — OBSERVACIONES'], '310 kg');
  // Nunca se escribe «NO» en un obligatorio: queda para el equipo, con el porqué.
  assert.equal(v['Ancho total: 75 [cm] ±5 [cm] — CUMPLE SI/NO'], undefined);
  assert.match(motivos.get('Ancho total: 75 [cm] ±5 [cm] — CUMPLE SI/NO')!, /NO cumple/);
  assert.match(motivos.get('Rudas direccionables o quinta rueda retráctil para direccionamiento — CUMPLE SI/NO')!, /no trae este dato/);
  assert.equal(v['Fabricante'], undefined);
  assert.equal(v['País/Año de Fabricación'], undefined);
});

test('sin opción aprobada no se escribe nada y cada casilla dice por qué', () => {
  const { matches, motivos } = resolverFichaTecnicaConAuditor(ETQ, datos(false), TITULO);
  assert.equal(matches.length, 0);
  assert.match(motivos.get('Marca')!, /ninguna aprobada/);
});

test('el formulario de OTRO equipo no recibe los datos de la única línea del Auditor', () => {
  assert.equal(fichaDelDocumento(['FORMULARIO N°2 ESPECIFICACIONES TÉCNICAS TENSIÓMETRO RODABLE'], datos(true)), null);
  const { matches, motivos } = resolverFichaTecnicaConAuditor(ETQ, datos(true), ['FORMULARIO N°2 ESPECIFICACIONES TÉCNICAS TENSIÓMETRO RODABLE']);
  assert.equal(matches.length, 0);
  assert.match(motivos.get('Marca')!, /no está entre las líneas que se ofertan/);
});

test('un documento sin columna «CUMPLE» no es una ficha técnica: su «País» o «Marca» no se tocan', () => {
  const { matches, motivos } = resolverFichaTecnicaConAuditor(['Marca', 'País'], datos(true), TITULO);
  assert.equal(matches.length + motivos.size, 0);
});

// 4844-24-LE26, ANEXO N°5: «PLAZO DE ENTREGA DE LOS PRODUCTOS: ______ días hábiles…» — el papel
// ya imprime la unidad; con el valor del Auditor entero salía «1 día habil días hábiles».
test('plazo en raya con la unidad impresa: va solo el número', async () => {
  const { plazoSinUnidadImpresa } = await import('../anexos-auditor-fuente');
  assert.equal(plazoSinUnidadImpresa('1 día habil', ' días hábiles a contar de la aceptación'), '1');
  assert.equal(plazoSinUnidadImpresa('10 días hábiles', ' DIAS HABILES'), '10');
  assert.equal(plazoSinUnidadImpresa('5', ' días corridos'), '5');
  assert.equal(plazoSinUnidadImpresa('5 días corridos', ' días hábiles'), null, 'corridos ≠ hábiles: no se convierte');
  assert.equal(plazoSinUnidadImpresa('1 día habil', ' a contar de la orden'), '1 día habil', 'sin unidad impresa, va completo');
  assert.equal(plazoSinUnidadImpresa('Inmediato', ' días hábiles'), 'Inmediato');
});
