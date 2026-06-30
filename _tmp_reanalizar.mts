// TEMP — re-analiza viabilidad de códigos puntuales con el prompt corregido. Borrar tras usar.
import fs from 'node:fs';
// Cargar .env.local en process.env ANTES de importar módulos que lo usan.
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const codigos = process.argv.slice(2);
const { analizarYGuardarViabilidadIA } = await import('@/app/lib/viabilidad-ia');

for (const codigo of codigos) {
  process.stdout.write(`\n=== ${codigo} … `);
  try {
    const r = await analizarYGuardarViabilidadIA(codigo);
    if (!r) { console.log('sin documentos legibles'); continue; }
    const bloq = r.capa_c_admisibilidad?.bloqueantes?.length ?? 0;
    console.log(`OK\n   score ${r.score_0_100}/100 [${r.semaforo}] · capaA ${r.capa_a?.score_total}/15 · veredicto ${r.veredicto?.nivel}/${r.veredicto?.gana_probable} · ${bloq} bloqueante(s)`);
    if (bloq) console.log('   bloqueantes:', r.capa_c_admisibilidad.bloqueantes.map((b:any)=>b.item).join(' | '));
  } catch (e: any) {
    console.log('ERROR:', String(e?.message || e).slice(0, 200));
  }
}
process.exit(0);
