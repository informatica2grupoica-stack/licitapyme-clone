const fs = require('fs');
const mysql = require('mysql2/promise');
const env = {};
fs.readFileSync('.env.local','utf8').split(/\r?\n/).forEach(l=>{
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if(m){ let v=m[2].trim(); if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1); env[m[1]]=v; }
});
(async () => {
  const pool = await mysql.createPool({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT||'3306'), connectionLimit: 2 });

  // 1. Distribución global de categorías
  const [dist] = await pool.query(
    `SELECT COALESCE(categoria,'(null)') AS cat, COUNT(*) AS n
     FROM documentos_cache GROUP BY categoria ORDER BY n DESC`);
  console.log('\n=== DISTRIBUCIÓN GLOBAL DE CATEGORÍAS ===');
  console.table(dist);

  // 2. Licitaciones clasificadas más recientes (con docs ya categorizados)
  const [recientes] = await pool.query(
    `SELECT licitacion_codigo, COUNT(*) AS docs,
            SUM(categoria IS NOT NULL) AS clasificados,
            MAX(created_at) AS ult
     FROM documentos_cache
     GROUP BY licitacion_codigo
     HAVING clasificados > 0
     ORDER BY ult DESC LIMIT 8`);
  console.log('\n=== ÚLTIMAS 5 LICITACIONES CLASIFICADAS ===');
  console.table(recientes);

  // 3. Detalle de la más reciente
  if (recientes.length) {
    const cod = recientes[0].licitacion_codigo;
    const [docs] = await pool.query(
      `SELECT documento_nombre, categoria FROM documentos_cache
       WHERE licitacion_codigo = ? ORDER BY categoria`, [cod]);
    console.log(`\n=== DETALLE: ${cod} ===`);
    docs.forEach(d => console.log(`  [${d.categoria||'(sin)'}]  ${d.documento_nombre}`));
  }

  await pool.end();
})().catch(e=>{ console.error('ERROR:', e.message); process.exit(1); });
