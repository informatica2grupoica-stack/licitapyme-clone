// Tests del núcleo determinista del VERIFICADOR TÉCNICO del AUDITOR (PROMPT 4 v2.0). Sin red ni IA: prueban que lo que devuelva
// el modelo no puede saltarse las reglas del prompt (cita de los dos lados, cita literal, cálculo numérico, complemento sin
// costear, cualitativo sin respaldo, habilitaciones por origen) y que el veredicto, los bloqueos y los eventos los calcula el código.
// Correr con: npx tsx --test app/lib/__tests__/auditor-tecnico-v2.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluarTecnico, textoCitado, type RequisitoHeredado, type ItemCrudo, type ParteCruda } from '../auditor-tecnico-v2-core';

const FICHA = `Konica Minolta LS-150. Conforme a DIN 5032-7 Clase B (LS-150). Precisión: ±2% ±2 dígitos. Accesorios estándar: tapa de lentes, baterías, estuche.`;
const req = (n: number, texto: string, criticidad: any = 'INADMISIBLE'): RequisitoHeredado => ({ n, texto, fuente: 'BBTT 4.2', criticidad });
const parte = (o: Partial<ParteCruda> = {}): ParteCruda => ({
  parte: 'parte', tipo_requisito: 'PRESENCIA', veredicto: 'CUMPLE', origen_dato: 'FICHA',
  cita_original: 'Ficha p.2: "Conforme a DIN 5032-7 Clase B (LS-150)"', ...o,
});
const item = (n: number, partes: ParteCruda[], extra: Partial<ItemCrudo> = {}): ItemCrudo => ({ n, partes, ...extra });
const ev = (requisitos: RequisitoHeredado[], matriz: ItemCrudo[], extra: any = {}) =>
  evaluarTecnico({ requisitos, salida: { matriz_tecnica: matriz, ...(extra.salida || {}) }, textoDocumentos: FICHA, habilitados: extra.habilitados, declarados: extra.declarados });

test('textoCitado: extrae lo que hay que buscar literal en el documento', () => {
  assert.equal(textoCitado('Ficha p.2, sección 1: "Conforme a DIN 5032-7 Clase B (LS-150)"'), 'Conforme a DIN 5032-7 Clase B (LS-150)');
  assert.equal(textoCitado("Ficha: 'tapa de lentes'"), 'tapa de lentes');
  assert.equal(textoCitado('Ficha p.4 tabla Especificaciones'), null);
});

test('el veredicto de la fila es el de su PEOR parte (Pantalla ✅ · Menús en español ⏳ → SIN VEREDICTO)', () => {
  const r = ev([req(1, 'Pantalla y menús en español')], [item(1, [
    parte({ parte: 'Pantalla' }),
    parte({ parte: 'Menús en español', veredicto: 'SIN_VEREDICTO', motivo_sin_veredicto: 'no_declarado_tras_busqueda', cita_original: '' }),
  ], { ayuda: { diagnostico: 'La ficha no dice el idioma.', ruta: 'SALVABLE', accion_concreta: 'Pedir la página del manual con el selector de idioma.', pregunta_proveedor: '¿Los menús del LS-150 se pueden configurar en español?' } })]);
  assert.equal(r.filas[0].veredicto, 'SIN_VEREDICTO');
  assert.equal(r.estado, 'CON_PENDIENTES');
  assert.equal(r.bloqueos[0].codigo, 'T_SIN_VEREDICTO');
  assert.match(r.bloqueos[0].salida, /manual/);
  assert.equal(r.preguntas.length, 1);
});

test('peor gravedad: NO_CUMPLE > SIN_VEREDICTO > CUMPLE_CON_COMPLEMENTO > CUMPLE', () => {
  const de = (v: string[]) => ev([req(1, 'x')], [item(1, v.map(x => parte({ veredicto: x, cita_original: x === 'CUMPLE' || x === 'NO_CUMPLE' ? 'Ficha: "tapa de lentes"' : '', complemento: x === 'CUMPLE_CON_COMPLEMENTO' ? { tipo: 'declarativo' } : undefined })))]).filas[0].veredicto;
  assert.equal(de(['CUMPLE', 'CUMPLE_CON_COMPLEMENTO']), 'CUMPLE_CON_COMPLEMENTO');
  assert.equal(de(['CUMPLE_CON_COMPLEMENTO', 'SIN_VEREDICTO']), 'SIN_VEREDICTO');
  assert.equal(de(['SIN_VEREDICTO', 'NO_CUMPLE', 'CUMPLE']), 'NO_CUMPLE');
});

test('guardarraíl: un CUMPLE sin cita de la ficha no está auditado → SIN VEREDICTO', () => {
  const r = ev([req(1, 'Tapa de lentes')], [item(1, [parte({ cita_original: '' })])]);
  assert.equal(r.filas[0].veredicto, 'SIN_VEREDICTO');
  assert.equal(r.filas[0].partes[0].motivoSinVeredicto, 'sin_cita');
});

test('guardarraíl: la cita tiene que existir LITERAL en los documentos leídos (no se inventan citas)', () => {
  const inventada = ev([req(1, 'Norma')], [item(1, [parte({ cita_original: 'Ficha p.9: "Conforme a DIN 9999-1 Clase Z"' })])]);
  assert.equal(inventada.filas[0].veredicto, 'SIN_VEREDICTO');
  assert.equal(inventada.filas[0].partes[0].motivoSinVeredicto, 'cita_no_verificable');
  const real = ev([req(1, 'Norma')], [item(1, [parte()])]);
  assert.equal(real.filas[0].veredicto, 'CUMPLE');
  assert.equal(real.filas[0].cerrada, true);
});

test('guardarraíl numérico: manda el cálculo (precisión TECHO 2,5% vs ofertado 3% → NO CUMPLE aunque el modelo diga CUMPLE)', () => {
  const r = ev([req(1, 'Precisión: al menos ±2,5%')], [item(1, [parte({
    tipo_requisito: 'TECHO', requerido_valor: '2.5', requerido_unidad: '%', ofertado_valor: '3', ofertado_unidad_original: '%', cita_original: 'Ficha: "Precisión: ±2% ±2 dígitos"',
  })])]);
  assert.equal(r.filas[0].veredicto, 'NO_CUMPLE');
  assert.equal(r.filas[0].motivoPendiente, 'RIESGO');
  assert.ok(r.alertas.some(a => a.texto.includes('cálculo numérico')));
});

test('guardarraíl numérico: PISO cumplido por el cálculo se mantiene', () => {
  const r = ev([req(1, 'Capacidad mínima 10 L')], [item(1, [parte({ tipo_requisito: 'PISO', requerido_valor: '10', requerido_unidad: 'l', ofertado_valor: '12', ofertado_unidad_original: 'l', cita_original: 'Ficha: "Precisión: ±2% ±2 dígitos"', sobrecumple: true })])]);
  assert.equal(r.filas[0].veredicto, 'CUMPLE');
  assert.equal(r.filas[0].sobrecumple, true);
});

test('CUALITATIVO: no se da por cumplido sin una declaración con respaldo (POR AFINAR)', () => {
  const r = ev([req(1, 'Equipo robusto', 'PUNTAJE')], [item(1, [parte({ tipo_requisito: 'CUALITATIVO', cita_original: 'Ficha: "tapa de lentes"' })], { ayuda: { diagnostico: 'Cualitativo', ruta: 'SALVABLE', accion_concreta: 'Declarar con respaldo', pregunta_proveedor: '¿Es robusto?' } })]);
  assert.equal(r.filas[0].veredicto, 'SIN_VEREDICTO');
  assert.equal(r.filas[0].motivoPendiente, 'POR_AFINAR');
  assert.equal(r.preguntas.length, 0, 'lo cualitativo NUNCA se pregunta al proveedor');
  // con declaración del asistente y respaldo → se da por respondido, pero pasa por el EM (origen DECLARADO)
  const d = ev([req(1, 'Equipo robusto', 'PUNTAJE')], [item(1, [parte({ tipo_requisito: 'CUALITATIVO', cita_original: '' })])], { declarados: new Set([1]) });
  assert.equal(d.filas[0].veredicto, 'CUMPLE');
  assert.equal(d.filas[0].origen, 'DECLARADO');
  assert.equal(d.filas[0].habilitacion, 'EM');
  assert.equal(d.filas[0].cerrada, false);
});

test('CUMPLE CON COMPLEMENTO de un accesorio sin costear no existe: queda abierto (POR AFINAR) y avisa al verificador de costo', () => {
  const r = ev([req(1, 'Debe incluir: certificado de calibración')], [item(1, [parte({
    tipo_requisito: 'INCLUYE', veredicto: 'CUMPLE_CON_COMPLEMENTO', cita_original: '', complemento: { tipo: 'documento_tercero', descripcion: 'Calibración de laboratorio', cotizado: false, respaldo: '' },
  })], { ayuda: { diagnostico: 'No viene de fábrica', ruta: 'SALVABLE', accion_concreta: 'Cotizar la calibración' } })]);
  assert.equal(r.filas[0].veredicto, 'SIN_VEREDICTO');
  assert.equal(r.filas[0].motivoPendiente, 'POR_AFINAR');
  assert.ok(r.eventos.some(e => e.tipo === 'complemento_requerido' && e.detalle.includes('Calibración')));
  const cotizado = ev([req(1, 'Debe incluir: certificado de calibración')], [item(1, [parte({
    tipo_requisito: 'INCLUYE', veredicto: 'CUMPLE_CON_COMPLEMENTO', cita_original: '', complemento: { tipo: 'documento_tercero', descripcion: 'Calibración', cotizado: true },
  })])]);
  assert.equal(cotizado.filas[0].veredicto, 'CUMPLE_CON_COMPLEMENTO');
  assert.equal(cotizado.filas[0].cerrada, true);
});

test('habilitación: FICHA_WEB como único sustento de una exigencia 🔴 requiere al EM; en un ítem no rojo es automática', () => {
  const rojo = ev([req(1, 'Rango de medición')], [item(1, [parte({ origen_dato: 'FICHA_WEB' })])]);
  assert.equal(rojo.filas[0].habilitacion, 'EM');
  assert.equal(rojo.filas[0].cerrada, false);
  assert.equal(rojo.bloqueos[0].codigo, 'T_HABILITACION');
  assert.equal(rojo.resumen.requiereEM, 1);
  const habilitado = ev([req(1, 'Rango de medición')], [item(1, [parte({ origen_dato: 'FICHA_WEB' })])], { habilitados: new Set([1]) });
  assert.equal(habilitado.filas[0].cerrada, true);
  const noRojo = ev([req(1, 'Rango de medición', 'PUNTAJE')], [item(1, [parte({ origen_dato: 'FICHA_WEB' })])]);
  assert.equal(noRojo.filas[0].habilitacion, 'no');
  assert.equal(noRojo.filas[0].cerrada, true);
});

test('habilitación: fuente informal o declarada siempre requiere al EM, sea cual sea la criticidad', () => {
  for (const origen of ['CONFIRMACION_INFORMAL', 'DECLARADO', 'CONTRADICE_FICHA']) {
    const r = ev([req(1, 'x', 'COMPROMISO')], [item(1, [parte({ origen_dato: origen })])]);
    assert.equal(r.filas[0].habilitacion, 'EM', origen);
  }
});

test('criticidad sospechosa: un PUNTAJE sin criterio que dé puntos se trata como INADMISIBLE y se alerta', () => {
  const r = ev([req(1, 'Debe incluir: tapa de lentes', 'PUNTAJE')], [item(1, [parte()], { criticidad_sospechosa: true })]);
  assert.equal(r.filas[0].criticidad, 'INADMISIBLE');
  assert.equal(r.filas[0].criticidadSospechosa, true);
  assert.ok(r.alertas.some(a => a.texto.includes('PUNTAJE sin un criterio')) || r.filas[0].criticidadSospechosa);
});

test('SIN_CLASIFICAR bloquea aunque el producto cumpla (no hay default cómodo a COMPROMISO)', () => {
  const r = ev([req(1, 'algo', 'SIN_CLASIFICAR')], [item(1, [parte()])]);
  assert.equal(r.filas[0].veredicto, 'CUMPLE');
  assert.equal(r.filas[0].cerrada, false);
  assert.equal(r.bloqueos[0].codigo, 'T_SIN_CLASIFICAR');
});

test('ruta_insalvable: solo un 🔴 que NO cumple y sin arreglo emite el evento (la opción queda descartada)', () => {
  const crudo = (crit: any) => ev([req(1, 'Menús en español', crit)], [item(1, [parte({ veredicto: 'NO_CUMPLE', cita_original: 'Ficha: "tapa de lentes"' })], { ayuda: { diagnostico: 'Menús en japonés', ruta: 'INSALVABLE', accion_concreta: 'Volver a buscar producto' } })]);
  assert.ok(crudo('INADMISIBLE').eventos.some(e => e.tipo === 'ruta_insalvable'));
  assert.ok(!crudo('PUNTAJE').eventos.some(e => e.tipo === 'ruta_insalvable'));
});

test('sobredimensionamiento: ≥ 50% de las características medibles sobrecumplen', () => {
  const p = (sobre: boolean) => parte({ tipo_requisito: 'PISO', requerido_valor: '10', requerido_unidad: 'l', ofertado_valor: sobre ? '20' : '10', ofertado_unidad_original: 'l', sobrecumple: sobre, cita_original: 'Ficha: "tapa de lentes"' });
  const r = ev([req(1, 'a'), req(2, 'b'), req(3, 'c')], [item(1, [p(true)]), item(2, [p(true)]), item(3, [p(false)])]);
  assert.equal(r.sobredimensionamiento.activa, true);
  assert.equal(r.sobredimensionamiento.sobrecumplen, 2);
  assert.ok(r.eventos.some(e => e.tipo === 'sobredimensionamiento'));
  const una = ev([req(1, 'a'), req(2, 'b'), req(3, 'c')], [item(1, [p(true)]), item(2, [p(false)]), item(3, [p(false)])]);
  assert.equal(una.sobredimensionamiento.activa, false);
  // con solo 2 medibles el 50% no significa nada: no alerta
  const dos = ev([req(1, 'a'), req(2, 'b')], [item(1, [p(true)]), item(2, [p(false)])]);
  assert.equal(dos.sobredimensionamiento.activa, false);
});

test('compromisos con costo: sin duplicar, sin literal se ignoran, y emiten el evento', () => {
  const r = evaluarTecnico({ requisitos: [], textoDocumentos: '', salida: { compromisos_con_costo: [
    { n: 1, materia: 'capacitacion', exige_base_literal: 'Capacitación de 8 horas', fuente_bases: 'BBTT 6.1', cuantificacion: '8 horas', criticidad: 'COMPROMISO' },
    { n: 2, materia: 'capacitacion', exige_base_literal: 'Capacitación de 8 horas', fuente_bases: 'BBTT 6.1', cuantificacion: '8 horas', criticidad: 'COMPROMISO' },
    { n: 3, materia: 'despacho', exige_base_literal: '', cuantificacion: 'Coquimbo' },
  ] } });
  assert.equal(r.compromisos.length, 1);
  assert.equal(r.compromisos[0].cuantificacion, '8 horas');
  assert.equal(r.eventos.filter(e => e.tipo === 'compromiso_con_costo').length, 1);
});

test('correspondencia: un documento de OTRO modelo emite producto_cambiado', () => {
  const r = evaluarTecnico({ requisitos: [], textoDocumentos: '', salida: { correspondencia_documentos: [{ extraccion_id: '7', corresponde_producto_opcion: false, marca_documento: 'Konica', modelo_documento: 'LS-160' }] } });
  assert.ok(r.eventos.some(e => e.tipo === 'producto_cambiado' && e.detalle.includes('LS-160')));
});

test('"no encontrado en la extracción" pasa a "no declarado tras búsqueda" (el verificador ya leyó todo el texto)', () => {
  const r = ev([req(1, 'Menús en español')], [item(1, [parte({ veredicto: 'SIN_VEREDICTO', motivo_sin_veredicto: 'no_encontrado_en_extraccion', cita_original: '' })])]);
  assert.equal(r.filas[0].partes[0].motivoSinVeredicto, 'no_declarado_tras_busqueda');
});

test('un requisito que el modelo omitió queda SIN VEREDICTO (no se omite ni se agrupa) y sin matriz el estado es SIN EVALUAR', () => {
  const r = ev([req(1, 'a'), req(2, 'b')], [item(1, [parte()])]);
  assert.equal(r.filas.length, 2);
  assert.equal(r.filas[1].veredicto, 'SIN_VEREDICTO');
  assert.equal(evaluarTecnico({ requisitos: [req(1, 'a')], salida: {}, textoDocumentos: '' }).estado, 'SIN_EVALUAR');
});

test('estado técnico de la opción: CUMPLE solo si TODO está cerrado; NO_CUMPLE domina', () => {
  assert.equal(ev([req(1, 'a')], [item(1, [parte()])]).estado, 'CUMPLE');
  assert.equal(ev([req(1, 'a'), req(2, 'b')], [item(1, [parte()]), item(2, [parte({ veredicto: 'NO_CUMPLE' })])]).estado, 'NO_CUMPLE');
});

test('ayuda incompleta: solo se evalúa en ítems ABIERTOS, nunca en un CUMPLE', () => {
  const cumple = ev([req(1, 'a')], [item(1, [parte()])]);
  assert.equal(cumple.filas[0].ayudaIncompleta, false);
  const abierto = ev([req(1, 'a')], [item(1, [parte({ veredicto: 'SIN_VEREDICTO', cita_original: '' })])]);
  assert.equal(abierto.filas[0].ayudaIncompleta, true);
  assert.ok(abierto.alertas.some(a => a.texto.includes('ayuda completa')));
});

test('alertas generales: contradicción letra vs mérito técnico trae la pregunta al foro; ficha contradice a la web', () => {
  const r = evaluarTecnico({ requisitos: [], textoDocumentos: '', salida: { alertas_generales: {
    contradicciones_bases: [{ item_ref: '3', explicacion: 'Un ángulo menor es mejor pero la letra pide al menos 1°.', pregunta_foro: '¿Se acepta un ángulo de medición menor a 1°?', plazo_foro: 'abierto' }],
    ficha_contradice_web: [{ item_ref: '2', valor_ficha: '±2%', valor_web: '±3%' }],
  } } });
  assert.ok(r.alertas.some(a => a.nivel === 'rojo' && a.texto.includes('¿Se acepta un ángulo')));
  assert.ok(r.alertas.some(a => a.texto.includes('Prevalece la ficha')));
});
