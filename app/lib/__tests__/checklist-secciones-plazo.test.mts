// Qué fila va ARRIBA (bloque) y cuál ABAJO (alertas de cumplimiento), y el cruce del plazo
// ofertado contra el rango de las bases. Caso fuente: 2724-35-LP26 (24-ago-2026) — anexos y
// garantías mezclados, bloqueantes que citaban los Anexos N°3 y N°7 apareciendo abajo como si
// fueran anexos, el plazo lejos del precio, y 31 días cargados y aprobados con tope de 30.
//   npx tsx --test app/lib/__tests__/checklist-secciones-plazo.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generarItemsDesdeViabilidad, nucleosCoinciden, nucleoDeTitulo,
  rangoPlazoDeDescripcion, validarPlazoOfertado, diasDeTexto, CLAVE_ITEM_PLAZO,
} from '../checklist-comercial';

const INFORME = {
  modalidad: { tipo: 'suma_alzada' },
  requisitos_admisibilidad: {
    orden_anexos_propios: [
      { que_crear: 'Anexo N°3: Oferta Técnica', criticidad: 'ADMISIBILIDAD_DURA' },
      { que_crear: 'Anexo N°7: Carta del fabricante', criticidad: 'ADMISIBILIDAD_DURA' },
    ],
    fiel_cumplimiento: { exige: true, forma: 'poliza' },
    boleta: { aplica: true, detalle: '5% del precio final neto ofertado' },
    cotizar_100: { aplica: true },
    plazo_entrega_rango: { min: '1 día hábil', max: '30 días hábiles', fuera_de_rango_inadmisible: true },
    bloqueantes: [
      { item: 'Anexo N°7 Carta del fabricante firmada por oferente y representante.', efecto: 'Oferta inadmisible' },
      { item: 'No presentar el certificado de vigencia societaria', efecto: 'Oferta inadmisible' },
    ],
  },
  criterios_evaluacion: {
    criterios: [
      { nombre: 'Cumplimiento de requisitos formales', ponderacion: 5 },
      { nombre: 'Programa de integridad', ponderacion: 5 },
      { nombre: 'Plazo de entrega', ponderacion: 10 },
      { nombre: 'Anexo N°9: Experiencia del oferente', ponderacion: 15 },
    ],
  },
};

const items = generarItemsDesdeViabilidad(INFORME);
const porTitulo = (t: string) => items.find(i => i.titulo.startsWith(t));

test('los anexos quedan arriba, en administrativo y como documento a subir', () => {
  for (const t of ['Anexo N°3', 'Anexo N°7', 'Anexo N°9']) {
    const it = porTitulo(t);
    assert.ok(it, `falta ${t}`);
    assert.equal(it!.bloque, 'ADMINISTRATIVO', t);
    assert.equal(it!.tipo, 'documento', t);
  }
});

test('garantías y criterios sin documento propio bajan a alertas (tipo dato)', () => {
  for (const t of ['Garantía de fiel cumplimiento', 'Boleta de garantía', 'Cotizar el 100%',
                   'Cumplimiento de requisitos formales', 'Programa de integridad']) {
    assert.equal(porTitulo(t)?.tipo, 'dato', t);
  }
});

test('un bloqueante que cita un anexo existente se pega a ese anexo, no abre fila propia', () => {
  const sueltos = items.filter(i => i.claveOrigen.startsWith('bloqueante:'));
  assert.equal(sueltos.length, 1);                                  // solo el que no cita anexo
  assert.match(sueltos[0].titulo, /vigencia societaria/);
  assert.match(porTitulo('Anexo N°7')!.descripcion || '', /Carta del fabricante firmada/);
});

test('el plazo se compromete en el bloque comercial, junto al precio', () => {
  const plazo = items.find(i => i.claveOrigen === CLAVE_ITEM_PLAZO);
  assert.equal(plazo?.bloque, 'COMERCIAL');
  assert.equal(plazo?.criticidad, 'ADMISIBILIDAD_DURA');
  assert.match(plazo!.descripcion || '', /Rango admisible/);
});

test('el rango se lee de vuelta desde la descripción del ítem', () => {
  const r = rangoPlazoDeDescripcion(items.find(i => i.claveOrigen === CLAVE_ITEM_PLAZO)!.descripcion);
  assert.deepEqual(r, { min: 1, max: 30, inadmisibleFuera: true });
});

test('sobre el máximo es error; bajo el mínimo solo aviso; dentro no molesta', () => {
  const r = { min: 5, max: 30, inadmisibleFuera: true };
  assert.equal(validarPlazoOfertado('31 dias habiles', r).nivel, 'error');
  assert.equal(validarPlazoOfertado('30 días hábiles', r).nivel, 'ok');
  assert.equal(validarPlazoOfertado('3 días', r).nivel, 'aviso');
  assert.equal(validarPlazoOfertado('31 días', { ...r, inadmisibleFuera: false }).nivel, 'aviso');
  assert.equal(validarPlazoOfertado('sin número', r).nivel, 'ok');
  assert.equal(validarPlazoOfertado('31 días', null).nivel, 'ok');
  assert.equal(diasDeTexto('31 dias habiles'), 31);
});

test('la garantía con coletilla es la misma que la garantía a secas (dedupe por prefijo)', () => {
  assert.ok(nucleosCoinciden(
    nucleoDeTitulo('Garantía de fiel cumplimiento'),
    nucleoDeTitulo('Garantía de fiel cumplimiento de contrato (Póliza/Certificado de fianza).'),
  ));
  // …pero dos garantías distintas siguen separadas
  assert.equal(nucleosCoinciden(
    nucleoDeTitulo('Garantía de seriedad de la oferta'),
    nucleoDeTitulo('Garantía de fiel cumplimiento'),
  ), false);
});

test('las filas ya guardadas con la clasificación vieja se reubican (y solo esas)', async () => {
  const { reubicacionDeItemGuardado } = await import('../checklist-comercial');
  assert.deepEqual(
    reubicacionDeItemGuardado({ clave_origen: 'adm:boleta_garantia', titulo: 'Boleta de garantía', bloque: 'ADMINISTRATIVO', tipo: 'documento' }),
    { bloque: 'ADMINISTRATIVO', tipo: 'dato' });
  assert.deepEqual(
    reubicacionDeItemGuardado({ clave_origen: 'criterio:mantenciones_preventivas', titulo: 'Mantenciones preventivas', bloque: 'TECNICO', tipo: 'documento' }),
    { bloque: 'TECNICO', tipo: 'dato' });
  assert.deepEqual(
    reubicacionDeItemGuardado({ clave_origen: 'criterio:anexo_n9_experiencia', titulo: 'Anexo N°9: Experiencia', bloque: 'TECNICO', tipo: 'documento' }),
    { bloque: 'ADMINISTRATIVO', tipo: 'documento' });
  // Ya está donde corresponde → no se toca. Un anexo normal → jamás se toca.
  assert.equal(reubicacionDeItemGuardado({ clave_origen: CLAVE_ITEM_PLAZO, titulo: 'Plazo de entrega', bloque: 'COMERCIAL', tipo: 'dato' }), null);
  assert.equal(reubicacionDeItemGuardado({ clave_origen: 'anexo:anexo_n1', titulo: 'Anexo N°1', bloque: 'ADMINISTRATIVO', tipo: 'documento' }), null);
});

// 25-ago-2026 (3489-29-LP26 y otras): el informe lista como "anexo propio" o "documento
// infaltable" cosas que NO son un anexo de las bases —programa de integridad, certificado de
// Tesorería y F30, documentación de experiencia—. Arriba van SOLO anexos y formularios.
test('lo que no nombra un anexo baja a alertas aunque venga como anexo propio o infaltable', () => {
  const items = generarItemsDesdeViabilidad({
    modalidad: { tipo: 'suma_alzada' },
    requisitos_admisibilidad: {
      orden_anexos_propios: [
        { que_crear: 'Anexo N°2: Declaración jurada' },
        { que_crear: 'Formulario de datos del oferente' },          // sin número, pero es formulario
        { que_crear: 'Programa de Integridad y Ética Empresarial' },
        { que_crear: 'Documentación de experiencia (órdenes de compra, facturas)' },
      ],
    },
    documentos_infaltables: [
      { exige: 'Certificado de Tesorería y F30 (solo si adjudica L1-L2)' },
    ],
  });
  const tipoDe = (t: string) => items.find(i => i.titulo.startsWith(t))?.tipo;
  assert.equal(tipoDe('Anexo N°2'), 'documento');
  assert.equal(tipoDe('Formulario de datos'), 'documento');
  assert.equal(tipoDe('Programa de Integridad'), 'dato');
  assert.equal(tipoDe('Documentación de experiencia'), 'dato');
  assert.equal(tipoDe('Certificado de Tesorería'), 'dato');
  // Todos siguen en el bloque administrativo: lo que cambia es la sección donde se muestran.
  assert.ok(items.every(i => i.bloque !== 'ADMINISTRATIVO' || i.titulo.length > 0));
});

test('reubicación: un "anexo:" guardado que no nombra ningún anexo baja a alertas', async () => {
  const { reubicacionDeItemGuardado } = await import('../checklist-comercial');
  assert.deepEqual(
    reubicacionDeItemGuardado({ clave_origen: 'anexo:programa_de_integridad', titulo: 'Programa de Integridad y Ética Empresarial', bloque: 'ADMINISTRATIVO', tipo: 'documento' }),
    { bloque: 'ADMINISTRATIVO', tipo: 'dato' });
  assert.equal(
    reubicacionDeItemGuardado({ clave_origen: 'anexo:anexo_n2', titulo: 'Anexo N°2: Declaración jurada', bloque: 'ADMINISTRATIVO', tipo: 'documento' }), null);
});
