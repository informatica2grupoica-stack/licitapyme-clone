// Verifica que TODOS los PASA sean decisiones reales de la IA (motivo + confianza>0)
// y no fallbacks silenciosos. Reporta cualquier PASA sospechoso.
import mysql from 'mysql2/promise';import{readFileSync}from'node:fs';
const e={};for(const l of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)e[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const p=await mysql.createPool({host:e.DB_HOST,user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME,port:+(e.DB_PORT||3306),connectTimeout:20000});
const q=async(s,a=[])=>(await p.query(s,a))[0];
const SOSP=`decision='PASA' AND (confianza IS NULL OR confianza=0 OR motivo IS NULL OR motivo='')`;
try{
  const tot=await q(`SELECT COUNT(*) n FROM prefiltro_licitacion WHERE decision='PASA'`);
  console.log('Total PASA:', tot[0].n);

  const sosp=await q(`SELECT COUNT(*) n FROM prefiltro_licitacion WHERE ${SOSP}`);
  console.log('PASA sospechosos (sin motivo o confianza 0):', sosp[0].n);

  // Desglose fino
  const d=await q(`SELECT
      SUM(confianza IS NULL OR confianza=0) sin_conf,
      SUM(motivo IS NULL OR motivo='') sin_motivo,
      MIN(confianza) minc, MAX(confianza) maxc, AVG(confianza) avgc
    FROM prefiltro_licitacion WHERE decision='PASA'`);
  console.log('  sin confianza:', d[0].sin_conf, '· sin motivo:', d[0].sin_motivo);
  console.log('  confianza min/prom/max:', d[0].minc, '/', Number(d[0].avgc).toFixed(3), '/', d[0].maxc);

  // Distribución de confianza
  console.log('\n== Distribución de confianza en PASA ==');
  for(const r of await q(`SELECT
      CASE WHEN confianza=0 THEN '0 (fallback)'
           WHEN confianza<0.5 THEN '0.01-0.49'
           WHEN confianza<0.7 THEN '0.50-0.69'
           WHEN confianza<0.9 THEN '0.70-0.89'
           ELSE '0.90-1.00' END rango,
      COUNT(*) n
    FROM prefiltro_licitacion WHERE decision='PASA' GROUP BY rango ORDER BY rango`))
    console.log(`  ${r.rango}: ${r.n}`);

  if(sosp[0].n>0){
    console.log('\n== Muestra de PASA sospechosos ==');
    for(const r of await q(`SELECT licitacion_codigo, confianza, motivo, created_at
        FROM prefiltro_licitacion WHERE ${SOSP} ORDER BY created_at DESC LIMIT 15`))
      console.log(`  ${r.licitacion_codigo} · conf=${r.confianza} · ${r.created_at} · motivo="${(r.motivo||'').slice(0,50)}"`);
  } else {
    console.log('\n✅ TODOS los PASA tienen motivo y confianza > 0 → son decisiones reales de la IA.');
  }

  // Muestra reciente para ojo humano
  console.log('\n== 10 PASA más recientes (para revisión) ==');
  for(const r of await q(`SELECT pf.licitacion_codigo, al.licitacion_nombre, pf.confianza, pf.motivo, pf.created_at
      FROM prefiltro_licitacion pf
      LEFT JOIN alertas_licitaciones al ON al.licitacion_codigo=pf.licitacion_codigo
      WHERE pf.decision='PASA'
      GROUP BY pf.licitacion_codigo ORDER BY pf.created_at DESC LIMIT 10`))
    console.log(`  ${r.licitacion_codigo} · conf=${r.confianza}\n     "${(r.licitacion_nombre||'(sin nombre)').slice(0,65)}"\n     motivo: ${(r.motivo||'(vacío)').slice(0,90)}`);
}catch(x){console.log('ERROR',x.message);}finally{await p.end();}
