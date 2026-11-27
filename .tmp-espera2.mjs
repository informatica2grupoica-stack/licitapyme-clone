// Solo lectura: espera a que las 4 partes queden leídas (máximo 20 min) y 90 s más para que se asignen.
import fs from 'node:fs';
import mysql from 'mysql2/promise';
for (const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] = m[2].replace(/\s+#.*$/,'').replace(/^["']|["']$/g,'').trim(); }
const src = fs.readFileSync('app/lib/db.ts','utf8'); const vars = [...new Set([...src.matchAll(/process\.env\.([A-Z_0-9]+)/g)].map(m=>m[1]))];
const g = k => process.env[vars.find(v => v.includes(k))];
const inicio = Date.now();
for (;;) {
  const c = await mysql.createConnection({ host: g('HOST'), port: Number(g('PORT')||3306), user: g('USER'), password: g('PASS'), database: g('NAME') || g('DATABASE'), dateStrings: true });
  const [x] = await c.query("SELECT e.documento_nombre n, e.error FROM auditor_evento ev JOIN auditor_extraccion e ON e.id=CAST(ev.detalle AS UNSIGNED) WHERE ev.negocio_id=891 AND ev.tipo='ficha_compras' AND e.documento_nombre LIKE '%PARTE%'");
  const [[q]] = await c.query("SELECT TIMESTAMPDIFF(SECOND, MAX(creado_at), NOW()) quieto FROM auditor_evento WHERE negocio_id=891 AND tipo IN ('ficha_compras','documento_nuevo','sugerencia_linea')");
  await c.end();
  if ((x.length >= 4 && q.quieto >= 90) || Date.now() - inicio > 20*60000) { console.log(x.map(r => r.n + (r.error ? ' ERROR ' + r.error : '')).join('\n')); console.log('leidas', x.length, 'quieto', q.quieto); break; }
  await new Promise(r => setTimeout(r, 30000));
}
