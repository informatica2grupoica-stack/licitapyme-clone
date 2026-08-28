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

test('REGRESIÓN 2928-17-LE26: "Comuna y región" resuelve igual que "Región y comuna" (orden invertido)', () => {
  assert.equal(campoDeEtiquetaInequivoca('Región y comuna'), 'region');
  assert.equal(campoDeEtiquetaInequivoca('Comuna y región'), 'region');
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

test('REGRESIÓN 2928-17-LE26: "contraparte técnica del oferente" no contamina el resto del bloque', () => {
  // Misma tabla de identificación densa del caso real: "Razón Social" y "RUT" del oferente
  // conviven, a menos de GAP=4 párrafos, con la sección "ANTECEDENTES CONTRAPARTE TÉCNICA DEL
  // OFERENTE" — el enlace técnico que el propio oferente designa, no un tercero. Antes del fix,
  // "contraparte" a secas en RE_BLOQUE_TERCERO se probaba contra las etiquetas de TODO el bloque
  // (construirBloques las agrupa por cercanía), así que una sola mención de "contraparte" apagaba
  // la resolución de las 14 casillas de la tabla entera, no solo la de esa sección.
  // "RUT de la Empresa" (no el "RUT" pelado) para no acoplar este test a la regla de coherencia
  // de titular del RUT pelado (1b, otro mecanismo, ya cubierto en sus propios tests). El párrafo 3
  // es el encabezado REAL de la sección (como en el documento real): es lo que
  // `esBloqueDesignadoPorNosotros`/`encabezadoDeSeccionMasCercano` usa para dejarla pendiente —
  // sin él, "Nombre completo" pelado se resolvería igual por la capa de contexto de persona, y el
  // test no distinguiría si el guardarraíl correcto sigue funcionando.
  const parrafos = [
    parrafo(0, 'ANEXO N°1A — IDENTIFICACIÓN PERSONA JURÍDICA'),
    parrafo(1, ''), parrafo(2, ''),
    parrafo(3, 'ANTECEDENTES CONTRAPARTE TÉCNICA DEL OFERENTE'),
  ];
  const r = resolverDeterminista({
    candidatos: [
      celda(1, 'Nombre o Razón Social'), celda(2, 'RUT de la Empresa'),
      celda(4, 'ANTECEDENTES CONTRAPARTE TÉCNICA DEL OFERENTE — Nombre completo'),
      celda(6, 'ANTECEDENTES CONTRAPARTE TÉCNICA DEL OFERENTE — Teléfono de contacto'),
    ],
    blancosInline: [], parrafos, empresa: EMPRESA,
  });
  // Las casillas del OFERENTE, ajenas a la sección de la contraparte, se resuelven igual que siempre.
  assert.equal(valorAuto(r.celda, 1), 'Comercial Los Robles SpA');
  assert.equal(valorAuto(r.celda, 2), '76.902.659-2');
  // La contraparte técnica sigue sin autocompletarse — la designa el asistente, no la ficha.
  assert.equal(r.celda.get(4), undefined);
  assert.equal(r.celda.get(6), undefined);
  assert.equal(r.celdaSinResolver.length, 2);
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
  // Lo que este test protege es que NO se invente nada: ninguna de las dos casillas se autocompleta.
  assert.equal([...r.celda.values()].filter(v => v.tipo === 'auto').length, 0);
  // Desde el 28-ago-2026 quedan como pendiente EXPLÍCITO (con el motivo "falta X en la ficha") en
  // vez de caer al cajón de "no reconocí la etiqueta" — ver los tests de "falta en ficha" abajo.
  // El motor sabe qué dato pide cada una, así que no tiene sentido mandarlas a adivinar más abajo.
  assert.equal(r.celda.size, 2);
  assert.equal(r.celdaSinResolver.length, 0);
  assert.deepEqual(r.faltantesFicha.map(f => f.campo).sort(), ['banco_numero', 'notaria']);
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

// BUG REAL (ANEXO N°2 de 2724-35-LP26, encontrado por el repaso de IA el 19-ago-2026): el anexo
// completo se titula "PROGRAMA DE INTEGRIDAD", así que el CONTEXTO del bloque activaba la política
// para cualquier casilla no resuelta del documento — el pie de firma "<Ciudad>, <día/mes/año>"
// quedó con "SÍ" escrito adentro. La etiqueta manda sobre el contexto.
test('programa de integridad: una casilla que pide OTRO dato no recibe el "SÍ" por el contexto', () => {
  const parrafos = [parrafo(0, 'DECLARACIÓN JURADA — PROGRAMA DE INTEGRIDAD')];
  const conRespuesta = { ...EMPRESA, programa_integridad_respuesta: 'SÍ' } as EmpresaCampos;
  for (const etiqueta of ['<Ciudad>, <día/mes/año>', 'Fecha', 'Comuna', 'RUT del oferente', 'Firma']) {
    const r = resolverDeterminista({
      candidatos: [celda(1, etiqueta)], blancosInline: [], parrafos, empresa: conRespuesta,
    });
    assert.notEqual(valorAuto(r.celda, 1), 'SÍ', `"${etiqueta}" no puede recibir la respuesta de integridad`);
  }

  // Y la casilla que SÍ es la pregunta se sigue resolviendo por contexto, como antes.
  const ok = resolverDeterminista({
    candidatos: [celda(1, '¿Cuenta con uno?')], blancosInline: [], parrafos, empresa: conRespuesta,
  });
  assert.equal(valorAuto(ok.celda, 1), 'SÍ');
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
  // Ojo: "el representante legal DE la empresa ___" NO va acá — ese blanco sí es la razón social
  // (se pide a quién representa). Tiene su propio test más abajo.
  for (const prefijo of ['el domicilio de la empresa ', 'el RUT de la empresa ', 'el giro de la empresa ']) {
    const l = `${prefijo}____________________ y más texto`;
    const campo = campoDeBlancoInline(blanco(l, prefijo.length, { largo: 20 }));
    assert.notEqual(campo, 'razon_social', `"${prefijo}" no puede resolver a la razón social`);
  }
});

// Detectado por la AUDITORÍA automática del 18-ago-2026 (scripts/doctor-anexos.mts) sobre
// 1057480-41-LP26: "Yo, …, representante legal de ______" dejaba el blanco vacío. A quien se
// representa es la EMPRESA, no otra persona.
test('AUDITORÍA 1057480-41-LP26: "representante legal de ___" es la razón social', () => {
  const f = 'Yo, Lidia Valenzuela, representante legal de ';
  assert.equal(campoDeBlancoInline(blanco(f + '______________', f.length, { largo: 14 })), 'razon_social');
  const g = 'representante legal de la empresa ';
  assert.equal(campoDeBlancoInline(blanco(g + '______________', g.length, { largo: 14 })), 'razon_social');

  // GUARDARRAÍL: sin el "de" final sigue siendo el NOMBRE de la persona, que es otro dato.
  const h = 'Nombre del representante legal ';
  assert.equal(campoDeBlancoInline(blanco(h + '______________', h.length, { largo: 14 })), 'representante_nombre');
});

// Detectado por la AUDITORÍA del 18-ago-2026 sobre 5251-65-LE26 y 1057480-41-LP26.
test('AUDITORÍA: instrucción que nombra el dato antes del blanco, y "Cédula de Identidad Nacional"', () => {
  // El organismo escribe la instrucción de qué va, y después el blanco.
  const f = 'Llenar con el Nombre o razón social de la empresa participante ';
  assert.equal(campoDeBlancoInline(blanco(f + '______________', f.length, { largo: 14 })), 'razon_social');
  // "Nacional" al FINAL, no en medio ("Cédula de Identidad Nacional" vs "Cédula Nacional de Identidad").
  assert.equal(campoDeEtiquetaInequivoca('Cédula de Identidad Nacional:'), 'representante_rut');
  assert.equal(campoDeEtiquetaInequivoca('Cédula Nacional de Identidad'), 'representante_rut');
  // GUARDARRAÍL: "Llenar con ___" a secas no dice qué dato es — sigue pendiente, no se adivina.
  const g = 'Llenar con ';
  assert.equal(campoDeBlancoInline(blanco(g + '______________', g.length, { largo: 14 })), null);
});

// ── Regresión 2724-35-LP26 (19-ago-2026) ─────────────────────────────────────────────────────
// El organismo aclara al final de la etiqueta para QUÉ TIPO de oferente sirve la casilla, porque
// la misma casilla sirve para los dos ("Razón social o nombre persona natural", ANEXO N°1). Eso no
// cambia QUÉ dato se pide, así que la aclaración se saca antes de comparar contra el diccionario:
// sin esto, la etiqueta más básica que existe —la primera fila de toda tabla de identificación—
// no matcheaba ninguna entrada de razon_social y quedaba pendiente.
test('la aclaración de tipo de persona al final de la etiqueta no cambia QUÉ dato se pide', () => {
  assert.equal(normalizarEtiqueta('Razón social o nombre persona natural'), 'razon social o nombre');
  assert.equal(normalizarEtiqueta('RUT persona natural o jurídica'), 'rut');
  assert.equal(normalizarEtiqueta('Nombre representante legal o persona natural según corresponda'), 'nombre representante legal');
  assert.equal(normalizarEtiqueta('Razón social empresa o persona natural según corresponda'), 'razon social empresa');

  // …pero la frase PELADA no es una casilla con aclaración: es el título de un bloque, y sacarle
  // el "persona natural" la dejaría vacía. Se conserva tal cual (lo maneja detectarSecciones).
  assert.equal(normalizarEtiqueta('PERSONA NATURAL'), 'persona natural');
  assert.equal(normalizarEtiqueta('Persona Jurídica'), 'persona juridica');
});

// El marcador escribe el FORMATO de la fecha en vez de la palabra "fecha". Caso real: los siete
// anexos de 2724-35-LP26 cierran con "<Ciudad>, <día/mes/año>" — la ciudad se llenaba y la fecha
// quedaba con el marcador literal a la vista en el documento que se sube al portal.
test('un marcador con el formato de la fecha ("<día/mes/año>") es la fecha de hoy', () => {
  const conMarcador = (texto: string) => campoDeBlancoInline({
    indiceParrafo: 0, indiceRun: 0, posEnTexto: 0, largo: 1,
    contexto: texto, textoMarcador: texto,
  } as CandidatoInline);
  for (const m of ['día/mes/año', 'dd/mm/aaaa', 'DD-MM-AAAA', 'dia/mes/ano']) {
    assert.equal(conMarcador(m), 'fecha_hoy', `"${m}" debe resolverse como la fecha de hoy`);
  }
});

// BUG REAL (2724-35-LP26, ANEXO N°1, bloque "B) DATOS DEL CONTACTO DEL OFERENTE"): el bloque pide
// "Nombre completo / Rut / Cargo" de la persona de contacto. El nombre y el cargo salían de la
// persona, pero el "Rut" pelado salía con el de la EMPRESA — el RUT de un titular distinto al del
// nombre de al lado. El RUT pelado calza con el diccionario de la capa 1 y nunca llegaba a la capa
// que mira el bloque.
test('el RUT pelado sigue al titular del NOMBRE pelado de su mismo bloque (regresión 2724-35-LP26)', () => {
  const candidatos: CandidatoCelda[] = [
    { etiqueta: 'Nombre completo', paraId: 'a', indice: 30 },
    { etiqueta: 'Rut', paraId: 'b', indice: 32 },
    { etiqueta: 'Cargo', paraId: 'c', indice: 34 },
  ];
  const parrafos = [
    ...Array.from({ length: 29 }, (_, i) => ({ indice: i, texto: '', paraId: `p${i}`, vacio: true })),
    { indice: 29, texto: 'B) DATOS DEL CONTACTO DEL OFERENTE PARA EFECTOS DE LA LICITACIÓN', paraId: 'h', vacio: false },
  ] as unknown as Parrafo[];
  const r = resolverDeterminista({ candidatos, blancosInline: [], parrafos, empresa: EMPRESA });

  assert.equal(valorAuto(r.celda, 30), EMPRESA.representante_nombre);
  assert.equal(valorAuto(r.celda, 32), EMPRESA.representante_rut,
    'el RUT del contacto es el de la persona nombrada al lado, no el de la empresa');
});

// La contraparte: en la tabla de identificación más común del país la hermana NO es una etiqueta
// pelada ("Nombre o Razón Social" dice explícitamente que es la empresa), y ahí el RUT sigue
// siendo el de la empresa. Si esto se rompe, se rompe el patrón más frecuente que existe.
test('el RUT de una tabla de identificación con "Nombre o Razón Social" sigue siendo el de la empresa', () => {
  const candidatos: CandidatoCelda[] = [
    { etiqueta: 'Nombre o Razón Social', paraId: 'a', indice: 5 },
    { etiqueta: 'RUT', paraId: 'b', indice: 7 },
  ];
  const parrafos = [
    ...Array.from({ length: 4 }, (_, i) => ({ indice: i, texto: '', paraId: `p${i}`, vacio: true })),
    { indice: 4, texto: 'IDENTIFICACIÓN DEL OFERENTE', paraId: 'h', vacio: false },
  ] as unknown as Parrafo[];
  const r = resolverDeterminista({ candidatos, blancosInline: [], parrafos, empresa: EMPRESA });
  assert.equal(valorAuto(r.celda, 7), EMPRESA.rut);
});

// BUG REAL (611669-17-LE26, ANEXO N°1-A, 27-ago-2026): "N° DE RUT O CÉDULA DE IDENTIDAD" quedaba
// pendiente pese a tener el RUT de la empresa en la ficha — el "N°" del organismo va con un "DE"
// en medio ("N° DE RUT", no "N° RUT") que el patrón del diccionario no aceptaba.
test('diccionario: "N° DE RUT O CÉDULA DE IDENTIDAD" resuelve a RUT (regresión 611669-17-LE26)', () => {
  assert.equal(campoDeEtiquetaInequivoca('N° DE RUT O CÉDULA DE IDENTIDAD'), 'rut');
  assert.equal(campoDeEtiquetaInequivoca('N° de Cédula de Identidad o RUT'), 'rut');
  // Sin el "de" también debe seguir andando — no se rompió el caso que ya funcionaba.
  assert.equal(campoDeEtiquetaInequivoca('N° RUT O CÉDULA DE IDENTIDAD'), 'rut');
});

// BUG REAL (611669-17-LE26, ANEXO N°1-B, 27-ago-2026): fórmula notarial estándar de toda
// declaración jurada chilena — "comparece ___" es el nombre de quien declara, y no tenía regla
// propia en REGLAS_PREVIAS pese a que las casillas hermanas de la misma oración (C.I., domicilio)
// ya resolvían bien.
test('declaración jurada: "comparece ___" es el nombre de quien declara (regresión 611669-17-LE26)', () => {
  const o = 'En Santiago, a 27 días del mes de agosto de 2026, comparece ';
  assert.equal(campoDeBlancoInline(blanco(o + '____________________, de nacionalidad chilena', o.length, { largo: 20 })), 'representante_nombre');
  // Las casillas hermanas de la misma oración, para que el fixture no mienta sobre el caso real.
  const ci = o + 'Lidia Valenzuela Soto, de nacionalidad chilena, C.I. N° ';
  assert.equal(campoDeBlancoInline(blanco(ci + '____________________, con domicilio en ', ci.length, { largo: 10 })), 'representante_rut');
});

// ── Correcciones aprendidas del experto (lápiz de la pantalla) ────────────────────────────────
// HALLAZGO DE LA AUDITORÍA (28-ago-2026): estas correcciones existían solo como texto dentro del
// prompt del respaldo IA, que está APAGADO por defecto — así que ninguna de las 10 correcciones
// guardadas cambió jamás un anexo, mientras la pantalla prometía lo contrario. Ahora llegan al
// motor determinista como pares (etiqueta → campo). Estos tests fijan las tres reglas del
// override: que se aplique, dónde manda, y dónde NO puede tocar.
test('override aprendido: una etiqueta que el diccionario no conoce se llena con el campo corregido', () => {
  const parrafos = [parrafo(0, 'INDIVIDUALIZACIÓN DEL PROVEEDOR'), parrafo(1, 'Denominación mercantil'), parrafo(2, '')];
  const sin = resolverDeterminista({ candidatos: [celda(1, 'Denominación mercantil')], blancosInline: [], parrafos, empresa: EMPRESA });
  assert.equal(valorAuto(sin.celda, 1), null, 'sin la corrección, el diccionario no la conoce');

  const con = resolverDeterminista({
    candidatos: [celda(1, 'Denominación mercantil')], blancosInline: [], parrafos, empresa: EMPRESA,
    overridesAprendidos: [{ etiqueta: 'Denominación mercantil', campo: 'razon_social' }],
  });
  assert.equal(valorAuto(con.celda, 1), 'Comercial Los Robles SpA');
  assert.equal(con.celdaSinResolver.length, 0);
});

test('override aprendido: manda sobre el diccionario, que es justo lo que el experto corrigió', () => {
  const parrafos = [parrafo(0, 'DATOS DEL CONTACTO'), parrafo(1, 'Nombre o Razón Social'), parrafo(2, '')];
  const c = [celda(1, 'Nombre o Razón Social')];
  const normal = resolverDeterminista({ candidatos: c, blancosInline: [], parrafos, empresa: EMPRESA });
  assert.equal(valorAuto(normal.celda, 1), 'Comercial Los Robles SpA', 'el diccionario dice razón social');

  const corregido = resolverDeterminista({
    candidatos: c, blancosInline: [], parrafos, empresa: EMPRESA,
    overridesAprendidos: [{ etiqueta: 'nombre o razon social', campo: 'representante_nombre' }],
  });
  assert.equal(valorAuto(corregido.celda, 1), 'Lidia Valenzuela Soto', 'la corrección del experto pesa más');
});

test('override aprendido: NUNCA rellena dentro del bloque de un tercero', () => {
  // El bloque de quien CERTIFICA no se llena con datos nuestros bajo ninguna capa — que la
  // corrección se haya aprendido por el TEXTO de la etiqueta no le da permiso de entrar acá.
  const parrafos = [
    parrafo(0, 'CERTIFICA LA INSTITUCIÓN CONTRATANTE'),
    parrafo(1, 'Nombre'), parrafo(2, ''), parrafo(3, 'Cargo'), parrafo(4, ''), parrafo(5, 'Institución'), parrafo(6, ''),
  ];
  const r = resolverDeterminista({
    candidatos: [celda(1, 'Nombre'), celda(3, 'Cargo'), celda(5, 'Institución')],
    blancosInline: [], parrafos, empresa: EMPRESA,
    overridesAprendidos: [{ etiqueta: 'Nombre', campo: 'representante_nombre' }],
  });
  assert.equal(valorAuto(r.celda, 1), null);
});

test('override aprendido: un campo que ya no existe en la ficha se ignora, no revienta', () => {
  const parrafos = [parrafo(0, 'Campo raro'), parrafo(1, '')];
  const r = resolverDeterminista({
    candidatos: [celda(0, 'Campo raro')], blancosInline: [], parrafos, empresa: EMPRESA,
    overridesAprendidos: [{ etiqueta: 'Campo raro', campo: 'columna_que_ya_no_existe' }],
  });
  assert.equal(valorAuto(r.celda, 0), null);
  assert.equal(r.celdaSinResolver.length, 1);
});

test('override aprendido: también aplica a un marcador inline', () => {
  const o = 'Yo, ';
  const b = blanco(o + '<<DENOMINACIÓN MERCANTIL>>, declaro', o.length, { largo: 26, textoMarcador: 'DENOMINACIÓN MERCANTIL' });
  const r = resolverDeterminista({
    candidatos: [], blancosInline: [b], parrafos: [parrafo(1, b.parrafoCompleto!)], empresa: EMPRESA,
    overridesAprendidos: [{ etiqueta: 'DENOMINACIÓN MERCANTIL', campo: 'razon_social' }],
  });
  assert.equal(valorAuto(r.inline, '1:4'), 'Comercial Los Robles SpA');
});

// ── Hallazgos medidos por el auditor sobre 700 documentos reales (28-ago-2026) ────────────────
// BUG REAL, 11 licitaciones: la regla que limpia el remate "persona natural/jurídica" de una
// etiqueta ("Razón social o nombre persona natural" → "razon social") se comía la etiqueta ENTERA
// cuando esa clasificación ES el dato pedido. "TIPO DE PERSONA JURÍDICA" quedaba en "tipo", que no
// calza con nada — y la entrada del diccionario para `tipo_persona_juridica` era código muerto:
// no existía ninguna etiqueta capaz de llegar hasta ella.
test('normalizarEtiqueta: no se come la etiqueta cuando el "tipo de persona" ES el dato pedido', () => {
  assert.equal(normalizarEtiqueta('TIPO DE PERSONA JURÍDICA'), 'tipo de persona juridica');
  assert.equal(campoDeEtiquetaInequivoca('TIPO DE PERSONA JURÍDICA'), 'tipo_persona_juridica');
  assert.equal(campoDeEtiquetaInequivoca('Naturaleza jurídica'), 'tipo_persona_juridica');
  // Y el caso que motivó la limpieza sigue funcionando igual: ahí el remate SÍ es una aclaración.
  assert.equal(normalizarEtiqueta('Razón social o nombre persona natural'), 'razon social o nombre');
  assert.equal(campoDeEtiquetaInequivoca('RUT persona natural o jurídica'), 'rut');
});

// Medido en 20 licitaciones de organismos distintos: la fórmula con la que el representante legal
// nombra a su empresa en una declaración jurada, siempre en blanco.
test('diccionario: "Mi representada" es la razón social, nunca una persona', () => {
  assert.equal(campoDeEtiquetaInequivoca('Mi representada'), 'razon_social');
  assert.equal(campoDeEtiquetaInequivoca('La empresa que represento'), 'razon_social');
  // Lo que importa es que NO se confunda con la persona: en una declaración jurada, poner ahí el
  // nombre del representante en vez de la razón social cambia quién declara.
  assert.notEqual(campoDeEtiquetaInequivoca('Mi representada'), 'representante_nombre');
});

test('inline: "Mi representada ___" es la razón social (medido en 20 licitaciones)', () => {
  const o = 'Mi representada ';
  assert.equal(campoDeBlancoInline(blanco(o + '_______________, declara bajo juramento', o.length, { largo: 15 })), 'razon_social');
  const o2 = 'Declaro que mi representada, ';
  assert.equal(campoDeBlancoInline(blanco(o2 + '_______________, no ha sido condenada', o2.length, { largo: 15 })), 'razon_social');
});

// ── Nacionalidad: política fija de la empresa (28-ago-2026) ───────────────────────────────────
// Medida por el auditor en 21 licitaciones (celda) + 10 (inline): es de las casillas más
// repetidas de las declaraciones juradas chilenas y no había ningún campo que la respondiera.
test('nacionalidad: la casilla se llena sola, en celda y en la fórmula notarial inline', () => {
  const empresa = { ...EMPRESA, nacionalidad: 'Chilena' } as EmpresaCampos;
  assert.equal(campoDeEtiquetaInequivoca('NACIONALIDAD'), 'nacionalidad');
  assert.equal(campoDeEtiquetaInequivoca('Nacionalidad del representante legal'), 'nacionalidad');

  const parrafos = [parrafo(0, 'ANTECEDENTES DEL OFERENTE'), parrafo(1, 'NACIONALIDAD'), parrafo(2, '')];
  const r = resolverDeterminista({ candidatos: [celda(1, 'NACIONALIDAD')], blancosInline: [], parrafos, empresa });
  assert.equal(valorAuto(r.celda, 1), 'Chilena');

  const o = 'comparece Lidia Valenzuela Soto, de nacionalidad ';
  assert.equal(campoDeBlancoInline(blanco(o + '__________, cédula de identidad N°', o.length, { largo: 10 })), 'nacionalidad');
});

test('nacionalidad: sin dato en la ficha, la casilla queda pendiente — no se inventa', () => {
  // El valor lo pone conCamposDerivados (política fija). Este motor nunca inventa: si por lo que
  // sea llega una ficha sin el campo, la casilla se muestra vacía para llenarla a mano.
  const parrafos = [parrafo(0, 'NACIONALIDAD'), parrafo(1, '')];
  const r = resolverDeterminista({ candidatos: [celda(0, 'NACIONALIDAD')], blancosInline: [], parrafos, empresa: EMPRESA });
  assert.equal(valorAuto(r.celda, 0), null);
});

// ── "Falta el dato en la ficha" ≠ "no reconozco la etiqueta" (28-ago-2026) ────────────────────
// CAUSA RAÍZ de "no me llena los campos": `anotar` devolvía el MISMO `false` en los dos casos, así
// que una casilla cuyo campo el motor conocía perfectamente terminaba rotulada "la etiqueta no
// corresponde a ningún dato de la ficha" — lo contrario de lo que pasaba. El hueco se descubría al
// abrir el .docx ya generado y había que rehacer el anexo.
test('falta en ficha: la casilla queda pendiente con el motivo ACCIONABLE, no como etiqueta desconocida', () => {
  const sinNotaria = { ...EMPRESA, notaria: null } as EmpresaCampos;
  const parrafos = [parrafo(0, 'ANTECEDENTES LEGALES'), parrafo(1, 'Notaría'), parrafo(2, '')];
  const r = resolverDeterminista({ candidatos: [celda(1, 'Notaría')], blancosInline: [], parrafos, empresa: sinNotaria });

  const res = r.celda.get(1);
  assert.equal(res?.tipo, 'pendiente');
  assert.match(res?.tipo === 'pendiente' ? res.motivo : '', /Falta "Notaría" en la ficha de la empresa/);
  // Y NO cae al cajón de "no la entendí": el motor sabe exactamente qué dato pide.
  assert.equal(r.celdaSinResolver.length, 0);
});

test('falta en ficha: se listan los campos a completar, sin repetir, con nombre legible', () => {
  const pelada = { ...EMPRESA, notaria: null, banco_nombre: null } as EmpresaCampos;
  const parrafos = [
    parrafo(0, 'Notaría'), parrafo(1, ''), parrafo(2, 'Banco'), parrafo(3, ''),
    parrafo(4, 'Notaria en que se otorgó'), parrafo(5, ''),
  ];
  const r = resolverDeterminista({
    candidatos: [celda(0, 'Notaría'), celda(2, 'Banco'), celda(4, 'Notaría')],
    blancosInline: [], parrafos, empresa: pelada,
  });
  const nombres = r.faltantesFicha.map(f => f.nombre).sort();
  assert.deepEqual(nombres, ['Banco', 'Notaría'], 'un campo aparece UNA vez aunque lo pidan dos casillas');
});

test('falta en ficha: con la ficha completa no se avisa nada', () => {
  const parrafos = [parrafo(0, 'Razón social'), parrafo(1, '')];
  const r = resolverDeterminista({ candidatos: [celda(0, 'Razón social')], blancosInline: [], parrafos, empresa: EMPRESA });
  assert.equal(r.faltantesFicha.length, 0);
  assert.equal(valorAuto(r.celda, 0), 'Comercial Los Robles SpA');
});

test('falta en ficha: un dato de la LICITACIÓN no manda a llenar la ficha (viene de Mercado Público)', () => {
  // Los `licitacion_*` no existen en la pantalla de Empresas: los trae la API de MP en cada
  // análisis. Si faltan, la causa es que MP no respondió y lo que corresponde es reintentar —
  // decir "complétalo en Empresas" mandaría a buscar un campo que no está en ningún formulario.
  const sinLicitacion = { ...EMPRESA, licitacion_codigo: null } as EmpresaCampos;
  const parrafos = [parrafo(0, 'ID Licitación Pública'), parrafo(1, '')];
  const r = resolverDeterminista({ candidatos: [celda(0, 'ID Licitación Pública')], blancosInline: [], parrafos, empresa: sinLicitacion });

  const res = r.celda.get(0);
  assert.match(res?.tipo === 'pendiente' ? res.motivo : '', /Mercado Público/);
  assert.equal(r.faltantesFicha[0]?.origen, 'licitacion');
});
