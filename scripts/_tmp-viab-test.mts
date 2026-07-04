// Sin arg: lista candidatas (licitaciones con documentos) para probar viabilidad.
// Con arg <codigo>: corre analizarYGuardarViabilidadIA instrumentada y mide tiempo total.
import { readFileSync } from 'fs';

for (const f of ['D:/licitapyme-clone/.env.local', 'D:/licitapyme-clone/.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ok */ }
}

const codigo = process.argv[2];
const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, connectionLimit: 2,
});

if (!codigo) {
  // Candidatas: con documentos legibles, con su tamaño en chars y si ya tienen viabilidad.
  const [rows] = await pool.query(
    `SELECT dc.licitacion_codigo AS codigo,
            COUNT(*) AS docs,
            SUM(CHAR_LENGTH(COALESCE(dc.texto_extraido,''))) AS chars,
            MAX(v.licitacion_codigo IS NOT NULL) AS tiene_viab
     FROM documentos_cache dc
     LEFT JOIN viabilidad_licitacion v ON v.licitacion_codigo = dc.licitacion_codigo
     GROUP BY dc.licitacion_codigo
     HAVING chars > 5000
     ORDER BY tiene_viab ASC, chars ASC
     LIMIT 15`) as any[];
  console.log('CANDIDATAS (codigo · docs · chars ≈ tokens · ¿ya tiene viab?):');
  for (const r of rows as any[]) {
    console.log(`  ${r.codigo}  ·  ${r.docs} docs  ·  ${Number(r.chars).toLocaleString('es-CL')} chars (~${Math.round(r.chars/4).toLocaleString('es-CL')} tok)  ·  viab=${r.tiene_viab ? 'SÍ' : 'no'}`);
  }
  await pool.end();
} else {
  // Flujo REAL del endpoint /api/licitacion-viabilidad: clasificar → análisis exhaustivo → viabilidad.
  const { procesarLicitacionCompleta } = await import('@/app/lib/pipeline-licitacion');
  console.log(`\n===== VIABILIDAD TEST (flujo completo, forzar) → ${codigo} =====`);
  const t0 = Date.now();
  try {
    const res = await procesarLicitacionCompleta(codigo, { forzar: true });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (!res.ok) {
      console.log(`\n❌ No OK en ${secs}s: ${res.error ?? '(sin detalle)'}`);
    } else {
      const v: any = res.viabilidad ?? {};
      console.log(`\n✅ VIABILIDAD LISTA en ${secs}s`);
      console.log(`   semáforo=${v.semaforo ?? '?'} · score=${v.score_total ?? v.score ?? '?'}`);
    }
  } catch (e: any) {
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n💥 FALLÓ en ${secs}s: ${e?.message ?? e}`);
  }
  await pool.end();
}
