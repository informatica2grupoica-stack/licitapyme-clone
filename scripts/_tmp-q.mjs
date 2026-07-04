import { readFileSync } from 'fs';
for (const f of ['D:/licitapyme-clone/.env.local']) { for (const line of readFileSync(f,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}}
const mysql=(await import('mysql2/promise')).default;
const pool=mysql.createPool({host:process.env.DB_HOST,port:+(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:1});
const [r]=await pool.query("SELECT documento_nombre, metodo_extraccion, CHAR_LENGTH(COALESCE(texto_extraido,'')) len FROM documentos_cache WHERE licitacion_codigo='2723-48-LE26' ORDER BY len DESC");
for(const x of r) console.log(`  ${x.len} chars · [${x.metodo_extraccion}] · ${x.documento_nombre}`);
await pool.end();
