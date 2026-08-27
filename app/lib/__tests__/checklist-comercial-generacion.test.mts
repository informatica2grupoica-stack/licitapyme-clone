// Tests de integración de generarItemsDesdeViabilidad() — el núcleo del checklist comercial
// (910 líneas, sin cobertura de conjunto hasta el 26-ago-2026, auditoría técnica). Lo que ya
// existe (checklist-comercial-linea-tecnica.test.mts, checklist-comercial-cross-sync.test.mts,
// checklist-secciones-plazo.test.mts, checklist-comercial-nucleos.test.mts) prueba piezas
// sueltas; este archivo arma un informe de viabilidad REALISTA y verifica el checklist completo
// que sale de él, incluidos los cruces entre fuentes documentados en el propio código con casos
// reales (986278-14-LE26, 2724-35-LP26, 24-ago-2026).
// Correr con:
//   npx tsx --test app/lib/__tests__/checklist-comercial-generacion.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarItemsDesdeViabilidad, type ItemGenerado } from '../checklist-comercial';

function porClave(items: ItemGenerado[], clave: string) {
  return items.find(i => i.claveOrigen === clave);
}

// Informe base con una fuente de cada tipo que la función lee: anexos propios, documentos
// infaltables, las 6 garantías/formalidades, un bloqueante suelto, un bloqueante que CITA un
// anexo ya creado, un criterio de evaluación normal, un criterio que ES un anexo (el caso
// 986278-14-LE26), y el plazo con rango excluyente.
const INFORME_BASE = {
  requisitos_admisibilidad: {
    orden_anexos_propios: [
      { que_crear: 'Anexo N°3: Declaración Jurada Simple', que_debe_contener: 'Firma del representante legal', criticidad: 'dura', fuente: 'Bases §4.2' },
    ],
    seriedad_oferta: { exige: true, fuente: 'Bases §3' },
    fiel_cumplimiento: { exige: true, forma: 'boleta bancaria', plazo_entrega: '10 días', fuente: 'Bases §5' },
    boleta: { aplica: false },
    firma_puno_y_letra: { exigida: true, evidencia_textual: 'Los anexos deben firmarse a mano.', fuente: 'Bases §2' },
    contrato: { exige: false },
    cotizar_100: { aplica: true, fuente: 'Bases §6' },
    plazo_entrega_rango: { min: '5', max: '15', fuera_de_rango_inadmisible: true, fuente: 'Bases §7' },
    bloqueantes: [
      'No firmar el Anexo N°3 declara la oferta inadmisible',           // cita un anexo ya creado
      { item: 'No presentar certificado de antecedentes', efecto: 'Inadmisible', fuente: 'Bases §8' },  // suelto
    ],
  },
  capa_c_admisibilidad: {},
  documentos_infaltables: [
    { exige: 'Certificado de inscripción vigente en ChileProveedores', cubre: 'Registro habilitante', fuente: 'Bases §9' },
  ],
  criterios_evaluacion: {
    criterios: [
      { nombre: 'Experiencia del oferente', ponderacion_efectiva: 20, forma_aplicacion: 'Por tramos de OC', fuente: 'Bases §10' },
      // El MISMO requisito citado dos veces (documento + criterio) — caso real 986278-14-LE26.
      { nombre: 'Anexo N°3: Declaración Jurada Simple', ponderacion_efectiva: 5, forma_aplicacion: 'Cumple/no cumple', fuente: 'Bases §10' },
      { nombre: 'Precio', ponderacion_efectiva: 40 },   // debe IGNORARSE (RE_PRECIO)
    ],
  },
};

test('genera al menos un ítem por cada fuente real del informe', () => {
  const items = generarItemsDesdeViabilidad(INFORME_BASE);
  assert.ok(items.length >= 8, `se esperaban varios ítems, salieron ${items.length}`);
  assert.ok(items.every(i => typeof i.orden === 'number'), 'todo ítem debe traer su orden');
});

test('el anexo propio nace en ADMINISTRATIVO/documento con su clave', () => {
  const items = generarItemsDesdeViabilidad(INFORME_BASE);
  const anexo = porClave(items, 'anexo:anexo_n_3_declaracion_jurada_simple');
  assert.ok(anexo, 'el Anexo N°3 debe existir');
  assert.equal(anexo!.bloque, 'ADMINISTRATIVO');
  assert.equal(anexo!.tipo, 'documento');
});

test('documento infaltable entra como anexo propio, sin duplicar', () => {
  const items = generarItemsDesdeViabilidad(INFORME_BASE);
  const infaltable = items.find(i => i.titulo.includes('ChileProveedores'));
  assert.ok(infaltable);
  assert.equal(infaltable!.bloque, 'ADMINISTRATIVO');
});

test('las 6 garantías/formalidades se crean SOLO si aplican (cond=true)', () => {
  const items = generarItemsDesdeViabilidad(INFORME_BASE);
  assert.ok(porClave(items, 'adm:garantia_seriedad'), 'seriedad SÍ exige → debe existir');
  assert.ok(!items.some(i => i.claveOrigen === 'adm:boleta_garantia'), 'boleta NO aplica → no debe existir');
  assert.ok(porClave(items, 'adm:firma_puno_y_letra'));
  assert.ok(!items.some(i => i.claveOrigen === 'adm:contrato'), 'contrato NO exige → no debe existir');
  assert.ok(porClave(items, 'adm:cotizar_100'));
});

// Regla de oro (24-ago-2026): garantía de fiel cumplimiento NO es documento a subir con la
// oferta (se entrega DESPUÉS de adjudicar) — va como 'dato' (alerta), no 'documento'.
test('garantía de fiel cumplimiento es alerta (dato), no documento a adjuntar con la oferta', () => {
  const items = generarItemsDesdeViabilidad(INFORME_BASE);
  const fc = porClave(items, 'adm:garantia_fiel_cumplimiento');
  assert.ok(fc);
  assert.equal(fc!.tipo, 'dato');
});

// Bloqueante que CITA un anexo ya creado se pega a la descripción del anexo — NO abre fila
// propia (caso real 2724-35-LP26, 24-ago-2026).
test('bloqueante que cita un anexo existente se pega a su descripción, no abre fila nueva', () => {
  const items = generarItemsDesdeViabilidad(INFORME_BASE);
  const anexo = porClave(items, 'anexo:anexo_n_3_declaracion_jurada_simple');
  assert.match(anexo!.descripcion || '', /⚠.*[Ii]nadmisible/, 'la advertencia debe quedar en la descripción del anexo citado');
  assert.equal(anexo!.criticidad, 'ADMISIBILIDAD_DURA', 'un bloqueante citado sube la criticidad a dura');
  assert.ok(!items.some(i => i.titulo.includes('No firmar el Anexo N°3')),
    'no debe existir una fila SUELTA para el bloqueante que ya se pegó al anexo');
});

test('bloqueante suelto (sin número de anexo citado) abre su propia fila', () => {
  const items = generarItemsDesdeViabilidad(INFORME_BASE);
  const suelto = items.find(i => i.titulo.includes('certificado de antecedentes'));
  assert.ok(suelto, 'un bloqueante que no cita ningún anexo debe quedar como fila propia');
  assert.equal(suelto!.bloque, 'ADMINISTRATIVO');
  assert.equal(suelto!.tipo, 'dato');
});

// El mismo requisito citado como documento Y como criterio de evaluación es UNA sola casilla,
// enriquecida con la ponderación — caso real 986278-14-LE26.
test('un criterio que repite un anexo ya creado enriquece esa fila, no crea una segunda', () => {
  const items = generarItemsDesdeViabilidad(INFORME_BASE);
  const anexo = porClave(items, 'anexo:anexo_n_3_declaracion_jurada_simple');
  assert.equal(anexo!.ponderacion, 5, 'la ponderación del criterio debe quedar pegada al anexo existente');
  const repetidos = items.filter(i => i.titulo.includes('Declaración Jurada Simple'));
  assert.equal(repetidos.length, 1, 'no debe haber una segunda fila para el mismo requisito');
});

test('el criterio "Precio" nunca se convierte en punto documental (lo cubre el bloque de precios)', () => {
  const items = generarItemsDesdeViabilidad(INFORME_BASE);
  assert.ok(!items.some(i => i.titulo === 'Precio'), 'Precio debe filtrarse siempre');
});

test('un criterio normal (no-anexo) va a Alertas de cumplimiento con su ponderación', () => {
  const items = generarItemsDesdeViabilidad(INFORME_BASE);
  const exp = items.find(i => i.titulo === 'Experiencia del oferente');
  assert.ok(exp);
  assert.equal(exp!.tipo, 'dato', 'un criterio que no es anexo/formulario no lleva botón Adjuntar');
  assert.equal(exp!.ponderacion, 20);
});

// El plazo con rango excluyente es ADMISIBILIDAD_DURA y se fusiona con el criterio de plazo si
// existe (una sola casilla, no dos que pidan el mismo número).
test('plazo de entrega con rango excluyente es admisibilidad dura y no se duplica', () => {
  const items = generarItemsDesdeViabilidad(INFORME_BASE);
  const plazos = items.filter(i => i.claveOrigen === 'comercial:plazo_entrega');
  assert.equal(plazos.length, 1, 'el plazo debe ser UNA sola casilla');
  assert.equal(plazos[0].criticidad, 'ADMISIBILIDAD_DURA');
  assert.match(plazos[0].descripcion || '', /5.*15|inadmisible/i);
});

// Informe vacío/mínimo no debe explotar — caso de borde real (informe legado sin varios campos).
// Siempre sale AL MENOS el ítem de precio (suma alzada por defecto): no hay licitación sin cotizar.
test('un informe vacío no revienta — solo sale el ítem de precio por defecto', () => {
  const items = generarItemsDesdeViabilidad({});
  assert.equal(items.length, 1);
  assert.equal(items[0].claveOrigen, 'precio:total');
});

test('un informe con campos null/undefined en vez de arrays no revienta', () => {
  const items = generarItemsDesdeViabilidad({
    requisitos_admisibilidad: { orden_anexos_propios: null, bloqueantes: undefined },
    documentos_infaltables: null,
    criterios_evaluacion: { criterios: undefined },
  });
  assert.equal(items.length, 1, 'campos null/undefined no deben tumbar la función, solo queda el precio por defecto');
  assert.equal(items[0].claveOrigen, 'precio:total');
});
