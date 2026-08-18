// Barrido: corre la detección de formularios sobre TODOS los .doc/.docx de anexos en caché y
// reporta cuáles no se separan, con las menciones de formulario/anexo/formato que sí trae el
// texto — así un "no separa" queda diagnosticado, no solo contado.
import { readFileSync, writeFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const mysql = (await import('mysql2/promise')).default;
const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, port: +(process.env.DB_PORT || 3306), connectTimeout: 20000 });
const { abrirDocx, normalizarParaIds } = await import('@/app/lib/anexos-docx');
const { detectarFormularios } = await import('@/app/lib/anexos-dividir');
const { convertirDocADocx } = await import('@/app/lib/anexos-doc-legacy');

const limite = Number(process.argv[process.argv.indexOf('--limite') + 1]) || 120;
const [rows] = await pool.query(
  `SELECT id, licitacion_codigo, documento_nombre, documento_url_local
     FROM documentos_cache
    WHERE (documento_nombre LIKE '%.docx' OR documento_nombre LIKE '%.doc')
      AND categoria <> 'DOCUMENTOS_PROPIOS'
    ORDER BY id DESC LIMIT ?`, [limite]) as any[];

const salida: any[] = [];
for (const d of rows) {
  const fila: any = { id: d.id, codigo: d.licitacion_codigo, nombre: d.documento_nombre };
  try {
    let buf = Buffer.from(await (await fetch(d.documento_url_local)).arrayBuffer());
    if (/\.doc$/i.test(d.documento_nombre)) buf = await convertirDocADocx(buf);
    const { xml: crudo } = await abrirDocx(buf);
    const { xml } = normalizarParaIds(crudo);
    const fs = detectarFormularios(xml);
    fila.formularios = fs.length;
    fila.titulos = fs.map((f: any) => f.titulo.slice(0, 60));
    if (fs.length < 2) {
      const texto = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:(?:br|cr)\b[^>]*\/?>/g)].map(m => (m[1] !== undefined ? m[1] : '\n')).join('');
      const lineas = texto.split('\n').map(t => t.trim()).filter(Boolean);
      fila.candidatos = [...new Set(lineas.filter(t => t.length <= 90 && /^(formulario|anexo|formato)\b/i.test(t)))].slice(0, 12);
    }
  } catch (e: any) { fila.error = String(e?.message || e).slice(0, 160); }
  salida.push(fila);
  const marca = fila.error ? 'ERROR' : fila.formularios >= 2 ? `OK ${fila.formularios}` : `SIN-DIVIDIR (${(fila.candidatos || []).length} candidatos)`;
  console.log(`${String(d.id).padEnd(6)} ${String(d.licitacion_codigo).padEnd(18)} ${marca}  ${d.documento_nombre.slice(0, 45)}`);
}
writeFileSync('scripts/_out-barrido-separar.json', JSON.stringify(salida, null, 2));
const err = salida.filter(s => s.error).length, ok = salida.filter(s => s.formularios >= 2).length;
console.log(`\nTOTAL ${salida.length} · separan ${ok} · sin dividir ${salida.length - ok - err} · error ${err}`);
await pool.end();
