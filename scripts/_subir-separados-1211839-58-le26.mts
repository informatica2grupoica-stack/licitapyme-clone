// Sube los 6 formularios ya separados (convertidos vía Word local, verificados válidos) a la
// licitación real 1211839-58-LE26 — mismo camino que /api/anexos/separar/route.ts (R2 +
// documentos_cache, categoria_manual=1, categoría según clasificarAnexo).
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const mysql = (await import('mysql2/promise')).default;
const { abrirDocx } = await import('@/app/lib/anexos-docx');
const { dividirPorFormularios } = await import('@/app/lib/anexos-dividir');
const { subirDocumentoR2 } = await import('@/app/lib/r2');

const CODIGO = '1211839-58-LE26';
const CATEGORIA_POR_CLASIFICACION: Record<string, string> = {
  administrativo: 'ANEXOS_ADMINISTRATIVOS',
  tecnico: 'ANEXOS_TECNICOS',
  economico: 'ANEXOS_ECONOMICOS',
  sin_clasificar: 'ANEXOS_OFERENTE',
};
const CONTENT_TYPE_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const buffer = readFileSync('D:/licitapyme-clone/scratch-formularios-1211839.docx');
const { xml } = await abrirDocx(buffer);
const divididos = await dividirPorFormularios(buffer, xml);
console.log(`${divididos.length} formularios a subir`);

const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000 });

for (const f of divididos) {
  const nombre = `${f.nombreArchivo}.docx`;
  const categoriaCaja = CATEGORIA_POR_CLASIFICACION[f.categoria] || 'ANEXOS_OFERENTE';
  const url = await subirDocumentoR2(CODIGO, nombre, f.buffer, CONTENT_TYPE_DOCX);
  await pool.query(
    `INSERT INTO documentos_cache
       (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, categoria_manual, usuario_id)
     VALUES (?, ?, ?, ?, ?, ?, 1, NULL)
     ON DUPLICATE KEY UPDATE
       documento_url_local = VALUES(documento_url_local),
       size_bytes          = VALUES(size_bytes),
       updated_at          = CURRENT_TIMESTAMP`,
    [CODIGO, nombre, url, f.buffer.length, CONTENT_TYPE_DOCX, categoriaCaja],
  );
  console.log(`  ✓ ${nombre} → ${categoriaCaja}`);
}
await pool.end();
console.log('Listo.');
