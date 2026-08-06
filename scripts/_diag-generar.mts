// Genera el .docx final del documento indicado y VUELCA su texto plano para revisarlo.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const mysql = (await import('mysql2/promise')).default;
const { generarAnexoFinal } = await import('@/app/lib/anexos-rellenar');
const { conCamposDerivados } = await import('@/app/lib/anexos-derivados');
const { abrirDocx, listarParrafos } = await import('@/app/lib/anexos-docx');
const idDoc = Number(process.argv[2] || 22110);
const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000 });
const [docs]: any = await pool.query(`SELECT * FROM documentos_cache WHERE id = ?`, [idDoc]);
const d = docs[0];
const [neg]: any = await pool.query(`SELECT empresa_id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE AND empresa_id IS NOT NULL LIMIT 1`, [d.licitacion_codigo]);
const [emp]: any = await pool.query(`SELECT * FROM empresas WHERE id = ?`, [neg[0].empresa_id]);
const empresa = conCamposDerivados(emp[0]);
const buffer = Buffer.from(await (await fetch(d.documento_url_local)).arrayBuffer());
const gen = await generarAnexoFinal(buffer, empresa, {});
console.log(`\nintegridad:`, gen.integridad, `completados=${gen.completados} respondidos=${gen.respondidos}`);
mkdirSync('scripts/_out-diag', { recursive: true });
const ruta = `scripts/_out-diag/${idDoc}_generado.docx`;
writeFileSync(ruta, gen.buffer);
console.log('→', ruta);
const { xml } = await abrirDocx(gen.buffer);
console.log('\n--- TEXTO GENERADO ---');
for (const p of listarParrafos(xml)) if (p.texto.trim()) console.log(`[${p.indice}] ${p.texto.slice(0, 130)}`);
await pool.end();
