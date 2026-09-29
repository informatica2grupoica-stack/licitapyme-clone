// Genera app/lib/auditor-lector-prompts.ts a partir de docs/PROMPT_6_Lector_Respaldos_v1_0.md.
// Los prompts se copian TAL CUAL del .md (no se retipean): si cambia el .md, se vuelve a correr este
// script. Uso: node scripts/generar-prompts-lector.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const md = readFileSync('docs/PROMPT_6_Lector_Respaldos_v1_0.md', 'utf8').replace(/\r\n/g, '\n');
const bloques = {}; // parte → [bloques de código]
let parte = null;
const lineas = md.split('\n');
for (let i = 0; i < lineas.length; i++) {
  const h = lineas[i].match(/^# PARTE ([IVX]+) /);
  if (h) parte = h[1];
  const sub = lineas[i].match(/^## V\.(\d) /);
  if (sub) parte = `V${sub[1]}`;
  if (parte && lineas[i].startsWith('```')) {
    const fin = lineas.findIndex((l, j) => j > i && l.startsWith('```'));
    (bloques[parte] ||= []).push(lineas.slice(i + 1, fin).join('\n'));
    i = fin;
  }
}
const necesarias = { I: 1, II: 1, III: 1, IV: 1, V1: 1, V2: 1, VI: 1 };
for (const [p, n] of Object.entries(necesarias)) if ((bloques[p] || []).length < n) throw new Error(`Falta el bloque de la PARTE ${p}`);

const BS = String.fromCharCode(92);
const esc = s => s.split(BS).join(BS + BS).split('`').join(BS + '`').split('${').join(BS + '${');
let out = `// app/lib/auditor-lector-prompts.ts
// GENERADO por scripts/generar-prompts-lector.mjs desde docs/PROMPT_6_Lector_Respaldos_v1_0.md
// (PROMPT 6 — AUDITOR · Lector de Respaldos, v1.0). NO EDITAR A MANO: se edita el .md y se vuelve a
// generar. Cada constante es el bloque de código de esa PARTE, sin tocar.
`;
const nombres = { I: 'PARTE_I', II: 'PARTE_II', III: 'PARTE_III', IV: 'PARTE_IV', V1: 'JSON_COMPLETO_COMERCIAL', V2: 'JSON_DIRIGIDO', VI: 'PARTE_VI' };
for (const [p, nombre] of Object.entries(nombres)) out += `\nexport const ${nombre} = \`${esc(bloques[p][0])}\`;\n`;
writeFileSync('app/lib/auditor-lector-prompts.ts', out);
console.log('OK', Object.entries(nombres).map(([p, n]) => `${n}:${bloques[p][0].length}`).join(' '));
