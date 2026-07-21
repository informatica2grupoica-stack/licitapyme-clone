import { readFileSync } from 'fs';
for (const f of ['D:/licitapyme-clone/.env.local']) {
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
async function main() {
  const { refrescarPreguntas, leerCachePreguntas } = await import('@/app/lib/preguntas-respuestas');
  const { default: pool } = await import('@/app/lib/db');

  console.log('--- refrescarPreguntas (fuerza scrape + guarda) ---');
  const r1 = await refrescarPreguntas('1288505-5-LE26');
  console.log(JSON.stringify(r1, null, 2));

  console.log('\n--- leerCachePreguntas (debe leer de BD, instantáneo) ---');
  const t0 = Date.now();
  const r2 = await leerCachePreguntas('1288505-5-LE26');
  console.log(`(${Date.now() - t0}ms)`, JSON.stringify(r2, null, 2));

  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
