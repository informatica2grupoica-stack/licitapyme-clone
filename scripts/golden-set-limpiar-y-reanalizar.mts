// Limpia (SOLO golden set): borra la viabilidad guardada y los documentos propios de cada
// licitación, y luego re-analiza con IA (guardando en BD) usando el código actual.
// No toca los documentos oficiales de Mercado Público (esos quedan igual, no hace falta
// redescargar). Uso: npx tsx scripts/golden-set-limpiar-y-reanalizar.mts
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
const SCRATCH = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/caf20eba-506b-4a47-b7a6-a9f8f467b8bc/scratchpad';
const LOG = `${SCRATCH}/golden_limpiar_reanalizar.log`;
const log = (s: string) => { const line = `[${new Date().toISOString()}] ${s}`; console.log(line); appendFileSync(LOG, line + '\n'); };

writeFileSync(LOG, `▶ Limpieza + reanálisis golden set — ${CODIGOS.length} licitaciones\n`);

const pool = (await import('@/app/lib/db')).default;
const { borrarDocumentoR2 } = await import('@/app/lib/r2');
const { analizarYGuardarViabilidadIA } = await import('@/app/lib/viabilidad-ia');

// ── FASE 1: limpiar (solo golden set) ──
log('\n== FASE 1: borrando viabilidad + documentos propios ==');
let totalDocsBorrados = 0;
let totalViabBorradas = 0;
for (const codigo of CODIGOS) {
  const [docs] = await pool.query(
    `SELECT id, documento_url_local FROM documentos_cache WHERE licitacion_codigo = ? AND categoria = 'DOCUMENTOS_PROPIOS'`,
    [codigo]
  );
  const lista = docs as any[];
  for (const d of lista) {
    try { await borrarDocumentoR2(d.documento_url_local); }
    catch (e) { log(`  ⚠ R2 no se pudo borrar (${codigo}): ${String(e).slice(0, 120)}`); }
    await pool.query(`DELETE FROM documentos_cache WHERE id = ?`, [d.id]);
  }
  totalDocsBorrados += lista.length;

  const [vRes]: any = await pool.query(`DELETE FROM viabilidad_licitacion WHERE licitacion_codigo = ?`, [codigo]);
  if (vRes.affectedRows) totalViabBorradas++;

  log(`${codigo}: ${lista.length} doc(s) propio(s) borrado(s) · viabilidad ${vRes.affectedRows ? 'borrada' : 'no tenía'}`);
}
log(`\nLimpieza lista → ${totalDocsBorrados} documentos propios borrados, ${totalViabBorradas} viabilidades borradas.\n`);

// ── FASE 2: re-analizar con el código actual y guardar en BD ──
log('== FASE 2: re-analizando con IA (se guarda en BD) ==');
const resumen: any[] = [];
for (let i = 0; i < CODIGOS.length; i++) {
  const codigo = CODIGOS[i];
  log(`[${i + 1}/${CODIGOS.length}] ${codigo} — analizando...`);
  try {
    const inf: any = await analizarYGuardarViabilidadIA(codigo);
    if (!inf) {
      log(`  SIN RESULTADO (sin documentos legibles)`);
      resumen.push({ codigo, error: 'sin resultado' });
      continue;
    }
    const nItems = Array.isArray(inf.productos?.items) ? inf.productos.items.length : null;
    log(`  OK — score=${inf.score_0_100} veredicto=${inf.tarjeta_decision?.veredicto} modalidad=${inf.modalidad?.tipo} adjudicacion=${inf.adjudicacion?.como_se_adjudica} n_items=${nItems}`);
    resumen.push({
      codigo, score: inf.score_0_100 ?? null, veredicto: inf.tarjeta_decision?.veredicto ?? null,
      modalidad: inf.modalidad?.tipo ?? null, adjudicacion: inf.adjudicacion?.como_se_adjudica ?? null, nItems,
    });
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 200);
    log(`  FALLÓ: ${msg}`);
    resumen.push({ codigo, error: msg });
  }
}

log(`\n== RESUMEN FINAL (${resumen.length}) ==`);
for (const r of resumen) {
  log(r.error
    ? `${r.codigo} | ERROR: ${r.error}`
    : `${r.codigo} | score=${r.score} | ${r.veredicto} | ${r.modalidad}/${r.adjudicacion} | items=${r.nItems}`);
}
writeFileSync(`${SCRATCH}/golden_limpiar_reanalizar_resumen.json`, JSON.stringify(resumen, null, 2), 'utf8');
log(`\nListo. Resumen → golden_limpiar_reanalizar_resumen.json`);
process.exit(0);
