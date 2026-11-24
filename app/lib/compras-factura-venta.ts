// app/lib/compras-factura-venta.ts
// Factura de venta al cliente final (migration-193). Al subirla se marca sola la tarea «Factura y cierre del proyecto» (clave factura_cierre).
import pool from '@/app/lib/db';
import { cambiarEstadoTarea } from '@/app/lib/compras';
import { facturasConOcObuma, pdfDteObuma, pdfYEstadoDte, type ObumaFacturaEmitida } from '@/app/lib/obuma';
import { subirDocumentoR2, borrarDocumentoR2 } from '@/app/lib/r2';
import { parsearFacturaXml } from '@/app/lib/factura-xml';
import { ahoraChileSQL } from '@/app/lib/tz';

export interface FacturaVenta {
  id: number; archivoUrl: string; archivoNombre: string; numero: string | null;
  emitidaAt: string | null; pagadaAt: string | null; subidaPorNombre: string | null; creadaAt: string;
  /** OBUMA = la trajo Licitank desde Obuma (se ve el visor del XML); MANUAL = la subió una persona (se ve el PDF). */
  origen: 'OBUMA' | 'MANUAL'; xmlUrl: string | null;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const fechaValida = (v: unknown): string | null => (typeof v === 'string' && FECHA.test(v.trim()) ? v.trim() : null);

export async function listarFacturasVenta(negocioId: number): Promise<FacturaVenta[]> {
  const [rows] = await pool.query(
    `SELECT id, archivo_url, archivo_nombre, numero, DATE_FORMAT(emitida_at,'%Y-%m-%d') emitida_at, DATE_FORMAT(pagada_at,'%Y-%m-%d') pagada_at,
            subida_por_nombre, DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') created_at, origen, xml_url
       FROM compras_factura_venta WHERE negocio_id = ? ORDER BY id`, [negocioId]) as any;
  return (rows as any[]).map(r => ({
    id: r.id, archivoUrl: r.archivo_url, archivoNombre: r.archivo_nombre, numero: r.numero, emitidaAt: r.emitida_at, pagadaAt: r.pagada_at,
    subidaPorNombre: r.subida_por_nombre, creadaAt: r.created_at,
    origen: r.origen === 'OBUMA' ? 'OBUMA' as const : 'MANUAL' as const, xmlUrl: r.xml_url ?? null,
  }));
}

export async function registrarFacturaVenta(negocioId: number, d: {
  archivoUrl: string; archivoNombre: string; numero: string | null; emitidaAt: string | null; pagadaAt: string | null;
  origen?: 'OBUMA' | 'MANUAL'; xmlUrl?: string | null;
}, actorId: number, actorNombre: string | null): Promise<{ tareaMarcada: boolean }> {
  await pool.query(
    `INSERT INTO compras_factura_venta (negocio_id, archivo_url, archivo_nombre, numero, emitida_at, pagada_at, subida_por, subida_por_nombre, origen, xml_url)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [negocioId, d.archivoUrl, d.archivoNombre.slice(0, 255), d.numero, d.emitidaAt, d.pagadaAt, actorId, actorNombre, d.origen ?? 'MANUAL', d.xmlUrl ?? null]);
  // Subir la factura ES la tarea «Factura y cierre»: se da por hecha sola (si ya estaba hecha, no se toca).
  const [t] = await pool.query(`SELECT id, estado FROM compras_tarea WHERE negocio_id = ? AND catalogo_clave = 'factura_cierre' LIMIT 1`, [negocioId]) as any;
  const tarea = (t as any[])[0];
  if (!tarea || tarea.estado === 'HECHA') return { tareaMarcada: false };
  await cambiarEstadoTarea(tarea.id, 'HECHA', {
    actorId, actorNombre, notaCierre: `Factura de venta subida${d.numero ? ` (N° ${d.numero})` : ''}: ${d.archivoNombre}`.slice(0, 2000),
  });
  return { tareaMarcada: true };
}

/** Factura de venta tal como está en Obuma, para la tarjeta «Factura de venta al cliente». */
export interface FacturaObumaDeNegocio extends ObumaFacturaEmitida { yaCargada: boolean }

/** Facturas de Obuma cuya referencia es una OC del cliente de esta licitación (las nuestras de Mercado Público). */
export async function facturasObumaDeNegocio(negocioId: number): Promise<{ ocs: string[]; facturas: FacturaObumaDeNegocio[] }> {
  const [oc] = await pool.query(
    `SELECT o.codigo FROM ordenes_compra o JOIN compras_asignacion ca ON ca.licitacion_codigo = o.licitacion_codigo
       JOIN negocios n ON n.id = ca.negocio_id
      WHERE ca.negocio_id = ? AND o.es_nuestra = 1 AND COALESCE(o.cliente_id, 1) = COALESCE(n.cliente_id, 1)`, [negocioId]) as any;
  const ocs = (oc as any[]).map(r => String(r.codigo).trim().toUpperCase()).filter(Boolean);
  if (ocs.length === 0) return { ocs, facturas: [] };
  // Igual que la ruta de facturas: tolera que la migration-193 aún no esté aplicada en esa base.
  const cargadas = new Set((await listarFacturasVenta(negocioId).catch(() => [])).map(f => (f.numero || '').trim()));
  const facturas = (await facturasConOcObuma())
    .filter(f => f.ocReferida && ocs.includes(f.ocReferida))
    .map(f => ({ ...f, yaCargada: cargadas.has(f.folio) }))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  return { ocs, facturas };
}

/**
 * Marca «pagada» las facturas de venta de Licitank que Obuma ya muestra pagadas (venta_total_pagado ≥ total en ventas.list; verificado
 * contra la pantalla «Cobros Realizados» el 24-nov-2026). La API no trae la fecha del cobro: se guarda el día en que Licitank lo detecta.
 * Solo toca facturas SIN fecha de pago y que Obuma ligue a una OC de esa licitación (las de Comercial MP no están en este Obuma).
 * Sin facturas pendientes de pago no llama a Obuma. `soloLeer` calcula sin escribir.
 */
export async function marcarFacturasPagadasDesdeObuma(opts: { soloLeer?: boolean } = {}): Promise<{ pendientes: number; marcadas: Array<{ negocioId: number; numero: string }> }> {
  const [rows] = await pool.query(
    `SELECT id, negocio_id, numero FROM compras_factura_venta WHERE pagada_at IS NULL AND numero IS NOT NULL AND numero <> ''`) as any;
  const pendientes = rows as Array<{ id: number; negocio_id: number; numero: string }>;
  const marcadas: Array<{ negocioId: number; numero: string }> = [];
  if (pendientes.length === 0) return { pendientes: 0, marcadas };
  const hoy = ahoraChileSQL().slice(0, 10);
  for (const negocioId of new Set(pendientes.map(p => p.negocio_id))) {
    let delNegocio: FacturaObumaDeNegocio[];
    try { delNegocio = (await facturasObumaDeNegocio(negocioId)).facturas; }
    catch (e) { console.warn(`[factura-venta] no se pudo leer Obuma para el negocio ${negocioId}:`, String(e).slice(0, 120)); continue; }
    for (const p of pendientes.filter(x => x.negocio_id === negocioId)) {
      const f = delNegocio.find(x => x.folio === p.numero.trim());
      if (!f || !f.pagado || f.anulada) continue;
      if (!opts.soloLeer) await pool.query(`UPDATE compras_factura_venta SET pagada_at = ? WHERE id = ? AND pagada_at IS NULL`, [hoy, p.id]);
      marcadas.push({ negocioId, numero: p.numero.trim() });
    }
  }
  return { pendientes: pendientes.length, marcadas };
}

/** Carga a Licitank una factura que está en Obuma (baja el PDF y lo guarda como si se hubiera subido a mano). */
export async function cargarFacturaDesdeObuma(negocioId: number, licitacionCodigo: string, tipo: number, folio: string, actorId: number, actorNombre: string | null): Promise<{ tareaMarcada: boolean }> {
  const { facturas } = await facturasObumaDeNegocio(negocioId);
  const f = facturas.find(x => x.tipo === tipo && x.folio === folio);
  if (!f) throw new Error('Esa factura no está en Obuma con la OC de esta licitación.');
  if (f.yaCargada) throw new Error(`La factura ${folio} ya está cargada.`);
  if (f.anulada) throw new Error(`La factura ${folio} tiene nota de crédito en Obuma: no se carga.`);
  const pdf = await pdfDteObuma(tipo, folio);
  const nombre = `Factura ${folio}.pdf`;
  const url = await subirDocumentoR2(`compras/${licitacionCodigo}/factura-venta`, nombre, pdf, 'application/pdf');
  // El XML se guarda en R2 (el link de Obuma es de ellos): con él Licitank dibuja la factura. Si no se logra bajar, queda solo el PDF.
  let xmlUrl: string | null = null;
  try {
    const { xml } = await pdfYEstadoDte(tipo, folio);
    if (xml) {
      const r = await fetch(xml, { signal: AbortSignal.timeout(20_000) });
      const txt = r.ok ? await r.text() : '';
      if (parsearFacturaXml(txt)) xmlUrl = await subirDocumentoR2(`compras/${licitacionCodigo}/factura-venta`, `Factura ${folio}.xml`, Buffer.from(txt, 'utf8'), 'application/xml');
    }
  } catch { /* sin XML: solo PDF */ }
  return registrarFacturaVenta(negocioId, { archivoUrl: url, archivoNombre: nombre, numero: folio, emitidaAt: fechaValida(f.fecha), pagadaAt: null, origen: 'OBUMA', xmlUrl }, actorId, actorNombre)
    .catch(async (e) => { await borrarDocumentoR2(url).catch(() => {}); if (xmlUrl) await borrarDocumentoR2(xmlUrl).catch(() => {}); throw e; });
}

export async function actualizarFacturaVenta(negocioId: number, id: number, p: { numero?: string | null; emitidaAt?: string | null; pagadaAt?: string | null }): Promise<void> {
  const sets: string[] = []; const vals: unknown[] = [];
  if (p.numero !== undefined) { sets.push('numero = ?'); vals.push(p.numero); }
  if (p.emitidaAt !== undefined) { sets.push('emitida_at = ?'); vals.push(p.emitidaAt); }
  if (p.pagadaAt !== undefined) { sets.push('pagada_at = ?'); vals.push(p.pagadaAt); }
  if (sets.length === 0) return;
  await pool.query(`UPDATE compras_factura_venta SET ${sets.join(', ')} WHERE id = ? AND negocio_id = ?`, [...vals, id, negocioId]);
}

export async function quitarFacturaVenta(negocioId: number, id: number): Promise<void> {
  const [r] = await pool.query(`SELECT xml_url FROM compras_factura_venta WHERE id = ? AND negocio_id = ?`, [id, negocioId]) as any;
  const xml = (r as any[])[0]?.xml_url;
  await pool.query(`DELETE FROM compras_factura_venta WHERE id = ? AND negocio_id = ?`, [id, negocioId]);
  if (xml) await borrarDocumentoR2(xml).catch(() => {});
}
