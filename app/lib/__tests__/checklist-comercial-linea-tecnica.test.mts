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
