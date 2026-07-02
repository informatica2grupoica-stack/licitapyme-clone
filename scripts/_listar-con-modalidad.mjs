// Vuelca a stdout los códigos de licitación que tienen modalidad grabada en el informe IA.
import fs from 'fs'; import mysql from 'mysql2/promise';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const pool = mysql.createPool({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000 });
const excluir = new Set(process.argv.slice(2));
const [rows] = await pool.query('SELECT licitacion_codigo, informe_ejecutivo FROM viabilidad_licitacion');
const out = [];
for (const r of rows) {
  let ie; try { ie = typeof r.informe_ejecutivo === 'string' ? JSON.parse(r.informe_ejecutivo) : r.informe_ejecutivo; } catch { continue; }
  const t = (ie?._informe_ia?.modalidad?.tipo || '').toLowerCase();
  if ((t === 'suma_alzada' || t === 'por_linea') && !excluir.has(r.licitacion_codigo)) out.push(r.licitacion_codigo);
}
fs.writeFileSync('scripts/_reanalizar-lista.txt', out.join('\n') + '\n');
console.log(`${out.length} códigos → scripts/_reanalizar-lista.txt`);
await pool.end();
