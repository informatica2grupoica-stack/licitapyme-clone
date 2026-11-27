const pool = ((await import('@/app/lib/db')) as any).default;
const [rows] = await pool.query(`SELECT detalle FROM auditor_evento WHERE negocio_id = 891 AND tipo='ficha_compras' ORDER BY id DESC LIMIT 400`) as any;
const { extraccionesPorIds } = await import('@/app/lib/auditor-lector');
const ex = await extraccionesPorIds(rows.map((r: any) => Number(r.detalle)));
for (const [id, e] of ex as any) {
  for (const [i, p] of (e.data?.salida?.productos || []).entries()) {
    for (const k of ['tipo','marca','modelo','version','sku_fabricante','sku_proveedor']) { const v = p.producto?.[k]; if (v != null && typeof v !== 'string') console.log('NO-STRING', id, e.documentoNombre, i, k, JSON.stringify(v).slice(0,150)); }
  }
}
process.exit(0);
