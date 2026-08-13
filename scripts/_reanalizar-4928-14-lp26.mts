// Re-análisis puntual de 4928-14-LP26 (adjudicación quedó GLOBAL, análisis viejo — ver
// project_modalidad_dos_ejes / hallazgo 13-ago-2026). Corre el mismo motor que usa
// POST /api/licitacion-viabilidad-ia/[codigo] (analizarYGuardarViabilidadIA), sin pasar por
// HTTP/login. Gasta una llamada real a la IA (proveedor GLM/Z.AI).
// Uso: npx tsx scripts/_reanalizar-4928-14-lp26.mts
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); }
const { analizarYGuardarViabilidadIA } = await import('@/app/lib/viabilidad-ia');

const COD = '4928-14-LP26';
console.log(`Re-analizando ${COD}...`);
const informe = await analizarYGuardarViabilidadIA(COD);
if (!informe) {
  console.error('analizarYGuardarViabilidadIA devolvió null — no hay documentos legibles.');
  process.exit(1);
}
console.log('\n== Resultado ==');
console.log('adjudicacion:', JSON.stringify((informe as any).adjudicacion, null, 2));
console.log('modalidad:', JSON.stringify((informe as any).modalidad, null, 2));
process.exit(0);
