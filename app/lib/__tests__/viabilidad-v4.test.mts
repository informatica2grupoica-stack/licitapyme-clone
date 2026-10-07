// Viabilidad v4.0 + nivel de atractivo v4.1 — golden set de las especificaciones (02-10-2026).
//   npx tsx --test app/lib/__tests__/viabilidad-v4.test.mts
// Un caso pasa solo si nivel, unidad evaluada y acción coinciden (especificación 2, §11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularNivel } from '../score-viabilidad';
import { CONFIG_V4_DEFAULT } from '../viabilidad-v4/config';
import { decidirAdjudicacion, marcarEvidenciasQueCuentan, evidenciasDeDetectores, type EvidenciaAdj } from '../viabilidad-v4/adjudicacion';
import { calcularPlazoPrevio, normalizarHitos, detectarNegaciones, feriadosPara } from '../viabilidad-v4/plazo-previo';
import { calcularMulta } from '../viabilidad-v4/multa';
import { plazoGarantiaEnTexto } from '../viabilidad-v4/lectura-dirigida';
import { descartarItemsInventados } from '../viabilidad-v4/productos';
import { interpretarMonto, interpretarPorLinea, sumaLineasCuadra, detectarPresupuestoExcluyente } from '../viabilidad-v4/presupuesto';
import { LocalizadorCitas } from '../viabilidad-v4/citas';
import { decidirSuministro, detectarSenalesSuministro, barridoConsecuencias, esObviedad, detectarVisitaTecnica, detectarMuestras, consolidarVisitaYMuestras } from '../viabilidad-v4/admisibilidad';
import { problemasCalidadManifiesto } from '../viabilidad-v4/productos';

const cfg = CONFIG_V4_DEFAULT;
const CITA_OK = { documento: 'Bases.pdf', numeral: '1', frase: 'frase de prueba', verificada: true };
const items = (n: number, familia: string, linea = 'L1') => Array.from({ length: n }, (_, i) => ({ linea, nombre: `Producto ${linea} ${i + 1}`, familia }));
const inf = (o: any) => ({
  adjudicacion: { resultado: 'GLOBAL' },
  presupuesto: { cita: CITA_OK },
  productos: { items: [] },
  criterios_evaluacion: { criterios: [] },
  requisitos_admisibilidad: { requisitos: [] },
  ...o,
});
const nivel = (o: any, codigo = '1234-1-LP26', extra: any = {}) => calcularNivel(inf(o), cfg, { codigo, utm: 72_151, ahora: new Date('2026-10-02T12:00:00Z'), ...extra });

// ─── Especificación 2, §11.2 · casos sintéticos ────────────────────────────────────────────
test('U1 · $10.000.000 neto exactos no pasa: EXCLUIDO (F3) · Suelta', () => {
  const s = nivel({ presupuesto: { neto: 10_000_000, cita: CITA_OK }, productos: { items: items(1, 'LABORATORIO') } });
  assert.equal(s.nivel, 'EXCLUIDO');
  assert.equal(s.motivo_exclusion?.filtro, 'F3');
  assert.equal(s.accion_asistente, 'SOLTAR');
});

test('U2 · $12M, 10 productos de ferretería: BAJO · Suelta', () => {
  const s = nivel({ presupuesto: { neto: 12_000_000, cita: CITA_OK }, productos: { items: items(10, 'FERRETERIA') } });
  assert.equal(s.nivel, 'BAJO');
  assert.equal(s.accion_asistente, 'SOLTAR');
});

test('U3 · $15M, 1 equipo de laboratorio: MEDIO · Consulta', () => {
  const s = nivel({ presupuesto: { neto: 15_000_000, cita: CITA_OK }, productos: { items: items(1, 'LABORATORIO') } });
  assert.equal(s.nivel, 'MEDIO');
  assert.equal(s.accion_asistente, 'CONSULTAR_CA');
});

test('U4 · $25M, 3 maquinarias, ley del mínimo en plazo sin piso: ALTO (piso) · Sigue', () => {
  const s = nivel({
    presupuesto: { neto: 25_000_000, cita: CITA_OK }, productos: { items: items(3, 'MAQUINARIA_CONSTRUCCION') },
    criterios_evaluacion: { criterios: [{ nombre: 'Plazo de entrega', tema: 'PLAZO_ENTREGA', clase: 'LEY_DEL_MINIMO', ponderacion_efectiva: 20, rango_admisibilidad: { min: '', max: '' } }] },
  });
  assert.equal(s.nivel, 'ALTO');
  assert.equal(s.accion_asistente, 'SEGUIR');
});

test('U4b · la misma ley pero con mínimo fijado por las bases no cuenta para el piso', () => {
  const s = nivel({
    presupuesto: { neto: 25_000_000, cita: CITA_OK }, productos: { items: items(3, 'MAQUINARIA_CONSTRUCCION') },
    criterios_evaluacion: { criterios: [{ nombre: 'Plazo', tema: 'PLAZO_ENTREGA', clase: 'LEY_DEL_MINIMO', rango_admisibilidad: { min: '5 días', max: '' } }] },
  });
  assert.equal(s.nivel, 'MEDIO');
});

test('U5 · $80M con servicio como objeto principal: MEDIO BAJO (el techo manda sobre el piso) · Consulta', () => {
  const s = nivel({ presupuesto: { neto: 80_000_000, cita: CITA_OK }, objeto_principal: { tipo: 'SERVICIO' } });
  assert.equal(s.nivel, 'MEDIO_BAJO');
  assert.equal(s.accion_asistente, 'CONSULTAR_CA');
});

test('U6 · $90M, 70 commodity, precio 80 %: MEDIO ALTO (piso) · Consulta', () => {
  const s = nivel({
    presupuesto: { neto: 90_000_000, cita: CITA_OK }, productos: { items: items(70, 'FERRETERIA') },
    criterios_evaluacion: { criterios: [{ nombre: 'Precio', tema: 'PRECIO', clase: 'LEY_DEL_MINIMO', ponderacion_efectiva: 80 }] },
  });
  assert.equal(s.nivel, 'MEDIO_ALTO');
  assert.equal(s.accion_asistente, 'CONSULTAR_CA');
});

test('U7 · LE sin monto publicado, 4 maquinarias: MEDIO + aviso de rango · Consulta', () => {
  const s = nivel({ presupuesto: {}, productos: { items: items(4, 'MAQUINARIA_CONSTRUCCION') } }, '2585-87-LE26');
  assert.equal(s.nivel, 'MEDIO');
  assert.equal(s.accion_asistente, 'CONSULTAR_CA');
  assert.ok(s.avisos.some(a => /no publicado/i.test(a)), JSON.stringify(s.avisos));
});

test('U8 · POR LÍNEA: L1 $8M, L2 $35M con 2 eléctricos → L2 ALTO · Sigue · L1 no viable', () => {
  const s = nivel({
    adjudicacion: { resultado: 'POR_LINEAS' },
    presupuesto: { neto: 43_000_000, cita: CITA_OK, por_linea_interpretado: [{ numero: 1, neto: 8_000_000 }, { numero: 2, neto: 35_000_000 }] },
    productos: { items: [...items(1, 'ELECTRICO', 'L1'), ...items(2, 'ELECTRICO', 'L2')] },
  });
  assert.equal(s.nivel, 'ALTO');
  assert.equal(s.unidad_evaluada, 'LINEA 2');
  assert.equal(s.accion_asistente, 'SEGUIR');
  const l1 = s.lineas.find(l => l.linea === 'L1');
  assert.equal(l1?.viable, false);
});

test('U9 · personal inscrito en tecnovigilancia del ISP que deja fuera, $200M: EXCLUIDO (F4) · Revisa salida', () => {
  const s = nivel({
    presupuesto: { neto: 200_000_000, cita: CITA_OK }, productos: { items: items(1, 'MEDICO_HOSPITALARIO') },
    requisitos_admisibilidad: { requisitos: [{ que: 'Contar con personal inscrito en el ISP como encargado de tecnovigilancia', consecuencia: 'inadmisible', cita: CITA_OK }] },
  });
  assert.equal(s.nivel, 'EXCLUIDO');
  assert.equal(s.motivo_exclusion?.filtro, 'F4');
  assert.equal(s.accion_asistente, 'REVISAR_SALIDA');
});

test('U10 · adjudicación NO CLARO: nivel = el menor de los dos supuestos · Confirma el dato', () => {
  const s = nivel({
    adjudicacion: { resultado: 'NO_CLARO' },
    presupuesto: { neto: 120_000_000, cita: CITA_OK, por_linea_interpretado: [{ numero: 1, neto: 15_000_000 }, { numero: 2, neto: 105_000_000 }] },
    productos: { items: [...items(1, 'VEHICULOS', 'L1'), ...items(1, 'VEHICULOS', 'L2')] },
  });
  // Global: $120M → MUY ALTO. Por línea: la mejor (L2 $105M, 1 producto) → MUY ALTO. Ambos MUY ALTO.
  assert.equal(s.nivel, 'MUY_ALTO');
  assert.equal(s.accion_asistente, 'CONFIRMAR_DATO');
  assert.ok(s.datos_dudosos.some(d => d.clave === 'adjudicacion'));
  // Con presupuesto total chico y una sola línea grande, los supuestos difieren y gana el menor.
  const s2 = nivel({
    adjudicacion: { resultado: 'NO_CLARO' },
    presupuesto: { neto: 45_000_000, cita: CITA_OK, por_linea_interpretado: [{ numero: 1, neto: 12_000_000 }, { numero: 2, neto: 33_000_000 }] },
    productos: { items: [...items(1, 'VEHICULOS', 'L1'), ...items(1, 'VEHICULOS', 'L2')] },
  });
  // Global: $45M → MEDIO ALTO, 2 productos +1 → ALTO. Por línea: L2 $33M → MEDIO +1 → MEDIO ALTO.
  assert.equal(s2.nivel, 'MEDIO_ALTO');
  assert.equal(s2.supuesto_no_claro, 'POR_LINEAS');
});

test('datos dudosos: presupuesto con cita no verificada cambia la acción; confirmado vuelve a la normal', () => {
  const base = { presupuesto: { neto: 150_000_000, cita: { ...CITA_OK, verificada: false } }, productos: { items: items(1, 'LABORATORIO') } };
  assert.equal(nivel(base).accion_asistente, 'CONFIRMAR_DATO');
  assert.equal(nivel(base, '1234-1-LP26', { confirmados: ['presupuesto'] }).accion_asistente, 'SEGUIR');
});

test('F1 contrato de suministro y F2 LS excluyen con su motivo', () => {
  const f1 = nivel({ exclusion: { excluido: true, categoria: 'CONTRATO_SUMINISTRO', motivo: 'vigencia 24 meses con OC mensuales', cita: CITA_OK }, presupuesto: { neto: 200_000_000, cita: CITA_OK } });
  assert.equal(f1.motivo_exclusion?.filtro, 'F1');
  assert.equal(f1.accion_asistente, 'SOLTAR');
  const f2 = nivel({ presupuesto: { neto: 200_000_000, cita: CITA_OK } }, '1234-5-LS26');
  assert.equal(f2.motivo_exclusion?.filtro, 'F2');
});

test('L1 sin monto publicado → EXCLUIDO (F3); otra categoría de exclusión solo avisa', () => {
  assert.equal(nivel({ presupuesto: {} }, '3890-114-L126').motivo_exclusion?.filtro, 'F3');
  const s = nivel({ exclusion: { excluido: false, categoria: 'OBRA_CIVIL' }, presupuesto: { neto: 50_000_000, cita: CITA_OK }, productos: { items: items(2, 'MOBILIARIO') } });
  assert.notEqual(s.nivel, 'EXCLUIDO');
  assert.ok(s.avisos.some(a => /obra civil/i.test(a)));
});

test('certificado de servicio técnico de marca resta un escalón', () => {
  const sin = nivel({ presupuesto: { neto: 50_000_000, cita: CITA_OK }, productos: { items: items(10, 'MOBILIARIO') } });
  const con = nivel({ presupuesto: { neto: 50_000_000, cita: CITA_OK }, productos: { items: items(10, 'MOBILIARIO') }, requisitos_admisibilidad: { requisitos: [{ que: 'Presentar certificado de servicio técnico autorizado de la marca', cita: CITA_OK }] } });
  assert.equal(sin.nivel_num - con.nivel_num, 1);
});

// ─── Especificación 2, §11.1 · licitaciones reales ─────────────────────────────────────────
test('Cholchol 4993-70-LR26 · POR LÍNEA, L1 $732,8M neto, 1 maquinaria → MUY ALTO (L1) · Sigue; L2 también MUY ALTO', () => {
  const l1 = Math.round(872_079_000 / 1.19), l2 = Math.round(286_591_000 / 1.19);
  const s = nivel({
    adjudicacion: { resultado: 'POR_LINEAS' },
    presupuesto: { neto: l1 + l2, cita: CITA_OK, por_linea_interpretado: [{ numero: 1, neto: l1 }, { numero: 2, neto: l2 }] },
    productos: { items: [{ linea: 'L1', nombre: 'Motoniveladora', familia: 'MAQUINARIA_CONSTRUCCION' }, { linea: 'L1', nombre: 'Motoniveladora', familia: 'MAQUINARIA_CONSTRUCCION' }, { linea: 'L2', nombre: 'Cargador frontal', familia: 'MAQUINARIA_CONSTRUCCION' }] },
  }, '4993-70-LR26');
  assert.equal(s.nivel, 'MUY_ALTO');
  assert.equal(s.unidad_evaluada, 'LINEA 1');
  assert.equal(s.accion_asistente, 'SEGUIR');
  assert.equal(s.lineas.find(l => l.linea === 'L2')?.nivel, 'MUY_ALTO');
  assert.match(s.resumen_pantalla, /MUY ALTO · Línea 1: \$732,8M neto · maquinaria · 1 producto$/);
});

test('Arica 2585-87-LE26 · POR LÍNEA sin presupuesto por línea, $43,7M neto, vehículos → ALTO · Sigue', () => {
  const neto = Math.round(52_000_000 / 1.19);
  const s = nivel({
    adjudicacion: { resultado: 'POR_LINEAS' },
    presupuesto: { neto, cita: CITA_OK, por_linea_interpretado: [] },
    productos: { items: [{ linea: 'L1', nombre: 'Moto acuática', familia: 'VEHICULOS' }, { linea: 'L2', nombre: 'Vehículo todoterreno', familia: 'VEHICULOS' }] },
  }, '2585-87-LE26');
  assert.equal(s.nivel, 'ALTO');
  assert.equal(s.accion_asistente, 'SEGUIR');
  assert.equal(s.lineas[0].presupuesto_origen, 'TOTAL');
});

// ─── P1 · tabla de decisión ────────────────────────────────────────────────────────────────
const ev = (tipo: any, extra: any = {}): EvidenciaAdj => ({ tipo, origen: 'modelo', cita: { frase: 'x', verificada: true, semantica: 'SI' }, ...extra });
test('P1 · 1 línea en la API = GLOBAL; COTIZAR_TOTALIDAD gana a "por línea"', () => {
  assert.equal(decidirAdjudicacion(marcarEvidenciasQueCuentan([ev('TOTAL_O_PARCIAL')]), 1).resultado, 'GLOBAL');
  const d = decidirAdjudicacion(marcarEvidenciasQueCuentan([ev('ADJUDICA_POR_LINEA'), ev('COTIZAR_TOTALIDAD')]), 3);
  assert.equal(d.resultado, 'GLOBAL'); assert.equal(d.regla_aplicada, 2); assert.equal(d.cotizar_100, 'SI');
});
test('P1 · Cholchol: OFERTA_POR_BIEN decisiva + SUMA_ALZADA débil → POR LÍNEA', () => {
  const d = decidirAdjudicacion(marcarEvidenciasQueCuentan([ev('OFERTA_POR_BIEN'), ev('SUMA_ALZADA')]), 2);
  assert.equal(d.resultado, 'POR_LINEAS'); assert.equal(d.regla_aplicada, 3);
});
test('P1 · Arica: TOTAL_O_PARCIAL → POR LÍNEA, cotizar 100 % no', () => {
  const d = decidirAdjudicacion(marcarEvidenciasQueCuentan([ev('TOTAL_O_PARCIAL')]), 2);
  assert.equal(d.resultado, 'POR_LINEAS'); assert.equal(d.cotizar_100, 'POR_LINEA');
});
test('P1 · decisivas en conflicto, solo débiles o nada → NO CLARO (sin default GLOBAL)', () => {
  assert.equal(decidirAdjudicacion(marcarEvidenciasQueCuentan([ev('ADJUDICA_GLOBAL'), ev('ADJUDICA_POR_LINEA')]), 2).regla_aplicada, 4);
  assert.equal(decidirAdjudicacion(marcarEvidenciasQueCuentan([ev('SUMA_ALZADA'), ev('FORMULARIO_TOTAL')]), 2).resultado, 'NO_CLARO');
  const nada = decidirAdjudicacion([], 2);
  assert.equal(nada.resultado, 'NO_CLARO'); assert.ok(nada.pregunta_foro);
});
test('P1 · PRESUPUESTO_POR_LINEA decide solo; FORMULARIOS_SEPARADOS necesita respaldo', () => {
  assert.equal(decidirAdjudicacion(marcarEvidenciasQueCuentan([ev('PRESUPUESTO_POR_LINEA')]), 3).regla_aplicada, 5);
  const solo = evidenciasDeDetectores({ tipoAdjudicacionMultiple: null, licitacionTipoMultiple: null, ofertaSubconjunto: null, participacionParcialPorLinea: null, lenguajePorLinea: null, presupuestoPorLinea: null, formulariosPorArchivo: [1, 2, 3], cuadroPorLinea: null, totalUnico: false });
  assert.equal(decidirAdjudicacion(marcarEvidenciasQueCuentan(solo), 3).resultado, 'NO_CLARO');
  assert.equal(decidirAdjudicacion(marcarEvidenciasQueCuentan([...solo, ev('EVALUACION_POR_ITEM')]), 3).regla_aplicada, 6);
});
test('P1 · una frase no encontrada o que no sostiene su tipo no cuenta', () => {
  const a = marcarEvidenciasQueCuentan([ev('TOTAL_O_PARCIAL', { cita: { frase: 'x', verificada: false } })]);
  const b = marcarEvidenciasQueCuentan([ev('TOTAL_O_PARCIAL', { cita: { frase: 'x', verificada: true, semantica: 'NO' } })]);
  assert.equal(decidirAdjudicacion(a, 2).resultado, 'NO_CLARO');
  assert.equal(decidirAdjudicacion(b, 2).resultado, 'NO_CLARO');
});

// ─── P3 · plazo previo ─────────────────────────────────────────────────────────────────────
test('P3 · Cholchol: 10 días hábiles + 10 días hábiles + OC no indicada + 24 h = al menos ≈ 29 días corridos', () => {
  const hitos = normalizarHitos([
    { hito: 'GARANTIA_FIEL_CUMPLIMIENTO', estado: 'EXISTE', plazo: 10, unidad_original: 'días hábiles' },
    { hito: 'FIRMA_CONTRATO_PROVEEDOR', estado: 'EXISTE', plazo: 10, unidad_original: 'días hábiles' },
    { hito: 'EMISION_OC', estado: 'NO_INDICADO' },
    { hito: 'ACEPTACION_OC', estado: 'EXISTE', plazo: 24, unidad_original: 'horas' },
  ]);
  // Lunes 2-nov-2026 (sin feriados en el tramo).
  const r = calcularPlazoPrevio(hitos, null, new Date('2026-11-02T12:00:00Z'), 'prueba', feriadosPara(cfg, 'Araucanía'));
  assert.equal(r.al_menos, true);
  assert.ok(r.total_dias_corridos >= 28 && r.total_dias_corridos <= 30, String(r.total_dias_corridos));
});
test('P3 · Arica: garantía y contrato NO_EXISTE, OC sin plazos, desfase de 24 h → al menos 1 día', () => {
  const hitos = normalizarHitos([
    { hito: 'GARANTIA_FIEL_CUMPLIMIENTO', estado: 'NO_EXISTE' },
    { hito: 'FIRMA_CONTRATO_PROVEEDOR', estado: 'NO_EXISTE' },
    { hito: 'FIRMA_CONTRATO_ORGANISMO', estado: 'NO_EXISTE' },
  ]);
  const r = calcularPlazoPrevio(hitos, { cantidad: 24, unidad: 'horas' }, new Date('2026-11-02T12:00:00Z'), 'prueba', new Set());
  assert.equal(r.total_dias_corridos, 1);
  assert.equal(r.al_menos, true);
});
test('P3 · los días hábiles saltan fines de semana y feriados', () => {
  const hitos = normalizarHitos([{ hito: 'EMISION_OC', estado: 'EXISTE', plazo: 1, unidad_original: 'día hábil' }]);
  // Viernes 9-oct-2026 + 1 hábil = martes 13 (lunes 12 es feriado).
  const r = calcularPlazoPrevio(hitos, null, new Date('2026-10-09T12:00:00Z'), 'prueba', feriadosPara(cfg, null));
  assert.equal(r.fechas_estimadas[0].hasta, '2026-10-13');
});
test('P3 · detector de negación: "no se exigirá garantía de fiel cumplimiento" → NO_EXISTE', () => {
  const n = detectarNegaciones([{ nombre: 'BA.pdf', texto: '13.3 Para esta licitación no se exigirá garantía de Fiel Cumplimiento del contrato.' }]);
  assert.ok(n.fiel_cumplimiento);
  const m = detectarNegaciones([{ nombre: 'BA.pdf', texto: '2.14 Garantía de Fiel Cumplimiento: NO APLICA.' }]);
  assert.ok(m.fiel_cumplimiento);
  const x = detectarNegaciones([{ nombre: 'BA.pdf', texto: 'El adjudicatario deberá entregar la garantía de fiel cumplimiento dentro de 10 días hábiles.' }]);
  assert.equal(x.fiel_cumplimiento, undefined);
});

// ─── P7 · multa ────────────────────────────────────────────────────────────────────────────
test('P7 · Arica: 1 % del total por día, tope 10 días → ≈ $520.000/día y ≈ $5,2M', () => {
  const m = calcularMulta({ valor: '1%', unidad: 'PORCENTAJE', base_calculo: 'total del contrato', tope: { valor: '10', unidad: 'días hábiles' } }, { bruto: 52_000_000, neto: 43_697_479 }, null)!;
  assert.equal(m.pesos_dia_estimado, 520_000);
  assert.equal(m.tope_estimado, 5_200_000);
});
test('P7 · Cholchol: 0,1 % diario del monto total → ≈ $1.158.670/día', () => {
  const m = calcularMulta({ valor: '0,1', unidad: 'PORCENTAJE', base_calculo: 'monto total del contrato' }, { bruto: 1_158_670_000, neto: null }, null)!;
  assert.equal(m.pesos_dia_estimado, 1_158_670);
});
test('P7 · multa en UF sin valor oficial: no se inventa', () => {
  const m = calcularMulta({ valor: '2', unidad: 'UF' }, { bruto: 10_000_000, neto: null }, null)!;
  assert.equal(m.pesos_dia_estimado, null);
  assert.match(m.nota, /no disponible/);
  const ok = calcularMulta({ valor: '2', unidad: 'UF' }, { bruto: 10_000_000, neto: null }, { valor: 39_500, fecha: '2026-10-02', fuente: 'mindicador.cl' })!;
  assert.equal(ok.pesos_dia_estimado, 79_000);
});

// ─── P2 · presupuesto ──────────────────────────────────────────────────────────────────────
test('P2 · "M$ 872.079" = $872.079.000; las líneas cuadran con el total', () => {
  assert.equal(interpretarMonto('M$ 872.079').pesos, 872_079_000);
  assert.equal(interpretarMonto('$52.000.000 IVA incluido').pesos, 52_000_000);
  assert.equal(interpretarMonto('2 motoniveladoras: $872.079.000').pesos, 872_079_000);
  const l = interpretarPorLinea([{ linea: 'L1', monto_texto: 'M$ 872.079' }, { linea: 'L2', monto_texto: 'M$ 286.591' }], false);
  assert.equal(l[0].monto_pesos, 872_079_000);
  assert.equal(sumaLineasCuadra(l, 1_158_670_000), true);
  assert.equal(sumaLineasCuadra(l, 1_000_000_000), false);
});
test('P2 · "M$ 1.158.670.000" (total ya sumado en pesos y rotulado M$) no se multiplica otra vez', () => {
  assert.equal(interpretarMonto('M$ 1.158.670.000').pesos, 1_158_670_000);
  assert.equal(interpretarMonto('M$ 1.158.670').pesos, 1_158_670_000);
  assert.equal(interpretarMonto('M$ 872.079').pesos, 872_079_000);
});

test('P2 · presupuesto EXCLUYENTE con texto expreso se detecta en código (Cholchol Art. 5)', () => {
  const docs = [{ nombre: 'BASES.pdf', texto: 'Proyecto financiado con recursos del Gobierno Regional. Observación: El oferente que exceda el presupuesto Máximo disponible quedara fuera de Bases en la etapa de evaluación. ## ART. 6' }];
  const r = detectarPresupuestoExcluyente(docs);
  assert.ok(r && /exceda el presupuesto M[aá]ximo disponible quedara fuera de Bases/i.test(r.frase));
  // la cláusula de modificación del contrato (hasta 30 %) no es evidencia
  assert.equal(detectarPresupuestoExcluyente([{ nombre: 'B.pdf', texto: 'El contrato podrá modificarse hasta un 30% del monto contratado.' }]), null);
  assert.equal(detectarPresupuestoExcluyente([{ nombre: 'B.pdf', texto: 'El presupuesto estimado es de $50.000.000.' }]), null);
});

test('P2 · suministro: el detector reconoce "vigencia de 24 meses o hasta completar el presupuesto" (Transductor)', () => {
  const s = detectarSenalesSuministro([{ nombre: 'RES.pdf', texto: 'el contrato tendrá una vigencia de 24 meses o hasta completar el presupuesto destinado para ésta, lo que ocurra primero.' }]);
  assert.ok(s.some(x => x.tipo === 'HASTA_AGOTAR_MONTO'));
});

test('P3 · plazo de la garantía de fiel cumplimiento leído del texto (Cholchol Art. 15)', () => {
  const texto = 'ART. 15. GARANTIA FIEL CUMPLIMIENTO DEL CONTRATO El oferente adjudicado deberá emitir una Garantía por 5% del valor total, vigente más 90 días corridos. Esta garantía deberá ser irrevocable; para ambos casos deberá ser enviada dentro de un plazo máximo de 10 días hábiles contados desde la fecha de adjudicación de la propuesta. La presentación es obligatoria.';
  const r = plazoGarantiaEnTexto([{ nombre: 'BASES.pdf', texto }]);
  assert.ok(r); assert.equal(r!.plazo, 10); assert.equal(r!.unidad, 'días hábiles');
  assert.equal(plazoGarantiaEnTexto([{ nombre: 'B.pdf', texto: 'Garantía de fiel cumplimiento vigente 90 días corridos más.' }]), null);
});

test('P8 · un ítem sin ficha y sin rastro en las bases se descarta (Arica)', () => {
  const bases = 'Moto acuática, cuatrimoto. Vehículos con motor de 686cc para uso en terreno. '.repeat(20);
  const items = [{ nombre: 'Moto acuática', caracteristicas: [] }, { nombre: 'Embarcación a motor de uso personal', caracteristicas: [] }, { nombre: 'Cuatrimoto', caracteristicas: ['Motor 686cc'] }];
  const fuera = descartarItemsInventados(items, [bases]);
  assert.deepEqual(fuera.map(x => x.nombre), ['Embarcación a motor de uso personal']);
  assert.equal(items.length, 2);
});

test('P2 · contrato de suministro: excluye con vigencia+OC o "hasta agotar"; cantidades referenciales solas no', () => {
  assert.equal(decidirSuministro([{ tipo: 'VIGENCIA_CON_PEDIDOS', cita: { frase: 'x', verificada: true, semantica: 'SI' } }]).excluido, true);
  assert.equal(decidirSuministro([{ tipo: 'CANTIDADES_REFERENCIALES', cita: { frase: 'x', verificada: true } }]).excluido, false);
  assert.equal(decidirSuministro([{ tipo: 'HASTA_AGOTAR_MONTO', cita: { frase: 'x', verificada: false } }]).excluido, false);
});

// ─── P5 · citas ────────────────────────────────────────────────────────────────────────────
test('P5 · el código pone la página de la frase; una frase inventada queda no verificada', () => {
  const loc = new LocalizadorCitas([{ nombre: 'Bases.pdf', texto: '[[PÁGINA 1]]\nIntroducción.\n[[PÁGINA 24]]\n2.11 La Municipalidad se reserva el derecho de adjudicar total o parcialmente la presente licitación.' }]);
  const c = loc.localizar({ documento: 'Bases.pdf', numeral: '2.11', frase: 'se reserva el derecho de adjudicar total o parcialmente' });
  assert.equal(c.verificada, true); assert.equal(c.pagina, 24);
  const inv = loc.localizar({ documento: 'Bases.pdf', numeral: '', frase: 'se admite marca o equivalente en todos los ítems' });
  assert.equal(inv.verificada, false);
});

// ─── P6 / P10 / V-23 ───────────────────────────────────────────────────────────────────────
test('P6 · barrido de consecuencias: una causal que el modelo no cubrió aparece', () => {
  const docs = [{ nombre: 'BT.pdf', texto: 'Las muestras deberán entregarse en un plazo de 3 días hábiles. La oferta que no entregue muestras será declarada inadmisible. Otra frase.' }];
  const r = barridoConsecuencias(docs, [], cfg);
  assert.equal(r.length, 1);
  assert.equal(barridoConsecuencias(docs, [{ que: 'Entregar muestras en 3 días hábiles', consecuencia: 'La oferta que no entregue muestras será declarada inadmisible' }], cfg).length, 0);
});
test('P10 · filtro de obviedades', () => {
  assert.equal(esObviedad('Verificar stock con proveedores antes de ofertar', cfg), true);
  assert.equal(esObviedad('Ofertar 5 días de plazo de entrega', cfg), false);
});
test('V-23 · Valdivia: rótulos como productos y cantidades = número de fila', () => {
  const man = ['Nombre del oferente:', 'FIRMA:', 'RUT:', 'Micrótomo', 'Impresora de láminas'].map((d, i) => ({ linea: 1, categoria: null, descripcion: d, modelo: '', cantidad: i + 1, unidad_medida: '', unidad_inferida: true, presupuesto_linea: null, tipo: 'generico', ruta: '' }));
  assert.ok(problemasCalidadManifiesto(man).length >= 1);
});

// ─── Visita técnica y muestras ───────────────────────────────────────────────────────────
const docT = (texto: string) => [{ nombre: 'Bases.pdf', texto }];
test('Visita técnica · obligatoria, voluntaria, negada y ausente', () => {
  assert.equal(detectarVisitaTecnica(docT('La visita a terreno será obligatoria y quien no asista quedará fuera del proceso.'))?.estado, 'OBLIGATORIA');
  assert.equal(detectarVisitaTecnica(docT('Se realizará una visita técnica voluntaria el día 12 en el establecimiento.'))?.estado, 'VOLUNTARIA');
  assert.equal(detectarVisitaTecnica(docT('No se realizará visita a terreno en esta licitación.'))?.estado, 'NO_EXISTE');
  assert.equal(detectarVisitaTecnica(docT('El oferente debe presentar los documentos solicitados en las bases.')), null);
});
test('Muestras · exigidas, negadas y "se muestra" no cuenta', () => {
  assert.equal(detectarMuestras(docT('El oferente deberá entregar muestras de los productos en 3 días hábiles desde el cierre.'))?.estado, 'EXIGE');
  assert.equal(detectarMuestras(docT('No se exigirán muestras en esta licitación para los oferentes.'))?.estado, 'NO_EXIGE');
  assert.equal(detectarMuestras(docT('Como se muestra en la tabla, el oferente debe presentar el anexo 3.')), null);
});
test('consolidarVisitaYMuestras · agrega requisito del sistema solo si el modelo no lo cubrió', () => {
  const docs = docT('La visita técnica es obligatoria. El oferente deberá entregar muestras en 3 días hábiles.');
  const adm: any = { requisitos: [] };
  const nuevos = consolidarVisitaYMuestras(adm, docs, c => c);
  assert.equal(nuevos.length, 2);
  assert.equal(adm.visita_tecnica.origen, 'detector');
  const adm2: any = { requisitos: [{ que: 'Asistir a visita técnica' }], visita_tecnica: { estado: 'OBLIGATORIA' } };
  assert.equal(consolidarVisitaYMuestras(adm2, docT('nada'), c => c).length, 0);
});
