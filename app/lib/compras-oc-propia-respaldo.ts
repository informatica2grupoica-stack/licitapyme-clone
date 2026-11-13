// app/lib/compras-oc-propia-respaldo.ts
// OC interna entre empresas del grupo (Comercial MP → Inversiones Claro): cuando Claro ya compró el producto a un
// proveedor externo y esa OC está en Obuma, la OC interna es solo el respaldo tributario de la venta entre
// relacionadas. El costo real del negocio es el del grupo (lo pagado afuera): esas líneas NO se suman otra vez.
// Decisión del dueño, 4152-22-LE26 (13-nov-2026). Si el producto no tiene OC externa (ej. 979: vacuolavadora del
// stock de Claro), la OC interna sí es el costo y se suma como siempre.
import pool from '@/app/lib/db';
import type { OcPropia } from '@/app/lib/compras-oc-propia';

const rutLimpio = (r: string | null | undefined) => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();

/** Neto de cada OC propia (por folio) que es solo respaldo interno y no debe sumar al costo. */
export async function netoRespaldoInterno(negocioId: number, propias: OcPropia[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!propias.length) return out;
  try {
    const [emp] = await pool.query(`SELECT rut FROM empresas`) as any;
    const delGrupo = new Set((emp as any[]).map(e => rutLimpio(e.rut)).filter(Boolean));
    const internas = propias.filter(o => delGrupo.has(rutLimpio(o.proveedor.rut)));
    if (!internas.length) return out;
    const { emparejarPlanConObuma } = await import('@/app/lib/compras-sku-obuma');   // dinámico: compras-sku-obuma importa compras-oc-obuma
    const { pares } = await emparejarPlanConObuma(negocioId);
    const conOcExterna = new Set(pares.map(p => p.item.productoId));
    for (const o of internas) {
      const neto = o.items.filter(i => i.productoId != null && conOcExterna.has(i.productoId)).reduce((s, i) => s + i.cantidad * i.precio, 0);
      if (neto > 0) out.set(o.folio, Math.round(neto));
    }
  } catch (e) {
    console.error('[compras] respaldo interno de OC propias no calculable:', String(e).slice(0, 150));
  }
  return out;
}
