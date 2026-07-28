import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const codigo = '1271359-92-LE26';

const [negocios] = await pool.query(
  `SELECT id, licitacion_codigo, estado_pipeline FROM negocios WHERE licitacion_codigo = ?`,
  [codigo]
);
console.log('Negocio(s):', negocios);

if (negocios.length) {
  const negocioId = negocios[0].id;

  const [costeo] = await pool.query(
    `SELECT id, version, vigente, archivo_url, archivo_nombre, total_costo_neto, total_precio_neto,
            presupuesto_publicado, total_anexo_economico, alertas, subido_por_nombre, subido_at
     FROM checklist_comercial_costeo WHERE negocio_id = ? ORDER BY version DESC`,
    [negocioId]
  );
  console.log('Filas de costeo (Motor Comercial, ingesta):', costeo.length);
  for (const c of costeo) {
    console.log(JSON.stringify(c, null, 2));
  }

  const [docs] = await pool.query(
    `SELECT id, documento_nombre, documento_url_local, categoria, subcategoria, size_bytes
     FROM documentos_cache WHERE licitacion_codigo = ? AND (documento_nombre LIKE '%osteo%' OR categoria LIKE '%COSTEO%')`,
    [codigo]
  );
  console.log('Documentos "costeo" en documentos_cache:', docs.length);
  for (const d of docs) console.log(JSON.stringify(d, null, 2));
}

await pool.end();
