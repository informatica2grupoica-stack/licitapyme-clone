// ¿La descarga fue INLINE (segundos tras asignar) o por LOTE (job posterior)?
// Mide la brecha entre la asignación y el primer documento descargado DESPUÉS de asignar.
import mysql from 'mysql2/promise';import{readFileSync}from'node:fs';
const e={};for(const l of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const p=await mysql.createPool({host:e.DB_HOST,user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,port:+(e.DB_PORT||3306),connectTimeout:20000});
const q=async(s,a=[])=>(await p.query(s,a))[0];
try{
  const rows = await q(`
    SELECT n.licitacion_codigo, n.created_at AS asignado_en,
           MIN(dc.created_at) AS primer_doc_post,
           TIMESTAMPDIFF(SECOND, n.created_at, MIN(dc.created_at)) AS gap_seg
    FROM negocios n
    JOIN documentos_cache dc
      ON dc.licitacion_codigo = n.licitacion_codigo
     AND dc.created_at >= n.created_at          -- solo docs bajados TRAS asignar
    WHERE n.activo=TRUE AND n.asignado_a IS NOT NULL
      AND n.created_at >= NOW() - INTERVAL 3 DAY
    GROUP BY n.licitacion_codigo, n.created_at
    ORDER BY gap_seg ASC
    LIMIT 20`);
  console.log('== Brecha asignación → primer doc (post-asignación), más ajustadas primero ==');
  for(const r of rows){
    const m = Math.round(r.gap_seg/60);
    const tipo = r.gap_seg <= 180 ? '⚡ INLINE (≤3 min)' : r.gap_seg <= 1800 ? '~ pronto' : '🕒 por lote';
    console.log(`  ${r.licitacion_codigo} · asignado=${r.asignado_en} · +${m} min (${r.gap_seg}s) ${tipo}`);
  }
  if(!rows.length) console.log('  (sin docs descargados después de una asignación en 3 días)');

  // ¿Hay log de scraping con origen/trigger?
  console.log('\n== Columnas de documentos_scraping_log ==');
  for(const r of await q(`SHOW COLUMNS FROM documentos_scraping_log`)) console.log('  ', r.Field, r.Type);
}catch(x){console.log('ERROR',x.message);}finally{await p.end();}
