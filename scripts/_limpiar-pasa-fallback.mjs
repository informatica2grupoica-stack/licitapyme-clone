// Limpieza puntual: borra los PASA-fallback (confianza=0, sin motivo) del prefiltro
// para que esos códigos vuelvan a quedar pendientes y se re-prefiltren con la IA.
import mysql from 'mysql2/promise';import{readFileSync}from'node:fs';
const e={};for(const l of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const p=await mysql.createPool({host:e.DB_HOST,user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,port:+(e.DB_PORT||3306),connectTimeout:20000});
const q=async(s,a=[])=>(await p.query(s,a))[0];
const COND=`decision='PASA' AND (confianza IS NULL OR confianza=0) AND (motivo IS NULL OR motivo='')`;
try{
  const antes=await q(`SELECT COUNT(*) n FROM prefiltro_licitacion WHERE ${COND}`);
  console.log('PASA-fallback a borrar:', antes[0].n);
  const res=await q(`DELETE FROM prefiltro_licitacion WHERE ${COND}`);
  console.log('Borrados:', res.affectedRows);
  const despues=await q(`SELECT COUNT(*) n FROM prefiltro_licitacion WHERE ${COND}`);
  console.log('Restantes con ese patrón:', despues[0].n);
  const tot=await q(`SELECT decision, COUNT(*) n FROM prefiltro_licitacion GROUP BY decision`);
  for(const r of tot) console.log(`  ${r.decision}: ${r.n}`);
}catch(x){console.log('ERROR',x.message);}finally{await p.end();}
