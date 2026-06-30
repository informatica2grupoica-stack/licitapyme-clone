// Invalida el texto cacheado de PDFs ESCANEADOS que se guardaron por error como
// 'pdf-text' con solo los marcadores [[PÁGINA N]] (texto real ≈ 0). El bug del umbral
// absoluto de 300 chars (document-extraction.ts) los daba por buenos y NUNCA los OCR-eaba,
// así que se perdía todo el contenido (p.ej. los criterios de evaluación). Al poner
// texto_extraido = NULL, la próxima viabilidad los vuelve a extraer con la lógica corregida
// (densidad por página → OCR).
//
// Uso:
//   node scripts/reextraer-pdf-escaneados.mjs           (DRY-RUN: solo lista)
//   node scripts/reextraer-pdf-escaneados.mjs --aplicar  (invalida el caché)
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const APLICAR = process.argv.includes('--aplicar');
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

// Mismo criterio que document-extraction.ts: densidad de texto real por página < 120 → escaneado.
const DENSIDAD_MIN = 120;

try {
  // Solo candidatos: PDFs marcados como extraídos por capa de texto.
  const [rows] = await pool.query(
    `SELECT id, licitacion_codigo, documento_nombre, metodo_extraccion, texto_extraido
       FROM documentos_cache
      WHERE metodo_extraccion = 'pdf-text' AND texto_extraido IS NOT NULL`);

  const malos = [];
  for (const r of rows) {
    const t = r.texto_extraido || '';
    const marcadores = (t.match(/\[\[P[ÁA]GINA[^\]]*\]\]/gi) || []).length;
    const real = t.replace(/\[\[P[ÁA]GINA[^\]]*\]\]/gi, '').trim();
    const pags = Math.max(1, marcadores);
    const densidad = real.length / pags;
    if (real.length <= 300 || densidad < DENSIDAD_MIN) {
      malos.push({ ...r, marcadores, real: real.length, densidad: Math.round(densidad) });
    }
  }

  console.log(`\n  Candidatos 'pdf-text' revisados: ${rows.length}`);
  console.log(`  PDFs escaneados mal cacheados:   ${malos.length}\n`);
  for (const m of malos) {
    console.log(`    [${m.licitacion_codigo}] ${m.documento_nombre} — ${m.marcadores} págs, ${m.real} chars reales (densidad ${m.densidad}/pág)`);
  }

  if (!malos.length) { console.log('\n  Nada que invalidar.\n'); }
  else if (!APLICAR) {
    console.log(`\n  DRY-RUN. Para invalidar el caché y forzar re-extracción con OCR, corre:`);
    console.log(`    node scripts/reextraer-pdf-escaneados.mjs --aplicar\n`);
  } else {
    const ids = malos.map(m => m.id);
    await pool.query(
      `UPDATE documentos_cache
          SET texto_extraido = NULL, metodo_extraccion = NULL, texto_extraido_at = NULL
        WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    console.log(`\n  ✅ Invalidados ${ids.length} documentos. Se re-extraerán (con OCR) en el próximo análisis de viabilidad.\n`);
  }
} catch (e) {
  console.error('\n  ERROR:', e.message, '\n');
  process.exitCode = 1;
} finally { await pool.end(); }
