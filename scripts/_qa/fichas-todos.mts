const pool = ((await import('@/app/lib/db')) as any).default;
const { panelFichas } = await import('@/app/lib/compras-fichas');
const [rows] = await pool.query(`SELECT a.negocio_id AS id, a.licitacion_codigo AS codigo FROM compras_asignacion a ORDER BY a.negocio_id DESC LIMIT 200`).catch(async (e:any)=>{ console.log('asig err', String(e).slice(0,200)); return [[]] as any; }) as any;
console.log('negocios', rows.length);
for (const r of rows) {
  try { const p = await panelFichas(r.id, r.codigo); console.log('OK', r.id, r.codigo, p.productos.length); }
  catch (e: any) { console.log('FALLA', r.id, r.codigo, String(e?.stack || e).slice(0, 600)); }
}
process.exit(0);
