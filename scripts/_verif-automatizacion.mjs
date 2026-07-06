import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';
const env = {};
for (const line of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const pool = mysql.createPool({host:env.DB_HOST,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,port:parseInt(env.DB_PORT||'3306'),connectTimeout:20000});
const q = async (sql,p=[]) => (await pool.query(sql,p))[0];
try {
  // ¿Cuándo cayó la última licitación al radar y cuántas en las últimas 24h/7d?
  const [ult] = await q(`SELECT MAX(created_at) AS ultima FROM alertas_licitaciones`);
  console.log('\n== ENTRADA AL RADAR (cron de keywords) ==');
  console.log('Última licitación caída:', ult.ultima);
  const [n24] = await q(`SELECT COUNT(*) n FROM alertas_licitaciones WHERE created_at >= NOW() - INTERVAL 24 HOUR`);
  const [n7d] = await q(`SELECT COUNT(*) n FROM alertas_licitaciones WHERE created_at >= NOW() - INTERVAL 7 DAY`);
  console.log(`Nuevas últimas 24h: ${n24.n} · últimos 7 días: ${n7d.n}`);

  // ¿Las recién caídas tienen decisión de prefiltro? (si el prefiltro fuera automático, ~todas)
  console.log('\n== ¿PREFILTRO AUTOMÁTICO? (de las nuevas, cuántas ya tienen decisión) ==');
  const [pf24] = await q(`
    SELECT COUNT(DISTINCT al.licitacion_codigo) AS total,
           COUNT(DISTINCT CASE WHEN pf.licitacion_codigo IS NOT NULL THEN al.licitacion_codigo END) AS con_prefiltro
    FROM alertas_licitaciones al
    LEFT JOIN prefiltro_licitacion pf ON pf.licitacion_codigo = al.licitacion_codigo
    WHERE al.created_at >= NOW() - INTERVAL 24 HOUR`);
  console.log(`Nuevas 24h: ${pf24.total} · con prefiltro: ${pf24.con_prefiltro} · SIN prefiltro: ${pf24.total - pf24.con_prefiltro}`);

  // ¿Cuándo se prefiltró por última vez? (si prefiltro_licitacion tiene timestamp)
  try {
    const [lp] = await q(`SELECT MAX(created_at) AS ultima FROM prefiltro_licitacion`);
    console.log('Último prefiltro registrado:', lp.ultima);
  } catch { console.log('(prefiltro_licitacion no tiene columna created_at)'); }

  // ¿Las PASA tienen documentos? (si la descarga fuera automática, ~todas)
  console.log('\n== ¿DESCARGA AUTOMÁTICA DE LAS PASA? ==');
  const [pasa] = await q(`
    SELECT COUNT(DISTINCT pf.licitacion_codigo) AS pasa_total,
           COUNT(DISTINCT CASE WHEN dc.licitacion_codigo IS NOT NULL THEN pf.licitacion_codigo END) AS con_docs
    FROM prefiltro_licitacion pf
    LEFT JOIN documentos_cache dc ON dc.licitacion_codigo = pf.licitacion_codigo
    WHERE pf.decision IN ('PASA','REVISION_HUMANA')`);
  console.log(`PASA/REVISION total: ${pasa.pasa_total} · con documentos: ${pasa.con_docs} · SIN documentos: ${pasa.pasa_total - pasa.con_docs}`);

  // Distribución de decisiones
  const dist = await q(`SELECT decision, COUNT(*) n FROM prefiltro_licitacion GROUP BY decision`);
  console.log('Distribución prefiltro:', dist.map(d=>`${d.decision}=${d.n}`).join(' · '));
} catch(e){ console.log('ERROR', e.message); } finally { await pool.end(); }
