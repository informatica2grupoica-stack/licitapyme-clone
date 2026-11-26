// app/lib/obuma-facturas-sueltas.ts
// Facturas (tipo 33) que Obuma tiene de un proveedor pero que NO están enlazadas a ninguna OC del negocio. Sirven para saber a qué
// factura anula una nota de crédito: si anula una suelta, no le resta nada a la OC (OC 4055 de 2736-44-LE26: 5 facturas de $1,8 M,
// 4 notas de crédito y solo la 39 enlazada → lo facturado es $1,8 M, no −$5,4 M). Lee el espejo `obuma_registro` (sin llamar a Obuma).
import pool from '@/app/lib/db';

export interface FacturaSuelta { proveedor: string | null; folio: string; neto: number }

const rutLimpio = (r: string | null | undefined) => String(r ?? '').replace(/[.\-\s]/g, '').toUpperCase();

export async function facturasSueltasDeProveedores(
  ocs: { proveedor: string | null; rut: string | null; facturasFolios: string[] }[],
): Promise<FacturaSuelta[]> {
  const enlazadas = new Set(ocs.flatMap(o => o.facturasFolios.map(f => `${rutLimpio(o.rut)}|${f}`)));
  const porRut = new Map<string, string | null>();
  for (const o of ocs) if (rutLimpio(o.rut) && !porRut.has(rutLimpio(o.rut))) porRut.set(rutLimpio(o.rut), o.proveedor);
  if (!porRut.size) return [];
  try {
    const [rows] = await pool.query(
      `SELECT folio, neto, REPLACE(REPLACE(contraparte_rut,'.',''),'-','') AS rut
         FROM obuma_registro
        WHERE entidad = 'compra_dte' AND tipo_dcto = '33' AND REPLACE(REPLACE(contraparte_rut,'.',''),'-','') IN (?)`,
      [[...porRut.keys()]],
    ) as any;
    return (rows as any[])
      .filter(r => r.folio && !enlazadas.has(`${String(r.rut).toUpperCase()}|${r.folio}`))
      .map(r => ({ proveedor: porRut.get(String(r.rut).toUpperCase()) ?? null, folio: String(r.folio), neto: Math.round(Number(r.neto) || 0) }));
  } catch { return []; }   // sin espejo de Obuma: las notas se asocian como antes
}
