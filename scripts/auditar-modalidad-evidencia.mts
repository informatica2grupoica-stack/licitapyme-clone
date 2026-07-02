// Diagnóstico de EVIDENCIA para los códigos en conflicto: muestra qué disparó el
// "total único" y si hay lenguaje de adjudicación por línea/ítem, para confirmar a mano
// que realmente son suma_alzada (y no un falso positivo del detector). Solo lectura.
// Uso: npx tsx scripts/auditar-modalidad-evidencia.mts <cod1> <cod2> ...
import fs from 'fs';
import mysql from 'mysql2/promise';

const env: Record<string, string> = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000 });

const codigos = process.argv.slice(2);
const reTitulo = /formulario\s+e\s*-?\s*1|oferta\s+econ[oó]mica|anexo\s+econ[oó]mico/gi;
const reTotal = /monto\s+total\s+(neto|iva|general)|precio\s+total\s+(neto\s+)?(final|general)|total\s+(general|neto)\s+(de\s+la\s+)?oferta|costo\s+total\s+(de\s+la\s+)?oferta|valor\s+total\s+ofertad|total\s+iva\s+incluido/gi;

for (const cod of codigos) {
  const [docs] = await pool.query<any[]>(`SELECT documento_nombre, categoria, texto_extraido FROM documentos_cache WHERE licitacion_codigo = ?`, [cod]);
  console.log(`\n================ ${cod} ================`);
  let evidencia: string | null = null, fuenteDoc = '';
  for (const d of docs as any[]) {
    const txt = (d.texto_extraido || '');
    if (txt.length < 50) continue;
    let m: RegExpExecArray | null; reTitulo.lastIndex = 0;
    while ((m = reTitulo.exec(txt)) && !evidencia) {
      const v = txt.slice(m.index, m.index + 6000);
      if (/total\s+(por\s+)?l[ií]nea|total\s+(por\s+)?lote/i.test(v)) continue;
      const trio = v.match(/\bsub\s*total\b[\s\S]{0,60}\biva\b[\s\S]{0,60}\btotal\b/i);
      if (trio) { evidencia = `TRÍO Subtotal/IVA/Total → "${trio[0].replace(/\s+/g, ' ').trim().slice(0, 80)}"`; fuenteDoc = d.documento_nombre; break; }
      let t: RegExpExecArray | null; reTotal.lastIndex = 0;
      while ((t = reTotal.exec(v))) {
        const sub = v.slice(Math.max(0, t.index - 200), t.index + 160);
        if (/valor\s+unitario|precio\s+unitario|p\.?\s*unit|c[aá]lculo\s+del|debe\s+aplicar|cantidad\s*[x×*]/i.test(sub)) continue;
        evidencia = `"${t[0].replace(/\s+/g, ' ').trim()}" ctx: …${v.slice(Math.max(0, t.index - 60), t.index + 40).replace(/\s+/g, ' ').trim()}…`;
        fuenteDoc = d.documento_nombre; break;
      }
    }
    if (evidencia) break;
  }
  console.log(`  Evidencia total único: ${evidencia || '(no encontrada)'}`);
  console.log(`  Documento fuente:      ${fuenteDoc}`);
  // ¿Hay lenguaje de adjudicación por línea/ítem que pudo confundir a la IA?
  const todo = (docs as any[]).map(d => d.texto_extraido || '').join('\n');
  const adj = todo.match(/adjudicar[aá]?[^.]{0,80}(por\s+l[ií]nea|por\s+.tem|m[uú]ltiple)/i);
  console.log(`  Lenguaje adjudicación: ${adj ? '"' + adj[0].replace(/\s+/g, ' ').trim().slice(0, 100) + '"' : '—'}`);
}
await pool.end();
