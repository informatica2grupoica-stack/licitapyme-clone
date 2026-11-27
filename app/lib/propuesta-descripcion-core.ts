// app/lib/propuesta-descripcion-core.ts — Armar la plataforma desde LO QUE LA EMPRESA CUENTA que vende (parte PURA).
// Para las que no tienen ventas recientes en Mercado Público (o no tienen RUT con historial): antes quedaban con la plataforma vacía.

export const MIN_DESCRIPCION = 30;
export const MAX_DESCRIPCION = 1500;
export const MAX_PROPUESTAS_POR_DIA = 5;
export const ORIGEN_DESCRIPCION = 'DESCRIPCION';

export function validarDescripcion(v: unknown): { ok: true; texto: string } | { ok: false; error: string } {
  const texto = String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPCION);
  // Cuenta letras: «aaaaaaaa…» o puros símbolos no describen un negocio.
  const palabras = new Set((texto.toLowerCase().match(/[a-záéíóúüñ]{3,}/g) ?? []));
  if (texto.length < MIN_DESCRIPCION || palabras.size < 3) return { ok: false, error: 'Cuéntanos con un poco más de detalle qué vende tu empresa: qué productos o servicios y a quién.' };
  return { ok: true, texto };
}

export interface PropuestaIA {
  modelo: string; resumen: string; sugeridas: string[]; posibles: { rubro: string; palabras: string[] }[]; negativas: string[];
  perfil: { descripcion: string; rubros: string; productos_si: string; productos_no: string; reglas: string };
}

/** Mismo formato que la evaluación por RUT (lo leen Mi empresa y el armado), sin cifras de ventas porque no las hay. */
export function resultadoDesdePropuesta(p: PropuestaIA) {
  return {
    origen: ORIGEN_DESCRIPCION, ordenes: 0, licitaciones: 0, actasConLineasGanadas: 0, lineas: 0, diasRevisados: 0,
    compradores: [] as string[], regiones: [] as string[], montoTipico: { p10: null, p90: null },
    modelo: p.modelo, resumen: p.resumen, sugeridas: p.sugeridas, posibles: p.posibles, negativas: p.negativas,
    perfil: { ...p.perfil, regiones: '', monto_min: null, monto_max: null },
  };
}
