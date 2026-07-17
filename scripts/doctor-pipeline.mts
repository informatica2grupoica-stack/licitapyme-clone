// ─────────────────────────────────────────────────────────────────────────────
// DOCTOR DEL PIPELINE — auto-auditoría de la viabilidad.
//
// Detecta (y opcionalmente auto-sana) las clases de fallo SILENCIOSO que
// encontramos en producción, para que ninguna licitación quede rota sin que
// nadie se entere. Pensado para correr en el scheduler (junto a intake/prefiltro).
//
// Uso:
//   npx tsx scripts/doctor-pipeline.mts                 → SOLO reporta (dry, no toca nada)
//   npx tsx scripts/doctor-pipeline.mts --fix           → auto-sana (re-analiza) hasta --limit
//   npx tsx scripts/doctor-pipeline.mts --fix --limit=30
//
// Clases que SANA (re-analizando con analizarYGuardarViabilidadIA, reusa OCR cacheado):
//   A) Asignada a un negocio pero SIN viabilidad (y no excluida por prefiltro).
//   B) Viabilidad en formato VIEJO (sin _informe_ia_v3).
//   C) Informe INCOHERENTE (presupuesto nulo · criterios no suman 100 · modalidad vacía).
// Clases que SOLO REPORTA (arreglo aparte):
//   D) Documentos con HUECOS de OCR (OCR_NO_DISPONIBLE) → requiere re-OCR.
//   E) Comprimidos (.zip/.rar) sin abrir en licitaciones que importan → requiere unzip.
//
// El --fix prioriza las ACTIVAS (cierre futuro) y sanea como máximo --limit por corrida
// (control de costo). Salta las que no tienen documentos legibles (no hay qué analizar).
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'fs';

// Cargar .env.local ANTES de importar módulos de la app (leen process.env al importarse).
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) {
    let v = m[2].trim();
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '').trim();
    process.env[m[1]] = v.replace(/^["']|["']$/g, '');
  }
}

const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const LIMIT = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] || 20);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const pool = (await import('@/app/lib/db')).default;

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseInforme(raw: any): { root: any; v3: any } {
  try {
    const ie = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { root: ie || {}, v3: ie?._informe_ia_v3 || null };
  } catch { return { root: null, v3: null }; }
}

// Motivo de INCOHERENCIA de un informe v3 (o null si está sano).
function motivoIncoherente(v3: any): string | null {
  if (!v3) return null;
  const problemas: string[] = [];
  const pres = v3?.presupuesto || {};
  if (pres.bruto == null && pres.neto == null) problemas.push('presupuesto nulo');
  const crit = v3?.criterios_evaluacion || {};
  if (crit?.suma_valida === false) problemas.push('criterios no suman 100');
  if (!v3?.modalidad?.tipo) problemas.push('modalidad vacía');
  return problemas.length ? problemas.join(' · ') : null;
}

type Caso = { codigo: string; clase: 'A' | 'B' | 'C'; motivo: string; activa: boolean };

// ── Detección ────────────────────────────────────────────────────────────────
async function detectar() {
  const casos: Caso[] = [];
  const soloReporte: { clase: string; total: number; ejemplos: string[] }[] = [];

  // Fecha de referencia (Chile). No usamos Date.now() del harness; en el scheduler real es Date normal.
  const ahora = new Date();

  // A) Asignadas (en negocios) SIN viabilidad y NO excluidas.
  const [a] = await pool.query<any[]>(`
    SELECT DISTINCT n.licitacion_codigo AS codigo, lc.fecha_cierre AS cierre
    FROM negocios n
    LEFT JOIN viabilidad_licitacion v ON v.licitacion_codigo = n.licitacion_codigo
    LEFT JOIN prefiltro_licitacion pf ON pf.licitacion_codigo = n.licitacion_codigo
    LEFT JOIN licitaciones_cache lc ON lc.codigo = n.licitacion_codigo
    WHERE v.licitacion_codigo IS NULL
      AND (pf.decision IS NULL OR pf.decision <> 'EXCLUIDO')`);
  for (const r of a as any[]) casos.push({ codigo: r.codigo, clase: 'A', motivo: 'asignada sin viabilidad', activa: r.cierre ? new Date(r.cierre) >= ahora : false });

  // B) Viabilidad en formato viejo (sin _informe_ia_v3).
  const [b] = await pool.query<any[]>(`
    SELECT v.licitacion_codigo AS codigo, lc.fecha_cierre AS cierre
    FROM viabilidad_licitacion v
    LEFT JOIN licitaciones_cache lc ON lc.codigo = v.licitacion_codigo
    WHERE v.informe_ejecutivo NOT LIKE '%\\_informe\\_ia\\_v3%'`);
  for (const r of b as any[]) casos.push({ codigo: r.codigo, clase: 'B', motivo: 'viabilidad en formato viejo', activa: r.cierre ? new Date(r.cierre) >= ahora : false });

  // C) Informe v3 incoherente. Traemos las v3 y evaluamos en JS.
  const [c] = await pool.query<any[]>(`
    SELECT v.licitacion_codigo AS codigo, v.informe_ejecutivo, lc.fecha_cierre AS cierre
    FROM viabilidad_licitacion v
    LEFT JOIN licitaciones_cache lc ON lc.codigo = v.licitacion_codigo
    WHERE v.informe_ejecutivo LIKE '%\\_informe\\_ia\\_v3%'`);
  for (const r of c as any[]) {
    const { v3 } = parseInforme(r.informe_ejecutivo);
    const motivo = motivoIncoherente(v3);
    if (motivo) casos.push({ codigo: r.codigo, clase: 'C', motivo: `informe incoherente (${motivo})`, activa: r.cierre ? new Date(r.cierre) >= ahora : false });
  }

  // D) Huecos de OCR (solo reporte).
  const [d] = await pool.query<any[]>(`
    SELECT DISTINCT licitacion_codigo AS codigo FROM documentos_cache
    WHERE texto_extraido LIKE '%OCR_NO_DISPONIBLE%'`);
  soloReporte.push({ clase: 'D · huecos de OCR (requiere re-OCR)', total: (d as any[]).length, ejemplos: (d as any[]).slice(0, 8).map(r => r.codigo) });

  // E) Comprimidos sin abrir en licitaciones con viabilidad (solo reporte).
  const [e] = await pool.query<any[]>(`
    SELECT DISTINCT dc.licitacion_codigo AS codigo
    FROM documentos_cache dc
    JOIN viabilidad_licitacion v ON v.licitacion_codigo = dc.licitacion_codigo
    WHERE (LOWER(dc.documento_nombre) LIKE '%.zip' OR LOWER(dc.documento_nombre) LIKE '%.rar' OR LOWER(dc.documento_nombre) LIKE '%.7z')
      AND CHAR_LENGTH(COALESCE(dc.texto_extraido,'')) < 50`);
  soloReporte.push({ clase: 'E · comprimidos sin abrir (requiere unzip)', total: (e as any[]).length, ejemplos: (e as any[]).slice(0, 8).map(r => r.codigo) });

  return { casos, soloReporte };
}

// ── Reporte + sanación ───────────────────────────────────────────────────────
async function main() {
  console.log(`\n🩺 DOCTOR DEL PIPELINE — ${FIX ? `MODO SANAR (límite ${LIMIT})` : 'MODO REPORTE (dry)'}\n`);
  const { casos, soloReporte } = await detectar();

  // Dedup: una misma licitación puede caer en varias clases; sanamos una vez.
  const porCodigo = new Map<string, Caso>();
  for (const c of casos) if (!porCodigo.has(c.codigo)) porCodigo.set(c.codigo, c);
  const unicos = [...porCodigo.values()];

  const cont = (cl: string) => casos.filter(c => c.clase === cl).length;
  console.log('DETECTADO (auto-sanable):');
  console.log(`  A) asignadas sin viabilidad : ${cont('A')}`);
  console.log(`  B) viabilidad formato viejo : ${cont('B')}`);
  console.log(`  C) informe incoherente      : ${cont('C')}`);
  console.log(`  → licitaciones únicas a sanar: ${unicos.length}`);
  console.log('\nDETECTADO (solo reporte, arreglo aparte):');
  for (const s of soloReporte) console.log(`  ${s.clase}: ${s.total}${s.ejemplos.length ? `  (ej: ${s.ejemplos.join(', ')})` : ''}`);

  if (!FIX) {
    console.log(`\nℹ️  Modo reporte. Para auto-sanar: npx tsx scripts/doctor-pipeline.mts --fix --limit=${LIMIT}`);
    console.log(`   Prioriza ACTIVAS (cierre futuro). ${unicos.filter(u => u.activa).length} de ${unicos.length} están activas.`);
    await pool.end(); process.exit(0);
  }

  // Sanar: primero las ACTIVAS, hasta LIMIT.
  const orden = [...unicos].sort((x, y) => Number(y.activa) - Number(x.activa));
  const aSanar = orden.slice(0, LIMIT);
  console.log(`\n🔧 Sanando ${aSanar.length} de ${unicos.length} (activas primero)…\n`);

  const { analizarYGuardarViabilidadIA } = await import('@/app/lib/viabilidad-ia');
  const resultado = { sanadas: 0, sinDocs: 0, error: 0 };
  let i = 0;
  for (const caso of aSanar) {
    i++;
    process.stdout.write(`[${i}/${aSanar.length}] ${caso.codigo} (${caso.clase}: ${caso.motivo}) … `);
    try {
      const r = await analizarYGuardarViabilidadIA(caso.codigo);
      if (!r) { console.log('SIN DOCUMENTOS LEGIBLES ⚠ (marcar para revisión manual)'); resultado.sinDocs++; }
      else { console.log(`✅ sanada → ${r.modalidad?.tipo || '?'}`); resultado.sanadas++; }
    } catch (err: any) {
      console.log(`❌ ERROR: ${String(err?.message || err).slice(0, 120)}`);
      resultado.error++;
    }
    await sleep(2000);
  }

  console.log('\n================ RESULTADO ================');
  console.log(`  ✅ sanadas: ${resultado.sanadas} · ⚠ sin docs (revisión manual): ${resultado.sinDocs} · ❌ error: ${resultado.error}`);
  const restantes = unicos.length - aSanar.length;
  if (restantes > 0) console.log(`  ⏳ quedan ${restantes} para la próxima corrida (sube --limit para sanar más de una vez).`);
  await pool.end();
  process.exit(0);
}

main().catch(async (e) => { console.error('doctor falló:', e); try { await pool.end(); } catch {} process.exit(1); });
