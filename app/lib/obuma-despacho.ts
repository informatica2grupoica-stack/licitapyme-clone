// Los 4 valores del selector «Método de despacho» de Obuma — leídos de 278 OC reales (21-oct-2026), no inventados.
// Archivo aparte (sin dependencias de servidor) para que lo use también el formulario de la OC.
export const METODOS_DESPACHO_OBUMA = [
  'Por cuenta COMPRADOR', 'PROVEEDOR a instalaciones comprador', 'PROVEEDOR a OTRAS instalaciones comprador', 'Sin despacho',
] as const;
