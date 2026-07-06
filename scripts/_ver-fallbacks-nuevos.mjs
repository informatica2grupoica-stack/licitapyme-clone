// ¿De dónde salen los fallbacks nuevos? Timestamp exacto + modelo que los guardó.
import mysql from 'mysql2/promise';import{readFileSync}from'node:fs';
const e={};for(const l of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const p=await mysql.createPool({host:e.DB_HOST,user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,port:+(e.DB_PORT||3306),connectTimeout:20000});
const q=async(s,a=[])=>(await p.query(s,a))[0];
try{
  const c=await q(`SELECT COUNT(*) n FROM prefiltro_licitacion WHERE decision='PASA' AND (motivo IS NULL OR motivo='')`);
  console.log('Fallbacks (PASA sin motivo) actuales:', c[0].n);
  console.log('\n== Detalle: hora exacta + modelo ==');
  for(const r of await q(`SELECT licitacion_codigo, confianza, modelo, created_at, updated_at
      FROM prefiltro_licitacion WHERE decision='PASA' AND (motivo IS NULL OR motivo='')
      ORDER BY created_at DESC LIMIT 40`))
    console.log(`  ${r.licitacion_codigo} · conf=${r.confianza} · modelo=${r.modelo} · created=${r.created_at}`);
}catch(x){console.log('ERROR',x.message);}finally{await p.end();}
