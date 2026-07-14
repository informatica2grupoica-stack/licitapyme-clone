// app/lib/estado-mp.ts
// Estado EFECTIVO de una licitación en Mercado Público (Publicada / Cerrada / …).
//
// Problema que resuelve: el estado (CodigoEstado) se cachea al capturar/asignar la
// licitación y NO se actualiza solo. Una licitación que ya cerró sigue figurando
// "Publicada" en el radar, el buscador, negocios y el detalle. Este helper deriva el
// estado real de forma INSTANTÁNEA y determinista, sin llamar a la API:
//   · Si el código es terminal (Cerrada 6 / Desierta 7 / Adjudicada 8 / Revocada 18 /
//     Suspendida 19) se respeta tal cual — son estados definitivos que da la API.
//   · Si figura "Publicada" (5, o desconocido) pero su fecha de cierre ya pasó → Cerrada.
//
// La comparación de fecha usa el mismo criterio que getDiasRestantes()
// (new Date(cierre) vs Date.now()); con TZ=America/Santiago en el server y navegadores
// chilenos, la "hora de pared" del cierre se interpreta en zona Chile → correcto.
//
// El estado autoritativo definitivo (Adjudicada/Desierta antes de tiempo, Revocada,
// Suspendida) proviene de la API en las vistas de detalle o del refresco en background;
// este helper solo cubre la transición Publicada→Cerrada por vencimiento.

export const CODIGO_ESTADO_MP: Record<number, string> = {
  5: 'Publicada',
  6: 'Cerrada',
  7: 'Desierta',
  8: 'Adjudicada',
  // MP usa códigos inconsistentes para Revocada: se ha visto 15 (verificado en vivo con
  // 2831-17-LR26) además de 18. Se mapean ambos para no perder el estado por el número.
  15: 'Revocada',
  18: 'Revocada',
  19: 'Suspendida',
};

const NOMBRE_A_CODIGO: Record<string, number> = {
  publicada: 5, cerrada: 6, desierta: 7, adjudicada: 8, revocada: 18, suspendida: 19,
};

// Normaliza un estado que puede venir como código (5 / '5') o como nombre ('Publicada')
// a su código numérico. Devuelve null si no se reconoce.
export function codigoEstadoMP(estado: string | number | null | undefined): number | null {
  if (estado == null || estado === '') return null;
  if (typeof estado === 'number') return estado;
  const s = String(estado).trim();
  if (/^\d+$/.test(s)) return Number(s);
  return NOMBRE_A_CODIGO[s.toLowerCase()] ?? null;
}

// ¿La fecha de cierre ya pasó? Mismo criterio que getDiasRestantes (consistencia).
export function cierreVencido(fechaCierre?: string | null): boolean {
  if (!fechaCierre) return false;
  const t = new Date(fechaCierre).getTime();
  if (Number.isNaN(t)) return false;
  return t < Date.now();
}

// Código de estado EFECTIVO: respeta los terminales; convierte Publicada vencida → Cerrada.
export function estadoEfectivoCodigo(
  estado: string | number | null | undefined,
  fechaCierre?: string | null,
): number | null {
  const codigo = codigoEstadoMP(estado);
  // Estados definitivos (todo lo que no es Publicada): se respetan tal cual.
  if (codigo != null && codigo !== 5) return codigo;
  // Publicada (5) o desconocido pero ya venció por fecha → Cerrada.
  if (cierreVencido(fechaCierre)) return 6;
  return codigo;
}

// Nombre del estado EFECTIVO ('Publicada' / 'Cerrada' / …). Si no se reconoce el código,
// cae al texto original recibido (para no perder estados exóticos que MP pudiera enviar).
export function estadoEfectivoNombre(
  estado: string | number | null | undefined,
  fechaCierre?: string | null,
): string | null {
  const c = estadoEfectivoCodigo(estado, fechaCierre);
  if (c != null) return CODIGO_ESTADO_MP[c] ?? (typeof estado === 'string' ? estado : String(estado ?? ''));
  return typeof estado === 'string' ? estado : (estado == null ? null : String(estado));
}

// ¿Está "activa" (Publicada y sin vencer)? Útil para filtros del radar/buscador.
export function estaActivaMP(
  estado: string | number | null | undefined,
  fechaCierre?: string | null,
): boolean {
  return estadoEfectivoCodigo(estado, fechaCierre) === 5;
}
