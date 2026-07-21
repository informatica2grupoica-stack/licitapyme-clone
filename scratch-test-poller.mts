import { readFileSync } from 'fs';
for (const f of ['D:/licitapyme-clone/.env.local']) {
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
async function main() {
  const { contarPendientesPreguntas, procesarPreguntasPendientes } = await import('@/app/lib/preguntas-respuestas');
  const { default: pool } = await import('@/app/lib/db');

  console.log('Pendientes ANTES:', await contarPendientesPreguntas());
  const r = await procesarPreguntasPendientes(3); // lote chico para la prueba
  console.log('Resultado del poller:', r);
  console.log('Pendientes DESPUÉS:', await contarPendientesPreguntas());

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
