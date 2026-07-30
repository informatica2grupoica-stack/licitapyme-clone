import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
const env = {};
for (const l of readFileSync('.env.local','utf8').split('\n')) { const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if(m && !(m[1] in env)) env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim(); }
const pool = mysql.createPool({host:env.DB_HOST,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,port:parseInt(env.DB_PORT||'3306'),connectTimeout:20000});
await pool.query(`UPDATE entrega_acuse SET acusado_at=NULL WHERE negocio_id=325 AND usuario_id=1`);
await pool.query(`UPDATE entrega_proyecto SET completada_at=NULL WHERE negocio_id=325`);
// Limpiar el evento de la prueba anterior para no dejar basura en el historial.
const [d] = await pool.query(`DELETE FROM historial_eventos WHERE tipo='ENTREGA_ACUSE'`);
console.log(`  Acuse reseteado · ${d.affectedRows} evento(s) de prueba borrados del historial`);
await pool.end();
