// Re-analiza la viabilidad IA (PROMPT 2) de las licitaciones indicadas, aplicando los
// detectores de modalidad ya mejorados. Usa analizarYGuardarViabilidadIA, que:
// analiza → guarda informe → vuelca ítems → regenera Excel de costeo.
//
// Reusa el texto cacheado en documentos_cache (no re-OCR), así que el costo LLM principal
// es DeepSeek (el JSON del informe). Secuencial, con pausa entre licitaciones y reintentos
// suaves ante saturación de Gemini/DeepSeek.
//
// Uso:
//   npx tsx scripts/reanalizar-viabilidad.mts 1549-58-LE26            (una o varias)
//   npx tsx scripts/reanalizar-viabilidad.mts --file lista.txt        (una por línea)
import fs from 'fs';

// 1) Cargar .env.local en process.env ANTES de importar módulos de la app (db, r2, llm
//    leen process.env al importarse).
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const args = process.argv.slice(2);
let codigos: string[] = [];
const fileIdx = args.indexOf('--file');
if (fileIdx >= 0) {
  codigos = fs.readFileSync(args[fileIdx + 1], 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
} else {
  codigos = args.filter(a => !a.startsWith('--'));
}
if (codigos.length === 0) { console.error('Sin códigos. Uso: npx tsx scripts/reanalizar-viabilidad.mts <cod...> | --file lista.txt'); process.exit(1); }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// 2) Import dinámico DESPUÉS de setear env.
const pool = (await import('@/app/lib/db')).default;
const { analizarYGuardarViabilidadIA } = await import('@/app/lib/viabilidad-ia');

async function modalidadGrabada(codigo: string): Promise<string> {
  try {
    const [rows] = await pool.query<any[]>(`SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
    const row = (rows as any[])[0]; if (!row) return '(sin viabilidad)';
    const ie = typeof row.informe_ejecutivo === 'string' ? JSON.parse(row.informe_ejecutivo) : row.informe_ejecutivo;
    return (ie?._informe_ia?.modalidad?.tipo || '(sin modalidad)');
  } catch { return '(error lectura)'; }
}

const resumen: any[] = [];
let i = 0;
for (const codigo of codigos) {
  i++;
  const antes = await modalidadGrabada(codigo);
  process.stdout.write(`\n[${i}/${codigos.length}] ${codigo}  (antes: ${antes}) … `);
  let intentos = 0, ok = false;
  while (intentos < 3 && !ok) {
    intentos++;
    try {
      const r = await analizarYGuardarViabilidadIA(codigo);
      if (!r) { console.log('SIN DOCUMENTOS LEGIBLES'); resumen.push({ codigo, antes, despues: '(sin docs)', estructura: '', cambio: false }); break; }
      const despues = r.modalidad?.tipo || '(?)';
      const cambio = antes !== despues;
      console.log(`OK → ${despues}${cambio ? '  ⟵ CAMBIÓ' : ''}  [costeo: ${r.estructura_costeo || 'plana/línea'}]`);
      resumen.push({ codigo, antes, despues, estructura: r.estructura_costeo || '', cambio });
      ok = true;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/429|quota|saturad|503/i.test(msg) && intentos < 3) { console.log(`saturado (intento ${intentos}), espero 30s…`); await sleep(30000); }
      else { console.log(`ERROR: ${msg.slice(0, 160)}`); resumen.push({ codigo, antes, despues: 'ERROR', estructura: '', cambio: false }); break; }
    }
  }
  await sleep(2500); // respiro entre licitaciones
}

console.log('\n\n================ RESUMEN ================');
const cambiaron = resumen.filter(r => r.cambio);
console.log(`Procesadas: ${resumen.length} · cambiaron modalidad: ${cambiaron.length}`);
for (const r of resumen) console.log(`  ${r.codigo}: ${r.antes} → ${r.despues}${r.cambio ? '  ⟵' : ''}  (costeo: ${r.estructura || '—'})`);

await pool.end();
process.exit(0);
