// Diagnóstico de CITAS/PÁGINAS de una licitación: ¿están los docs en caché? ¿traen marcadores
// [[PÁGINA N]]? ¿qué fuentes emitió el último informe v3 y coinciden con marcadores reales?
import mysql from 'mysql2/promise';
import { cargarEnv } from './_env';
cargarEnv();

const codigo = process.argv[2] || '2693-22-LP26';

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, connectionLimit: 2, connectTimeout: 20000,
  });

  const [docs] = await pool.query(
    `SELECT documento_nombre, categoria, metodo_extraccion,
            CHAR_LENGTH(COALESCE(texto_extraido,'')) AS len,
            texto_extraido
       FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY created_at ASC`, [codigo]);
  const rows = docs as any[];
  console.log(`\n=== ${codigo}: ${rows.length} documento(s) en cache ===`);
  let totalChars = 0;
  for (const d of rows) {
    const t = d.texto_extraido || '';
    const marks = (t.match(/\[\[P[ÁA]GINA[^\]]*\]\]/gi) || []);
    const maxPag = marks.map((m: string) => Number((m.match(/\d+/) || [0])[0])).reduce((a: number, b: number) => Math.max(a, b), 0);
    totalChars += d.len;
    console.log(`  ${String(d.len).padStart(7)} chars · ${marks.length} marcadores (máx pág ${maxPag}) · ${(d.metodo_extraccion || '?').padEnd(16)} · ${(d.categoria || 'sin-cat').padEnd(18)} · ${d.documento_nombre}`);
  }
  console.log(`  TOTAL: ${totalChars.toLocaleString('es-CL')} chars (tope análisis: 350.000)`);

  // Fuentes del informe v3 guardado
  const [v] = await pool.query(`SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo=? LIMIT 1`, [codigo]);
  const row = (v as any[])[0];
  if (!row) { console.log('\n(sin informe guardado)'); await pool.end(); return; }
  let ie: any; try { ie = typeof row.informe_ejecutivo === 'string' ? JSON.parse(row.informe_ejecutivo) : row.informe_ejecutivo; } catch { ie = {}; }
  const inf = ie?._informe_ia_v3;
  if (!inf) { console.log('\n(no hay _informe_ia_v3)'); await pool.end(); return; }

  // Recolecta todas las "fuente" del informe
  const fuentes: string[] = [];
  const walk = (o: any) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, val] of Object.entries(o)) {
      if (k === 'fuente' && typeof val === 'string' && val.trim()) fuentes.push(val.trim());
      else walk(val);
    }
  };
  walk(inf);
  const nombresDoc = new Set(rows.map(r => r.documento_nombre));
  console.log(`\n=== ${fuentes.length} citas en el informe v3 ===`);
  let sinPag = 0, docMalo = 0;
  for (const f of fuentes) {
    const tienePag = /p[áa]g\.?\s*\d+/i.test(f) || /p[áa]g\.?\s*no especificada/i.test(f);
    const noEspecif = /no especificada/i.test(f);
    if (noEspecif || !/\d/.test(f)) sinPag++;
    // ¿el nombre citado matchea algún documento real?
    const matchDoc = [...nombresDoc].some(n => f.includes(n) || n.includes(f.split('·')[0].trim()));
    if (!matchDoc) docMalo++;
    console.log(`  ${noEspecif ? '⚠sinpag' : tienePag ? '  pag  ' : '  ??   '} ${matchDoc ? '  ' : '✗doc'} ${f.slice(0, 110)}`);
  }
  console.log(`\nResumen citas: ${fuentes.length} total · ${sinPag} sin página · ${docMalo} con nombre de doc que no matchea`);
  console.log(`Modelo guardado: ${inf?._schema} · score ${inf?.score_0_100} · criterios ${inf?.criterios_evaluacion?.criterios?.length} · items ${inf?.manifiesto_productos?.length}`);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
