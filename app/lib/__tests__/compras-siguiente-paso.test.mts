// "¿Qué hago ahora?" de Compras.
//   npx tsx --test app/lib/__tests__/compras-siguiente-paso.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siguientePaso, type EntradaSiguientePaso } from '../compras-siguiente-paso';

const base = (o: Partial<EntradaSiguientePaso> = {}): EntradaSiguientePaso => ({
  asignado: true, plazoAsignacionVencido: false, esJefeDeVentas: false, ocAceptada: true, tareas: [],
  fases: { tareasVencidas: 0, productosSinCotizacion: 0, compuertasPendientes: 0, hitosAdminPendientes: 0, incidenciasAbiertas: 0, relojVencido: false }, ...o,
});
const t = (clave: string | null, titulo: string, estado: 'PENDIENTE' | 'HECHA' = 'PENDIENTE', vencida = false) => ({ catalogoClave: clave, titulo, estado, vencida });

test('sin encargado: jefe de ventas debe asignar, y es alerta si el plazo venció', () => {
  const p = siguientePaso(base({ asignado: false, esJefeDeVentas: true, plazoAsignacionVencido: true }));
  assert.equal(p.ancla, 'encargado'); assert.equal(p.tono, 'alerta'); assert.equal(p.titulo, 'Asigna un encargado');
});
test('sin encargado y sin ser jefe: solo espera', () => {
  assert.match(siguientePaso(base({ asignado: false })).titulo, /Esperando/);
});
test('reloj vencido manda sobre todo lo demás', () => {
  const p = siguientePaso(base({ fases: { ...base().fases!, relojVencido: true, incidenciasAbiertas: 2 }, tareas: [t('aceptar_oc', 'OC', 'PENDIENTE', true)] }));
  assert.equal(p.fase, 'entrega'); assert.equal(p.tono, 'alerta');
});
test('incidencias antes que tareas vencidas', () => {
  const p = siguientePaso(base({ fases: { ...base().fases!, incidenciasAbiertas: 1 }, tareas: [t('x', 'Algo', 'PENDIENTE', true)] }));
  assert.equal(p.titulo, 'Hay 1 incidencia abierta');
});
test('tarea vencida nombra la tarea', () => {
  const p = siguientePaso(base({ tareas: [t('x', 'Contactar proveedor', 'PENDIENTE', true)] }));
  assert.match(p.titulo, /Contactar proveedor/); assert.equal(p.fase, 'tareas');
});
test('una tarea HECHA vencida no cuenta', () => {
  assert.equal(siguientePaso(base({ tareas: [t('x', 'Vieja', 'HECHA', true)] })).tono, 'ok');
});
test('OC sin aceptar lleva al bloque de la OC', () => {
  assert.equal(siguientePaso(base({ ocAceptada: false })).ancla, 'oc');
});
test('reloj pendiente antes que validaciones y cotizaciones', () => {
  const p = siguientePaso(base({ tareas: [t('contacto_inicial', 'Contacto'), t('reloj_entrega', 'Reloj')], fases: { ...base().fases!, productosSinCotizacion: 3 } }));
  assert.equal(p.titulo, 'Fija el plazo de entrega');
});
test('validación de inicio antes que cotizar', () => {
  const p = siguientePaso(base({ tareas: [t('validacion_tecnica_real', 'Validación técnica real')], fases: { ...base().fases!, productosSinCotizacion: 3 } }));
  assert.equal(p.titulo, 'Validación técnica real');
});
test('cotizaciones: plural y singular', () => {
  assert.equal(siguientePaso(base({ fases: { ...base().fases!, productosSinCotizacion: 3 } })).titulo, 'Cotiza 3 productos');
  assert.equal(siguientePaso(base({ fases: { ...base().fases!, productosSinCotizacion: 1 } })).titulo, 'Cotiza 1 producto');
});
test('compuertas, luego hitos administrativos', () => {
  assert.equal(siguientePaso(base({ fases: { ...base().fases!, compuertasPendientes: 2, hitosAdminPendientes: 4 } })).fase, 'aprobacion');
  assert.equal(siguientePaso(base({ fases: { ...base().fases!, hitosAdminPendientes: 4 } })).fase, 'compra');
});
test('hitos null (sin dato) no inventa pendientes', () => {
  assert.equal(siguientePaso(base({ fases: { ...base().fases!, hitosAdminPendientes: null } })).tono, 'ok');
});
test('sin resumenFases no revienta', () => {
  assert.equal(siguientePaso(base({ fases: null })).tono, 'ok');
});
test('todo al día: lleva a entrega', () => {
  const p = siguientePaso(base()); assert.equal(p.tono, 'ok'); assert.equal(p.fase, 'entrega');
});

test('sin forma de comprar elegida no se dice "todo al día" (auditoría 07-oct-2026)', () => {
  const p = siguientePaso({ asignado: true, plazoAsignacionVencido: false, esJefeDeVentas: false, ocAceptada: true, tareas: [],
    fases: { tareasVencidas: 0, productosSinCotizacion: 0, escenarioElegido: false, compraAprobada: false, margenAprobado: false, compuertasPendientes: 0, hitosAdminPendientes: null, incidenciasAbiertas: 0, relojVencido: false } });
  assert.equal(p.titulo, 'Elige cómo comprar');
});
test('elegida la compra pero sin proponerla: pide proponer la aprobación', () => {
  const p = siguientePaso({ asignado: true, plazoAsignacionVencido: false, esJefeDeVentas: false, ocAceptada: true, tareas: [],
    fases: { tareasVencidas: 0, productosSinCotizacion: 0, escenarioElegido: true, compraAprobada: false, margenAprobado: false, compuertasPendientes: 0, hitosAdminPendientes: null, incidenciasAbiertas: 0, relojVencido: false } });
  assert.equal(p.fase, 'aprobacion');
});
