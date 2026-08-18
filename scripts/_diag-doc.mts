import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000 });
const id = Number(process.argv[2]);
const [rows] = await pool.query(`SELECT documento_nombre, documento_url_local FROM documentos_cache WHERE id = ?`, [id]) as any[];
const buf = Buffer.from(await (await fetch(rows[0].documento_url_local)).arrayBuffer());
const { abrirDocx, normalizarParaIds } = await import('@/app/lib/anexos-docx');
const { xml: crudo } = await abrirDocx(buf);
const { xml } = normalizarParaIds(crudo);
const texto = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:(?:br|cr)\b[^>]*\/?>/g)].map(m => (m[1] !== undefined ? m[1] : '\n')).join('');
const lineas = texto.split('\n').map(t => t.trim());
writeFileSync(`scripts/_out-lineas-${id}.txt`, lineas.map((t,i)=>`${i}\t${t}`).join('\n'));
console.log(rows[0].documento_nombre, '· líneas:', lineas.length);
lineas.forEach((t, i) => { if (/formulario|anexo|formato/i.test(t)) console.log(i, JSON.stringify(t.slice(0,110))); });
await pool.end();
