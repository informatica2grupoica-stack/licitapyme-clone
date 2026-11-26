// RUT genérico que Obuma/SII usa para TODO proveedor extranjero (55.555.555-5): no identifica a nadie,
// así que nunca sirve para decidir «quién es el proveedor» (buscar en Obuma, agrupar OC, deduplicar).
const RUT_GENERICO_EXTRANJERO = '555555555';

export function esRutGenericoExtranjero(rut: string | null | undefined): boolean {
  return String(rut ?? '').replace(/[^0-9kK]/g, '').toUpperCase() === RUT_GENERICO_EXTRANJERO;
}
