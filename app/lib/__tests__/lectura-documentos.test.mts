// Tests de la GARANTÍA DE LECTURA (26-ago-2026).
// Nacen de un caso real medido: 1.889 documentos en formato legible quedaron sin texto en 375
// licitaciones que igual entregaron informe — 240 sin leer sus bases administrativas. Al
// reintentarlos, 9 de cada 10 se leyeron sin problema. Estos tests fijan que eso no vuelva a
// pasar en silencio.
//   npx tsx --test app/lib/__tests__/lectura-documentos.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  esFormatoLegible, esDocumentoCritico, evaluarCoberturaLectura, resumirCobertura, extensionDe,
} from '../lectura-documentos';

test('formato legible: los que el sistema sabe leer cuentan; los que no, no', () => {
  for (const n of ['BASES.pdf', 'anexo.docx', 'FORM.doc', 'itemizado.xlsx', 'viejo.xls'])
    assert.equal(esFormatoLegible(n), true, `${n} debería contar como legible`);
  for (const n of ['planos.rar', 'proyecto.zip', 'corte.dwg', 'mapa.kmz', 'foto.jpg'])
    assert.equal(esFormatoLegible(n), false, `${n} NO debería contar como fallo de lectura`);
});

// Mercado Público a veces entrega el archivo sin extensión ("download"). No se puede afirmar que
// sea legible, así que no se cuenta como fallo nuestro.
test('archivo sin extensión no se cuenta como fallo de lectura', () => {
  assert.equal(extensionDe('download'), '');
  assert.equal(esFormatoLegible('download'), false);
});

test('un formato desconocido NO se cuela como "no me tocaba"', () => {
  assert.equal(esFormatoLegible('bases.odt'), false, 'odt no está soportado, no debe contar como legible');
  assert.equal(esFormatoLegible('bases.pdf'), true);
});

test('documento crítico: bases y anexos sí; nuestros propios archivos no', () => {
  assert.equal(esDocumentoCritico('BASES_ADMINISTRATIVAS', 'x.pdf'), true);
  assert.equal(esDocumentoCritico('BASES_TECNICAS', 'x.pdf'), true);
  assert.equal(esDocumentoCritico('ANEXOS_ECONOMICOS', 'x.xlsx'), true);
  assert.equal(esDocumentoCritico('DOCUMENTOS_PROPIOS', 'COSTEO_123.xlsx'), false,
    'el Excel que genera este mismo sistema no puede ser fuente de verdad');
  assert.equal(esDocumentoCritico('DOCUMENTOS_PROCESO', 'acta.pdf'), false);
});

// La clasificación de documentos corre DESPUÉS de la descarga: al analizar, muchos vienen sin
// categoría. Un archivo llamado "bases" es crítico aunque nadie lo haya clasificado todavía.
test('sin categoría, el nombre decide: "bases" o "anexo económico" son críticos', () => {
  assert.equal(esDocumentoCritico(null, 'BASES_ADMINISTRATIVAS_E-44.pdf'), true);
  assert.equal(esDocumentoCritico('', 'Formulario_oferta_económica.doc'), true);
  assert.equal(esDocumentoCritico('OTROS', 'EETT_equipos.pdf'), true);
  assert.equal(esDocumentoCritico(null, 'foto_del_terreno.pdf'), false);
});

test('cobertura completa cuando todo lo legible se leyó', () => {
  const c = evaluarCoberturaLectura([
    { nombre: 'BASES.pdf', categoria: 'BASES_ADMINISTRATIVAS', texto: 'x'.repeat(500) },
    { nombre: 'EETT.docx', categoria: 'BASES_TECNICAS', texto: 'y'.repeat(500) },
    { nombre: 'planos.rar', categoria: 'OTROS', texto: '' },
  ]);
  assert.equal(c.completa, true);
  assert.equal(c.legibles, 2);
  assert.equal(c.leidos, 2);
  assert.equal(c.cobertura, 1);
  assert.deepEqual(c.noLegibles, ['planos.rar'], 'el .rar no debe contarse como fallo');
});

// EL CASO QUE ORIGINA TODO: el informe salió igual, sin marca de nada.
test('bases sin leer ⇒ expediente INCOMPLETO (regresión de las 240 licitaciones)', () => {
  const c = evaluarCoberturaLectura([
    { nombre: 'BASES_ADMINISTRATIVAS.pdf', categoria: 'BASES_ADMINISTRATIVAS', texto: '' },
    { nombre: 'anexo1.docx', categoria: 'ANEXOS_OFERENTE', texto: 'z'.repeat(500) },
  ]);
  assert.equal(c.completa, false, 'un informe sin las bases NO puede darse por completo');
  assert.deepEqual(c.criticosFaltantes, ['BASES_ADMINISTRATIVAS.pdf']);
  assert.match(resumirCobertura(c), /FALTAN 1 CRÍTICOS/);
});

test('un documento con texto DEMASIADO corto cuenta como no leído', () => {
  const c = evaluarCoberturaLectura([
    { nombre: 'BASES.pdf', categoria: 'BASES_ADMINISTRATIVAS', texto: '[[PÁGINA 1]]' },
  ]);
  assert.equal(c.leidos, 0, '12 caracteres no son un documento leído');
  assert.equal(c.completa, false);
});

test('faltar algo NO crítico no invalida el informe, pero queda registrado', () => {
  const c = evaluarCoberturaLectura([
    { nombre: 'BASES.pdf', categoria: 'BASES_ADMINISTRATIVAS', texto: 'x'.repeat(500) },
    { nombre: 'acta_reunion.pdf', categoria: 'DOCUMENTOS_PROCESO', texto: '' },
  ]);
  assert.equal(c.completa, true, 'un acta ilegible no invalida el análisis');
  assert.deepEqual(c.faltantes, ['acta_reunion.pdf'], 'pero igual queda anotada');
  assert.equal(c.cobertura, 0.5);
});

test('sin documentos legibles la cobertura es 1 y no inventa un fallo', () => {
  const c = evaluarCoberturaLectura([{ nombre: 'planos.dwg', categoria: 'OTROS', texto: '' }]);
  assert.equal(c.cobertura, 1);
  assert.equal(c.completa, true);
  assert.equal(resumirCobertura(c), 'sin documentos legibles que leer');
});

// ─── Los tres puntos del flujo que hacen cumplir la garantía ────────────────────────────────
// Sin cualquiera de ellos la garantía se cae en silencio, que es exactamente como se acumularon
// los 1.889 fallos invisibles. Se verifican sobre el código fuente.

test('el fallo de lectura SE PERSISTE (si no, queda indistinguible de "nunca se intentó")', () => {
  const src = readFileSync('app/lib/viabilidad-ia.ts', 'utf8');
  const i = src.indexOf('Persistir SIEMPRE el resultado de la lectura');
  assert.ok(i > 0, 'falta la persistencia del intento fallido en cargarDocumentos');
  const bloque = src.slice(i, i + 1600);
  assert.match(bloque, /else\s*\{[\s\S]*?UPDATE documentos_cache SET metodo_extraccion/,
    'el camino de FALLO debe escribir metodo_extraccion; sin eso vuelve a quedar en NULL');
});

test('los críticos ilegibles se reintentan ANTES de gastar IA', () => {
  const src = readFileSync('app/lib/viabilidad-ia.ts', 'utf8');
  assert.match(src, /SEGUNDA PASADA sobre los CR[IÍ]TICOS/,
    'falta la segunda pasada: sin ella un documento recuperable se pierde hasta el próximo re-análisis (que cuesta IA)');
  assert.match(src, /const aReintentar = out\.filter\(d => !d\.ok && esFormatoLegible\(d\.nombre\) && esDocumentoCritico\(/,
    'la segunda pasada debe filtrar por formato legible Y criticidad');
});

test('la cobertura viaja al informe y V-17 la convierte en decisión', () => {
  const via = readFileSync('app/lib/viabilidad-ia.ts', 'utf8');
  assert.match(via, /_cobertura_lectura: cobertura/, 'la cobertura debe guardarse en el informe');
  const val = readFileSync('app/lib/validador-viabilidad.ts', 'utf8');
  assert.match(val, /function v17_expedienteCompleto/, 'falta la regla V-17');
  assert.match(val, /v17_expedienteCompleto,/, 'V-17 no está registrada en el array REGLAS');
  assert.match(val, /REGLAS_A_REVISION_HUMANA = new Set\(\[[^\]]*'V-17'/,
    'V-17 debe mandar el informe a revisión humana');
});

test('V-17 no opina sobre informes viejos que no traen el dato', () => {
  const val = readFileSync('app/lib/validador-viabilidad.ts', 'utf8');
  const i = val.indexOf('function v17_expedienteCompleto');
  const cuerpo = val.slice(i, val.indexOf('\n}', i));
  assert.match(cuerpo, /if \(!c \|\| typeof c !== 'object'\) return;/,
    'sin cobertura registrada la regla debe callarse, no marcar todo como incompleto');
});
