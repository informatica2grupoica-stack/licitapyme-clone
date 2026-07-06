// Verifica empíricamente la descarga-al-asignar: cruza asignaciones (negocios) recientes
// con documentos_cache y compara timestamps para ver si los docs aparecieron tras asignar.
import mysql from 'mysql2/promise';import{readFileSync}from'node:fs';
const e={};for(const l of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const p=await mysql.createPool({host:e.DB_HOST,user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,port:+(e.DB_PORT||3306),connectTimeout:20000});
const q=async(s,a=[])=>(await p.query(s,a))[0];
try{
  // Estructura de negocios: nombre de la tabla y columnas de asignación/tiempo.
  console.log('== Tablas candidatas ==');
  for(const r of await q(`SHOW TABLES LIKE '%negocio%'`)) console.log('  ', Object.values(r)[0]);
  for(const r of await q(`SHOW TABLES LIKE '%document%'`)) console.log('  ', Object.values(r)[0]);

  console.log('\n== Asignaciones recientes vs documentos (últimos 7 días) ==');
  const rows = await q(`
    SELECT n.licitacion_codigo,
           n.asignado_a,
           n.created_at        AS asignado_en,
           COUNT(dc.id)        AS n_docs,
           MIN(dc.created_at)  AS primer_doc,
           MAX(dc.created_at)  AS ultimo_doc
    FROM negocios n
    LEFT JOIN documentos_cache dc ON dc.licitacion_codigo = n.licitacion_codigo
    WHERE n.activo = TRUE AND n.asignado_a IS NOT NULL
      AND n.created_at >= NOW() - INTERVAL 7 DAY
    GROUP BY n.licitacion_codigo, n.asignado_a, n.created_at
    ORDER BY n.created_at DESC
    LIMIT 25`);
  if(!rows.length){ console.log('  (sin asignaciones en 7 días)'); }
  for(const r of rows){
    const estado = r.n_docs>0 ? `✅ ${r.n_docs} docs (primer doc: ${r.primer_doc})` : '❌ SIN documentos';
    console.log(`  ${r.licitacion_codigo} · asignado_a=${r.asignado_a} · asignado_en=${r.asignado_en}\n     ${estado}`);
  }

  // Resumen
  const resumen = await q(`
    SELECT COUNT(*) total,
           SUM(tiene_docs) con_docs
    FROM (
      SELECT n.licitacion_codigo,
             (SELECT COUNT(*) FROM documentos_cache dc WHERE dc.licitacion_codigo=n.licitacion_codigo)>0 AS tiene_docs
      FROM negocios n
      WHERE n.activo=TRUE AND n.asignado_a IS NOT NULL AND n.created_at >= NOW()-INTERVAL 7 DAY
      GROUP BY n.licitacion_codigo
    ) t`);
  const t=resumen[0];
  console.log(`\n== Resumen 7 días: ${t.con_docs}/${t.total} asignaciones tienen documentos ==`);
}catch(x){console.log('ERROR',x.message);}finally{await p.end();}
