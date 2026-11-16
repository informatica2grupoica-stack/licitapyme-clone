// app/lib/compras-del-auditor-core.ts
// PESTAÑA «REVISADO DEL AUDITOR» (Costeo y auditoría, Compras): reglas puras para decidir qué documento del Auditor
// se puede pasar a Compras como cotización o como ficha. Sin base de datos: se prueban solas.
import type { RespaldoDTO, EstadoOpcion } from '@/app/lib/auditor-opciones';

/** Una opción en alguno de estos estados ya fue elegida por el equipo en el Auditor (es la que se va a comprar). */
export const ESTADOS_ELEGIDOS: EstadoOpcion[] = ['definitiva', 'en_aprobacion', 'aprobada'];
export const esElegida = (estado: string) => (ESTADOS_ELEGIDOS as string[]).includes(estado);

export function etiquetaEstado(estado: string): string {
  switch (estado) {
    case 'aprobada': return 'Aprobada en el Auditor';
    case 'en_aprobacion': return 'En aprobación en el Auditor';
    case 'definitiva': return 'Elegida en el Auditor';
    case 'verificada': return 'Verificada, sin firmar';
    case 'formalizada': return 'Con cotización formal, sin firmar';
    default: return 'Tanteo, sin firmar';
  }
}

/** El respaldo que SOSTIENE el costo de la opción: el marcado y, si no hay, el vigente más reciente (misma regla que el panel del Auditor).
 *  Una ficha técnica no trae precio, así que nunca sostiene un costo. */
export function respaldoQueSostiene(respaldos: RespaldoDTO[]): RespaldoDTO | null {
  const candidatos = respaldos.filter(r => r.vigente && r.tipo !== 'ficha_tecnica').reverse();
  return candidatos.find(r => r.sostieneCosto) ?? candidatos[0] ?? null;
}

/** Fichas técnicas vigentes que la persona puede pasar a Compras: tienen archivo y de qué producto del documento se leyeron. */
export function fichasUsables(respaldos: RespaldoDTO[]): RespaldoDTO[] {
  return respaldos.filter(r => r.vigente && r.tipo === 'ficha_tecnica' && !!r.documentoUrl && r.extraccionId != null && r.productoIdx != null);
}

/** Origen con que se registra la cotización en Compras según el archivo (el mismo que la bandeja usa al subir un archivo). */
export function origenDeArchivo(nombre: string | null | undefined, url: string | null | undefined): 'pdf' | 'imagen' {
  const ext = ((nombre || '').split('.').pop() || (url || '').split('?')[0].split('.').pop() || '').toLowerCase();
  return /^(png|jpe?g|webp)$/.test(ext) ? 'imagen' : 'pdf';
}

/** Por qué una cotización del Auditor NO se puede pasar tal cual (null = se puede). */
export function motivoCotizacionNoUsable(p: { respaldo: RespaldoDTO | null; precioNeto: number | null }): string | null {
  if (!p.respaldo) return 'El precio de esta opción no viene de un documento.';
  if (p.respaldo.tipo === 'link_web') return 'El precio viene de un link de internet, no de una cotización con archivo.';
  if (!p.respaldo.documentoUrl) return 'El respaldo no tiene archivo.';
  if (p.precioNeto == null || !(p.precioNeto > 0)) return 'El Auditor no pudo calcular un precio neto de este documento.';
  return null;
}

/** Cantidad a mostrar de «cumple X de Y». */
export function textoCumple(r: { total: number; cumple: number; noCumple: number; sinVeredicto: number } | null | undefined): string | null {
  if (!r || !r.total) return null;
  return `Cumple ${r.cumple} de ${r.total}`;
}
