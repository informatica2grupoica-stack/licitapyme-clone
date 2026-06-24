import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
const env = {};
for (const line of readFileSync('.env.local','utf8').split('\n')) { const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim(); }
const pool = mysql.createPool({ host:env.DB_HOST,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,port:parseInt(env.DB_PORT||'3306'),connectTimeout:20000 });
// userId admin: tomo el primero con rol admin
const [[u]] = await pool.query("SELECT id,email FROM usuarios WHERE rol='admin' ORDER BY id LIMIT 1");
const userId = u.id;
console.log(`\n  userId admin = ${userId} (${u.email})`);
const GATE = `AND EXISTS (SELECT 1 FROM prefiltro_licitacion pf WHERE pf.licitacion_codigo = al.licitacion_codigo AND pf.decision IN ('PASA','REVISION_HUMANA'))`;
const pend = (gate) => `SELECT COUNT(*) n FROM (SELECT DISTINCT al.licitacion_codigo FROM alertas_licitaciones al WHERE al.usuario_id=? AND NOT EXISTS (SELECT 1 FROM viabilidad_licitacion v WHERE v.licitacion_codigo=al.licitacion_codigo AND INSTR(v.informe_ejecutivo,'_informe_ia')>0) ${gate}) t`;
const [[a]] = await pool.query(pend(GATE),[userId]);
console.log(`  PASA/REVISION sin informe profundo (_informe_ia): ${a.n}`);
// Desglose: con docs vs sin docs
const [[b]] = await pool.query(`SELECT COUNT(*) n FROM (SELECT DISTINCT al.licitacion_codigo FROM alertas_licitaciones al WHERE al.usuario_id=? AND EXISTS(SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo=al.licitacion_codigo) AND NOT EXISTS (SELECT 1 FROM viabilidad_licitacion v WHERE v.licitacion_codigo=al.licitacion_codigo AND INSTR(v.informe_ejecutivo,'_informe_ia')>0) ${GATE}) t`,[userId]);
console.log(`    · de esas, CON documentos ya: ${b.n}`);
console.log(`    · sin documentos (habría que descargar): ${a.n - b.n}`);
// Cuántas YA tienen informe profundo
const [[c]] = await pool.query(`SELECT COUNT(*) n FROM viabilidad_licitacion WHERE INSTR(informe_ejecutivo,'_informe_ia')>0`);
console.log(`  Ya con informe profundo (no se re-procesan): ${c.n}`);
await pool.end();
console.log('');
