import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000 });
const [rows] = await pool.query(`SELECT documento_nombre, documento_url_local FROM documentos_cache WHERE id = ?`, [22869]) as any[];
const doc = rows[0];
const buf = Buffer.from(await (await fetch(doc.documento_url_local)).arrayBuffer());
writeFileSync('scripts/_out-2296-formatos.docx', buf);
const { abrirDocx, normalizarParaIds } = await import('@/app/lib/anexos-docx');
const { xml: crudo } = await abrirDocx(buf);
const { xml } = normalizarParaIds(crudo);
const { dividirPorFormularios, RE_ENCABEZADO_FORMULARIO } = await import('@/app/lib/anexos-dividir');
const fs = await dividirPorFormularios(buf, xml);
console.log('FORMULARIOS DETECTADOS:', fs.length, fs.map((f: any) => f.titulo));
// texto plano por párrafo
const parrafos = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>|<w:p\b[^>]*\/>/g)].map(m => m[0]);
console.log('total parrafos:', parrafos.length);
const lineas = parrafos.map(p => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('').trim());
lineas.forEach((t, i) => { if (/formulario|anexo/i.test(t)) console.log(i, JSON.stringify(t.slice(0, 120)), 'MATCH=' + RE_ENCABEZADO_FORMULARIO.test(t)); });
writeFileSync('scripts/_out-2296-lineas.txt', lineas.map((t,i)=>`${i}\t${t}`).join('\n'));
await pool.end();
