// Reúne los datos para la prueba de asignación: admin (actor), informatica2 (destino)
// y una licitación PASA/REVISION sin documentos para ver la descarga automática.
import mysql from 'mysql2/promise';import{readFileSync}from'node:fs';
const e={};for(const l of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const p=await mysql.createPool({host:e.DB_HOST,user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,port:+(e.DB_PORT||3306)});
const q=async(s,a=[])=>(await p.query(s,a))[0];
try{
  console.log('== Admins ==');
  for(const r of await q(`SELECT id,email,nombre,rol FROM usuarios WHERE rol='admin' AND activo=1`)) console.log('  ',r.id,r.email,'|',r.nombre);
  console.log('== informatica2 ==');
  for(const r of await q(`SELECT id,email,nombre,rol,activo FROM usuarios WHERE email LIKE 'informatica2%'`)) console.log('  ',r.id,r.email,'| rol=',r.rol,'| activo=',r.activo);
  console.log('\n== Candidata: PASA/REVISION, SIN docs, con nombre, cierre futuro ==');
  const c=await q(`
    SELECT al.licitacion_codigo, MAX(al.licitacion_nombre) nombre, MAX(al.licitacion_organismo) org,
           MAX(al.licitacion_monto) monto, MAX(al.licitacion_cierre) cierre, pf.decision
    FROM alertas_licitaciones al
    JOIN prefiltro_licitacion pf ON pf.licitacion_codigo=al.licitacion_codigo AND pf.decision IN ('PASA','REVISION_HUMANA')
    WHERE NOT EXISTS (SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo=al.licitacion_codigo)
      AND NOT EXISTS (SELECT 1 FROM negocios n WHERE n.licitacion_codigo=al.licitacion_codigo AND n.activo=1)
    GROUP BY al.licitacion_codigo, pf.decision
    ORDER BY MAX(al.licitacion_cierre) DESC
    LIMIT 5`);
  for(const r of c) console.log(`  ${r.licitacion_codigo} · ${r.decision} · cierre=${r.cierre}\n     "${(r.nombre||'').slice(0,60)}" · ${r.org||''} · $${r.monto||'?'}`);
}catch(x){console.log('ERROR',x.message);}finally{await p.end();}
