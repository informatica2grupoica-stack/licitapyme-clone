// Tests de la extensión del bloque TECNICO por línea (Auditor Técnico, Fase 1) en
// generarItemsDesdeViabilidad(). Correr con:
//   npx tsx --test app/lib/__tests__/checklist-comercial-linea-tecnica.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarItemsDesdeViabilidad } from '../checklist-comercial';

test('generarItemsDesdeViabilidad: genera cabecera linea_tecnica por cada línea con caracteristicas', () => {
  const informe = {
    modalidad: { tipo: 'suma_alzada' },
    productos: { items: [
      { linea: 1, nombre: 'Barredora vial', clasificacion: 'especifico', admite_equivalente: false, caracteristicas: ['Capacidad 500 lts', 'Peso máximo 600 kg'] },
      { linea: 2, nombre: 'Hidrolavadora', clasificacion: 'generico', admite_equivalente: true, caracteristicas: ['Presión mínima 2000 PSI'] },
    ] },
  };
  const items = generarItemsDesdeViabilidad(informe);
  const tecnicas = items.filter(i => i.tipo === 'linea_tecnica');
  assert.equal(tecnicas.length, 2, 'una cabecera por línea con caracteristicas');
  assert.equal(tecnicas[0].claveOrigen, 'tecnico:linea:1');
  assert.equal(tecnicas[0].lineaNumero, 1);
  assert.equal(tecnicas[1].claveOrigen, 'tecnico:linea:2');
});

test('generarItemsDesdeViabilidad: la cabecera linea_tecnica se genera SIEMPRE, independiente de modalidad.tipo (suma_alzada)', () => {
  // A diferencia del bloque COMERCIAL (que solo genera precio-por-línea si es por_linea), la
  // auditoría técnica no depende de cómo se factura: en suma alzada puede haber igual varios
  // productos con especificaciones distintas dentro del mismo total.
  const informe = {
    modalidad: { tipo: 'suma_alzada' },
    productos: { items: [{ linea: 1, nombre: 'Producto A', caracteristicas: ['Voltaje 220V'] }] },
  };
  const items = generarItemsDesdeViabilidad(informe);
  assert.ok(items.some(i => i.tipo === 'linea_tecnica' && i.claveOrigen === 'tecnico:linea:1'));
  // Y el bloque COMERCIAL, en suma_alzada, sigue siendo UN solo precio total (no por línea).
  const comercialPrecio = items.filter(i => i.bloque === 'COMERCIAL' && i.tipo === 'precio');
  assert.equal(comercialPrecio.length, 1);
  assert.equal(comercialPrecio[0].claveOrigen, 'precio:total');
});

test('generarItemsDesdeViabilidad: criticidad ADMISIBILIDAD_DURA si especifico + sin equivalente; PUNTAJE_CONDICIONANTE si no', () => {
  const informe = {
    modalidad: { tipo: 'por_linea' },
    productos: { items: [
      { linea: 1, nombre: 'Marca exclusiva', clasificacion: 'especifico', admite_equivalente: false, caracteristicas: ['x'] },
      { linea: 2, nombre: 'Genérico', clasificacion: 'generico', admite_equivalente: true, caracteristicas: ['y'] },
    ] },
  };
  const items = generarItemsDesdeViabilidad(informe);
  const l1 = items.find(i => i.claveOrigen === 'tecnico:linea:1')!;
  const l2 = items.find(i => i.claveOrigen === 'tecnico:linea:2')!;
  assert.equal(l1.criticidad, 'ADMISIBILIDAD_DURA');
  assert.equal(l2.criticidad, 'PUNTAJE_CONDICIONANTE');
});

test('generarItemsDesdeViabilidad: sin caracteristicas[] en una línea, no genera cabecera linea_tecnica para ella', () => {
  const informe = {
    modalidad: { tipo: 'suma_alzada' },
    productos: { items: [{ linea: 1, nombre: 'Sin specs', caracteristicas: [] }] },
  };
  const items = generarItemsDesdeViabilidad(informe);
  assert.equal(items.filter(i => i.tipo === 'linea_tecnica').length, 0);
});

test('generarItemsDesdeViabilidad: sin informe.productos, no revienta y no genera líneas técnicas', () => {
  const informe = { modalidad: { tipo: 'suma_alzada' } };
  const items = generarItemsDesdeViabilidad(informe);
  assert.equal(items.filter(i => i.tipo === 'linea_tecnica').length, 0);
});

// Caso real reportado 24-ago-2026: el bloque ADMINISTRATIVO traía cada Formato duplicado —
// orden_anexos_propios (v3) y documentos_infaltables (v2.1, campo legado) describen el MISMO
// requisito con la redacción invertida ("Formato N°1: X" vs "X (Formato N°1)"), y las garantías
// estructuradas (fiel_cumplimiento.exige) nunca se comparaban contra lo ya generado.
test('generarItemsDesdeViabilidad: no duplica un Formato N°X que viene por dos fuentes con redacción distinta', () => {
  const informe = {
    modalidad: { tipo: 'suma_alzada' },
    requisitos_admisibilidad: {
      fiel_cumplimiento: { exige: true, forma: 'boleta', fuente: 'bases' },
      orden_anexos_propios: [
        { que_crear: 'Formato N°1: Formulario de Identificación del Oferente', fuente: 'bases' },
        { que_crear: 'Garantía de Fiel Cumplimiento', fuente: 'bases' },
      ],
    },
    // Campo legado (v2.1): mismo Formato N°1, redactado al revés.
    documentos_infaltables: [
      { exige: 'Formulario de Identificación del Oferente (Formato N°1)', fuente: 'bases' },
    ],
  };
  const items = generarItemsDesdeViabilidad(informe);
  const admin = items.filter(i => i.bloque === 'ADMINISTRATIVO');
  const formato1 = admin.filter(i => /formato\s*n?[°ºo]?\s*1\b/i.test(i.titulo));
  const garantia = admin.filter(i => /garant[ií]a de fiel cumplimiento/i.test(i.titulo));
  assert.equal(formato1.length, 1, `Formato N°1 no debería duplicarse (salieron: ${formato1.map(i => i.titulo).join(' | ')})`);
  assert.equal(garantia.length, 1, `Garantía de Fiel Cumplimiento no debería duplicarse (salieron: ${garantia.map(i => i.titulo).join(' | ')})`);
});

// Encontrado al hacer el dry-run de limpieza (24-ago-2026): cuando el título es SOLO "Anexo N°X"
// (sin texto propio), quitarle la anotación de número deja un string vacío — y el slug() genérico
// convierte ESO en el literal 'sin_nombre', así que "Anexo N°1"/"Anexo N°2"/"Anexo N°3" quedaban
// con el MISMO núcleo y se fusionaban entre sí pese a ser anexos distintos.
test('generarItemsDesdeViabilidad: "Anexo N°1", "Anexo N°2", "Anexo N°3" (sin texto propio) NO se fusionan entre sí', () => {
  const informe = {
    modalidad: { tipo: 'suma_alzada' },
    requisitos_admisibilidad: {
      orden_anexos_propios: [
        { que_crear: 'Anexo N°1', fuente: 'bases' },
        { que_crear: 'Anexo N°2', fuente: 'bases' },
        { que_crear: 'Anexo N°3', fuente: 'bases' },
      ],
    },
  };
  const items = generarItemsDesdeViabilidad(informe);
  const admin = items.filter(i => i.bloque === 'ADMINISTRATIVO');
  assert.equal(admin.length, 3, `deberían quedar 3 anexos distintos (salieron: ${admin.map(i => i.titulo).join(' | ')})`);
});

// Un "bloqueante" (advertencia/riesgo) puede CITAR el número de un anexo como contexto sin SER
// ese anexo ("No firmar Anexo N°8" no es el Anexo N°8, es la advertencia de qué pasa si falta).
// El dedupe por N° de formato no debe fusionarlos con el documento real, o se pierde la advertencia.
test('generarItemsDesdeViabilidad: un bloqueante que cita "Anexo N°8" no se fusiona con el Anexo N°8 real', () => {
  const informe = {
    modalidad: { tipo: 'suma_alzada' },
    requisitos_admisibilidad: {
      orden_anexos_propios: [
        { que_crear: 'Anexo N°8 - Declaración Aceptación Bases Técnicas', fuente: 'bases' },
      ],
      bloqueantes: ['No firmar Anexo N°8 deja la oferta inadmisible'],
    },
  };
  const items = generarItemsDesdeViabilidad(informe);
  const admin = items.filter(i => i.bloque === 'ADMINISTRATIVO');
  assert.equal(admin.length, 2, `el documento y la advertencia son dos ítems distintos (salieron: ${admin.map(i => i.titulo).join(' | ')})`);
});

// Encontrado en el dry-run de limpieza (24-ago-2026, caso real 608-145-LP26): un regex que solo
// capturaba el dígito base ("6") fundía "Anexo N°6.1" a "N°6.7" en un solo ítem, pese a ser 7
// especificaciones técnicas de 7 equipos médicos distintos (escáner, audímetro, monitores...).
test('generarItemsDesdeViabilidad: "Anexo N°6.1" a "N°6.7" (sub-índices) NO se fusionan entre sí', () => {
  const equipos = ['Escáner Intraoral', 'Audímetro', 'Monitores', 'Refrigeradores', 'Lámpara', 'Balanzas', 'Cuna Neonatal'];
  const informe = {
    modalidad: { tipo: 'suma_alzada' },
    requisitos_admisibilidad: {
      orden_anexos_propios: equipos.map((eq, i) => ({ que_crear: `Anexo N°6.${i + 1}: Especificaciones Técnicas (${eq})`, fuente: 'bases' })),
    },
  };
  const items = generarItemsDesdeViabilidad(informe);
  const admin = items.filter(i => i.bloque === 'ADMINISTRATIVO');
  assert.equal(admin.length, 7, `deberían quedar 7 anexos distintos (salieron: ${admin.map(i => i.titulo).join(' | ')})`);
});

// Caso real 759-21-LE26: dos anexos con la MISMA descripción genérica pero número EXPLÍCITO
// distinto no son el mismo documento — el número, cuando ambos lo citan, manda por sobre el
// parecido del texto.
test('generarItemsDesdeViabilidad: mismo texto pero N° explícito distinto NO se fusiona', () => {
  const informe = {
    modalidad: { tipo: 'suma_alzada' },
    requisitos_admisibilidad: {
      orden_anexos_propios: [
        { que_crear: 'Anexo N°2 (Declaración Jurada Simple UTP)', fuente: 'bases' },
        { que_crear: 'Anexo N°3 (Declaración Jurada Simple UTP)', fuente: 'bases' },
      ],
    },
  };
  const items = generarItemsDesdeViabilidad(informe);
  const admin = items.filter(i => i.bloque === 'ADMINISTRATIVO');
  assert.equal(admin.length, 2, `Anexo N°2 y N°3 son documentos distintos (salieron: ${admin.map(i => i.titulo).join(' | ')})`);
});

// Casos reales (803, 875): "Formulario N°1" y "Anexo N°1" comparten el número pero suelen ser
// series de numeración INDEPENDIENTES en las bases chilenas — acá describen temas distintos
// (identificación del oferente vs. programa de integridad) y no deben fusionarse solo por el "1".
test('generarItemsDesdeViabilidad: "Formulario N°1" y "Anexo N°1" NO se fusionan (series de numeración distintas)', () => {
  const informe = {
    modalidad: { tipo: 'suma_alzada' },
    requisitos_admisibilidad: {
      orden_anexos_propios: [
        { que_crear: 'Formulario N°1: Identificación del Oferente', fuente: 'bases' },
        { que_crear: 'Anexo N°1: Programa de Integridad', fuente: 'bases' },
      ],
    },
  };
  const items = generarItemsDesdeViabilidad(informe);
  const admin = items.filter(i => i.bloque === 'ADMINISTRATIVO');
  assert.equal(admin.length, 2, `Formulario N°1 y Anexo N°1 son documentos distintos (salieron: ${admin.map(i => i.titulo).join(' | ')})`);
});

// Caso real 2905-36-LR26: "Formulario N°4: Garantía" (sin N° explícito del lado de las otras dos)
// se fusionaba con "Garantía de seriedad de la oferta" Y "Garantía de fiel cumplimiento" —
// instrumentos DISTINTOS — solo porque las tres frases contienen la palabra suelta "garantía".
test('generarItemsDesdeViabilidad: un núcleo genérico de una sola palabra ("Garantía") NO fusiona instrumentos distintos', () => {
  const informe = {
    modalidad: { tipo: 'suma_alzada' },
    requisitos_admisibilidad: {
      seriedad_oferta: { exige: true, fuente: 'bases' },
      fiel_cumplimiento: { exige: true, forma: 'boleta', fuente: 'bases' },
      orden_anexos_propios: [
        { que_crear: 'Formulario N°4: Garantía', fuente: 'bases' },
      ],
    },
  };
  const items = generarItemsDesdeViabilidad(informe);
  const admin = items.filter(i => i.bloque === 'ADMINISTRATIVO');
  assert.equal(admin.length, 3, `las 3 garantías son ítems distintos (salieron: ${admin.map(i => i.titulo).join(' | ')})`);
});
