// Muestra la zona del ANEXO/FORMATO ECONÓMICO de cada código para juzgar a mano la
// modalidad real (¿un total consolidado al pie? ¿precio unitario por ítem con líneas que
// se pueden omitir? ¿convenio de suministro?). Solo lectura.
// Uso: npx tsx scripts/ver-anexo-economico.mts <cod1> <cod2> ...
import fs from 'fs';
import mysql from 'mysql2/promise';

const env: Record<string, string> = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000 });

for (const cod of process.argv.slice(2)) {
  const [docs] = await pool.query<any[]>(`SELECT documento_nombre, categoria, LENGTH(texto_extraido) AS len, texto_extraido FROM documentos_cache WHERE licitacion_codigo = ?`, [cod]);
  console.log(`\n\n########## ${cod} ##########`);
  console.log('Docs:', (docs as any[]).map(d => `${d.documento_nombre}(${d.len || 0})`).join(', '));
  // Elige el doc que parece el anexo económico (por nombre) o el que tenga la tabla econ.
  const rank = (n: string) => /econom|oferta|formulario|formato|anexo/i.test(n) ? 0 : 1;
  const orden = (docs as any[]).filter(d => (d.texto_extraido || '').length > 50).sort((a, b) => rank(a.documento_nombre) - rank(b.documento_nombre));
  let mostrado = false;
  for (const d of orden) {
    const txt: string = d.texto_extraido;
    const m = txt.match(/(anexo\s*n?\s*[°º]?\s*\d+[^\n]*econ|oferta\s+econ[oó]mica|formato\s+econ|planilla\s+de\s+precios|precio\s+unitario|valor\s+unitario)/i);
    if (!m) continue;
    const ini = Math.max(0, m.index! - 200);
    console.log(`\n--- ${d.documento_nombre} @${m.index} ---`);
    console.log(txt.slice(ini, ini + 1600).replace(/\n{2,}/g, '\n').trim());
    mostrado = true;
    break;
  }
  if (!mostrado) console.log('  (no se encontró zona económica reconocible en el texto cacheado)');
}
await pool.end();
