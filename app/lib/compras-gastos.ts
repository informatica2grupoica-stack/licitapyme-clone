// app/lib/compras-gastos.ts
// REGISTRO DE GASTOS — pedido explícito del usuario (09-sep-2026): "aparte de los productos que
// tiene la licitación a veces salen gastos extras... aplicar más ítems si es necesario como el
// mismo flete, horas extras o productos" y verlos TODOS juntos para saber cuánto se gastó de
// verdad en el negocio. Es la primera vez que el módulo registra un costo REAL incurrido — todo lo
// anterior (escenarios §8.10, costo aterrizado §12.3) es una ESTIMACIÓN para decidir/comparar, no
// un gasto que de verdad se pagó. Por eso vive aparte de EntregaCard (que es sobre la entrega
// física, no sobre plata) y aparte de los escenarios (que son antes de comprar, no después).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}
const fmtMonto = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);

export interface CategoriaGasto { clave: string; etiqueta: string }

export async function listarCategoriasGasto(): Promise<CategoriaGasto[]> {
  const [rows] = await pool.query(`SELECT clave, etiqueta FROM compras_gasto_categoria WHERE activo = 1 ORDER BY orden`) as any;
  return rows as CategoriaGasto[];
}

/** §1.3.5 — "lo escrito en texto libre debe poder promoverse a categoría estable cuando se repite." */
export async function promoverCategoriaGasto(etiquetaLibre: string): Promise<string> {
  const clave = etiquetaLibre.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || `otro_${Date.now()}`;
  await pool.query(
    `INSERT IGNORE INTO compras_gasto_categoria (clave, etiqueta, orden, promovido_de_texto_libre) VALUES (?, ?, 500, 1)`,
    [clave, etiquetaLibre.trim().slice(0, 150)],
  );
  return clave;
}

export interface DatosGasto {
  categoriaClave?: string | null; descripcion: string; monto: number; moneda?: string;
  fechaGasto?: string | null; comprobanteUrl?: string | null; notas?: string | null;
}

export async function registrarGasto(
  negocioId: number, datos: DatosGasto, actorId: number, actorNombre: string | null,
): Promise<number> {
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `INSERT INTO compras_gasto
       (negocio_id, categoria_clave, descripcion, monto, moneda, fecha_gasto, comprobante_url, notas,
        registrado_por, registrado_por_nombre, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      negocioId, datos.categoriaClave || null, datos.descripcion.slice(0, 500), datos.monto,
      datos.moneda || 'CLP', datos.fechaGasto || null, datos.comprobanteUrl || null, datos.notas || null,
      actorId, actorNombre, ahora,
    ],
  ) as any;
  const id = r.insertId as number;

  await registrarEvento({
    tipo: 'COMPRAS_GASTO_REGISTRADO', licitacionCodigo: await licitacionDeNegocio(negocioId),
    actorId, actorNombre,
    mensaje: `Se registró un gasto: "${datos.descripcion}" — ${fmtMonto(datos.monto)}.`,
    metadata: { negocio_id: negocioId, gasto_id: id, categoria: datos.categoriaClave, monto: datos.monto },
  });
  return id;
}

export async function eliminarGasto(negocioId: number, gastoId: number, actorId: number, actorNombre: string | null): Promise<void> {
  const [rows] = await pool.query(`SELECT descripcion, monto FROM compras_gasto WHERE id = ? AND negocio_id = ?`, [gastoId, negocioId]) as any;
  const g = (rows as any[])[0];
  if (!g) throw new Error('Gasto no encontrado para este negocio.');
  await pool.query(`DELETE FROM compras_gasto WHERE id = ?`, [gastoId]);
  await registrarEvento({
    tipo: 'COMPRAS_GASTO_ELIMINADO', licitacionCodigo: await licitacionDeNegocio(negocioId),
    actorId, actorNombre,
    mensaje: `Se eliminó el gasto: "${g.descripcion}" — ${fmtMonto(Number(g.monto))}.`,
    metadata: { negocio_id: negocioId, gasto_id: gastoId },
  });
}

export interface GastoFila {
  id: number; categoriaClave: string | null; categoriaEtiqueta: string | null;
  descripcion: string; monto: number; moneda: string; fechaGasto: string | null;
  comprobanteUrl: string | null; notas: string | null;
  registradoPorNombre: string | null; createdAt: string;
}

export async function listarGastos(negocioId: number): Promise<GastoFila[]> {
  const [rows] = await pool.query(
    `SELECT g.id, g.categoria_clave, c.etiqueta AS categoria_etiqueta, g.descripcion, g.monto, g.moneda,
            DATE_FORMAT(g.fecha_gasto, '%Y-%m-%d') AS fecha_gasto, g.comprobante_url, g.notas,
            g.registrado_por_nombre, DATE_FORMAT(g.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM compras_gasto g LEFT JOIN compras_gasto_categoria c ON c.clave = g.categoria_clave
       WHERE g.negocio_id = ? ORDER BY g.created_at DESC`,
    [negocioId],
  ) as any;
  return (rows as any[]).map(r => ({
    id: r.id, categoriaClave: r.categoria_clave, categoriaEtiqueta: r.categoria_etiqueta,
    descripcion: r.descripcion, monto: Number(r.monto), moneda: r.moneda, fechaGasto: r.fecha_gasto,
    comprobanteUrl: r.comprobante_url, notas: r.notas,
    registradoPorNombre: r.registrado_por_nombre, createdAt: r.created_at,
  }));
}

export interface ResumenGastos { total: number; porCategoria: Array<{ clave: string | null; etiqueta: string; total: number }> }

/** Solo suma gastos en CLP — un gasto en otra moneda sin convertir queda visible en la lista pero
 *  fuera del total, mismo criterio de "nunca inventar" que usa tipo-cambio.ts para cotizaciones. */
export async function resumenGastos(negocioId: number): Promise<ResumenGastos> {
  const gastos = await listarGastos(negocioId);
  const clp = gastos.filter(g => g.moneda === 'CLP');
  const total = clp.reduce((s, g) => s + g.monto, 0);
  const porCategoriaMap = new Map<string, { etiqueta: string; total: number }>();
  for (const g of clp) {
    const clave = g.categoriaClave || '__sin_categoria__';
    const etiqueta = g.categoriaEtiqueta || 'Sin categoría';
    const actual = porCategoriaMap.get(clave) || { etiqueta, total: 0 };
    actual.total += g.monto;
    porCategoriaMap.set(clave, actual);
  }
  return {
    total,
    porCategoria: [...porCategoriaMap.entries()].map(([clave, v]) => ({ clave: clave === '__sin_categoria__' ? null : clave, ...v })),
  };
}
