// Solo lectura: mide cuántos documentos faltan en cada set del plan.
//  A) Negocios (activo=TRUE) sin documentos  → paso 1 (descarga negocios)
//  B) Radar (todas las alertas dedup) sin decisión de prefiltro → paso 2 (prefiltro)
//  C) Radar con prefiltro PASA / PASA+REVISION sin documentos → paso 3 (descarga radar)
import { readFileSync } from 'fs';
import mysql from 'mysql2/promise';

for (const f of ['D:/licitapyme-clone/.env.local', 'D:/licitapyme-clone/.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ok */ }
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, connectionLimit: 2,
  });
  const q = async (sql: string) => { const [r] = await pool.query(sql) as any[]; return (r as any[])[0]; };

  // A) Negocios activos: total, con/sin docs
  const negTotal = (await q(`SELECT COUNT(DISTINCT licitacion_codigo) c FROM negocios WHERE activo = TRUE`)).c;
  const negSinDocs = (await q(
    `SELECT COUNT(DISTINCT n.licitacion_codigo) c
     FROM negocios n
     WHERE n.activo = TRUE
       AND NOT EXISTS (SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = n.licitacion_codigo)`)).c;

  // B) Radar (dedup por código) total y sin prefiltro
  const radarTotal = (await q(`SELECT COUNT(DISTINCT licitacion_codigo) c FROM alertas_licitaciones`)).c;
  const radarSinPref = (await q(
    `SELECT COUNT(DISTINCT al.licitacion_codigo) c
     FROM alertas_licitaciones al
     WHERE NOT EXISTS (SELECT 1 FROM prefiltro_licitacion pf WHERE pf.licitacion_codigo = al.licitacion_codigo)`)).c;

  // Desglose de decisiones de prefiltro existentes en el radar
  const [decisiones] = await pool.query(
    `SELECT pf.decision, COUNT(DISTINCT al.licitacion_codigo) c
     FROM alertas_licitaciones al
     JOIN prefiltro_licitacion pf ON pf.licitacion_codigo = al.licitacion_codigo
     GROUP BY pf.decision`) as any[];

  // C) Radar PASA sin docs, y PASA+REVISION_HUMANA sin docs
  const radarPasaSinDocs = (await q(
    `SELECT COUNT(DISTINCT al.licitacion_codigo) c
     FROM alertas_licitaciones al
     JOIN prefiltro_licitacion pf ON pf.licitacion_codigo = al.licitacion_codigo AND pf.decision = 'PASA'
     WHERE NOT EXISTS (SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = al.licitacion_codigo)`)).c;
  const radarGateSinDocs = (await q(
    `SELECT COUNT(DISTINCT al.licitacion_codigo) c
     FROM alertas_licitaciones al
     JOIN prefiltro_licitacion pf ON pf.licitacion_codigo = al.licitacion_codigo AND pf.decision IN ('PASA','REVISION_HUMANA')
     WHERE NOT EXISTS (SELECT 1 FROM documentos_cache dc WHERE dc.licitacion_codigo = al.licitacion_codigo)`)).c;

  console.log('===== VOLÚMENES DEL PLAN =====');
  console.log(`\n[A] NEGOCIOS (asignadas activas)`);
  console.log(`    total códigos:        ${negTotal}`);
  console.log(`    SIN documentos:       ${negSinDocs}   <- paso 1 descargaría estos`);
  console.log(`\n[B] RADAR (todas las alertas, dedup)`);
  console.log(`    total códigos:        ${radarTotal}`);
  console.log(`    SIN prefiltro:        ${radarSinPref}   <- paso 2 prefiltraría estos`);
  console.log(`    decisiones actuales:`);
  for (const d of decisiones as any[]) console.log(`      ${d.decision}: ${d.c}`);
  console.log(`\n[C] RADAR con prefiltro, SIN documentos`);
  console.log(`    PASA sin docs:              ${radarPasaSinDocs}   <- paso 3 (solo PASA)`);
  console.log(`    PASA+REVISION_HUMANA docs: ${radarGateSinDocs}   <- paso 3 (gate actual del endpoint)`);

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
