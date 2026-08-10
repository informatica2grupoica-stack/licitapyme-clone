// Regresión de los campos derivados de la ficha de empresa (anexos-derivados.ts). Correr con:
//   npx tsx --test app/lib/__tests__/anexos-derivados.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conCamposDerivados } from '../anexos-derivados';
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
