// Frente A.2 — agrega los hallazgos del validador (_validador.hallazgos) de TODOS los informes de
// viabilidad ya guardados, para responder la pregunta que pide el plan: "¿qué regla falla más
// seguido, y en qué licitaciones, para saber qué parte del prompt/código afinar?".
//
// Sin este script, cada hallazgo queda guardado (informe por informe) pero NUNCA junto — nadie
// puede ver el patrón sin abrir licitación por licitación a mano. Solo lectura.
//
// Uso: npx tsx scripts/estadisticas-validador.mts
import fs from 'fs';
import mysql from 'mysql2/promise';

const env: Record<string, string> = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({
  host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
  database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000,
});

const [rows] = await pool.query<any[]>(
  `SELECT licitacion_codigo, informe_ejecutivo FROM viabilidad_licitacion`,
);

type Conteo = { total: number; codigos: string[]; ejemploMensaje: string };
const porRegla = new Map<string, Conteo>();
let conValidador = 0, sinValidador = 0, malFormados = 0;

for (const r of rows as any[]) {
  let ie: any;
  try { ie = typeof r.informe_ejecutivo === 'string' ? JSON.parse(r.informe_ejecutivo) : r.informe_ejecutivo; }
  catch { malFormados++; continue; }
  const validador = ie?._informe_ia_v3?._validador;
  if (!validador || !Array.isArray(validador.hallazgos)) { sinValidador++; continue; }
  conValidador++;
  for (const h of validador.hallazgos) {
    const key = h?.regla || 'V-??';
    const c = porRegla.get(key) || { total: 0, codigos: [], ejemploMensaje: '' };
    c.total++;
    if (c.codigos.length < 5) c.codigos.push(r.licitacion_codigo);
    if (!c.ejemploMensaje) c.ejemploMensaje = h?.mensaje || '';
    porRegla.set(key, c);
  }
}

const ordenado = [...porRegla.entries()].sort((a, b) => b[1].total - a[1].total);

console.log('\n================ ESTADÍSTICA DEL VALIDADOR (Frente A.2) ================');
console.log(`Informes con _validador guardado: ${conValidador}  ·  sin _validador (informes viejos/v2): ${sinValidador}  ·  JSON mal formado: ${malFormados}\n`);
if (ordenado.length === 0) {
  console.log('Sin hallazgos registrados todavía.');
} else {
  console.log('Regla   Veces   Licitaciones de ejemplo                    Mensaje de ejemplo');
  for (const [regla, c] of ordenado) {
    console.log(`${regla.padEnd(7)} ${String(c.total).padStart(5)}   ${c.codigos.slice(0, 3).join(', ').padEnd(42)} ${c.ejemploMensaje.slice(0, 90)}`);
  }
}
console.log('\n(Usa esta lista para decidir qué regla V-XX conviene reforzar, o qué parte del prompt suele fallar en el origen del dato.)');

await pool.end();
