// app/lib/anexos-ia-opciones.ts
// Opciones de modelo para TODAS las llamadas de IA del motor de anexos (bases, órdenes de compra, precios, repaso).
//
// Por defecto es lo de siempre: GLM-4.7 y solo GLM (medido: es el más estable en estos lotes y sin cortes a otros
// proveedores a mitad de un anexo). `ANEXOS_IA_PROVEEDOR` (p. ej. `kimi_rapido` = K2.6 sin razonar, `kimi` = K3) permite
// MEDIR otro proveedor sin tocar el código; sin esa variable nada cambia.
export function opcionesIAAnexos(timeoutMs: number): { timeoutMs: number; modeloPreferido?: string; soloGlm?: boolean; proveedorPreferido?: string } {
  const proveedor = process.env.ANEXOS_IA_PROVEEDOR?.trim();
  return proveedor ? { timeoutMs, proveedorPreferido: proveedor } : { timeoutMs, modeloPreferido: 'glm-4.7', soloGlm: true };
}
