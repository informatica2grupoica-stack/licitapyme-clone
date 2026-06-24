// Lista los modelos disponibles para la key y prueba la fiabilidad de los candidatos
// fuertes con un request GRANDE (≈viabilidad). Solo lectura.
// Uso: node scripts/diag-gemini.mjs
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const apiKey = env.GEMINI_API_KEY;

const relleno = 'El presente documento de licitación establece las bases administrativas y técnicas. '.repeat(1800);
const bigBody = JSON.stringify({
  systemInstruction: { parts: [{ text: 'Eres un analista de licitaciones. Responde JSON.' }] },
  contents: [{ parts: [{ text: relleno + '\n\nResume en JSON {"ok":true}.' }] }],
  generationConfig: { temperature: 0.15, responseMimeType: 'application/json', maxOutputTokens: 60_000 },
});

async function probar(model) {
  const t = performance.now();
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bigBody, signal: AbortSignal.timeout(120_000) });
    const ms = Math.round(performance.now() - t);
    if (res.ok) return { ok: true, ms };
    let p; try { p = JSON.parse(await res.text()); } catch {}
    return { ok: false, ms, status: res.status + (p?.error?.status ? ' ' + p.error.status : '') };
  } catch (e) { return { ok: false, msg: e.message }; }
}

// 1) Listar modelos con generateContent
console.log('\n  ── Modelos disponibles (gemini, generateContent) ──');
try {
  const lst = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`).then(r => r.json());
  const ms = (lst.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && m.name.includes('gemini'));
  for (const m of ms) console.log(`   ${m.name.replace('models/', '').padEnd(34)} ${m.displayName || ''}`);
} catch (e) { console.log('   (no se pudo listar:', e.message, ')'); }

// 2) Fiabilidad de candidatos con request grande (4 corridas c/u)
const candidatos = ['gemini-2.5-pro', 'gemini-pro-latest', 'gemini-2.5-flash', 'gemini-flash-latest'];
console.log('\n  ── Fiabilidad con request GRANDE (4 corridas c/u) ──');
for (const model of candidatos) {
  let ok = 0; const lat = [];
  process.stdout.write(`  ${model.padEnd(22)} `);
  for (let i = 0; i < 4; i++) {
    const r = await probar(model);
    process.stdout.write(r.ok ? '✅' : '❌');
    if (r.ok) { ok++; lat.push(r.ms); }
    if (i < 3) await new Promise(r => setTimeout(r, 2500));
  }
  const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0;
  console.log(`  → ${ok}/4${avg ? '  (~' + avg + 'ms)' : ''}`);
}
console.log('');
