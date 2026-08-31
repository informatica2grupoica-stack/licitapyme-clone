// Regresión de los campos derivados de la ficha de empresa (anexos-derivados.ts). Correr con:
//   npx tsx --test app/lib/__tests__/anexos-derivados.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conCamposDerivados, camposDelCodigoLicitacion } from '../anexos-derivados';
import type { EmpresaCampos } from '../anexos-ia-motor';

const empresaBase: EmpresaCampos = {
  razon_social: 'Comercial MP SpA', rut: '78.388.175-6', direccion: null, region: null, giro: null,
  tipo_persona_juridica: null, fecha_sociedad: null, fecha_escritura: null, notaria: null,
  numero_repertorio: null, fojas_numero_anio: null,
  representante_nombre: null, representante_rut: null, representante_cargo: null,
  email1: null, telefono1: null, banco_tipo_cuenta: null, banco_numero: null, banco_nombre: null,
  banco_email: null, banco_titular_nombre: null, banco_titular_rut: null, firma_url: null, timbre_url: null,
};

// BUG REAL (1426039-8-LE26, 10-ago-2026, ANEXO N°6): una tabla "Nombres | Apellidos" (dos
// casillas separadas) repetía el NOMBRE COMPLETO en las dos, porque no existía ningún campo que
// diera solo el nombre de pila o solo el apellido.
test('nombres/apellidos: 2 palabras se parten 1+1 (caso real "Lidia Valenzuela")', () => {
  const { representante_nombres, representante_apellidos } = conCamposDerivados({ ...empresaBase, representante_nombre: 'Lidia Valenzuela' });
  assert.equal(representante_nombres, 'Lidia');
  assert.equal(representante_apellidos, 'Valenzuela');
});

test('nombres/apellidos: 3 palabras se parten 1 nombre + 2 apellidos (patrón chileno más común)', () => {
  const { representante_nombres, representante_apellidos } = conCamposDerivados({ ...empresaBase, representante_nombre: 'Santiago López Palavecino' });
  assert.equal(representante_nombres, 'Santiago');
  assert.equal(representante_apellidos, 'López Palavecino');
});

test('nombres/apellidos: 4 palabras se parten 2 nombres + 2 apellidos', () => {
  const { representante_nombres, representante_apellidos } = conCamposDerivados({ ...empresaBase, representante_nombre: 'Santiago Osvaldo López Palavecino' });
  assert.equal(representante_nombres, 'Santiago Osvaldo');
  assert.equal(representante_apellidos, 'López Palavecino');
});

// Regla de oro anti-alucinación: con 1 palabra o 5+, no hay forma de cortar sin adivinar — mejor
// pendiente que un corte inventado (mismo criterio que calleYNumeroDeDireccion).
test('nombres/apellidos: 1 palabra o 5+ no se parten (mejor pendiente que adivinar)', () => {
  const unaPalabra = conCamposDerivados({ ...empresaBase, representante_nombre: 'Madonna' });
  assert.equal(unaPalabra.representante_nombres, null);
  assert.equal(unaPalabra.representante_apellidos, null);

  const cincoPalabras = conCamposDerivados({ ...empresaBase, representante_nombre: 'Juan Carlos De La Torre' });
  assert.equal(cincoPalabras.representante_nombres, null);
  assert.equal(cincoPalabras.representante_apellidos, null);
});

test('nombres/apellidos: sin representante_nombre, no revienta y queda null', () => {
  const { representante_nombres, representante_apellidos } = conCamposDerivados(empresaBase);
  assert.equal(representante_nombres, null);
  assert.equal(representante_apellidos, null);
});

// (14-ago-2026, pedido explícito del usuario, instructivo interno "Presentacion_Creacion_Anexos_
// FINAL_CON_EJEMPLOS.pdf" puntos 4 y 5): socio único al 100% y Programa de Integridad siempre "SÍ"
// — política fija de la empresa, no algo que dependa de la licitación.
test('socio_nombre/socio_participacion: socio único = representante legal al 100%', () => {
  const { socio_nombre, socio_participacion } = conCamposDerivados({ ...empresaBase, representante_nombre: 'Lidia Valenzuela' });
  assert.equal(socio_nombre, 'Lidia Valenzuela');
  assert.equal(socio_participacion, '100%');
});

test('socio_nombre/socio_participacion: sin representante, no inventa un socio (mejor pendiente)', () => {
  const { socio_nombre, socio_participacion } = conCamposDerivados(empresaBase);
  assert.equal(socio_nombre, null);
  assert.equal(socio_participacion, null);
});

test('programa_integridad_respuesta: siempre "SÍ", sin depender de ningún dato de la ficha', () => {
  assert.equal(conCamposDerivados(empresaBase).programa_integridad_respuesta, 'SÍ');
});

// BUG REAL (14-ago-2026, mismo instructivo, punto 7): "fecha_hoy" (la fecha con la que se firma y
// presenta la oferta) debe basarse en la fecha de CIERRE de la licitación cuando se conoce — no en
// el reloj real del momento en que se genera el anexo (un anexo preparado varios días antes del
// cierre no debe quedar fechado con el día de la preparación).
test('fecha_hoy: se basa en la fecha que se pase como "ahora" (la fecha de cierre, no el reloj real)', () => {
  const fechaCierre = new Date('2026-09-15T15:00:00-04:00');
  const { fecha_hoy, fecha_hoy_dia, fecha_hoy_mes, fecha_hoy_anio } = conCamposDerivados(empresaBase, fechaCierre);
  assert.equal(fecha_hoy, '15 de septiembre de 2026');
  assert.equal(fecha_hoy_dia, '15');
  assert.equal(fecha_hoy_mes, '09');
  assert.equal(fecha_hoy_anio, '2026');
});

// Política fija de la empresa, igual que el Programa de Integridad (respuesta del usuario a la
// auditoría del 28-ago-2026: "nacionalidad siempre es chilena").
test('conCamposDerivados: la nacionalidad se resuelve como política fija, pero la ficha manda', () => {
  const base = { razon_social: 'Comercial Los Robles SpA', direccion: 'Av. Alemania 0671, Temuco' } as any;
  assert.equal(conCamposDerivados(base).nacionalidad, 'Chilena');
  // Si algún día existe la columna en `empresas` (un representante extranjero), ese dato manda —
  // por eso se resuelve con `||` y no a la fuerza.
  assert.equal(conCamposDerivados({ ...base, nacionalidad: 'Argentina' }).nacionalidad, 'Argentina');
});

// ── Oficina/departamento del domicilio (31-ago-2026) ───────────────────────────────────────────
// Medido por el auditor de generalización sobre 502 formularios reales: los organismos que parten
// el domicilio en columnas ("Calle | N° | DPTO./OF. | Comuna") dejaban esa casilla siempre
// pendiente aunque el dato ya venía dentro de `direccion`.
test('direccion_oficina: saca la oficina pegada al número ("Of.78")', () => {
  const e = { direccion: 'Barros Arana N°492 Of.78, Concepción' } as any;
  assert.equal(conCamposDerivados(e).direccion_oficina, '78');
});

test('direccion_oficina: también cuando la oficina es un SEGMENTO propio, no el primero', () => {
  // A diferencia de la calle (siempre en el primer segmento), la oficina aparece indistintamente
  // pegada a la calle o separada por coma. El ÚLTIMO segmento nunca se mira: ahí va la comuna.
  const e = { direccion: 'Av. Providencia 1234, Oficina 45, Santiago' } as any;
  assert.equal(conCamposDerivados(e).direccion_oficina, '45');
});

test('direccion_oficina: "Depto"/"Dpto." son la misma marca', () => {
  assert.equal(conCamposDerivados({ direccion: 'Av. Alemania 0671 Depto 22, Temuco' } as any).direccion_oficina, '22');
  assert.equal(conCamposDerivados({ direccion: 'Calle Larga 55 Dpto. 3B, Osorno' } as any).direccion_oficina, '3B');
});

// BUG REAL encontrado escribiendo esta regla: con las alternativas ordenadas de más corta a más
// larga, `of` matcheaba DENTRO de "Oficina" y la marca capturaba "icina" en vez del número. El
// orden (larga → corta) y el `\b` de cierre son los dos necesarios; sin test, esto pasa inadvertido
// porque igual devuelve un string y "parece" que funcionó.
test('direccion_oficina: "Oficina" completa no se parte en "icina"', () => {
  const e = { direccion: 'Av. Providencia 1234, Oficina 45, Santiago' } as any;
  assert.notEqual(conCamposDerivados(e).direccion_oficina, 'icina');
});

test('direccion_oficina: sin marca explícita queda null, nunca el número de la calle', () => {
  // Misma regla anti-invención que calleYNumeroDeDireccion: mejor pendiente que un dato inventado.
  assert.equal(conCamposDerivados({ direccion: 'Los Olivos 900, Valdivia' } as any).direccion_oficina, null);
  assert.equal(conCamposDerivados({ direccion: 'Camino El Oliveto N° 575 N° 6, Talagante' } as any).direccion_oficina, null);
});

// ── Tramos del código de licitación (31-ago-2026, caso real 2495-17-B226) ──────────────────────
test('camposDelCodigoLicitacion: parte el código en sus tres tramos', () => {
  const r = camposDelCodigoLicitacion('2495-17-B226');
  assert.equal(r.licitacion_codigo_p1, '2495');
  assert.equal(r.licitacion_codigo_p2, '17');
  assert.equal(r.licitacion_codigo_p3, 'B226');
});

test('camposDelCodigoLicitacion: sin código, o con otra forma, los tres quedan null', () => {
  // Anti-invención: un código que no tiene exactamente tres tramos no se rellena a medias.
  for (const malo of [null, '', '2495-17', '2495-17-B226-X', '2495--B226']) {
    const r = camposDelCodigoLicitacion(malo as any);
    assert.deepEqual([r.licitacion_codigo_p1, r.licitacion_codigo_p2, r.licitacion_codigo_p3], [null, null, null], String(malo));
  }
});
