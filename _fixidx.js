const fs = require('fs');
const mysql = require('mysql2/promise');
const env = {};
fs.readFileSync('.env.local','utf8').split(/\r?\n/).forEach(l=>{
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if(m){ let v=m[2].trim(); if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1); env[m[1]]=v; }
});
(async () => {
  const pool = await mysql.createPool({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT||'3306'), connectionLimit: 2 });
  const [idx] = await pool.query(`SHOW INDEX FROM alertas_licitaciones WHERE Key_name='idx_alertas_codigo'`);
  if (idx.length) { console.log('idx_alertas_codigo ya existe.'); }
  else {
    const a = Date.now();
    await pool.query(`CREATE INDEX idx_alertas_codigo ON alertas_licitaciones (licitacion_codigo)`);
    console.log('Índice idx_alertas_codigo creado en', (Date.now()-a)+'ms');
  }
  // Re-medir el UPDATE
  const a = Date.now();
  const [r] = await pool.query(`UPDATE alertas_licitaciones SET licitacion_fecha_publicacion = licitacion_fecha_publicacion WHERE licitacion_codigo = ?`, ['1171326-6-LE26']);
  console.log('UPDATE por licitacion_codigo AHORA:', (Date.now()-a)+'ms');
  await pool.end();
})().catch(e=>{ console.error('ERROR:', e.message); process.exit(1); });
