// app/lib/tipo-cambio.ts
// TIPO DE CAMBIO DIARIO — pedido explícito del usuario (09-sep-2026): "el tipo de cambio debe ser
// el dólar actual, como lo podemos rescatar diario." Fuente: mindicador.cl, API pública oficial
// chilena (dólar observado), sin llave. Se consulta como máximo UNA vez por día — el resultado
// queda cacheado en `compras_tipo_cambio` (migration-100), no se le pega a la API en cada
// cotización.
//
// Hoy solo se resuelve USD (es lo que trae la spec y lo único que apareció en un documento real).
// Si mañana aparece otra moneda, se agrega el símbolo `codigo` de mindicador.cl (ver
// https://mindicador.cl/api) — nunca se inventa un valor para una moneda sin fuente.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';

export interface TipoCambio { valor: number; fecha: string; fuente: string }

const FUENTE = 'mindicador.cl';
const CODIGO_MINDICADOR: Record<string, string> = { USD: 'dolar' };

/** Cuántos CLP vale 1 unidad de `moneda`, para el día de hoy (hora de Chile). `null` si la moneda
 *  es CLP (no hay nada que convertir) o si no se pudo obtener el dato de ninguna fuente — nunca
 *  inventa un tipo de cambio. */
export async function obtenerTipoCambio(moneda: string): Promise<TipoCambio | null> {
  if (!moneda || moneda === 'CLP') return null;
  const codigo = CODIGO_MINDICADOR[moneda];
  if (!codigo) return null; // moneda sin fuente conocida — no se adivina

  const hoy = ahoraChileSQL().slice(0, 10);
  const [rows] = await pool.query(
    `SELECT valor, fuente FROM compras_tipo_cambio WHERE fecha = ? AND moneda = ? LIMIT 1`,
    [hoy, moneda],
  ) as any;
  const cached = (rows as any[])[0];
  if (cached) return { valor: Number(cached.valor), fecha: hoy, fuente: cached.fuente };

  try {
    const res = await fetch(`https://mindicador.cl/api/${codigo}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data = await res.json();
    const valor = Number(data?.serie?.[0]?.valor);
    if (!Number.isFinite(valor) || valor <= 0) return null;

    await pool.query(
      `INSERT INTO compras_tipo_cambio (fecha, moneda, valor, fuente, consultado_at) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE valor = VALUES(valor), fuente = VALUES(fuente), consultado_at = VALUES(consultado_at)`,
      [hoy, moneda, valor, FUENTE, ahoraChileSQL()],
    );
    return { valor, fecha: hoy, fuente: FUENTE };
  } catch (e) {
    console.error('[tipo-cambio] no se pudo consultar mindicador.cl:', String(e).slice(0, 200));
    return null;
  }
}
