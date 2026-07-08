// app/lib/precios-cache.ts
// Caché en MySQL para los precios de mercado (tabla precios_mercado, migración 39).
// Evita repagar Serper/IA cuando se cotiza el mismo ítem (dentro de un costeo y entre
// licitaciones). La clave combina producto normalizado + región + rubro.
//
// TTL configurable con PRECIOS_CACHE_TTL_DIAS (default 30). Un hit vencido se ignora
// (se vuelve a cotizar y se reescribe la fila por su UNIQUE(clave)).

import crypto from 'crypto';
import pool from '@/app/lib/db';
import type { BusquedaPreciosResult } from '@/app/lib/buscador-precios';

const TTL_DIAS = Number(process.env.PRECIOS_CACHE_TTL_DIAS ?? 30);

// clave estable: hash de producto-normalizado + region + rubro (todo en minúsculas).
export function claveCache(productoNorm: string, region: string, rubro: string): string {
  const base = `${productoNorm}|${(region || '').toLowerCase().trim()}|${(rubro || '').toLowerCase().trim()}`;
  return crypto.createHash('sha1').update(base).digest('hex');
}

let tablaVerificada: boolean | null = null;
// Verifica una vez por proceso que la tabla exista (si la migración 39 no se aplicó, la
// caché se desactiva silenciosamente en vez de romper la cotización).
async function tablaDisponible(): Promise<boolean> {
  if (tablaVerificada !== null) return tablaVerificada;
  try {
    const [rows] = await pool.query(
      `SELECT 1 FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'precios_mercado' LIMIT 1`,
    ) as any[];
    tablaVerificada = (rows as any[]).length > 0;
  } catch {
    tablaVerificada = false;
  }
  if (!tablaVerificada) console.warn('[precios-cache] tabla precios_mercado ausente (¿migración 39?) → caché OFF');
  return tablaVerificada;
}

// Devuelve el resultado cacheado (si existe y no venció) en el mismo shape que buscarPrecioProducto.
export async function leerPrecioCache(productoNorm: string, region: string, rubro: string): Promise<BusquedaPreciosResult | null> {
  if (!await tablaDisponible()) return null;
  const clave = claveCache(productoNorm, region, rubro);
  try {
    const [rows] = await pool.query(
      `SELECT producto, region, rubro, resultados, total,
              DATEDIFF(NOW(), updated_at) AS dias
         FROM precios_mercado WHERE clave = ? LIMIT 1`,
      [clave],
    ) as any[];
    const row = (rows as any[])[0];
    if (!row) return null;
    if (TTL_DIAS > 0 && Number(row.dias) > TTL_DIAS) return null; // vencido

    const resultados = typeof row.resultados === 'string' ? JSON.parse(row.resultados) : (row.resultados || []);
    if (!Array.isArray(resultados) || resultados.length === 0) return null;

    return {
      producto: row.producto || '',
      categoria: resultados[0]?.categoria || 'desconocida',
      resultados,
      total_encontrados: Number(row.total) || resultados.length,
      suficientes: resultados.length >= 5,
      region_busqueda: row.region || null,
      queries_ia: [],
      entidades_detectadas: { marca: null, modelo: null, sku: null, specs: [], variantes: [], categoria_ia: null, es_especifico: false },
    };
  } catch (e) {
    console.warn('[precios-cache] leer falló:', String(e).slice(0, 120));
    return null;
  }
}

// Guarda/actualiza el resultado en caché. `res` es lo que devolvió buscarPrecioProducto.
export async function guardarPrecioCache(productoNorm: string, region: string, rubro: string, res: BusquedaPreciosResult): Promise<void> {
  if (!await tablaDisponible()) return;
  const clave = claveCache(productoNorm, region, rubro);
  const mejor = res.resultados[0] || null;
  try {
    await pool.query(
      `INSERT INTO precios_mercado
         (clave, producto, region, rubro, precio_neto, precio_iva, tienda, link, score, nivel, resultados, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         producto = VALUES(producto), region = VALUES(region), rubro = VALUES(rubro),
         precio_neto = VALUES(precio_neto), precio_iva = VALUES(precio_iva),
         tienda = VALUES(tienda), link = VALUES(link), score = VALUES(score),
         nivel = VALUES(nivel), resultados = VALUES(resultados), total = VALUES(total),
         updated_at = CURRENT_TIMESTAMP`,
      [
        clave,
        (res.producto || '').slice(0, 500),
        (region || '').slice(0, 120) || null,
        (rubro || '').slice(0, 120) || null,
        mejor?.precio_neto ?? null,
        mejor?.precio_valor ?? null,
        mejor?.tienda?.slice(0, 120) ?? null,
        mejor?.link ?? null,
        mejor?.score ?? null,
        mejor?.nivel_concordancia ?? null,
        JSON.stringify(res.resultados),
        res.total_encontrados ?? res.resultados.length,
      ],
    );
  } catch (e) {
    console.warn('[precios-cache] guardar falló:', String(e).slice(0, 120));
  }
}
