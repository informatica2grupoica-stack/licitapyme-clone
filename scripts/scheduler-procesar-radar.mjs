// scripts/scheduler-procesar-radar.mjs
// Scheduler del NOTEBOOK (IP chilena) que automatiza el flujo prefiltro → descarga.
// Golpea en bucle el endpoint /api/cron/procesar-radar: cada corrida prefiltra un lote
// de radar sin decisión y descarga documentos de las que pasaron (PASA/REVISION_HUMANA)
// y no tienen docs, disparando el pipeline IA. Resumible e idempotente.
//
// Uso (en el notebook, con la app corriendo en localhost):
//   node scripts/scheduler-procesar-radar.mjs                 # bucle infinito, 5 min entre corridas
//   node scripts/scheduler-procesar-radar.mjs --once          # una sola corrida (para cron del SO)
//   node scripts/scheduler-procesar-radar.mjs --intervalo=180 # 3 min entre corridas
//   node scripts/scheduler-procesar-radar.mjs --loteDescarga=5 --lotePrefiltro=60
//   node scripts/scheduler-procesar-radar.mjs --base=http://localhost:3000
//
// Lee CRON_SECRET (y PORT opcional) de .env.local. Requiere Node 18+ (fetch global).

import { readFileSync } from 'node:fs';

const env = {};
try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
} catch { /* sin .env.local → usa process.env */ }

const arg = (name, def) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

const SECRET        = env.CRON_SECRET || process.env.CRON_SECRET || '';
const PORT          = env.PORT || process.env.PORT || '3000';
const BASE          = arg('base', `http://localhost:${PORT}`);
const INTERVALO_MS  = Math.max(30, parseInt(arg('intervalo', '300'), 10)) * 1000;
const LOTE_PREF     = parseInt(arg('lotePrefiltro', '30'), 10);
const LOTE_DESC     = parseInt(arg('loteDescarga', '3'), 10);
const ONCE          = flag('once');

if (!SECRET) {
  console.error('❌ Falta CRON_SECRET (en .env.local o entorno). Aborto.');
  process.exit(1);
}

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function unaCorrida() {
  const url = `${BASE}/api/cron/procesar-radar`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': SECRET },
      body: JSON.stringify({ lotePrefiltro: LOTE_PREF, loteDescarga: LOTE_DESC }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 409) { console.log(`[${ts()}] ⏳ otra corrida en progreso (lock), salto.`); return { pendientes: null }; }
    if (!res.ok) { console.error(`[${ts()}] ❌ HTTP ${res.status}: ${data.error || 'error'}`); return { pendientes: null }; }

    const p = data.prefiltro || {}, d = data.descarga || {}, pend = data.pendientes || {};
    console.log(
      `[${ts()}] prefiltro: ${p.procesadas || 0} (${p.pasa || 0} PASA/${p.revision || 0} REV/${p.excluido || 0} EXCL) · ` +
      `descarga: ${d.exito || 0}/${d.intentadas || 0} ok, ${d.docsNuevos || 0} docs · ` +
      `pendientes: pref=${pend.prefiltro ?? '?'} desc=${pend.descarga ?? '?'} · ${data.duracionMs || 0}ms`,
    );
    return { pendientes: pend };
  } catch (e) {
    console.error(`[${ts()}] ❌ excepción: ${String(e.message || e)}`);
    return { pendientes: null };
  }
}

console.log(`▶ scheduler-procesar-radar · base=${BASE} · intervalo=${INTERVALO_MS / 1000}s · lotePref=${LOTE_PREF} loteDesc=${LOTE_DESC}${ONCE ? ' · ONCE' : ''}`);

if (ONCE) {
  await unaCorrida();
  process.exit(0);
}

// Bucle infinito. Ctrl+C para detener.
for (;;) {
  await unaCorrida();
  await sleep(INTERVALO_MS);
}
