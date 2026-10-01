// PRE-POSTULACIÓN: certificado de admisibilidad, bloque técnico-administrativo y candado de anexos.
//   npx tsx --test app/lib/__tests__/auditor-prepostulacion-core.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  armarCertificado, evaluarCandado, claveDeCompromiso, repetidosDeCompromisos, materiaLegible, itemAbierto, itemVigente, motivoCandado,
  type LineaParaCertificado, type ItemPrePost,
} from '../auditor-prepostulacion-core';
import type { FilaTecnica, ResultadoTecnico } from '../auditor-tecnico-v2-core';
import { evaluarAvance } from '../auditor-opciones-core';

const fila = (p: Partial<FilaTecnica>): FilaTecnica => ({
  n: 1, requeridoTexto: 'Norma DIN 5032-7 Clase B', fuenteBases: 'Bases técnicas, numeral 3', criticidad: 'INADMISIBLE', criticidadSospechosa: false,
  veredicto: 'CUMPLE', resumenPartes: '', partes: [], origen: 'FICHA', habilitacion: 'no', habilitado: true, motivoHabilitacion: null,
  cerrada: true, motivoPendiente: null, ayuda: null, ayudaIncompleta: false, valorCorto: '', sobrecumple: false, rojo: true,
  rutaCierre: '', cambio: '', rectificacion: '', reverificado: true, ...p,
});
const resultado = (filas: FilaTecnica[]) => ({ filas } as unknown as ResultadoTecnico);
const linea = (o: Partial<LineaParaCertificado> & { filas?: FilaTecnica[]; via?: 'liviana' | 'completa'; tecnicoEstado?: string }): LineaParaCertificado => ({
  filaId: o.filaId ?? 'f1', item: o.item ?? 1, detalle: 'Luminancímetro', noOfertada: o.noOfertada ?? false,
  aprobada: o.aprobada === undefined ? { id: 10, marca: 'Konica', modelo: 'LS-150', via: o.via ?? 'completa', tecnicoEstado: o.tecnicoEstado ?? 'CUMPLE', resultado: o.filas ? resultado(o.filas) : null, segundaPasadaAt: null } : o.aprobada,
});

// ── Certificado ──
test('un 🔴 cerrado y reverificado queda CUMPLIDA', () => {
  const c = armarCertificado([linea({ filas: [fila({})] })]);
  assert.equal(c.total, 1); assert.equal(c.cumplidas, 1); assert.equal(c.limpio, true);
});

test('un 🔴 declarado CUMPLE sin segunda pasada queda PENDIENTE (SEGUNDA_PASADA) y pide correrla', () => {
  const c = armarCertificado([linea({ filas: [fila({ reverificado: false })] })]);
  assert.equal(c.lineas[0].causales[0].estado, 'PENDIENTE');
  assert.equal(c.lineas[0].causales[0].motivoPendiente, 'SEGUNDA_PASADA');
  assert.equal(c.lineas[0].requiereSegundaPasada, true);
  assert.equal(c.limpio, false);
});

test('NO CUMPLE → NO_CUMPLIDA, con la ruta de salida del verificador', () => {
  const c = armarCertificado([linea({ filas: [fila({ veredicto: 'NO_CUMPLE', cerrada: false, rutaCierre: 'Pedir la ficha del modelo que sí cumple.' })] })]);
  assert.equal(c.lineas[0].causales[0].estado, 'NO_CUMPLIDA');
  assert.match(c.lineas[0].causales[0].rutaCierre, /ficha/);
});

test('pendiente conserva RIESGO / POR_AFINAR del verificador técnico', () => {
  const c = armarCertificado([linea({ filas: [
    fila({ n: 1, veredicto: 'SIN_VEREDICTO', cerrada: false, motivoPendiente: 'RIESGO', rutaCierre: 'Confirmar menús en español con el proveedor.' }),
    fila({ n: 2, veredicto: 'SIN_VEREDICTO', cerrada: false, motivoPendiente: 'POR_AFINAR', rutaCierre: 'Cotizar el certificado de calibración.' }),
  ] })]);
  assert.deepEqual(c.lineas[0].causales.map(x => x.motivoPendiente), ['RIESGO', 'POR_AFINAR']);
  assert.equal(c.pendientes, 2);
});

test('solo entran las causales rojas: un PUNTAJE o COMPROMISO no va al certificado', () => {
  const c = armarCertificado([linea({ filas: [fila({ n: 1 }), fila({ n: 2, rojo: false, criticidad: 'PUNTAJE', veredicto: 'SIN_VEREDICTO', cerrada: false })] })]);
  assert.equal(c.total, 1);
});

test('criticidad sin clasificar es causal abierta (nunca se da por cumplida)', () => {
  const c = armarCertificado([linea({ filas: [fila({ criticidad: 'SIN_CLASIFICAR', cerrada: false, veredicto: 'CUMPLE', motivoPendiente: 'RIESGO' })] })]);
  assert.equal(c.lineas[0].causales[0].estado, 'PENDIENTE');
});

test('línea NO OFERTADA queda fuera del certificado; línea sin opción aprobada se marca sinOpcion', () => {
  const c = armarCertificado([linea({ filaId: 'a', noOfertada: true, filas: [fila({ veredicto: 'NO_CUMPLE', cerrada: false })] }), linea({ filaId: 'b', item: 2, aprobada: null })]);
  assert.equal(c.lineas.length, 1);
  assert.equal(c.lineas[0].sinOpcion, true);
  assert.equal(c.total, 0);
});

test('opción de vía completa aprobada SIN verificación técnica no se da por limpia', () => {
  const c = armarCertificado([linea({ tecnicoEstado: 'NO_CORRIDO' })]);
  assert.equal(c.lineas[0].causales[0].motivoPendiente, 'SIN_VERIFICAR');
  assert.equal(c.limpio, false);
});

test('vía liviana o línea sin requisitos: sin causales y certificado limpio', () => {
  assert.equal(armarCertificado([linea({ via: 'liviana', tecnicoEstado: 'NO_APLICA' })]).limpio, true);
  assert.equal(armarCertificado([linea({ tecnicoEstado: 'SIN_REQUISITOS' })]).limpio, true);
});

// ── Bloque técnico-administrativo ──
const item = (o: Partial<ItemPrePost> = {}): ItemPrePost => ({
  id: 1, filaId: 'f1', origen: 'ia', materia: 'capacitacion', exigeBaseLiteral: 'Capacitación de 8 horas', fuenteBases: 'Bases §7',
  seCompromete: '8 horas de capacitación', cuantificacion: '8 horas', criticidad: 'COMPROMISO', costoAsociadoId: null,
  confirmado: false, confirmadoPorNombre: null, confirmadoAt: null, noAplica: false, nota: null, costo: null, ...o,
});

test('un ítem sin confirmar está abierto; confirmado o "no aplica" no', () => {
  assert.equal(itemAbierto(item()), true);
  assert.equal(itemAbierto(item({ confirmado: true })), false);
  assert.equal(itemAbierto(item({ noAplica: true })), false);
});

test('un compromiso cuyo costo asociado se anuló ya no es vigente ni bloquea', () => {
  const i = item({ origen: 'costo_asociado', costo: { anulado: true, montoEstimado: null } });
  assert.equal(itemVigente(i), false);
  assert.equal(itemAbierto(i), false);
});

test('la clave del compromiso ignora mayúsculas, tildes y puntuación', () => {
  assert.equal(claveDeCompromiso('f1', 'Capacitación', 'Capacitación de 8 horas.'), claveDeCompromiso('f1', 'capacitacion', 'CAPACITACION de 8 horas'));
  assert.notEqual(claveDeCompromiso('f1', 'capacitacion', 'x'), claveDeCompromiso('f2', 'capacitacion', 'x'));
});

// ── Candado ──
const avanceOk = evaluarAvance({ modalidad: null, lineas: [{ filaId: 'f1', item: 1, noOfertada: false, tieneAprobada: true }] });
const certLimpio = armarCertificado([linea({ filas: [fila({})] })]);

test('todo en orden: se pueden generar los anexos, sin causales', () => {
  const r = evaluarCandado({ avance: avanceOk, certificado: certLimpio, items: [item({ confirmado: true })], lineasSinRevisar: [] });
  assert.equal(r.puedeGenerarAnexos, true);
  assert.deepEqual(r.causales, []);
  assert.equal(r.resumen.confirmados, 1);
});

test('cada causal trae su ruta de desbloqueo (nunca "bloqueado" a secas)', () => {
  const avance = evaluarAvance({ modalidad: null, lineas: [{ filaId: 'f1', item: 1, noOfertada: false, tieneAprobada: false }] });
  const cert = armarCertificado([linea({ filaId: 'f2', item: 2, filas: [fila({ reverificado: false }), fila({ n: 2, veredicto: 'NO_CUMPLE', cerrada: false })] })]);
  const r = evaluarCandado({ avance, certificado: cert, items: [item()], lineasSinRevisar: [3] });
  assert.equal(r.puedeGenerarAnexos, false);
  assert.deepEqual(r.causales.map(c => c.codigo).sort(), [
    'PREPOST_CERTIFICADO_NO_CUMPLE', 'PREPOST_CERTIFICADO_PENDIENTE', 'PREPOST_LINEAS_SIN_APROBAR', 'PREPOST_TECADM_SIN_CONFIRMAR', 'PREPOST_TECADM_SIN_REVISAR',
  ]);
  for (const c of r.causales) assert.ok(c.rutaDesbloqueo.length > 10, c.codigo);
  assert.match(motivoCandado(r), /5 pendientes/);
});

test('una línea sin revisar bloquea aunque no haya ítems; "no aplica" y anulados no cuentan como abiertos', () => {
  const r = evaluarCandado({ avance: avanceOk, certificado: certLimpio, items: [item({ noAplica: true }), item({ id: 2, origen: 'costo_asociado', costo: { anulado: true, montoEstimado: null } })], lineasSinRevisar: [1] });
  assert.deepEqual(r.causales.map(c => c.codigo), ['PREPOST_TECADM_SIN_REVISAR']);
  assert.equal(r.resumen.abiertos, 0);
});

test('costo asociado sin estimar y compromiso sin cuantificar solo avisan, no bloquean', () => {
  const r = evaluarCandado({
    avance: avanceOk, certificado: certLimpio, lineasSinRevisar: [],
    items: [item({ id: 1, origen: 'costo_asociado', confirmado: true, costo: { anulado: false, montoEstimado: null } }), item({ id: 2, confirmado: true, cuantificacion: 'no cuantificado' })],
  });
  assert.equal(r.puedeGenerarAnexos, true);
  assert.equal(r.alertas.length, 2);
});

test('licitación GLOBAL con una línea no ofertada: el avance lo bloquea y el candado lo hereda', () => {
  const avance = evaluarAvance({ modalidad: 'suma_alzada', lineas: [{ filaId: 'f1', item: 1, noOfertada: false, tieneAprobada: true }, { filaId: 'f2', item: 2, noOfertada: true, tieneAprobada: false }] });
  const r = evaluarCandado({ avance, certificado: certLimpio, items: [], lineasSinRevisar: [] });
  assert.equal(r.puedeGenerarAnexos, false);
  assert.match(r.causales[0].descripcion, /GLOBAL/);
});

test('compromisos repetidos: el mismo compromiso detectado varias veces con el texto apenas distinto queda UNO; materias o ámbitos distintos no se mezclan', () => {
  const x = (id: number, materia: string, texto: string, filaId: string | null = null, prioridad = 1) => ({ id, filaId, materia, texto, prioridad });
  const r = repetidosDeCompromisos([
    x(1, 'garantia_extendida', 'Garantía Extendida (meses) declarada en Anexo N°5; puntaje = garantía evaluada / mayor garantía ofertada'),
    x(2, 'garantia_extendida', "Criterio 'Garantía Extendida': Puntaje = (garantía evaluada / mayor garantía ofertada) x 7 en el Anexo N°5"),
    x(3, 'garantia_extendida', 'Garantía Extendida (meses) — Anexo N°5 Propuesta Técnica; garantía evaluada contra la mayor garantía ofertada', null, 0),   // confirmado: es el que se conserva
    x(4, 'despacho', 'Plazo de entrega máximo 20 días hábiles'),
    x(5, 'garantia_extendida', 'Garantía Extendida (meses) declarada en Anexo N°5; puntaje = garantía evaluada / mayor garantía ofertada', 'f1'),   // otra línea: no se mezcla
    x(6, 'otro', 'Garantía de fiel cumplimiento exigida (5% del valor neto), en forma de póliza'),
    x(7, 'otro', 'Seriedad de la oferta exigida'),                                                                                                       // «otro» exige más parecido
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].queda, 3); assert.deepEqual(r[0].sobran.sort(), [1, 2]);
  assert.equal(materiaLegible('garantia_extendida'), 'Garantía extendida'); assert.equal(materiaLegible('cosa_rara'), 'Cosa rara');
});

test('candado: el mismo aviso no se repite, se cuenta (×N) y la materia sale legible', () => {
  const item = (id: number): ItemPrePost => ({ id, filaId: null, origen: 'costo_asociado', materia: 'garantia_extendida', exigeBaseLiteral: 'x', fuenteBases: '', seCompromete: 'no cuantificado', cuantificacion: 'no cuantificado', criticidad: 'PUNTAJE', costoAsociadoId: id, confirmado: false, confirmadoPorNombre: null, confirmadoAt: null, noAplica: false, nota: null, costo: { anulado: false, montoEstimado: null } });
  const c = evaluarCandado({ avance: { puede: true, mensaje: '', ofertadas: 1, aprobadas: 1, noOfertadas: 0, pendientes: [] } as any, certificado: { lineas: [], total: 0, cumplidas: 0, noCumplidas: 0, pendientes: 0, limpio: true }, items: [item(1), item(2), item(3)], lineasSinRevisar: [] });
  assert.equal(c.alertas.length, 2);                       // «tiene costo sin estimar» + «no cuantifican», cada una UNA vez
  assert.ok(c.alertas.every(a => a.veces === 3));
  assert.match(c.alertas[0].texto, /Garantía extendida/);
});
