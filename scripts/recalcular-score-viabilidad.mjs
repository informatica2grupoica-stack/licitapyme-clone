// Recalcula score_total/semaforo de TODAS las viabilidades desde el _informe_ia ya
// guardado, aplicando la lógica corregida de derivarSemaforo (los bloqueantes ya NO
// craterean el score por su sola presencia). NO llama a Gemini: solo re-deriva de datos
// que ya están en la BD. Así se arreglan de inmediato las licitaciones ya analizadas.
//
// Uso:
//   node scripts/recalcular-score-viabilidad.mjs            (DRY-RUN)
//   node scripts/recalcular-score-viabilidad.mjs --aplicar   (escribe en la BD)
import fs from 'fs';
import mysql from 'mysql2/promise';

const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const APLICAR = process.argv.includes('--aplicar');
const pool = mysql.createPool({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306'), connectTimeout: 20000 });

// Réplica EXACTA de la nueva derivarSemaforo (app/lib/viabilidad-ia.ts).
function derivar(ia) {
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
  let score = clamp(((ia.capa_a?.score_total || 0) / 15) * 100);
  const ganaNo = (ia.veredicto?.gana_probable || '').toLowerCase() === 'no';
  const gateDuro = !!ia.exclusion?.excluido || ia.presupuesto?.gate === 'NO_CALIFICA' || (ia.veredicto?.nivel || '').toUpperCase() === 'DESCARTE';
  if (gateDuro) score = Math.min(score, 19);
  else if (ia.presupuesto?.gate === 'DESCARTE_CONDICIONAL' || ganaNo) score = Math.min(score, 39);
  const semaforo = score >= 80 ? 'VERDE' : score >= 60 ? 'AMARILLO' : score >= 40 ? 'NARANJA' : score >= 20 ? 'ROJO' : 'ROJO_DURO';
  return { score, semaforo };
}

try {
  const [rows] = await pool.query(`SELECT licitacion_codigo, score_total, semaforo, informe_ejecutivo FROM viabilidad_licitacion`);
  const cambios = [];
  const distAntes = {}, distDespues = {};
  for (const r of rows) {
    let ie; try { ie = typeof r.informe_ejecutivo === 'string' ? JSON.parse(r.informe_ejecutivo) : r.informe_ejecutivo; } catch { continue; }
    const ia = ie?._informe_ia; if (!ia) continue;
    const antes = Number(r.score_total) || 0;
    const { score, semaforo } = derivar(ia);
    distAntes[bucket(antes)] = (distAntes[bucket(antes)] || 0) + 1;
    distDespues[bucket(score)] = (distDespues[bucket(score)] || 0) + 1;
    if (score !== antes || semaforo !== r.semaforo) {
      cambios.push({ codigo: r.licitacion_codigo, antes, despues: score, sem: semaforo, ie, ia, capaA: ia.capa_a?.score_total, gana: ia.veredicto?.gana_probable, nivel: ia.veredicto?.nivel, nBloq: (ia.capa_c_admisibilidad?.bloqueantes || []).length });
    }
  }

  function bucket(s){ return s>=80?'VERDE(80+)':s>=60?'AMARILLO(60-79)':s>=40?'NARANJA(40-59)':s>=20?'ROJO(20-39)':'ROJO_DURO(<20)'; }

  console.log(`\n=== ${rows.length} filas · ${cambios.length} cambian de score/semáforo ===`);
  console.log('Distribución ANTES:  ', distAntes);
  console.log('Distribución DESPUÉS:', distDespues);
  console.log('\nEjemplos (los que más suben):');
  cambios.sort((a,b)=>(b.despues-b.antes)-(a.despues-a.antes)).slice(0,20)
    .forEach(c => console.log(`  ${c.codigo.padEnd(16)} ${String(c.antes).padStart(3)} → ${String(c.despues).padStart(3)}  [${c.sem}]  capaA ${c.capaA}/15 · ${c.nivel}/${c.gana} · ${c.nBloq} bloq`));

  if (!APLICAR) {
    console.log(`\nDRY-RUN. Para escribir en la BD: node scripts/recalcular-score-viabilidad.mjs --aplicar\n`);
  } else {
    for (const c of cambios) {
      c.ia.score_0_100 = c.despues; c.ia.semaforo = c.sem;   // sincroniza el JSON con las columnas
      await pool.query(
        `UPDATE viabilidad_licitacion SET informe_ejecutivo = ?, score_total = ?, semaforo = ? WHERE licitacion_codigo = ?`,
        [JSON.stringify(c.ie), c.despues, c.sem, c.codigo]);
    }
    console.log(`\n✅ Actualizadas ${cambios.length} viabilidades.\n`);
  }
} catch (e) { console.error('\nERROR:', e.message, '\n'); process.exitCode = 1; }
finally { await pool.end(); }
