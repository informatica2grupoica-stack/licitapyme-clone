// Re-descarga documentos (recoge aclaraciones/respuestas nuevas de MP) y re-analiza con IA
// (guardando en BD, NO el modo dry de scripts/regresion) las 29 licitaciones del golden set.
// Uso: npx tsx scripts/_batch_golden_redescarga_reanalisis.mts
import { readFileSync, writeFileSync, appendFileSync } from 'fs';

for (const f of ['D:/licitapyme-clone/.env.local', 'D:/licitapyme-clone/.env']) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* ok */ }
}

const CODIGOS: string[] = JSON.parse(readFileSync('scripts/regresion/gold.json', 'utf8')).map((c: any) => c.codigo);
const LOG = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/53e124b4-e3a4-4b57-b030-71b8b3fdf56a/scratchpad/batch_golden.log';
const log = (s: string) => { const line = `[${new Date().toISOString()}] ${s}`; console.log(line); appendFileSync(LOG, line + '\n'); };

writeFileSync(LOG, `▶ Batch golden set — ${CODIGOS.length} licitaciones\n`);

const { descargarDocumentosLicitacion } = await import('@/app/lib/mp-descarga-orquestador');
const { analizarYGuardarViabilidadIA } = await import('@/app/lib/viabilidad-ia');

const resumen: { codigo: string; nuevosDocs: number; score: number | null; veredicto: string | null; modalidad: string | null; adjudicacion: string | null; nItems: number | null; error: string | null }[] = [];

for (let i = 0; i < CODIGOS.length; i++) {
  const codigo = CODIGOS[i];
  log(`\n[${i + 1}/${CODIGOS.length}] ${codigo} — descargando documentos...`);
  let nuevosDocs = 0;
  try {
    const r = await descargarDocumentosLicitacion(codigo);
    nuevosDocs = r.nuevos;
    log(`  descarga: ${r.nuevos} nuevo(s), ${r.omitidos} ya en caché, exito=${r.exito}${r.error ? ` error=${r.error}` : ''}`);
  } catch (e: any) {
    log(`  descarga falló: ${String(e?.message || e).slice(0, 200)}`);
  }

  log(`  analizando con IA...`);
  try {
    const inf: any = await analizarYGuardarViabilidadIA(codigo);
    if (!inf) {
      log(`  análisis: SIN RESULTADO (sin documentos legibles)`);
      resumen.push({ codigo, nuevosDocs, score: null, veredicto: null, modalidad: null, adjudicacion: null, nItems: null, error: 'sin resultado' });
    } else {
      const nItems = Array.isArray(inf.productos?.items) ? inf.productos.items.length : Array.isArray(inf.manifiesto_productos) ? inf.manifiesto_productos.length : null;
      log(`  OK — score=${inf.score_0_100} veredicto=${inf.tarjeta_decision?.veredicto} modalidad=${inf.modalidad?.tipo} adjudicacion=${inf.adjudicacion?.como_se_adjudica} n_items=${nItems}`);
      resumen.push({ codigo, nuevosDocs, score: inf.score_0_100 ?? null, veredicto: inf.tarjeta_decision?.veredicto ?? null, modalidad: inf.modalidad?.tipo ?? null, adjudicacion: inf.adjudicacion?.como_se_adjudica ?? null, nItems, error: null });
    }
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200);
    log(`  análisis falló: ${msg}`);
    resumen.push({ codigo, nuevosDocs, score: null, veredicto: null, modalidad: null, adjudicacion: null, nItems: null, error: msg });
  }
}

log(`\n\n══ RESUMEN FINAL (${resumen.length} licitaciones) ══`);
for (const r of resumen) {
  log(`${r.codigo} | docs_nuevos=${r.nuevosDocs} | score=${r.score} | ${r.veredicto} | ${r.modalidad}/${r.adjudicacion} | items=${r.nItems}${r.error ? ` | ERROR: ${r.error}` : ''}`);
}
writeFileSync('C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/53e124b4-e3a4-4b57-b030-71b8b3fdf56a/scratchpad/batch_golden_resumen.json', JSON.stringify(resumen, null, 2), 'utf8');
log(`\nListo. JSON → batch_golden_resumen.json`);
process.exit(0);
