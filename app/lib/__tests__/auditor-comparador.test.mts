// Tests del núcleo determinista del COMPARADOR DE FICHAS (PROMPT 4). Sin red ni IA: prueban que lo
// que el modelo devuelva no puede saltarse las reglas del prompt.
// Correr con: npx tsx --test app/lib/__tests__/auditor-comparador.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  procesarItemComparador, evaluarReverificacion, estadoDeFila, alertaSobredimensionamiento, certificadoAdmisibilidad,
  bloqueosDeLinea, mensajesPorProveedor, marcarDuplicados, proponerAsignacion, ambitoDe, criticidadP4, normasDe, resumenComparador,
  type FilaComparador, type FichaInventariada,
} from '../auditor-comparador-core';

const fila = (o: Partial<FilaComparador> = {}): FilaComparador => ({
  id: 1, descripcion: 'Potencia del motor', tipo: 'PISO', valor_requerido_texto: 'mínimo 80 HP',
  valor_requerido_numero: 80, valor_requerido_numero_max: null, unidad_requerida: 'HP',
  veredicto: null, criticidad: 'INADMISIBLE', analisis: { ambito: 'tecnico', fuente_bases: 'BBTT 4.1' }, ...o,
});
const FICHA = 'Specifications: Engine power 93 HP. Noise level 74 dB. Certified ISO 9001:2015. Weight 1200 kg.';
const crudo = (o: Record<string, unknown> = {}) => ({
  n: 1, veredicto: 'CUMPLE', ofertado_valor: '93', ofertado_unidad_original: 'HP',
  fuente_bases: 'BBTT 4.1', fuente_ficha: 'Ficha p.3, tabla Specifications, fila Engine power', origen_dato: 'FICHA', ...o,
});

test('numérico: CUMPLE con cita de los dos lados y SOBRECUMPLE calculado por código', () => {
  const r = procesarItemComparador(fila(), crudo(), FICHA);
  assert.equal(r.columnas.veredicto, 'CUMPLE');
  assert.equal(r.analisis.sobrecumple, true);
  assert.match(r.analisis.sobrecumple_detalle!, /exigido 80 HP, ofertado 93 HP, diferencia 13 HP/);
  assert.equal(r.analisis.requiere_habilitacion, 'no');
});

test('numérico: 70 HP contra ≥80 es NO CUMPLE aunque la IA invente un complemento', () => {
  const r = procesarItemComparador(fila(), crudo({
    ofertado_valor: '70', veredicto: 'CUMPLE_CON_COMPLEMENTO', complemento: { tipo: 'declarativo', descripcion: 'carta', cotizado: false, respaldo: '' },
  }), 'Engine power 70 HP');
  assert.equal(r.columnas.veredicto, 'NO_CUMPLE');
});

test('numérico: un valor que no está en la ficha no sostiene un veredicto', () => {
  const r = procesarItemComparador(fila(), crudo({ ofertado_valor: '120' }), FICHA);
  assert.equal(r.columnas.veredicto, null);
  assert.equal(r.columnas.pendiente, true);
  assert.ok(r.analisis.notas_sistema?.length);
});

test('sin cita de la ficha el ítem no está auditado', () => {
  const r = procesarItemComparador(fila(), crudo({ fuente_ficha: '' }), FICHA);
  assert.equal(r.columnas.veredicto, null);
});

test('TECHO: menos ruido que el máximo sobrecumple', () => {
  const f = fila({ id: 2, descripcion: 'Nivel de ruido', tipo: 'TECHO', valor_requerido_texto: 'máximo 78 dB', valor_requerido_numero: 78, unidad_requerida: 'dB' });
  const r = procesarItemComparador(f, crudo({ n: 2, ofertado_valor: '74', ofertado_unidad_original: 'dB' }), FICHA);
  assert.equal(r.columnas.veredicto, 'CUMPLE');
  assert.equal(r.analisis.sobrecumple, true);
});

test('CUALITATIVO nunca se da por cumplido', () => {
  const f = fila({ tipo: 'CUALITATIVO', valor_requerido_numero: null, descripcion: 'Equipo robusto', valor_requerido_texto: 'robusto' });
  const r = procesarItemComparador(f, crudo({ ofertado_valor: 'Heavy duty' }), 'Heavy duty frame');
  assert.equal(r.columnas.veredicto, null);
  assert.equal(r.analisis.sobrecumple, false);
});

test('NORMATIVO: la misma norma cumple; una distinta sin fuente no se propone', () => {
  const f = fila({ tipo: 'NORMATIVO', descripcion: 'Certificación de calidad', valor_requerido_texto: 'ISO 9001', valor_requerido_numero: null, unidad_requerida: null });
  const igual = procesarItemComparador(f, crudo({ ofertado_valor: 'ISO 9001:2015' }), FICHA);
  assert.equal(igual.columnas.veredicto, 'CUMPLE');
  const otra = procesarItemComparador(f, crudo({ ofertado_valor: 'NCh 9001', veredicto: 'CUMPLE' }), 'Certified NCh 9001');
  assert.equal(otra.columnas.veredicto, null);
  assert.equal(otra.analisis.propuesta, undefined);
});

test('NORMATIVO: una equivalencia CON fuente se propone, y queda esperando a un humano', () => {
  const f = fila({ tipo: 'NORMATIVO', descripcion: 'Certificación', valor_requerido_texto: 'ISO 9001', valor_requerido_numero: null, unidad_requerida: null });
  const r = procesarItemComparador(f, crudo({
    ofertado_valor: 'NCh-ISO 9001', veredicto: 'CUMPLE',
    emparejamiento_propuesto: { parametro_bases: 'ISO 9001', parametro_ficha: 'NCh-ISO 9001', razon: 'homologada', fuente_equivalencia: 'INN, NCh-ISO 9001:2015' },
  }), 'NCh-ISO 9001 certificado');
  // "NCh-ISO 9001" contiene "iso9001" → es literal; probamos entonces una norma realmente distinta:
  const r2 = procesarItemComparador(f, crudo({
    ofertado_valor: 'EN 29001', veredicto: 'CUMPLE',
    emparejamiento_propuesto: { parametro_bases: 'ISO 9001', parametro_ficha: 'EN 29001', razon: 'equivalente', fuente_equivalencia: 'CEN, tabla de equivalencias' },
  }), 'Quality EN 29001');
  assert.equal(r.columnas.veredicto, 'CUMPLE');
  assert.equal(r2.columnas.veredicto, null);
  assert.equal(r2.analisis.propuesta?.tipo, 'equivalencia_normativa');
  assert.equal(r2.analisis.propuesta?.confirmado, null);
  assert.equal(r2.analisis.propuesta?.veredicto_propuesto, 'CUMPLE');
});

test('emparejamiento no literal: nunca escondido dentro de un CUMPLE', () => {
  const r = procesarItemComparador(fila(), crudo({
    emparejamiento_literal: false,
    emparejamiento_propuesto: { parametro_bases: 'Potencia motor', parametro_ficha: 'Engine power', razon: 'mismo parámetro' },
  }), FICHA);
  assert.equal(r.columnas.veredicto, null);
  assert.equal(r.analisis.propuesta?.tipo, 'emparejamiento');
  assert.equal(r.analisis.propuesta?.veredicto_propuesto, 'CUMPLE');
  assert.equal(estadoDeFila({ ...fila(), analisis: r.analisis, veredicto: null }), 'PENDIENTE');
});

test('un dato DECLARADO sin respaldo no cierra; con respaldo pide habilitación del EM', () => {
  const sin = procesarItemComparador(fila(), crudo({ origen_dato: 'DECLARADO' }), FICHA);
  assert.equal(sin.columnas.veredicto, null);
  const con = procesarItemComparador(fila(), crudo({ origen_dato: 'DECLARADO', respaldo_adjunto: 'carta_proveedor.pdf' }), FICHA);
  assert.equal(con.columnas.veredicto, 'CUMPLE');
  assert.equal(con.analisis.requiere_habilitacion, 'EM');
  assert.equal(con.analisis.sobrecumple, false);   // SOBRECUMPLE solo con dato real de la ficha
});

test('CUMPLE CON COMPLEMENTO: accesorio sin cotización ni respaldo no existe; con cotización sí', () => {
  const f = fila({ descripcion: 'Incluye cabina', tipo: 'EXACTO', valor_requerido_numero: null, valor_requerido_texto: 'cabina cerrada' });
  const sin = procesarItemComparador(f, crudo({ ofertado_valor: 'cabina opcional', veredicto: 'CUMPLE_CON_COMPLEMENTO', complemento: { tipo: 'accesorio', descripcion: 'cabina', cotizado: false, respaldo: '' } }), 'cabina opcional');
  assert.equal(sin.columnas.veredicto, null);
  const con = procesarItemComparador(f, crudo({ ofertado_valor: 'cabina opcional', veredicto: 'CUMPLE_CON_COMPLEMENTO', complemento: { tipo: 'accesorio', descripcion: 'cabina', cotizado: true, respaldo: '' } }), 'cabina opcional');
  assert.equal(con.columnas.veredicto, 'CUMPLE_CON_COMPLEMENTO');
});

test('conflicto entre fichas: no se elige', () => {
  const r = procesarItemComparador(fila(), crudo({ conflicto_fuentes: { existe: true, versiones: [
    { documento: 'A.pdf', valor: '93', cita: 'p.2' }, { documento: 'B.pdf', valor: '85', cita: 'p.1' }] } }), FICHA);
  assert.equal(r.columnas.veredicto, null);
  assert.equal(r.analisis.conflicto_fuentes?.existe, true);
});

test('todo ítem no cerrado avisa si su ayuda viene incompleta', () => {
  const r = procesarItemComparador(fila(), crudo({ ofertado_valor: '70', ayuda: { diagnostico: 'faltan 10 HP' } }), 'Engine power 70 HP');
  assert.equal(r.columnas.veredicto, 'NO_CUMPLE');
  assert.ok(r.analisis.notas_sistema?.some(n => n.startsWith('Ayuda incompleta')));
  const completa = procesarItemComparador(fila(), crudo({ ofertado_valor: '70', ayuda: {
    diagnostico: 'faltan 10 HP', hipotesis_causa: ['existe versión XE'], pregunta_proveedor: '¿Hay versión de 93 HP?',
    veredicto_equivalencia: 'No satisface BBTT 4.1', ruta: 'SALVABLE', accion_concreta: 'Pedir ficha XE' } }), 'Engine power 70 HP');
  assert.ok(!completa.analisis.notas_sistema?.some(n => n.startsWith('Ayuda incompleta')));
});

test('estadoDeFila: un CUMPLE crítico de ficha espera reverificación; luego cierra', () => {
  const base = fila({ veredicto: 'CUMPLE', origen: 'ficha', analisis: { ambito: 'tecnico', origen_dato: 'FICHA', requiere_habilitacion: 'no' } });
  assert.equal(estadoDeFila(base), 'PENDIENTE');
  assert.equal(estadoDeFila({ ...base, analisis: { ...base.analisis, reverificado: true } }), 'CUMPLIDA');
  assert.equal(estadoDeFila({ ...base, criticidad: 'PUNTAJE' }), 'CUMPLIDA');
  // filas del flujo anterior (sin analisis del comparador) no se ven afectadas
  assert.equal(estadoDeFila({ ...base, analisis: { ambito: 'tecnico' } }), 'CUMPLIDA');
});

test('estadoDeFila: habilitación del EM y respaldo de lo declarado a mano', () => {
  const base = fila({ criticidad: 'PUNTAJE', veredicto: 'CUMPLE', origen: 'ficha', analisis: { ambito: 'tecnico', origen_dato: 'CONFIRMACION_INFORMAL', requiere_habilitacion: 'EM' } });
  assert.equal(estadoDeFila(base), 'PENDIENTE');
  assert.equal(estadoDeFila({ ...base, analisis: { ...base.analisis, habilitado: { por: 'EM', at: 'x' } } }), 'CUMPLIDA');
  const manual = fila({ criticidad: 'PUNTAJE', veredicto: 'CUMPLE', origen: 'manual', respuesta_manual: true });
  assert.equal(estadoDeFila(manual), 'PENDIENTE');
  assert.equal(estadoDeFila({ ...manual, adjunto_url: 'https://x/y.pdf' }), 'CUMPLIDA');
  assert.equal(estadoDeFila({ ...manual, corregido_at: '2026-09-24' }), 'CUMPLIDA');
});

test('ámbito: garantía y capacitación son técnico-administrativas; una certificación del equipo no', () => {
  assert.equal(ambitoDe({ descripcion: 'Garantía de 24 meses' }, {}), 'administrativo');
  assert.equal(ambitoDe({ descripcion: 'Capacitación de 8 horas' }, {}), 'administrativo');
  assert.equal(ambitoDe({ descripcion: 'Manual de operación en español' }, {}), 'administrativo');
  assert.equal(ambitoDe({ descripcion: 'Certificación de emisiones', tipo: 'NORMATIVO' }, {}), 'tecnico');
  assert.equal(ambitoDe({ descripcion: 'Potencia 80 HP' }, {}), 'tecnico');
  assert.equal(ambitoDe({ descripcion: 'Garantía' }, { ambito: 'tecnico' }), 'tecnico');
});

test('un compromiso administrativo bloquea hasta marcar el check', () => {
  const a = fila({ criticidad: 'INADMISIBLE', descripcion: 'Garantía 24 meses', tipo: 'EXACTO', analisis: { ambito: 'administrativo' } });
  assert.equal(estadoDeFila(a), 'PENDIENTE');
  const marcado = { ...a, veredicto: 'CUMPLE', respuesta_manual: true, analisis: { ambito: 'administrativo' as const, admin: { se_compromete: '24 meses', check_confirmado: true } } };
  assert.equal(estadoDeFila(marcado), 'CUMPLIDA');
});

test('criticidad heredada: lo que no se reconoce queda SIN_CLASIFICAR, nunca COMPROMISO', () => {
  assert.equal(criticidadP4('ADMISIBILIDAD_DURA'), 'INADMISIBLE');
  assert.equal(criticidadP4('PUNTAJE_CONDICIONANTE'), 'PUNTAJE');
  assert.equal(criticidadP4('INFORMATIVO'), 'COMPROMISO');
  assert.equal(criticidadP4(null), 'SIN_CLASIFICAR');
  assert.equal(criticidadP4('lo-que-sea'), 'SIN_CLASIFICAR');
});

test('alerta de sobredimensionamiento al 50% de las medibles', () => {
  const mk = (id: number, sobre: boolean) => fila({ id, veredicto: 'CUMPLE', valor_ofertado_numero: 90, analisis: { ambito: 'tecnico', sobrecumple: sobre } });
  const activa = alertaSobredimensionamiento([mk(1, true), mk(2, true), mk(3, false)]);
  assert.equal(activa.activa, true);
  assert.match(activa.mensaje, /2 de 3 características sobrecumplen/);
  assert.equal(alertaSobredimensionamiento([mk(1, true), mk(2, false), mk(3, false)]).activa, false);
});

test('certificado de admisibilidad: causales rojas con su ruta, ordenadas NO CUMPLIDA → PENDIENTE → CUMPLIDA', () => {
  const cumplida = fila({ id: 1, veredicto: 'CUMPLE', origen: 'ficha', analisis: { ambito: 'tecnico', origen_dato: 'FICHA', reverificado: true, fuente_bases: 'BBTT 4.1' } });
  const roja = fila({ id: 2, descripcion: 'Peso', veredicto: 'NO_CUMPLE', analisis: { ambito: 'tecnico', ayuda: { diagnostico: '', hipotesis_causa: [], pregunta_proveedor: '', veredicto_equivalencia: '', ruta: 'SALVABLE', accion_concreta: 'Pedir ficha XE' } } });
  const pend = fila({ id: 3, descripcion: 'Despacho', tipo: 'EXACTO', analisis: { ambito: 'administrativo' } });
  const puntaje = fila({ id: 4, criticidad: 'PUNTAJE', veredicto: 'NO_CUMPLE' });
  const cert = certificadoAdmisibilidad([cumplida, roja, pend, puntaje]);
  assert.deepEqual(cert.map(c => c.estado), ['NO_CUMPLIDA', 'PENDIENTE', 'CUMPLIDA']);
  assert.equal(cert[0].ruta_cierre, 'Pedir ficha XE');
  assert.equal(cert[2].ruta_cierre, '');
  const bloqueos = bloqueosDeLinea([cumplida, roja, pend], { asignacionesSinConfirmar: 1, lineaSinFicha: false });
  assert.ok(bloqueos.every(b => b.ruta_desbloqueo));
  assert.equal(bloqueos.length, 3);
});

test('resumen global calculado por código, solo sobre lo técnico', () => {
  const r = resumenComparador([
    fila({ id: 1, veredicto: 'CUMPLE' }), fila({ id: 2, veredicto: 'NO_CUMPLE' }),
    fila({ id: 3, veredicto: null, pendiente_confirmacion_proveedor: true }),
    fila({ id: 4, descripcion: 'Garantía', analisis: { ambito: 'administrativo' } }),
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.cumplen, 1);
  assert.equal(r.noCumplen, 1);
});

test('reverificación: coincide → confirma; valor distinto o fuera de la ficha → rectifica', () => {
  const f = fila({ valor_ofertado_numero: 93, valor_convertido_numero: 93 });
  assert.equal(evaluarReverificacion(f, { confirmado: true, valor_releido: '93', unidad_releida: 'HP', cita: 'p.3' }, FICHA).confirmado, true);
  assert.equal(evaluarReverificacion(f, { confirmado: true, valor_releido: '85', unidad_releida: 'HP' }, 'Engine power 85 HP').confirmado, false);
  assert.equal(evaluarReverificacion(f, { confirmado: true, valor_releido: '93' }, 'sin ese dato').confirmado, false);
  assert.equal(evaluarReverificacion(f, { confirmado: true, valor_releido: '70', unidad_releida: 'HP' }, 'Engine power 70 HP').confirmado, false);
  assert.equal(evaluarReverificacion(f, { confirmado: false, rectificacion: 'no aparece' }, FICHA).confirmado, false);
});

test('normasDe: reconoce siglas con número', () => {
  assert.deepEqual(normasDe('cumple norma ISO 9001 y NCh 2437'), ['iso9001', 'nch2437']);
});

const ficha = (o: Partial<FichaInventariada>): FichaInventariada => ({
  archivo: 'a.pdf', url: 'u/a', tipo: 'ficha_producto', marca: 'CAT', modelos: ['420'], tipo_equipo: 'retroexcavadora',
  idioma_original: 'es', traducido: false, emisor: 'fabricante', proveedor: 'Finning', formalidad: 'formal', legibilidad: 'completa',
  no_legible_detalle: '', duplicado_de: null, corresponde_licitacion: true, motivo_no_corresponde: '', candidatos: [], largo_texto: 1000, ...o,
});

test('inventario: dos archivos del mismo modelo se agrupan y el más completo queda de principal', () => {
  const r = marcarDuplicados([ficha({ archivo: 'corta.pdf', largo_texto: 500 }), ficha({ archivo: 'larga.pdf', largo_texto: 5000 }), ficha({ archivo: 'otra.pdf', modelos: ['430'] })]);
  assert.equal(r.find(f => f.archivo === 'corta.pdf')!.duplicado_de, 'larga.pdf');
  assert.equal(r.find(f => f.archivo === 'larga.pdf')!.duplicado_de, null);
  assert.equal(r.find(f => f.archivo === 'otra.pdf')!.duplicado_de, null);
});

test('asignación: un catálogo con varios modelos NO se cierra solo; una ficha ajena o ilegible queda sin asignar', () => {
  const catalogo = ficha({ archivo: 'cat.pdf', tipo: 'catalogo_familia', modelos: ['420', '430'], candidatos: [{ modelo: '430', razon: 'más potencia' }] });
  const unica = ficha({ archivo: 'u.pdf' });
  const ajena = ficha({ archivo: 'x.pdf', corresponde_licitacion: false, motivo_no_corresponde: 'es un generador' });
  const ilegible = ficha({ archivo: 'y.jpg', legibilidad: 'nula', no_legible_detalle: 'imagen' });
  const p = proponerAsignacion([catalogo, unica, ajena, ilegible]);
  assert.equal(p.mapa.find(m => m.archivo === 'cat.pdf')!.confirmado_por_humano, false);
  assert.equal(p.mapa.find(m => m.archivo === 'cat.pdf')!.modelo_propuesto, '430');
  assert.equal(p.mapa.find(m => m.archivo === 'u.pdf')!.confirmado_por_humano, true);
  assert.equal(p.sinAsignar.length, 2);
  assert.match(p.sinAsignar[0].motivo, /NO CORRESPONDE/);
  const conElegido = proponerAsignacion([catalogo], { 'cat.pdf': '420' });
  assert.equal(conElegido.mapa[0].confirmado_por_humano, true);
  assert.equal(conElegido.mapa[0].modelo_propuesto, '420');
});

test('mensajes: UN mensaje por proveedor con todos sus productos', () => {
  const m = mensajesPorProveedor([
    { proveedor: 'Finning', producto: 'CAT 420', pregunta: '¿Versión de 93 HP?' },
    { proveedor: 'Finning', producto: 'CAT 430', pregunta: '¿Nivel de ruido en dB?' },
    { proveedor: 'Bomtec', producto: 'Bomba X', pregunta: '¿Caudal?' },
    { proveedor: 'Finning', producto: 'CAT 420', pregunta: '¿Versión de 93 HP?' },
  ]);
  assert.equal(m.length, 2);
  const f = m.find(x => x.proveedor === 'Finning')!;
  assert.deepEqual(f.productos_incluidos, ['CAT 420', 'CAT 430']);
  assert.equal((f.mensaje.match(/93 HP/g) || []).length, 1);
});

// ─── Los prompts son EXACTAMENTE los bloques del .md (nada retipeado) ──────────────────────────
import { readFileSync } from 'node:fs';
import * as PROMPTS from '../auditor-comparador-prompts';
import { SYS_L1, SYS_L2, SYS_L3 } from '../auditor-comparador';

test('los prompts generados coinciden con los bloques del .md (si falla: node scripts/generar-prompts-comparador.mjs)', () => {
  const md = readFileSync(new URL('../../../docs/PROMPT_4_AUDITOR_TECNICO_COMPARADOR.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const porParte = new Map<string, string>();
  const lineas = md.split(String.fromCharCode(10));
  let parte: string | null = null;
  for (let i = 0; i < lineas.length; i++) {
    const h = lineas[i].match(/^# PARTE ([IVX]+) /);
    if (h) parte = h[1];
    if (parte && lineas[i].startsWith('```') && !porParte.has(parte)) {
      const fin = lineas.findIndex((l, j) => j > i && l.startsWith('```'));
      porParte.set(parte, lineas.slice(i + 1, fin).join(String.fromCharCode(10)));
      i = fin;
    }
  }
  assert.equal(porParte.size, 12);
  for (const [parte, texto] of porParte) assert.equal((PROMPTS as Record<string, string>)[`PARTE_${parte}`], texto, `PARTE ${parte} difiere del .md`);
});

test('cada llamada arma las PARTES que le tocan (L1: I–III · L2: I, II, IV–VII, X, XII · L3: I y IX)', () => {
  for (const p of ['PARTE_I', 'PARTE_II', 'PARTE_III'] as const) assert.ok(SYS_L1.includes(PROMPTS[p]));
  for (const p of ['PARTE_I', 'PARTE_II', 'PARTE_IV', 'PARTE_V', 'PARTE_VI', 'PARTE_VII', 'PARTE_X', 'PARTE_XII'] as const) assert.ok(SYS_L2.includes(PROMPTS[p]));
  for (const p of ['PARTE_I', 'PARTE_IX'] as const) assert.ok(SYS_L3.includes(PROMPTS[p]));
  assert.ok(!SYS_L2.includes(PROMPTS.PARTE_III));   // el inventario es otra llamada
  assert.ok(!SYS_L3.includes(PROMPTS.PARTE_VI));
});
