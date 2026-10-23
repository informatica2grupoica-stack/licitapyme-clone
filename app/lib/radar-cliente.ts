// app/lib/radar-cliente.ts
// Multi-cliente: «Actualizar ahora» de una empresa-cliente.
//
// El barrido grande contra Mercado Público (cron/alertas + enriquecimiento) es COMPARTIDO y lo corre Grupo ICA: baja el universo de
// licitaciones UNA vez y lo deja en `licitaciones_cache`. Una empresa-cliente NO debe dispararlo (gastaría la cuota diaria de la API,
// que es de todos, y arrastraría procesos internos de ICA: postuladas, estados, correos).
//
// Lo que sí puede hacer al instante es cruzar SUS palabras clave contra lo que ya está en la caché y generar sus alertas. Es el mismo
// motor (radar-matching.ts) que usa el barrido, solo acotado a sus palabras: así lo que ve es consistente con el resto del sistema.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { leerCache } from '@/app/lib/licitaciones-cache';
import { cargarKeywordsRadar, matchearEInsertar } from '@/app/lib/radar-matching';

const DIAS_RECIENTES = 15;       // igual que el universo del barrido: activas + últimos 15 días
const TOPE_LICITACIONES = 20000; // cordura: nadie tiene tantas activas

export async function actualizarRadarDeCliente(clienteId: number): Promise<{
  licitaciones: number; palabras: number; alertasNuevas: number; excluidasPorNegativa: number;
}> {
  const kws = await cargarKeywordsRadar(clienteId);
  if (kws.positivas.length === 0) return { licitaciones: 0, palabras: 0, alertasNuevas: 0, excluidasPorNegativa: 0 };

  const ahora = ahoraChileSQL();
  const [rows] = await pool.query(
    `SELECT codigo FROM licitaciones_cache
      WHERE enriquecido = 1
        AND (fecha_cierre >= ? OR fecha_cierre IS NULL OR fecha_publicacion >= DATE_SUB(?, INTERVAL ? DAY))
      ORDER BY fecha_publicacion DESC
      LIMIT ?`,
    [ahora, ahora, DIAS_RECIENTES, TOPE_LICITACIONES],
  ) as any[];
  const codigos = (rows as Array<{ codigo: string }>).map(r => r.codigo);
  const cache = await leerCache(codigos);
  const lics = Array.from(cache.values()).map(c => c.lic);

  let alertasNuevas = 0, excluidasPorNegativa = 0;
  for (let i = 0; i < lics.length; i += 500) {
    const r = await matchearEInsertar(lics.slice(i, i + 500), kws);
    alertasNuevas += r.alertasNuevas;
    excluidasPorNegativa += r.excluidasPorNegativa;
  }
  return { licitaciones: lics.length, palabras: kws.positivas.length, alertasNuevas, excluidasPorNegativa };
}
