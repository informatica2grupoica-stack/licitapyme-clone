// Reintento puntual de los 2 casos del golden set que fallaron por timeout de GLM en la
// corrida completa (golden-set-limpiar-y-reanalizar.mts). Ya tienen la viabilidad y los
// documentos propios anteriores borrados (fase 1 de esa corrida) — solo falta re-analizar
// y guardar. Uso: npx tsx scripts/_golden-retry-2.mts
import { readFileSync, writeFileSync, appendFileSync } from 'fs';

for (const f of ['D:/licitapyme-clone/.env.local', 'D:/licitapyme-clone/.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ok */ }
}

const CODIGOS = ['1260058-2-LE26', '2467-70-LE26'];
const SCRATCH = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/caf20eba-506b-4a47-b7a6-a9f8f467b8bc/scratchpad';
const LOG = `${SCRATCH}/golden_retry2.log`;
const log = (s: string) => { const line = `[${new Date().toISOString()}] ${s}`; console.log(line); appendFileSync(LOG, line + '\n'); };

writeFileSync(LOG, `▶ Reintento golden set — ${CODIGOS.length} caso(s)\n`);

const { analizarYGuardarViabilidadIA } = await import('@/app/lib/viabilidad-ia');

const resumen: any[] = [];
for (let i = 0; i < CODIGOS.length; i++) {
  const codigo = CODIGOS[i];
  log(`[${i + 1}/${CODIGOS.length}] ${codigo} — analizando...`);
  try {
    const inf: any = await analizarYGuardarViabilidadIA(codigo);
    if (!inf) {
      log(`  SIN RESULTADO`);
      resumen.push({ codigo, error: 'sin resultado' });
      continue;
    }
    const nItems = Array.isArray(inf.productos?.items) ? inf.productos.items.length : null;
    log(`  OK — score=${inf.score_0_100} veredicto=${inf.tarjeta_decision?.veredicto} modalidad=${inf.modalidad?.tipo} adjudicacion=${inf.adjudicacion?.como_se_adjudica} n_items=${nItems}`);
    resumen.push({ codigo, score: inf.score_0_100 ?? null, veredicto: inf.tarjeta_decision?.veredicto ?? null, modalidad: inf.modalidad?.tipo ?? null, adjudicacion: inf.adjudicacion?.como_se_adjudica ?? null, nItems });
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200);
    log(`  FALLÓ: ${msg}`);
    resumen.push({ codigo, error: msg });
  }
}

log(`\n== RESUMEN REINTENTO ==`);
for (const r of resumen) {
  log(r.error ? `${r.codigo} | ERROR: ${r.error}` : `${r.codigo} | score=${r.score} | ${r.veredicto} | ${r.modalidad}/${r.adjudicacion} | items=${r.nItems}`);
}
writeFileSync(`${SCRATCH}/golden_retry2_resumen.json`, JSON.stringify(resumen, null, 2), 'utf8');
log(`\nListo.`);
process.exit(0);
