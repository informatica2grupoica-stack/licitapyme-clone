// CORREDOR DE REGRESIÓN de viabilidad. Lee scripts/regresion/gold.json (casos + esperado) y
// mide aciertos por métrica. Dos modos:
//
//   npx tsx scripts/regresion/run.ts                 (DRY: compara contra el informe GUARDADO en BD; gratis)
//   npx tsx scripts/regresion/run.ts --run           (RE-ANALIZA de verdad con el modelo; para A/B del flag)
//   npx tsx scripts/regresion/run.ts --run --only=1057536-77-LE26
//
// A/B del prompt (ej. barrido v3.5): corre dos veces cambiando el flag, y compara los dos reportes:
//   VIABILIDAD_BARRIDO_V35=1 npx tsx scripts/regresion/run.ts --run   → report guarda etiqueta "barrido=1"
//   VIABILIDAD_BARRIDO_V35=0 npx tsx scripts/regresion/run.ts --run   → "barrido=0"
//
// Salida: tabla por caso + resumen global (% aciertos por métrica) + JSON de reporte al scratchpad.
import { readFileSync, writeFileSync } from 'fs';
import mysql from 'mysql2/promise';
import { cargarEnv } from './_env';
import { extraerMetricas, comparar, type Esperado, type Chequeo } from './_metricas';

cargarEnv();

const REPORTE_DIR = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/9bd4f2d2-48e0-467e-9288-d7b1b8c0bd7d/scratchpad';
const GOLD = 'D:/licitapyme-clone/scripts/regresion/gold.json';

const args = process.argv.slice(2);
const MODO_RUN = args.includes('--run');
const only = args.find(a => a.startsWith('--only='))?.split('=')[1];

async function leerInformeGuardado(pool: mysql.Pool, codigo: string): Promise<any | null> {
  const [rows] = await pool.query(
    `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
  const row = (rows as any[])[0];
  if (!row) return null;
  try {
    const ie = typeof row.informe_ejecutivo === 'string' ? JSON.parse(row.informe_ejecutivo) : row.informe_ejecutivo;
    return ie?._informe_ia_v3 ?? null;
  } catch { return null; }
}

async function main() {
  let casos: Array<{ codigo: string; esperado: Esperado; nota?: string }>;
  try { casos = JSON.parse(readFileSync(GOLD, 'utf8')); }
  catch { console.error(`No pude leer ${GOLD}. Corre primero seed.ts y renombra gold.seed.json → gold.json.`); process.exit(1); return; }
  if (only) casos = casos.filter(c => c.codigo === only);
  if (!casos.length) { console.error('Sin casos que correr.'); process.exit(1); }

  const barrido = process.env.VIABILIDAD_BARRIDO_V35 === '0' ? '0' : '1';
  const etiqueta = `${MODO_RUN ? 'run' : 'dry'} · barrido=${barrido}`;
  console.log(`\n▶ Regresión viabilidad — ${casos.length} caso(s) — modo ${etiqueta}\n`);

  const pool = mysql.createPool({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME, connectionLimit: 2, connectTimeout: 20000,
  });

  // Import perezoso: solo si vamos a re-analizar (evita cargar todo el grafo en modo dry).
  let analizar: ((c: string) => Promise<any>) | null = null;
  if (MODO_RUN) ({ analizarViabilidadIAV3: analizar } = await import('@/app/lib/viabilidad-ia'));

  const porMetrica = new Map<string, { ok: number; total: number }>();
  const detalle: any[] = [];
  let casosOK = 0;

  for (const caso of casos) {
    const t0 = Date.now();
    let inf: any = null; let err = '';
    try {
      inf = MODO_RUN ? await analizar!(caso.codigo) : await leerInformeGuardado(pool, caso.codigo);
    } catch (e) { err = String((e as any)?.message ?? e).slice(0, 160); }
    const segs = ((Date.now() - t0) / 1000).toFixed(1);

    if (!inf) {
      console.log(`✗ ${caso.codigo.padEnd(20)} SIN INFORME ${err ? `(${err})` : MODO_RUN ? '(análisis devolvió null)' : '(no guardado)'}`);
      detalle.push({ codigo: caso.codigo, error: err || 'sin informe', chequeos: [] });
      continue;
    }

    const m = extraerMetricas(inf);
    const chequeos: Chequeo[] = comparar(m, caso.esperado);
    const fallos = chequeos.filter(c => !c.ok);
    for (const c of chequeos) {
      const acc = porMetrica.get(c.metrica) ?? { ok: 0, total: 0 };
      acc.total++; if (c.ok) acc.ok++; porMetrica.set(c.metrica, acc);
    }
    const casoOK = fallos.length === 0;
    if (casoOK) casosOK++;

    console.log(`${casoOK ? '✓' : '✗'} ${caso.codigo.padEnd(20)} ${String(chequeos.length - fallos.length)}/${chequeos.length} ok${MODO_RUN ? ` · ${segs}s · score=${m.score}` : ''}${caso.nota ? ` · ${caso.nota}` : ''}`);
    for (const f of fallos) console.log(`    ↳ ${f.metrica}: esperaba ${f.esperado}, obtuvo ${f.obtenido}`);
    detalle.push({ codigo: caso.codigo, metricas: m, chequeos, ok: casoOK });
  }

  // ── Resumen ──
  console.log(`\n── Resumen (${etiqueta}) ──`);
  console.log(`Casos perfectos: ${casosOK}/${casos.length}`);
  const filas = [...porMetrica.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [metrica, { ok, total }] of filas) {
    const pct = total ? Math.round((ok / total) * 100) : 0;
    console.log(`  ${metrica.padEnd(16)} ${String(ok).padStart(3)}/${String(total).padEnd(3)}  ${pct}%`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${REPORTE_DIR}/regresion-${MODO_RUN ? 'run' : 'dry'}-barrido${barrido}-${stamp}.json`;
  writeFileSync(dest, JSON.stringify({ etiqueta, casosOK, total: casos.length, porMetrica: Object.fromEntries(porMetrica), detalle }, null, 2), 'utf8');
  console.log(`\nReporte → ${dest}\n`);
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
