// Fuerza la re-extracción de ANEXO_N°4.docx de 1736-82-LE26 (fix mammoth convertToHtml para
// tablas Word) y valida cuántos ítems detecta ahora el parser determinista.
import fs from 'fs';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) {
    let v = m[2].trim();
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '').trim();
    process.env[m[1]] = v.replace(/^["']|["']$/g, '');
  }
}

const pool = (await import('@/app/lib/db')).default;
const { descargarYExtraerTexto } = await import('@/app/lib/document-extraction');
const { parsearPlanillaCosteo } = await import('@/app/lib/planilla-costeo-parser');

const CODIGO = '1736-82-LE26';

const [rows] = await pool.query<any[]>(
  `SELECT documento_nombre, documento_url_local, categoria FROM documentos_cache WHERE licitacion_codigo = ?`,
  [CODIGO],
);
const docs = rows as any[];
const anexo = docs.find(d => /ANEXO.*N.?4/i.test(d.documento_nombre));
if (!anexo) { console.error('No se encontró ANEXO_N°4 entre:', docs.map(d => d.documento_nombre)); process.exit(1); }

console.log(`Re-extrayendo: ${anexo.documento_nombre}`);
const r = await descargarYExtraerTexto(anexo.documento_url_local, anexo.documento_nombre, {});
if (!r) { console.error('descargarYExtraerTexto devolvió null — no se pudo re-extraer.'); process.exit(1); }
console.log(`Método: ${r.metodo} · confianza: ${r.confianza} · ${r.texto.length} caracteres`);
console.log(`¿Contiene <table>? ${/<table/i.test(r.texto)}`);

await pool.query(
  `UPDATE documentos_cache SET texto_extraido = ?, metodo_extraccion = ?, texto_extraido_at = NOW()
   WHERE licitacion_codigo = ? AND documento_nombre = ?`,
  [r.texto, r.metodo, CODIGO, anexo.documento_nombre],
);
console.log('documentos_cache actualizado.');

// Validar con TODOS los documentos de la licitación (texto fresco para el que se re-extrajo).
const [rows2] = await pool.query<any[]>(
  `SELECT documento_nombre AS nombre, categoria, texto_extraido AS texto, metodo_extraccion AS metodo
     FROM documentos_cache WHERE licitacion_codigo = ? AND texto_extraido IS NOT NULL AND texto_extraido <> ''`,
  [CODIGO],
);
const docsParaParser = (rows2 as any[]).map(d => ({ nombre: d.nombre, categoria: d.categoria, texto: d.texto, metodo: d.metodo }));
const resultado = parsearPlanillaCosteo(docsParaParser as any);
if (!resultado) {
  console.log('parsearPlanillaCosteo → null (sigue sin detectar nada)');
} else {
  console.log(`parsearPlanillaCosteo → fuenteDoc="${resultado.fuenteDoc}", ${resultado.items.length} ítems, estructura=${resultado.estructura}`);
  console.log('Primeros 5 ítems:', resultado.items.slice(0, 5));
  console.log('Últimos 5 ítems:', resultado.items.slice(-5));
}

await pool.end();
process.exit(0);
