import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
const env = {};
for (const line of readFileSync('.env.local','utf8').split('\n')){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const pool = mysql.createPool({host:env.DB_HOST,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,port:parseInt(env.DB_PORT||'3306'),connectTimeout:20000});
const codigo = process.argv[2]||'3890-113-L126';
try{
  const [al] = await pool.query(`SELECT licitacion_monto, licitacion_nombre FROM alertas_licitaciones WHERE licitacion_codigo=? ORDER BY created_at DESC LIMIT 1`,[codigo]);
  console.log('PORTADA (alertas_licitaciones):', al[0] ? `monto=${al[0].licitacion_monto} · ${al[0].licitacion_nombre?.slice(0,60)}` : 'sin fila');
  const [v] = await pool.query(`SELECT modelo, score_total, semaforo,
      JSON_EXTRACT(informe_ejecutivo,'$._informe_ia.presupuesto') AS presu,
      JSON_EXTRACT(informe_ejecutivo,'$._informe_ia.capa_a.score_total') AS capaA,
      JSON_CONTAINS_PATH(informe_ejecutivo,'one','$._informe_ia') AS tiene_ia
    FROM viabilidad_licitacion WHERE licitacion_codigo=?`,[codigo]);
  if(!v.length){console.log('viabilidad_licitacion: SIN fila');}
  else{const r=v[0];console.log(`\nviabilidad_licitacion: modelo=${r.modelo} score=${r.score_total} semaforo=${r.semaforo} tiene_ia=${r.tiene_ia}`);
    console.log('  capa_a.score_total =', r.capaA);
    console.log('  presupuesto (del _informe_ia) =', r.presu);}
}catch(e){console.error('ERR',e.message);}finally{await pool.end();}
