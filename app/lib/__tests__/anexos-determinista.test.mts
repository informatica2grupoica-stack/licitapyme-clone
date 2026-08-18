// Motor DETERMINISTA de anexos (anexos-determinista.ts, 17-ago-2026). Cada regla del motor tiene
// su test acá — esa es la razón de ser del cambio: el prompt que reemplaza no tenía UN SOLO test
// que lo ejercitara, y por eso dos regresiones verificadas en un día pasaron los 227 tests sin
// despeinarse. Los casos con código de licitación son documentos reales del banco de pruebas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolverDeterminista, campoDeEtiquetaInequivoca, resolverPeladaPorBloque,
  campoDeBlancoInline, clasificarPendiente, normalizarEtiqueta, direccionSinComuna,
  esBloqueDesignadoPorNosotros, encabezadoDeSeccionMasCercano,
} from '../anexos-determinista';
import type { EmpresaCampos, Resolucion } from '../anexos-ia-motor';
import type { CandidatoCelda, CandidatoInline } from '../anexos-detectar';
import type { Parrafo } from '../anexos-docx';

const EMPRESA: EmpresaCampos = {
  razon_social: 'Comercial Los Robles SpA', rut: '76.902.659-2',
  direccion: 'Av. Alemania 0671, Temuco', region: 'Región de La Araucanía', giro: 'Venta de equipos',
  tipo_persona_juridica: 'SpA', fecha_sociedad: null, fecha_escritura: null, notaria: null,
  numero_repertorio: null, fojas_numero_anio: null,
  representante_nombre: 'Lidia Valenzuela Soto', representante_rut: '6.736.698-0',
  representante_cargo: 'Gerente General',
  email1: 'contacto@losrobles.cl', telefono1: '+56 45 2 123456',
  banco_tipo_cuenta: null, banco_numero: null, banco_nombre: null, banco_email: null,
  banco_titular_nombre: null, banco_titular_rut: null, firma_url: null, timbre_url: null,
  licitacion_comuna: 'Nueva Imperial', licitacion_codigo: '3713-7-LE26',
} as EmpresaCampos;

const parrafo = (indice: number, texto: string): Parrafo => ({
  paraId: `p${indice}`, texto, vacio: !texto, indice,
  centrado: false, bordeInferior: false, tapadoPorCuadroOpaco: false,
});
const celda = (indice: number, etiqueta: string, extra: Partial<CandidatoCelda> = {}): CandidatoCelda =>
  ({ etiqueta, paraId: `p${indice}`, indice, ...extra });
/** Valor auto de una casilla, o null si quedó pendiente — evita repetir el narrowing en cada test. */
const valorAuto = (m: Map<number | string, Resolucion>, k: number | string): string | null => {
  const r = m.get(k);
  return r?.tipo === 'auto' ? r.valor : null;
};
const blanco = (parrafoCompleto: string, posEnParrafo: number, extra: Partial<CandidatoInline> = {}): CandidatoInline => ({
  indiceRun: 1, indiceParrafo: 1, textoRunOriginal: parrafoCompleto, posEnTexto: posEnParrafo,
  largo: 5, contexto: parrafoCompleto, parrafoCompleto, posEnParrafo, ...extra,
});

// ── Capa 1: diccionario de etiquetas inequívocas ─────────────────────────────────────────────
test('diccionario: la MISMA pregunta con los remates de distintos organismos cae en el mismo campo', () => {
  for (const e of ['RUT', 'R.U.T.', 'Rut del oferente', 'R.U.T. DEL PROPONENTE', 'Rol Único Tributario de la empresa']) {
    assert.equal(campoDeEtiquetaInequivoca(e), 'rut', e);
  }
  for (const e of ['Razón Social', 'Nombre o Razón Social', 'NOMBRE COMPLETO O RAZÓN SOCIAL DEL PROPONENTE', 'Nombre de la Empresa']) {
    assert.equal(campoDeEtiquetaInequivoca(e), 'razon_social', e);
  }
});

test('diccionario: la etiqueta que ya nombra al representante no depende del contexto', () => {
  assert.equal(campoDeEtiquetaInequivoca('NOMBRE REPRESENTANTE LEGAL'), 'representante_nombre');
  assert.equal(campoDeEtiquetaInequivoca('Nombre completo del apoderado'), 'representante_nombre');
  assert.equal(campoDeEtiquetaInequivoca('Cédula de Identidad N°'), 'representante_rut');
  assert.equal(campoDeEtiquetaInequivoca('RUT del representante legal'), 'representante_rut');
  assert.equal(campoDeEtiquetaInequivoca('Cargo del representante'), 'representante_cargo');
});

test('diccionario: es CONSERVADOR — las etiquetas ambiguas NO entran (las decide el bloque)', () => {
  for (const e of ['Nombre', 'NOMBRE', 'Firma', 'Observaciones']) {
    assert.equal(campoDeEtiquetaInequivoca(e), null, e);
  }
});

test('diccionario: "Cargo" pelado SÍ entra — no existe un cargo de la empresa que compita', () => {
  // A diferencia de "Nombre"/"RUT" (que tienen dos titulares posibles en el mismo bloque), el
  // cargo solo puede ser el de la persona que suscribe. Dejarlo ambiguo pendiente no protegía nada.
  assert.equal(campoDeEtiquetaInequivoca('Cargo'), 'representante_cargo');
  assert.equal(campoDeEtiquetaInequivoca('Cargo o función'), 'representante_cargo');
});

test('diccionario: normaliza tildes, numeración de lista y "(si correspondiere)"', () => {
  assert.equal(normalizarEtiqueta('3. DIRECCIÓN (comercial):'), 'direccion');
  assert.equal(campoDeEtiquetaInequivoca('1) Giro comercial:'), 'giro');
  assert.equal(campoDeEtiquetaInequivoca('Comuna (si correspondiere)'), 'comuna');
});

test('diccionario: los datos de ESTA licitación salen de la API de MP, no de un juicio', () => {
  assert.equal(campoDeEtiquetaInequivoca('ID Licitación Pública'), 'licitacion_codigo');
  assert.equal(campoDeEtiquetaInequivoca('Nombre Licitación Pública'), 'licitacion_nombre');
  assert.equal(campoDeEtiquetaInequivoca('Organismo comprador'), 'licitacion_organismo');
});

// ── Capa 2: desambiguación por bloque ────────────────────────────────────────────────────────
test('REGRESIÓN 1058086-43-LP26 Anexo N°5: con "NOMBRE DE LA EMPRESA" al lado, el NOMBRE pelado es la PERSONA', () => {
  const hermanas = ['nombre', 'rut', 'nombre de la empresa'];
  assert.equal(resolverPeladaPorBloque('NOMBRE', hermanas, '', false), 'representante_nombre');
  // Y el RUT pelado sigue al nombre de su propio bloque — nunca se mezcla la persona con la empresa.
  assert.equal(resolverPeladaPorBloque('RUT', hermanas, '', false), 'representante_rut');
});

test('bloque: si la casilla propia de la persona ya existe, el pelado es la EMPRESA', () => {
  const hermanas = ['nombre', 'rut', 'nombre del representante legal'];
  assert.equal(resolverPeladaPorBloque('NOMBRE', hermanas, '', false), 'razon_social');
  assert.equal(resolverPeladaPorBloque('RUT', hermanas, '', false), 'rut');
});

test('bloque: sin hermana explícita, manda el encabezado que precede al bloque', () => {
  assert.equal(resolverPeladaPorBloque('NOMBRE', ['nombre', 'rut'], 'identificacion del representante legal', false), 'representante_nombre');
  assert.equal(resolverPeladaPorBloque('NOMBRE', ['nombre', 'rut'], 'antecedentes del oferente', false), 'razon_social');
});

test('bloque: encabezado que nombra a los DOS no decide — mejor pendiente que un dato equivocado', () => {
  assert.equal(resolverPeladaPorBloque('NOMBRE', ['nombre'], 'datos del oferente y su representante legal', false), null);
  assert.equal(resolverPeladaPorBloque('NOMBRE', ['nombre'], '', false), null);
});

test('bloque: al pie de una firma sin más contexto, quien firma es la persona', () => {
  assert.equal(resolverPeladaPorBloque('NOMBRE', ['nombre'], 'firma del representante legal', true), 'representante_nombre');
});

// ── Capa 3: declaración jurada corrida ───────────────────────────────────────────────────────
test('ANEXO N°4 antisindicales: las 5 casillas de la MISMA oración piden 5 campos DISTINTOS', () => {
  const oracion = 'Yo , Cédula de identidad N.º , con domicilio en la ciudad de , en representación de , Rut Nº , declaro bajo juramento que:';
  const pos = (frag: string) => oracion.indexOf(frag) + frag.length;
  assert.equal(campoDeBlancoInline(blanco(oracion, pos('Yo '))), 'representante_nombre');
  assert.equal(campoDeBlancoInline(blanco(oracion, pos('Cédula de identidad N.º '))), 'representante_rut');
  assert.equal(campoDeBlancoInline(blanco(oracion, pos('con domicilio en la ciudad de '))), 'direccion');
  assert.equal(campoDeBlancoInline(blanco(oracion, pos('en representación de '))), 'razon_social');
  assert.equal(campoDeBlancoInline(blanco(oracion, pos('Rut Nº '))), 'rut');
});

test('declaración jurada: "don ___" es el nombre del representante, no la empresa', () => {
  const o = 'El proponente, por medio de su representante legal, don  declara bajo juramento lo siguiente:';
  assert.equal(campoDeBlancoInline(blanco(o, o.indexOf('don ') + 4)), 'representante_nombre');
});

test('declaración jurada: "en representación de" gana aunque venga tras la palabra representante', () => {
  const o = 'comparece en representación de  la sociedad';
  assert.equal(campoDeBlancoInline(blanco(o, o.indexOf('de ') + 3)), 'razon_social');
});

// ── Capa 5: localidad de la firma (hueco abierto del instructivo) ────────────────────────────
test('localidad de firma: "En ____ a 12 de agosto" es la comuna del ORGANISMO, no la región de la empresa', () => {
  const o = 'En  a 12 de agosto de 2026';
  assert.equal(campoDeBlancoInline(blanco(o, 3)), 'licitacion_comuna');
});

test('localidad: "en" sin fecha detrás no es localidad — no se fuerza', () => {
  const o = 'participa en  el proceso';
  assert.equal(campoDeBlancoInline(blanco(o, o.indexOf('en ') + 3)), null);
});

// ── Marcadores literales del organismo ───────────────────────────────────────────────────────
test('marcador: el texto dentro del marcador manda sobre el contexto inferido', () => {
  assert.equal(campoDeBlancoInline(blanco('texto', 0, { textoMarcador: '[Nombre Completo del Representante Legal]' })), 'representante_nombre');
  assert.equal(campoDeBlancoInline(blanco('texto', 0, { textoMarcador: '[Número de RUN]' })), 'representante_rut');
  assert.equal(campoDeBlancoInline(blanco('texto', 0, { textoMarcador: '<<NOMBRE PERSONA NATURAL O PERSONA JURIDICA>>' })), 'razon_social');
  assert.equal(campoDeBlancoInline(blanco('texto', 0, { textoMarcador: '[Insertar ID de Mercado Público]' })), 'licitacion_codigo');
});

test('marcador que es una INSTRUCCIÓN al oferente nunca se autocompleta', () => {
  const m = '[indicar en esta casilla el número del documento que respalda]';
  assert.equal(campoDeBlancoInline(blanco('texto', 0, { textoMarcador: m })), null);
});

// ── Motor completo + guardarraíl anti-invención ──────────────────────────────────────────────
test('resolverDeterminista: resuelve la tabla de identificación entera sin llamar a nadie', () => {
  const parrafos = [parrafo(0, 'ANEXO N°1 — IDENTIFICACIÓN DEL OFERENTE'), parrafo(1, ''), parrafo(2, ''), parrafo(3, '')];
  const r = resolverDeterminista({
    candidatos: [celda(1, 'Razón Social'), celda(2, 'R.U.T.'), celda(3, 'Nombre del Representante Legal')],
    blancosInline: [], parrafos, empresa: EMPRESA,
  });
  assert.equal(valorAuto(r.celda, 1), 'Comercial Los Robles SpA');
  assert.equal(valorAuto(r.celda, 2), '76.902.659-2');
  assert.equal(valorAuto(r.celda, 3), 'Lidia Valenzuela Soto');
  assert.equal(r.celdaSinResolver.length, 0);
});

test('resolverDeterminista: la categoría acompaña al campo (la UI agrupa por ella)', () => {
  const r = resolverDeterminista({
    candidatos: [celda(1, 'Nombre del Representante Legal'), celda(5, 'ID Licitación Pública')],
    blancosInline: [], parrafos: [parrafo(0, 'x')], empresa: EMPRESA,
  });
  assert.equal(r.celda.get(1)?.categoria, 'perfil_representante_legal');
  assert.equal(r.celda.get(5)?.categoria, 'datos_licitacion');
});

test('guardarraíl: campo reconocido pero SIN valor en la ficha queda pendiente, nunca inventado', () => {
  const r = resolverDeterminista({
    candidatos: [celda(1, 'Notaría'), celda(2, 'N° de cuenta')],
    blancosInline: [], parrafos: [parrafo(0, 'x')], empresa: EMPRESA,
  });
  assert.equal(r.celda.size, 0);
  assert.equal(r.celdaSinResolver.length, 2);
});

test('campoFijo (estructura del documento) manda sobre cualquier otra capa', () => {
  const r = resolverDeterminista({
    candidatos: [celda(1, 'RUT:', { campoFijo: 'representante_rut' })],
    blancosInline: [], parrafos: [parrafo(0, 'FIRMA REPRESENTANTE LEGAL:')], empresa: EMPRESA,
  });
  assert.equal(valorAuto(r.celda, 1), '6.736.698-0');
});

test('resolverDeterminista es idempotente: dos corridas dan exactamente lo mismo', () => {
  const entrada = {
    candidatos: [celda(1, 'Nombre'), celda(2, 'RUT'), celda(3, 'Nombre de la Empresa')],
    blancosInline: [], parrafos: [parrafo(0, 'ANEXO N°5')], empresa: EMPRESA,
  };
  const a = resolverDeterminista(entrada), b = resolverDeterminista(entrada);
  assert.deepEqual([...a.celda], [...b.celda]);
  // Y el resultado es el correcto del caso real, no solo estable.
  assert.equal(valorAuto(a.celda, 1), 'Lidia Valenzuela Soto');
  assert.equal(valorAuto(a.celda, 3), 'Comercial Los Robles SpA');
});

// ── Política fija ────────────────────────────────────────────────────────────────────────────
test('programa de integridad: la pregunta SÍ/NO se responde sola; "describa" queda al humano', () => {
  const parrafos = [parrafo(0, '¿La empresa cuenta con un Programa de Integridad?')];
  const conRespuesta = { ...EMPRESA, programa_integridad_respuesta: 'SÍ' } as EmpresaCampos;
  const r = resolverDeterminista({
    candidatos: [celda(1, '¿Cuenta con Programa de Integridad?')],
    blancosInline: [], parrafos, empresa: conRespuesta,
  });
  assert.equal(valorAuto(r.celda, 1), 'SÍ');

  const r2 = resolverDeterminista({
    candidatos: [celda(1, 'Describa en qué consiste su Programa de Integridad')],
    blancosInline: [], parrafos, empresa: conRespuesta,
  });
  assert.equal(r2.celda.size, 0);
});

// ── Clasificación del pendiente ──────────────────────────────────────────────────────────────
test('clasificarPendiente: distingue precio, decisión, tercero y título', () => {
  assert.equal(clasificarPendiente('Valor unitario neto').categoria, 'especifico_licitacion');
  assert.equal(clasificarPendiente('Plazo de entrega en días').categoria, 'especifico_licitacion');
  assert.equal(clasificarPendiente('Marque con una X').categoria, 'decision_del_usuario');
  assert.equal(clasificarPendiente('Nombre del cliente que certifica').categoria, 'declaracion_tercero');
  assert.equal(clasificarPendiente('ANTECEDENTES GENERALES').categoria, 'no_aplica_al_oferente');
  assert.equal(clasificarPendiente('').categoria, 'especifico_licitacion');
});

test('clasificarPendiente: siempre trae un motivo legible para mostrar bajo la casilla', () => {
  for (const e of ['Valor unitario', 'Marque con una X', '', 'Individualización del compareciente']) {
    assert.ok(clasificarPendiente(e).motivo.length > 20, e);
  }
});

// ── Casos reales que el banco encontró (17-ago-2026) ─────────────────────────────────────────
test('REGRESIÓN 1738-18-LE26: la tabla numerada "1.- NOMBRE…" se resuelve entera', () => {
  const etiquetas: [string, string][] = [
    ['1.- NOMBRE COMPLETO DEL PROPONENTE O RAZON SOCIAL:', 'razon_social'],
    ['2.- RUT:', 'rut'],
    ['3.- NOMBRE DEL REPRESENTANTE LEGAL:', 'representante_nombre'],
    ['4.- RUT DEL REPRESENTANTE LEGAL:', 'representante_rut'],
    ['5.- DIRECCION (Calle, N°, Comuna):', 'direccion'],
    ['6.- N° DE TELEFONO:', 'telefono1'],
    ['7.- CORREO ELECTRÓNICO:', 'email1'],
  ];
  for (const [e, campo] of etiquetas) assert.equal(campoDeEtiquetaInequivoca(e), campo, e);
});

test('1058086-43-LP26: "R.U.T. N°:" es la etiqueta más común del país escrita con puntos', () => {
  assert.equal(campoDeEtiquetaInequivoca('R.U.T. N°:'), 'rut');
});

test('inline tras "Etiqueta:" usa el MISMO diccionario que las celdas, sin duplicar reglas', () => {
  const caso = (texto: string) => campoDeBlancoInline(blanco(texto, texto.length));
  assert.equal(caso('Nombre o Razón Social: '), 'razon_social');
  assert.equal(caso('ID LICITACIÓN: '), 'licitacion_codigo');
  assert.equal(caso('Cargo: '), 'representante_cargo');
  assert.equal(caso('FECHA                                 : '), 'fecha_hoy');
  // Una etiqueta que el diccionario no reconoce sigue quedando pendiente, no se fuerza.
  assert.equal(caso('Institución: '), null);
});

// ── Guardarraíl: bloque de un TERCERO no se llena con datos de la empresa ────────────────────
test('REGRESIÓN 1058086-43-LP26: "Nombre/Cargo/Institución" es la firma de un TERCERO, no la nuestra', () => {
  // "Cargo" solo es inequívoco (capa 1) y "Nombre" lo resuelve la capa 2 por bloque — pero acá
  // el bloque certifica algo DEL OFERENTE y lo firma alguien de OTRA institución: ninguno de los
  // dos debe llenarse con la ficha de la empresa.
  const p = 'Nombre: __________________________________________Cargo: ___________________________________________Institución: ______________________________________';
  assert.equal(campoDeBlancoInline(blanco(p, 8, { largo: 42, contexto: 'Nombre:' })), null);
  assert.equal(campoDeBlancoInline(blanco(p, 57, { largo: 43, contexto: 'Cargo:' })), null);

  const parrafos = [parrafo(0, 'CERTIFICADO DE EXPERIENCIA')];
  // Con "Institución" como hermana del mismo bloque, "Cargo" pelado queda pendiente.
  const rBloque = resolverDeterminista({
    candidatos: [celda(1, 'Institución'), celda(2, 'Cargo')],
    blancosInline: [], parrafos, empresa: EMPRESA,
  });
  assert.equal(rBloque.celda.has(2), false);
  assert.equal(rBloque.celdaSinResolver.some(c => c.indice === 2), true);
});

test('el guardarraíl de tercero no bloquea un "Cargo:" normal, sin institución cerca', () => {
  const r = resolverDeterminista({
    candidatos: [celda(1, 'Cargo')],
    blancosInline: [], parrafos: [parrafo(0, 'firma del representante legal')], empresa: EMPRESA,
  });
  assert.equal(valorAuto(r.celda, 1), 'Gerente General');
});

// ── Casos reales del certificado de experiencia (1786987035022_ANEXO_N2.docx, 17-ago-2026) ──
test('REGRESIÓN certificado de experiencia: "Correo del que EXTIENDE el certificado" es del TERCERO, no nuestro', () => {
  // Encabezado real: "DATOS DE LA PERSONA QUE EXTIENDE EL CERTIFICADO." — no dice "institución" ni
  // "mandante" ni ninguna de las frases que ya cazaba el guardarraíl; había que ampliarlo.
  const parrafos = [parrafo(0, 'DATOS DE LA PERSONA QUE EXTIENDE EL CERTIFICADO.')];
  const empresaConCorreo = { ...EMPRESA, email1: 'contacto@nuestraempresa.cl' } as EmpresaCampos;
  const r = resolverDeterminista({
    candidatos: [celda(1, 'Nombre'), celda(2, 'Correo electrónico')],
    blancosInline: [], parrafos, empresa: empresaConCorreo,
  });
  assert.equal(r.celda.has(1), false);
  assert.equal(r.celda.has(2), false, 'el correo de la empresa no debe escribirse en la casilla del tercero');
});

test('"Nombre del proveedor postulante a la licitación" SÍ somos nosotros — se resuelve', () => {
  assert.equal(campoDeEtiquetaInequivoca('Nombre del proveedor postulante a la licitación'), 'razon_social');
});

// REGRESIÓN 2296-48-LE26 (Municipalidad de Conchalí, 18-ago-2026). Los datos de empresa/oferente
// de este pliego quedaban TODOS pendientes y clasificados "no_aplica_al_oferente" — el peor
// resultado posible: el anexo se veía completo pero salía sin la identificación del oferente.
// Cuatro brechas distintas, una por línea de este test.
test('REGRESIÓN 2296-48-LE26: los datos del oferente de ese pliego SÍ se reconocen', () => {
  // 1. La palabra sola, sin "nombre" ni "razón social" delante.
  assert.equal(campoDeEtiquetaInequivoca('PROPONENTE:'), 'razon_social');
  // 2. "oferente" intercalado entre "nombre" y "o razón social".
  assert.equal(campoDeEtiquetaInequivoca('NOMBRE OFERENTE O RAZÓN SOCIAL:'), 'razon_social');
  // 3. La casilla que ofrece las dos formas (empresa o persona natural) es el RUT de la empresa.
  assert.equal(campoDeEtiquetaInequivoca('RUT o C.I:'), 'rut');
  // 4. El organismo aclara de dónde sale el giro; sigue siendo el mismo dato de la ficha.
  assert.equal(campoDeEtiquetaInequivoca('GIRO SII:'), 'giro');
  assert.equal(campoDeEtiquetaInequivoca('GIRO SERVICIOS DE IMPUESTOS INTERNOS:'), 'giro');
});

// La viñeta de LETRA con puntuación compuesta ("A.-", "B.-") no se estaba quitando, así que la
// etiqueta quedaba como "a - razon social del proponente" y no matcheaba nada.
test('REGRESIÓN 2296-48-LE26: la viñeta "A.-" se quita como cualquier otra numeración de lista', () => {
  assert.equal(campoDeEtiquetaInequivoca('A.- RAZÓN SOCIAL DEL PROPONENTE:'), 'razon_social');
  assert.equal(campoDeEtiquetaInequivoca('B.- NOMBRE DEL REPRESENTANTE LEGAL'), 'representante_nombre');
  // Guardarraíl que no se puede perder: "R.U.T." NO es la viñeta "r." — no hay espacio entre el
  // punto y la letra siguiente, que es justo lo que distingue una viñeta real de una sigla.
  assert.equal(campoDeEtiquetaInequivoca('R.U.T.'), 'rut');
});

// Evidencia de ANEXOS REALES YA PRESENTADOS (banco de plantillas del usuario, 18-ago-2026): se
// extrajeron los pares "etiqueta → lo que escribió el humano" de 20 anexos presentados y se
// contrastaron contra el diccionario. Estas son las etiquetas que un humano respondió con un dato
// de la ficha de empresa y que nosotros dejábamos pendientes — brechas medidas, no supuestas.
test('etiquetas de anexos REALES ya presentados que quedaban pendientes', () => {
  assert.equal(campoDeEtiquetaInequivoca('PROFESIÓN, OFICIO O GIRO'), 'giro');
  assert.equal(campoDeEtiquetaInequivoca('NOMBRE EMPRESA'), 'razon_social');
  assert.equal(campoDeEtiquetaInequivoca('DOMICILIO Y COMUNA'), 'direccion');
  assert.equal(campoDeEtiquetaInequivoca('Domicilio comercial que acredita'), 'direccion');
  assert.equal(campoDeEtiquetaInequivoca('TELÉFONO FIJO Y CELULAR'), 'telefono1');
  assert.equal(campoDeEtiquetaInequivoca('N° DE CÉDULA NACIONAL DE IDENTIDAD'), 'representante_rut');
  // Guardarraíl: "CÉDULA DE IDENTIDAD" a secas seguía siendo del representante, no de la empresa.
  assert.equal(campoDeEtiquetaInequivoca('CÉDULA DE IDENTIDAD'), 'representante_rut');
});

// BUG REAL (18-ago-2026, "Formatos Esmaltes" de La Serena — documento GENERADO por el sistema al
// que el usuario reportó datos faltantes): el paréntesis se usa de las DOS formas opuestas.
// Como ACOTACIÓN de una etiqueta que ya existe ("Nombre (si correspondiere)") hay que borrarlo.
// Pero cuando el organismo no escribe etiqueta y deja SOLO el paréntesis como marcador de qué va
// ahí, borrarlo dejaba la etiqueta VACÍA — el documento decía literalmente el nombre del campo y
// la casilla igual quedaba en blanco. Se distingue por la forma: si envuelve TODO, es la etiqueta.
test('REGRESIÓN Formatos Esmaltes: un paréntesis que envuelve TODA la etiqueta ES la etiqueta', () => {
  assert.equal(campoDeEtiquetaInequivoca('(Razón social empresa)'), 'razon_social');
  assert.equal(campoDeEtiquetaInequivoca('(Rut de Empresa)'), 'rut');
  assert.equal(campoDeEtiquetaInequivoca('(Rut representante legal)'), 'representante_rut');
  // El typo "representate" (sin la "n") es real y frecuente en los pliegos.
  assert.equal(campoDeEtiquetaInequivoca('(representate legal)'), 'representante_nombre');
  // Guardarraíl: con texto AFUERA del paréntesis sigue siendo una acotación que se descarta —
  // "Nombre" pelado es ambiguo por diseño y lo resuelve la capa 2 mirando el bloque.
  assert.equal(campoDeEtiquetaInequivoca('Nombre (si correspondiere)'), null);
  // Guardarraíl: un paréntesis que no nombra ningún campo no inventa uno.
  assert.equal(campoDeEtiquetaInequivoca('(SOLO SI CORRESPONDE)'), null);
});

// Misma raíz que el test del paréntesis de arriba, pero por la ruta INLINE (blanco en medio del
// texto). El match de etiqueta exigía que el texto terminara en ":", así que un rótulo entre
// paréntesis nunca llegaba al diccionario y la casilla quedaba en blanco aunque el documento
// dijera qué campo va ahí. Caso real "Formatos Esmaltes" (La Serena).
test('REGRESIÓN Formatos Esmaltes: rótulo entre paréntesis junto al blanco inline', () => {
  // El rótulo va DESPUÉS de la raya, que es como lo imprime este organismo.
  const linea = '______________________ (Razón social empresa)';
  assert.equal(campoDeBlancoInline(blanco(linea, 0)), null, 'sin texto antes no se resuelve');

  // `largo` es el ancho real de la raya: sin eso, el texto "después del blanco" arrastraría los
  // guiones bajos y el rótulo no quedaría pegado al paréntesis.
  const raya = '______________________';
  const conAntes = `Firma: ${raya} (Rut de Empresa)`;
  assert.equal(campoDeBlancoInline(blanco(conAntes, 'Firma: '.length, { largo: raya.length })), 'rut');

  // Y también cuando el rótulo va ANTES del blanco.
  const antes = 'Nombre (Razón social empresa) ______________________';
  assert.equal(campoDeBlancoInline(blanco(antes, antes.indexOf('_'))), 'razon_social');

  // Guardarraíl: un paréntesis que no nombra ningún campo sigue sin resolverse.
  const neutro = `Declaro (bajo juramento) ${raya}`;
  assert.equal(campoDeBlancoInline(blanco(neutro, neutro.indexOf('_'), { largo: raya.length })), null);
});

// REGRESIÓN 1247197-54-LE26 ("DECLARACIÓN JURADA PARA CONTRATAR", 18-ago-2026). Ese organismo
// rotula con UN par de ángulos y repite "o persona natural según corresponda" en TODOS los
// marcadores, para cubrir los dos tipos de oferente. Dos bugs distintos:
//   1. `<…>` simple no era un marcador reconocido (solo `<<…>>`) → el anexo se veía "sin nada que
//      llenar" cuando pedía los seis datos más básicos. Arreglado en anexos-docx.ts.
//   2. "RUT representante legal o persona natural…" caía en la regla de "representante legal" y se
//      completaba con el NOMBRE donde iba el RUT: un dato equivocado en una declaración jurada.
test('REGRESIÓN 1247197-54-LE26: el DATO manda sobre el TITULAR en los marcadores de RUT', () => {
  const marcador = (textoMarcador: string) => campoDeBlancoInline(blanco('texto', 0, { textoMarcador }));
  // Los dos marcadores del caso real. "o persona natural según corresponda" está en AMBOS, así que
  // no puede ser la señal que desambigua — lo que decide es la palabra pegada al dato.
  assert.equal(marcador('<RUT representante legal o persona natural según corresponda >'), 'representante_rut');
  assert.equal(marcador('<RUT empresa o persona natural según corresponda >'), 'rut');
  assert.equal(marcador('<nombre de representante legal o persona natural según corresponda >'), 'representante_nombre');
  assert.equal(marcador('<razón social empresa o persona natural según corresponda >'), 'razon_social');
  assert.equal(marcador('<domicilio>'), 'direccion');
  // "Cédula de identidad" sola sigue siendo del representante, como siempre.
  assert.equal(marcador('[Cédula de identidad]'), 'representante_rut');
});

// "E-mail" (con guion) es una de las etiquetas más frecuentes que existe, y quedaba sin reconocer:
// normalizarEtiqueta conserva el guion a propósito (lo necesita el sufijo "N°1-A"), así que
// "e-mail" llegaba con el guion y el patrón, que solo aceptaba espacio o nada, no calzaba.
test('el correo se reconoce con guion, con espacio y junto', () => {
  for (const e of ['E-mail', 'E-MAIL:', 'e mail', 'email', 'Correo electrónico', 'Correo Electrónico del Oferente']) {
    assert.equal(campoDeEtiquetaInequivoca(e), 'email1', e);
  }
});

// BUG REAL (18-ago-2026, ANEXO N°4 de 1247197-54-LE26 — el usuario lo vio en el .docx generado):
// "con domicilio en <domicilio>, <comuna>, <ciudad> en representación de…" salió como
// "Camino El Oliveto N° 575 N° 6, Talagante, CONCHALÍ, CONCHALÍ": la comuna de la Municipalidad de
// Conchalí (el organismo comprador) metida dentro del domicilio de una empresa de Talagante.
test('REGRESIÓN ANEXO N°4: "<comuna>"/"<ciudad>" son del OFERENTE, no del organismo', () => {
  const marcador = (textoMarcador: string) => campoDeBlancoInline(blanco('texto', 0, { textoMarcador }));
  // `textoMarcador` llega SIN los delimitadores (ver BlancoInline en anexos-docx.ts); se prueban
  // las dos formas igual, para que la regla no dependa de ese detalle.
  assert.equal(marcador('comuna'), 'comuna');
  assert.equal(marcador('ciudad'), 'ciudad');
  assert.equal(marcador('<comuna>'), 'comuna');
  assert.equal(marcador('<ciudad>'), 'ciudad');
  // La localidad de FIRMA sí es la del organismo, y la resuelve RE_LOCALIDAD_FIRMA por el contexto
  // de la frase (no por el marcador) — ese camino no se toca.
  const firma = 'En ____________ a 12 de agosto de 2026';
  assert.equal(campoDeBlancoInline(blanco(firma, firma.indexOf('_'), { largo: 14 })), 'licitacion_comuna');
});

// El campo `direccion` de la ficha YA trae la comuna adentro ("Camino El Oliveto N° 575 N° 6,
// Talagante"), así que "con domicilio en <domicilio>, <comuna>, <ciudad>" salía como
// "…N° 6, Talagante, Talagante, Talagante" (reportado por el usuario en el ANEXO N°4 de
// 1247197-54-LE26). Cuando el párrafo pide la comuna aparte, la dirección va sin ella.
test('direccionSinComuna: recorta la comuna del final conservando el formato de la ficha', () => {
  assert.equal(
    direccionSinComuna({ direccion: 'Camino El Oliveto N° 575 N° 6, Talagante', comuna: 'Talagante' } as any),
    'Camino El Oliveto N° 575 N° 6',
  );
  // Sin tildes/mayúsculas exactas también recorta.
  assert.equal(
    direccionSinComuna({ direccion: 'Barros Arana N°492 Of.78, CONCEPCIÓN', comuna: 'Concepción' } as any),
    'Barros Arana N°492 Of.78',
  );
  // Si la comuna NO está en la dirección, no se toca nada.
  assert.equal(
    direccionSinComuna({ direccion: 'Barros Arana N°492 Of.78', comuna: 'Concepción' } as any),
    'Barros Arana N°492 Of.78',
  );
  // Si al recortar no queda nada, mejor repetir el dato que dejar la casilla vacía.
  assert.equal(direccionSinComuna({ direccion: 'Talagante', comuna: 'Talagante' } as any), 'Talagante');
  assert.equal(direccionSinComuna({ direccion: '', comuna: 'Talagante' } as any), null);
});

// REGLA DEL USUARIO (18-ago-2026, vista en el ANEXO N°2 de 1247197-54-LE26, "CARTA IDENTIFICACIÓN
// UTP"): la empresa usa el MISMO teléfono y el MISMO correo para todo — principal y alternativo son
// el mismo dato, y el del representante es el de la empresa. Esas dos casillas quedaban vacías.
test('teléfono y correo: "principal y alternativo" y el del representante son el MISMO dato', () => {
  for (const e of ['Teléfono principal y alternativo', 'Teléfono principal', 'Teléfono alternativo',
                   'Teléfono del representante legal', 'Fono principal y alternativo']) {
    assert.equal(campoDeEtiquetaInequivoca(e), 'telefono1', e);
  }
  for (const e of ['Correo electrónico principal y alternativo', 'Correo electrónico alternativo',
                   'Correo electrónico del representante legal', 'E-mail principal']) {
    assert.equal(campoDeEtiquetaInequivoca(e), 'email1', e);
  }
  // GUARDARRAÍL: esto vale SOLO para contacto. El nombre y el RUT del representante son de una
  // persona distinta de la empresa — confundirlos es el error que este archivo existe para evitar.
  assert.equal(campoDeEtiquetaInequivoca('Nombre del representante legal'), 'representante_nombre');
  assert.equal(campoDeEtiquetaInequivoca('RUT del representante legal'), 'representante_rut');
  assert.equal(campoDeEtiquetaInequivoca('Razón social del oferente'), 'razon_social');
});

// REGRESIÓN FORMULARIO N°1 de 1063538-204-LE26 (18-ago-2026, reportado por el usuario sobre el
// documento generado). Tres cosas del mismo formulario:
test('REGRESIÓN FORMULARIO N°1: "RUT o Cédula de Identidad" es el RUT de la EMPRESA', () => {
  // El organismo ofrece las dos formas porque el oferente puede ser persona natural. Para nosotros
  // (persona jurídica) es el RUT de la empresa — el del representante tiene su propia casilla.
  for (const e of ['RUT o Cédula de Identidad', 'Cédula de Identidad o RUT', 'RUT/Cédula de Identidad', 'RUT o C.I']) {
    assert.equal(campoDeEtiquetaInequivoca(e), 'rut', e);
  }
});

// La PROFESIÓN u OFICIO no es el CARGO: un anexo puede pedir las dos en el mismo bloque
// ("Cargo: Gerente" / "Profesión u oficio: Empresaria"). Columna creada en migration-69.
test('profesión u oficio es un campo distinto del cargo', () => {
  for (const e of ['Profesión', 'Oficio', 'Profesión u oficio', 'Profesión o oficio', 'Título profesional',
                   'Profesión u oficio del representante legal']) {
    assert.equal(campoDeEtiquetaInequivoca(e), 'representante_profesion', e);
  }
  assert.equal(campoDeEtiquetaInequivoca('Cargo'), 'representante_cargo');
  assert.equal(campoDeEtiquetaInequivoca('Cargo del representante legal'), 'representante_cargo');
});

// El COORDINADOR TÉCNICO lo designa el asistente para esta licitación en concreto: no es un dato de
// la ficha de la empresa y NUNCA debe autocompletarse (regla del usuario, 18-ago-2026).
test('el coordinador técnico nunca se autocompleta — lo designa el asistente', () => {
  for (const e of ['Coordinador Técnico', 'Nombre del Coordinador Técnico', 'Coordinador del contrato']) {
    assert.equal(campoDeEtiquetaInequivoca(e), null, e);
  }
});

// REGRESIÓN FORMULARIO N°1 de 1063538-204-LE26 (18-ago-2026). El bloque "COORDINADOR TÉCNICO" trae
// las MISMAS etiquetas peladas que el del representante legal ("Nombre completo", "Cargo o función",
// "Correo electrónico"), y la capa 2 las resolvía por contexto: escribía a la representante legal
// como coordinadora técnica. Regla del usuario: el coordinador lo designa el asistente para ESA
// licitación, no sale de la ficha. Y justo debajo viene "CONTACTO DEL PROPONENTE", que SÍ se llena —
// los dos caen en el mismo bloque (GAP=4), así que hay que mirar el encabezado real de cada casilla.
test('REGRESIÓN FORMULARIO N°1: el coordinador técnico no se llena, el contacto del proponente sí', () => {
  assert.equal(esBloqueDesignadoPorNosotros('COORDINADOR TECNICO*:'), true);
  assert.equal(esBloqueDesignadoPorNosotros('Coordinador del contrato'), true);
  assert.equal(esBloqueDesignadoPorNosotros('CONTRAPARTE TÉCNICA'), true);
  // El contacto del proponente somos nosotros: no entra en el bloqueo.
  assert.equal(esBloqueDesignadoPorNosotros('CONTACTO DEL PROPONENTE:'), false);
  assert.equal(esBloqueDesignadoPorNosotros('REPRESENTANTE LEGAL:'), false);
  assert.equal(esBloqueDesignadoPorNosotros('DATOS DEL OFERENTE'), false);
});

// El encabezado de sección se distingue de una etiqueta de campo por estar en MAYÚSCULAS. Sin esto,
// "Nombre completo" (la etiqueta) se tomaría por encabezado y el bloqueo nunca encontraría el real.
test('encabezadoDeSeccionMasCercano: encuentra el encabezado real, no la etiqueta de campo', () => {
  const p = (texto: string, indice: number): any => ({ texto, indice, vacio: !texto });
  const parrafos = [
    p('REPRESENTANTE LEGAL:', 0), p('Nombre completo', 1), p('Lidia Valenzuela', 2),
    p('COORDINADOR TECNICO*:', 3), p('Nombre completo', 4), p('', 5),
    p('CONTACTO DEL PROPONENTE:', 6), p('Nombre completo', 7), p('', 8),
  ];
  assert.equal(encabezadoDeSeccionMasCercano(parrafos, 2), 'REPRESENTANTE LEGAL:');
  assert.equal(encabezadoDeSeccionMasCercano(parrafos, 5), 'COORDINADOR TECNICO*:');
  assert.equal(encabezadoDeSeccionMasCercano(parrafos, 8), 'CONTACTO DEL PROPONENTE:');
  assert.equal(encabezadoDeSeccionMasCercano(parrafos, 0), '');
});

// Las tres etiquetas de ese mismo formulario que quedaban en blanco.
test('REGRESIÓN FORMULARIO N°1: cédula/RUT con "N°" delante, y "Teléfono / Fax"', () => {
  assert.equal(campoDeEtiquetaInequivoca('N° Cédula de Identidad o RUT'), 'rut');
  assert.equal(campoDeEtiquetaInequivoca('Nº Cédula de Identidad'), 'representante_rut');
  assert.equal(campoDeEtiquetaInequivoca('Teléfono (Anexo) / Fax'), 'telefono1');
  // Una casilla de FAX SOLA sigue pendiente: no tenemos fax y no se inventa.
  assert.equal(campoDeEtiquetaInequivoca('Fax'), null);
});

// REGRESIÓN FORMULARIO N°5 de 1063538-204-LE26 (18-ago-2026): "Mediante el presente Formulario, la
// empresa ______ certifica que el plazo para entrega…". El blanco pegado a "la empresa" es la razón
// social del oferente, sea cual sea la empresa asignada al negocio.
test('REGRESIÓN FORMULARIO N°5: el blanco tras "la empresa" es la razón social', () => {
  const frase = 'Mediante el presente Formulario, la empresa ';
  const linea = `${frase}____________________ certifica que el plazo para entrega es de 15 días.`;
  assert.equal(campoDeBlancoInline(blanco(linea, frase.length, { largo: 20 })), 'razon_social');

  // GUARDARRAÍL — la razón por la que esta regla va AL FINAL de REGLAS_PREVIAS: cualquier frase más
  // específica que también termine en "empresa" tiene que seguir ganando. Si alguna de estas
  // empieza a devolver 'razon_social', la regla nueva se comió a una anterior.
  // "<dato> DE la empresa ___" pide ese dato, NO la razón social. La regla exige una coma antes de
  // "la empresa" justo para no comerse estos casos (la primera versión sí los rompía).
  for (const prefijo of ['el domicilio de la empresa ', 'el RUT de la empresa ',
                         'el giro de la empresa ', 'el representante legal de la empresa ']) {
    const l = `${prefijo}____________________ y más texto`;
    const campo = campoDeBlancoInline(blanco(l, prefijo.length, { largo: 20 }));
    assert.notEqual(campo, 'razon_social', `"${prefijo}" no puede resolver a la razón social`);
  }
});
