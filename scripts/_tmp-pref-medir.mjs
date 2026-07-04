import { readFileSync } from 'fs';
for (const line of readFileSync('D:/licitapyme-clone/.env.local','utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const mysql=(await import('mysql2/promise')).default;
const pool=mysql.createPool({host:process.env.DB_HOST,port:+(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:1});
const [rows]=await pool.query("SELECT DISTINCT licitacion_codigo FROM alertas_licitaciones ORDER BY id DESC LIMIT 15");
const codigos=rows.map(r=>r.licitacion_codigo);
await pool.end();
const { cargarMetadata, prefiltrarLote } = await import('@/app/lib/prefiltro');
const metas = await cargarMetadata(codigos);
console.log(`Midiendo prefiltro de ${metas.length} licitaciones (1 lote)...`);
const t0=Date.now();
const res = await prefiltrarLote(metas);
console.log(`Lote listo en ${((Date.now()-t0)/1000).toFixed(1)}s · decisiones: ${res.map(r=>r.decision).join(',')}`);
