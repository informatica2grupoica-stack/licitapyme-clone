// Verifica que gemini-flash-latest (y 2.5-flash) leen PDF por visión (inlineData).
// Crea un PDF con texto, lo manda como documento y comprueba que lo extrae.
// Uso: node scripts/diag-gemini-vision.mjs
import { readFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const apiKey = env.GEMINI_API_KEY;

// PDF de prueba con una frase única
const FRASE = 'PRESUPUESTO MAXIMO: 47.350.000 pesos. Criterio precio 80 por ciento.';
const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText(FRASE, { x: 50, y: 760, size: 16, font });
const base64 = Buffer.from(await pdf.save()).toString('base64');

const body = JSON.stringify({
  contents: [{ parts: [
    { text: 'Extrae TODO el texto de este PDF tal como aparece. Devuelve solo el texto.' },
    { inlineData: { mimeType: 'application/pdf', data: base64 } },
  ] }],
  generationConfig: { temperature: 0 },
});

for (const model of ['gemini-flash-latest', 'gemini-2.5-flash']) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) { console.log(`  ${model.padEnd(22)} HTTP ${res.status} — ${(await res.text()).slice(0, 120)}`); continue; }
    const d = await res.json();
    const txt = (d.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
    const leyo = txt.includes('47.350.000') || txt.toLowerCase().includes('presupuesto');
    console.log(`  ${model.padEnd(22)} ${leyo ? '✅ LEYÓ el PDF' : '❌ no leyó'} → "${txt.slice(0, 80).replace(/\n/g, ' ')}"`);
  } catch (e) { console.log(`  ${model.padEnd(22)} ⚠ ${e.message}`); }
}
console.log('');
