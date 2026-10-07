// app/lib/compras-plazo-proveedor.ts
// ¿EL PLAZO DEL PROVEEDOR CABE EN EL PLAZO QUE LE OFERTAMOS AL CLIENTE? — comparación PURA, con pruebas.
//
// Hallazgo 07-oct-2026 (negocio 457): una cotización de "45 días hábiles" para una licitación ofertada a
// 15 días hábiles salió sin ninguna alerta, porque el auditor SOLO comparaba contra el reloj de entrega y,
// mientras el reloj no está fijado (casi siempre, hasta que llega la OC), se saltaba la revisión en silencio.
// Ahora, sin reloj, se compara contra el plazo OFERTADO de la licitación. Días hábiles ≈ 1,4 × corridos
// (mismo factor que ya usaba el auditor).

export interface PlazoDias { dias: number; habiles: boolean }

export const esPlazoHabil = (texto: string | null | undefined): boolean => /h[aá]bil/i.test(String(texto ?? ''));

export const aCorridos = (p: PlazoDias): number => (p.habiles ? Math.ceil(p.dias * 1.4) : p.dias);

/** Plazo ofertado al cliente, a partir del resumen ejecutivo ("15 Días hábiles" + 15). null si falta alguno. */
export function plazoOfertado(texto: string | null | undefined, dias: number | null | undefined): PlazoDias | null {
  if (dias == null || !Number.isFinite(dias) || dias <= 0) return null;
  return { dias, habiles: esPlazoHabil(texto) };
}

export function plazoCabe(proveedor: PlazoDias, limite: PlazoDias): { cabe: boolean; proveedorCorridos: number; limiteCorridos: number } {
  const proveedorCorridos = aCorridos(proveedor), limiteCorridos = aCorridos(limite);
  return { cabe: proveedorCorridos <= limiteCorridos, proveedorCorridos, limiteCorridos };
}
