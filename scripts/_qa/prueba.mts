const pool = ((await import('@/app/lib/db')) as any).default;
const [r] = await pool.query(`SELECT ca.negocio_id, ca.licitacion_codigo, ca.estado_compra, l.nombre FROM compras_asignacion ca LEFT JOIN licitaciones_cache l ON l.codigo = ca.licitacion_codigo WHERE ca.licitacion_codigo LIKE '%PRUEBA%' OR ca.licitacion_codigo LIKE 'TEST%' OR ca.licitacion_codigo LIKE 'COT-%' OR l.nombre LIKE '%prueba%' LIMIT 10`).catch((e: any) => [[String(e).slice(0,200)]]) as any; console.log(r);
process.exit(0);
