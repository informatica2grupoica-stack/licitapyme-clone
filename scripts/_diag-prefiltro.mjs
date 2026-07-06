// Diagnóstico del prefiltro: distribución de decisiones (global y reciente) y si las
// recién prefiltradas venían enriquecidas (con descripción/ítems) o solo con el nombre.
import mysql from 'mysql2/promise';import{readFileSync}from'node:fs';
const e={};for(const l of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const p=await mysql.createPool({host:e.DB_HOST,user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,port:+(e.DB_PORT||3306),connectTimeout:20000});
const q=async(s,a=[])=>(await p.query(s,a))[0];
try{
  console.log('== Distribución GLOBAL de prefiltro ==');
  for(const r of await q(`SELECT decision, COUNT(*) n FROM prefiltro_licitacion GROUP BY decision`)) console.log(`  ${r.decision}: ${r.n}`);

  console.log('\n== Últimas 48h (por created_at) ==');
  for(const r of await q(`SELECT decision, COUNT(*) n FROM prefiltro_licitacion WHERE created_at >= NOW()-INTERVAL 48 HOUR GROUP BY decision`)) console.log(`  ${r.decision}: ${r.n}`);
  const u=await q(`SELECT MAX(created_at) m FROM prefiltro_licitacion`);
  console.log('  último prefiltro:', u[0].m);

  console.log('\n== ¿Las recién prefiltradas estaban ENRIQUECIDAS? (tienen fila en licitaciones_cache) ==');
  const r2 = await q(`
    SELECT pf.decision,
           SUM(lc.descripcion IS NOT NULL AND lc.descripcion <> '') AS con_descripcion,
           SUM(lc.items_json IS NOT NULL AND lc.items_json <> '' AND lc.items_json <> '[]') AS con_items,
           SUM(lc.codigo IS NULL) AS sin_cache,
           COUNT(*) total
    FROM prefiltro_licitacion pf
    LEFT JOIN licitaciones_cache lc ON lc.codigo = pf.licitacion_codigo
    WHERE pf.created_at >= NOW()-INTERVAL 7 DAY
    GROUP BY pf.decision`);
  for(const r of r2) console.log(`  ${r.decision}: total=${r.total} · con_descripcion=${r.con_descripcion} · con_items=${r.con_items} · sin_cache=${r.sin_cache}`);

  console.log('\n== Muestra de 8 PASA recientes (nombre · confianza · motivo) ==');
  const s = await q(`
    SELECT pf.licitacion_codigo, al.licitacion_nombre, pf.confianza, pf.motivo, pf.pasada
    FROM prefiltro_licitacion pf
    JOIN alertas_licitaciones al ON al.licitacion_codigo = pf.licitacion_codigo
    WHERE pf.decision='PASA' AND pf.created_at >= NOW()-INTERVAL 7 DAY
    GROUP BY pf.licitacion_codigo ORDER BY pf.created_at DESC LIMIT 8`);
  for(const r of s) console.log(`  ${r.licitacion_codigo} · conf=${r.confianza} · pasada=${r.pasada||'-'}\n     "${(r.licitacion_nombre||'').slice(0,70)}" · motivo: ${(r.motivo||'').slice(0,80)}`);
}catch(x){console.log('ERROR',x.message);}finally{await p.end();}
