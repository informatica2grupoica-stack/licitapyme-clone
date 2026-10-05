// app/lib/auditor-compra.ts
// AUDITOR DE COMPRA (etapa comercial, 28-sep-2026) — pestaña propia del negocio, debajo del
// Auditor Técnico, visible solo cuando el negocio ganó. No es el "Auditor de Compras" del módulo
// Compras (post-adjudicación, ver auditor-compras.ts / AuditorCosteoCard / AuditorComprasCard):
// este vive en /negocios/[id] y lee las MISMAS filas del Costeo (negocio_costeo_editor) que ya
// muestra el editor, sin duplicar su link ni su precio de mercado — solo agrega lo que faltaba:
// ¿se cotizó de verdad este producto?, y si se cotizó con una cotización real (documento que puede
// cubrir uno o más productos a la vez), el precio nuevo que trae esa cotización para cada uno
// (migration-130 — antes solo se guardaba un documento suelto por fila, sin precio propio).
import pool from '@/app/lib/db';
import { esLinkDeProducto } from '@/app/lib/costeo-comparativo';
import type { EstadoCosteoEditor, FilaEditorCosteo } from '@/app/lib/costeo-editor';

export interface LineaAuditorCompra {
  filaId: string;
  hoja: string;
  item: number;
  detalle: string;
  unidad: string;
  cantidad: number | null;
  links: string[];           // link1/2/3 que de verdad son un link (ver esLinkDeProducto)
  precioWeb: number | null;  // valorConIva de la fila — "VALOR C/ IVA", precio de mercado ya cargado en el Costeo
  cotizado: boolean;
  cotizacionId: number | null;
  precioCotizado: number | null;  // precio nuevo que trae la cotización para ESTE producto (migration-130)
  documentoUrl: string | null;
  documentoNombre: string | null;
}

export interface CotizacionAuditorCompra {
  id: number;
  documentoUrl: string;
  documentoNombre: string | null;
  creadoAt: string;
}

interface FilaGuardada {
  fila_id: string;
  cotizado: number;
  documento_url: string | null;
  documento_nombre: string | null;
  cotizacion_id: number | null;
  precio_cotizado: string | number | null;
  cot_url: string | null;
  cot_nombre: string | null;
}

/** Junta cada fila del Costeo (link y precio web ya cargados ahí) con lo guardado en
 *  negocio_auditor_compra_linea (cotizado + documento/precio). Una fila del Costeo sin nada
 *  guardado todavía aparece con cotizado=false y sin documento — nunca se inventa un default
 *  distinto. Cuando la fila está enganchada a una cotización (cotizacion_id), el documento que se
 *  muestra es el de la cotización (puede cubrir varios productos); si no, se usa el documento
 *  legado guardado directo en la fila (antes de migration-130, un documento por fila). */
export async function lineasAuditorCompra(negocioId: number, estadoCosteo: EstadoCosteoEditor | null): Promise<LineaAuditorCompra[]> {
  if (!estadoCosteo) return [];
  const [rows] = await pool.query(
    `SELECT l.fila_id, l.cotizado, l.documento_url, l.documento_nombre, l.cotizacion_id, l.precio_cotizado,
            c.documento_url AS cot_url, c.documento_nombre AS cot_nombre
     FROM negocio_auditor_compra_linea l
     LEFT JOIN negocio_auditor_compra_cotizacion c ON c.id = l.cotizacion_id
     WHERE l.negocio_id = ?`,
    [negocioId],
  ) as any;
  const guardadas = new Map<string, FilaGuardada>((rows as FilaGuardada[]).map(r => [r.fila_id, r]));

  const lineas: LineaAuditorCompra[] = [];
  for (const g of estadoCosteo.grupos || []) {
    if (g.ofertamos === false) continue;
    for (const f of (g.filas || []) as FilaEditorCosteo[]) {
      if (f.agregadoPorCompras || f.esCostoAdicional) continue; // gasto extra / costo adicional, no es un producto cotizado
      const sinDatos = !f.detalle?.trim() && f.cantidad == null && f.valorConIva == null;
      if (sinDatos) continue;
      const guardada = guardadas.get(f.id);
      lineas.push({
        filaId: f.id, hoja: g.nombre, item: f.item,
        detalle: f.detalle?.trim() || `Fila ${f.item}`,
        unidad: f.unidad?.trim() || '',
        cantidad: f.cantidad,
        links: [f.link1, f.link2, f.link3].filter(esLinkDeProducto),
        precioWeb: f.valorConIva,
        cotizado: !!guardada?.cotizado,
        cotizacionId: guardada?.cotizacion_id ?? null,
        precioCotizado: guardada?.precio_cotizado != null ? Number(guardada.precio_cotizado) : null,
        documentoUrl: guardada?.cot_url ?? guardada?.documento_url ?? null,
        documentoNombre: guardada?.cot_nombre ?? guardada?.documento_nombre ?? null,
      });
    }
  }
  return lineas;
}

/** Guarda el estado de UNA fila (cotizado, y/o precio cotizado suelto, y/o documento legado sin
 *  cotización agrupadora). Upsert: la primera vez que se toca una fila crea su registro, las
 *  siguientes lo actualiza. */
export async function guardarLineaAuditorCompra(params: {
  negocioId: number; filaId: string; cotizado: boolean;
  precioCotizado?: number | null;
  documentoUrl?: string | null; documentoNombre?: string | null;
  userId: number; nombreActor: string; ahora: string;
}): Promise<void> {
  const { negocioId, filaId, cotizado, precioCotizado, documentoUrl, documentoNombre, userId, nombreActor, ahora } = params;
  await pool.query(
    `INSERT INTO negocio_auditor_compra_linea
       (negocio_id, fila_id, cotizado, precio_cotizado, documento_url, documento_nombre, actualizado_por, actualizado_por_nombre, actualizado_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       cotizado = VALUES(cotizado),
       precio_cotizado = COALESCE(VALUES(precio_cotizado), precio_cotizado),
       documento_url = COALESCE(VALUES(documento_url), documento_url),
       documento_nombre = COALESCE(VALUES(documento_nombre), documento_nombre),
       actualizado_por = VALUES(actualizado_por), actualizado_por_nombre = VALUES(actualizado_por_nombre),
       actualizado_at = VALUES(actualizado_at)`,
    [negocioId, filaId, cotizado ? 1 : 0, precioCotizado ?? null, documentoUrl ?? null, documentoNombre ?? null, userId, nombreActor, ahora],
  );
}

/** Crea UNA cotización (un documento) que cubre una o más filas a la vez, cada una con su propio
 *  precio cotizado (puede venir null si todavía no se sabe el precio de esa línea puntual).
 *  Transaccional: si falla cualquier fila, no queda la cotización huérfana sin filas. */
export async function crearCotizacionAuditorCompra(params: {
  negocioId: number;
  documentoUrl: string;
  documentoNombre: string | null;
  filas: Array<{ filaId: string; precioCotizado: number | null }>;
  userId: number; nombreActor: string; ahora: string;
}): Promise<number> {
  const { negocioId, documentoUrl, documentoNombre, filas, userId, nombreActor, ahora } = params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.query(
      `INSERT INTO negocio_auditor_compra_cotizacion
         (negocio_id, documento_url, documento_nombre, creado_por, creado_por_nombre, creado_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [negocioId, documentoUrl, documentoNombre, userId, nombreActor, ahora],
    ) as any;
    const cotizacionId = ins.insertId as number;
    for (const f of filas) {
      await conn.query(
        `INSERT INTO negocio_auditor_compra_linea
           (negocio_id, fila_id, cotizado, cotizacion_id, precio_cotizado, actualizado_por, actualizado_por_nombre, actualizado_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cotizado = 1, cotizacion_id = VALUES(cotizacion_id), precio_cotizado = VALUES(precio_cotizado),
           actualizado_por = VALUES(actualizado_por), actualizado_por_nombre = VALUES(actualizado_por_nombre),
           actualizado_at = VALUES(actualizado_at)`,
        [negocioId, f.filaId, cotizacionId, f.precioCotizado, userId, nombreActor, ahora],
      );
    }
    await conn.commit();
    return cotizacionId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
