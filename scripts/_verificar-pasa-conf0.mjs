// Distingue los dos tipos de PASA con confianza 0:
//  (A) fallback puro: conf=0 Y sin motivo
//  (B) conf=0 PERO con motivo (¿decisión real con confianza 0, o parseo raro?)
import mysql from 'mysql2/promise';import{readFileSync}from'node:fs';
const e={};for(const l of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const p=await mysql.createPool({host:e.DB_HOST,user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,port:+(e.DB_PORT||3306),connectTimeout:20000});
const q=async(s,a=[])=>(await p.query(s,a))[0];
try{
  const a=await q(`SELECT COUNT(*) n FROM prefiltro_licitacion WHERE decision='PASA' AND confianza=0 AND (motivo IS NULL OR motivo='')`);
  const b=await q(`SELECT COUNT(*) n FROM prefiltro_licitacion WHERE decision='PASA' AND confianza=0 AND motivo IS NOT NULL AND motivo<>''`);
  console.log('(A) fallback puro (conf=0, SIN motivo):', a[0].n);
  console.log('(B) conf=0 CON motivo:', b[0].n);

  console.log('\n== Fechas de los conf=0 (por día) ==');
  for(const r of await q(`SELECT DATE(created_at) d, COUNT(*) n,
      SUM(motivo IS NULL OR motivo='') sin_motivo
    FROM prefiltro_licitacion WHERE decision='PASA' AND confianza=0
    GROUP BY DATE(created_at) ORDER BY d DESC`))
    console.log(`  ${r.d}: ${r.n} (sin motivo: ${r.sin_motivo})`);

  console.log('\n== Muestra tipo B (conf=0 con motivo) — ¿qué dice el motivo? ==');
  for(const r of await q(`SELECT licitacion_codigo, motivo, created_at
      FROM prefiltro_licitacion WHERE decision='PASA' AND confianza=0 AND motivo IS NOT NULL AND motivo<>''
      ORDER BY created_at DESC LIMIT 12`))
    console.log(`  ${r.licitacion_codigo} · ${r.created_at}\n     "${(r.motivo||'').slice(0,110)}"`);
}catch(x){console.log('ERROR',x.message);}finally{await p.end();}
