import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env: Record<string, string> = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const codigo = '1736-82-LE26';

const [negRows]: any = await pool.query(
  `SELECT id, licitacion_codigo, estado_pipeline FROM negocios WHERE licitacion_codigo = ?`,
  [codigo]
);
console.log('=== NEGOCIOS ===');
console.log(negRows);

const [viabRows]: any = await pool.query(
  `SELECT id, licitacion_codigo, LENGTH(informe_ejecutivo) AS len_informe, created_at, updated_at
   FROM viabilidad_licitacion WHERE licitacion_codigo = ? ORDER BY id DESC`,
  [codigo]
);
console.log('=== VIABILIDAD_LICITACION rows ===');
console.log(viabRows);

const [docRows]: any = await pool.query(
  `SELECT id, documento_nombre, size_bytes, content_type,
          LENGTH(texto_extraido) AS len_texto, categoria, categoria_manual
   FROM documentos_cache WHERE licitacion_codigo = ? ORDER BY id`,
  [codigo]
);
console.log('=== DOCUMENTOS_CACHE ===');
console.log(docRows);

await pool.end();
