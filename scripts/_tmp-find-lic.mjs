import { readFileSync } from 'fs';
for (const line of readFileSync('D:/licitapyme-clone/.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const mysql = (await import('mysql2/promise')).default;
const p = mysql.createPool({ host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 1 });
// Licitaciones con >9 docs, contando cuántos escaneados (texto vacío = candidato a OCR) hay.
const [r] = await p.query(`
  SELECT licitacion_codigo codigo,
         COUNT(*) docs,
         SUM(CASE WHEN CHAR_LENGTH(COALESCE(texto_extraido,'')) < 50 THEN 1 ELSE 0 END) escaneados_sin_texto,
         SUM(CASE WHEN metodo_extraccion LIKE '%ocr%' THEN 1 ELSE 0 END) ya_ocr,
         SUM(CHAR_LENGTH(COALESCE(texto_extraido,''))) chars
  FROM documentos_cache
  GROUP BY licitacion_codigo
  HAVING docs > 9 AND escaneados_sin_texto >= 1
  ORDER BY escaneados_sin_texto DESC, docs DESC
  LIMIT 15`);
console.log('codigo · docs · escaneados_sin_texto · ya_ocr · chars');
for (const x of r) console.log(`  ${x.codigo}  ·  ${x.docs} docs  ·  ${x.escaneados_sin_texto} sin texto  ·  ${x.ya_ocr} ya-ocr  ·  ${Number(x.chars).toLocaleString('es-CL')} chars`);
await p.end();
