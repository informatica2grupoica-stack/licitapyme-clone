import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
const env = {};
for (const l of readFileSync('.env.local','utf8').split('\n')) { const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if(m && !(m[1] in env)) env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim(); }
let c = null;
for (let i = 1; i <= 20 && !c; i++) {
  try { c = await mysql.createConnection({host:env.DB_HOST,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,port:parseInt(env.DB_PORT||'3306'),connectTimeout:15000}); }
  catch (e) {
    if (e.code !== 'ER_TOO_MANY_USER_CONNECTIONS') throw e;
    if (i % 4 === 0) console.log(`  esperando slot libre... (${i}/20)`);
    await new Promise(r=>setTimeout(r, 9000));
  }
}
if (!c) { console.error('  NO se pudo conectar — los datos de prueba SIGUEN en la base.'); process.exit(1); }
const [a] = await c.query(`DELETE FROM entrega_acuse WHERE negocio_id=325`);
const [e] = await c.query(`DELETE FROM entrega_proyecto WHERE negocio_id=325`);
const [h] = await c.query(`DELETE FROM historial_eventos WHERE tipo='ENTREGA_ACUSE'`);
console.log(`  Borrados: ${e.affectedRows} entrega · ${a.affectedRows} acuses · ${h.affectedRows} eventos`);
const [[q]] = await c.query(`SELECT (SELECT COUNT(*) FROM entrega_proyecto) ep, (SELECT COUNT(*) FROM entrega_acuse) ea, (SELECT COUNT(*) FROM historial_eventos WHERE tipo='ENTREGA_ACUSE') he`);
console.log(`  Estado final → entrega_proyecto=${q.ep} · entrega_acuse=${q.ea} · eventos=${q.he}`);
const [[n]] = await c.query(`SELECT estado_pipeline FROM negocios WHERE id=325`);
console.log(`  Negocio 325 intacto → estado_pipeline=${n.estado_pipeline}`);
await c.end();
