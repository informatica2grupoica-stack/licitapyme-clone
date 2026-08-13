// Corre exactamente el mismo motor que el botón "Viabilidad" de producción, sin apurar nada.
// Uso: npx tsx scripts/_reanalizar-1159-6-le26.mts
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const { analizarYGuardarViabilidadIA } = await import('@/app/lib/viabilidad-ia');

const COD = '1159-6-LE26';
const t0 = Date.now();
console.log(`[${new Date().toISOString()}] Iniciando análisis de ${COD}...`);
const informe = await analizarYGuardarViabilidadIA(COD);
const segs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n[${new Date().toISOString()}] Terminado en ${segs}s`);
if (!informe) {
  console.error('analizarYGuardarViabilidadIA devolvió null — no hay documentos legibles.');
  process.exit(1);
}
console.log('score:', (informe as any).score_0_100, '· veredicto:', (informe as any).tarjeta_decision?.veredicto);
console.log('adjudicacion:', JSON.stringify((informe as any).adjudicacion?.como_se_adjudica));
console.log('modalidad:', JSON.stringify((informe as any).modalidad?.tipo));
process.exit(0);
