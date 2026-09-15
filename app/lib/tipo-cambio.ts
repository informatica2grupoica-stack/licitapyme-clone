// app/lib/tipo-cambio.ts
// TIPO DE CAMBIO DIARIO — pedido explícito del usuario (09-sep-2026): "el tipo de cambio debe ser
// el dólar actual, como lo podemos rescatar diario." Fuente: mindicador.cl, API pública oficial
// chilena (dólar observado), sin llave. Se consulta como máximo UNA vez por día — el resultado
// queda cacheado en `compras_tipo_cambio` (migration-100), no se le pega a la API en cada
// cotización.
//
// Empezó resolviendo solo USD (lo único que había aparecido en un documento real). Se agrega EUR
// (15-sep-2026, cotización real de un proveedor italiano en euros — "tendríamos que hacer lo mismo
// que hacemos con dólar") con el mismo criterio: símbolo `codigo` de mindicador.cl (ver
// https://mindicador.cl/api, que también publica "euro"), nunca se inventa un valor para una
// moneda sin fuente. Para sumar otra, basta agregar su código acá.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';

export interface TipoCambio { valor: number; fecha: string; fuente: string }

const FUENTE = 'mindicador.cl';
const CODIGO_MINDICADOR: Record<string, string> = { USD: 'dolar', EUR: 'euro' };

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
    // 8s se quedaba corto para el indicador "euro" (medido 15-sep-2026: "dolar" responde rápido,
    // "euro" puede tardar >10s) — sin el tipo de cambio la cotización queda "sin convertir, no
    // entra al comparativo", así que vale la pena esperar un poco más antes de rendirse.
    const res = await fetch(`https://mindicador.cl/api/${codigo}`, { signal: AbortSignal.timeout(15_000) });
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
