// app/lib/exportar-propio.ts
// Exportación de datos pedida por la PROPIA empresa-cliente (Ley 21.719: derecho de acceso y portabilidad, rige desde 2026-12-01).
// Usa exportarCliente (borrar-cliente.ts): todas las filas de la empresa, sin contraseñas, tokens ni credenciales cifradas.
// Es una consulta pesada (miles de filas): se limita a una exportación cada 10 minutos por empresa y cada una queda en la bitácora.
import pool from '@/app/lib/db';
import { exportarCliente } from '@/app/lib/borrar-cliente';

export const MIN_ENTRE_EXPORTACIONES = 10;

/** ¿Han pasado suficientes minutos desde la última exportación? Pura. `ultimaMs` null = nunca exportó. */
export function esperaParaExportar(ultimaMs: number | null, ahoraMs: number, minutos = MIN_ENTRE_EXPORTACIONES): number {
  if (ultimaMs == null) return 0;
  const faltan = minutos * 60_000 - (ahoraMs - ultimaMs);
  return faltan > 0 ? Math.ceil(faltan / 60_000) : 0;
}

export class ExportacionReciente extends Error {
  constructor(public minutos: number) { super(`Ya exportaste tus datos hace poco. Podrás pedir otra en ${minutos} minuto${minutos === 1 ? '' : 's'}.`); }
}

/** Exporta los datos de la empresa de `usuarioId`. Lanza ExportacionReciente si se pidió hace menos de 10 minutos. */
export async function exportarDatosPropios(clienteId: number, usuarioId: number): Promise<Record<string, unknown>> {
  // Se reserva el turno ANTES de exportar (así dos clics seguidos no lanzan dos consultas pesadas).
  const [[u]] = await pool.query(
    `SELECT UNIX_TIMESTAMP(MAX(created_at)) * 1000 AS ultima FROM clientes_bitacora WHERE cliente_id = ? AND accion = 'exportar_propio'`, [clienteId]) as any;
  const [[ahora]] = await pool.query(`SELECT UNIX_TIMESTAMP(NOW()) * 1000 AS ms`) as any;
  const espera = esperaParaExportar(u?.ultima != null ? Number(u.ultima) : null, Number(ahora.ms));
  if (espera > 0) throw new ExportacionReciente(espera);
  await pool.query('INSERT INTO clientes_bitacora (cliente_id, usuario_id, accion, detalle) VALUES (?, ?, ?, ?)',
    [clienteId, usuarioId, 'exportar_propio', JSON.stringify({ origen: 'mi-empresa' })]);
  return exportarCliente(clienteId);
}
