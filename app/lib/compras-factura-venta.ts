// app/lib/compras-factura-venta.ts
// Factura de venta al cliente final (migration-193). Al subirla se marca sola la tarea «Factura y cierre del proyecto» (clave factura_cierre).
import pool from '@/app/lib/db';
import { cambiarEstadoTarea } from '@/app/lib/compras';

export interface FacturaVenta {
  id: number; archivoUrl: string; archivoNombre: string; numero: string | null;
  emitidaAt: string | null; pagadaAt: string | null; subidaPorNombre: string | null; creadaAt: string;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const fechaValida = (v: unknown): string | null => (typeof v === 'string' && FECHA.test(v.trim()) ? v.trim() : null);

export async function listarFacturasVenta(negocioId: number): Promise<FacturaVenta[]> {
  const [rows] = await pool.query(
    `SELECT id, archivo_url, archivo_nombre, numero, DATE_FORMAT(emitida_at,'%Y-%m-%d') emitida_at, DATE_FORMAT(pagada_at,'%Y-%m-%d') pagada_at,
            subida_por_nombre, DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') created_at
       FROM compras_factura_venta WHERE negocio_id = ? ORDER BY id`, [negocioId]) as any;
  return (rows as any[]).map(r => ({
    id: r.id, archivoUrl: r.archivo_url, archivoNombre: r.archivo_nombre, numero: r.numero, emitidaAt: r.emitida_at, pagadaAt: r.pagada_at,
    subidaPorNombre: r.subida_por_nombre, creadaAt: r.created_at,
  }));
}

export async function registrarFacturaVenta(negocioId: number, d: {
  archivoUrl: string; archivoNombre: string; numero: string | null; emitidaAt: string | null; pagadaAt: string | null;
}, actorId: number, actorNombre: string | null): Promise<{ tareaMarcada: boolean }> {
  await pool.query(
    `INSERT INTO compras_factura_venta (negocio_id, archivo_url, archivo_nombre, numero, emitida_at, pagada_at, subida_por, subida_por_nombre)
     VALUES (?,?,?,?,?,?,?,?)`,
    [negocioId, d.archivoUrl, d.archivoNombre.slice(0, 255), d.numero, d.emitidaAt, d.pagadaAt, actorId, actorNombre]);
  // Subir la factura ES la tarea «Factura y cierre»: se da por hecha sola (si ya estaba hecha, no se toca).
  const [t] = await pool.query(`SELECT id, estado FROM compras_tarea WHERE negocio_id = ? AND catalogo_clave = 'factura_cierre' LIMIT 1`, [negocioId]) as any;
  const tarea = (t as any[])[0];
  if (!tarea || tarea.estado === 'HECHA') return { tareaMarcada: false };
  await cambiarEstadoTarea(tarea.id, 'HECHA', {
    actorId, actorNombre, notaCierre: `Factura de venta subida${d.numero ? ` (N° ${d.numero})` : ''}: ${d.archivoNombre}`.slice(0, 2000),
  });
  return { tareaMarcada: true };
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
  await pool.query(`DELETE FROM compras_factura_venta WHERE id = ? AND negocio_id = ?`, [id, negocioId]);
}
