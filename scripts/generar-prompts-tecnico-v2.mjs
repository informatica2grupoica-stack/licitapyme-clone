// Genera app/lib/auditor-tecnico-v2-prompts.ts a partir de docs/PROMPT_4_Verificador_Tecnico_v2_0.md (PROMPT 4 v2.0,
// verificador técnico del AUDITOR). Los prompts se copian TAL CUAL del .md (no se retipean): si cambia el .md se vuelve
// a correr este script. Uso: node scripts/generar-prompts-tecnico-v2.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const md = readFileSync('docs/PROMPT_4_Verificador_Tecnico_v2_0.md', 'utf8').replace(/\r\n/g, '\n');
const bloques = {};
let parte = null;
const lineas = md.split('\n');
for (let i = 0; i < lineas.length; i++) {
  const h = lineas[i].match(/^# PARTE ([IVX]+) /);
  if (h) parte = h[1];
  if (parte && lineas[i].startsWith('```') && !bloques[parte]) {
    const fin = lineas.findIndex((l, j) => j > i && l.startsWith('```'));
    bloques[parte] = lineas.slice(i + 1, fin).join('\n');
    i = fin;
  }
}
const esperadas = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XII'];
for (const p of esperadas) if (!bloques[p]) throw new Error(`Falta el bloque de la PARTE ${p}`);

const BS = String.fromCharCode(92);
const esc = s => s.split(BS).join(BS + BS).split('`').join(BS + '`').split('${').join(BS + '${');
let out = `// app/lib/auditor-tecnico-v2-prompts.ts
// GENERADO por scripts/generar-prompts-tecnico-v2.mjs desde docs/PROMPT_4_Verificador_Tecnico_v2_0.md
// (PROMPT 4 v2.0 — AUDITOR · Verificador técnico). NO EDITAR A MANO: se edita el .md y se vuelve a generar.
// Cada constante es el bloque de código de esa PARTE, sin tocar.
`;
for (const p of esperadas) out += `\nexport const PARTE_${p} = \`${esc(bloques[p])}\`;\n`;
writeFileSync('app/lib/auditor-tecnico-v2-prompts.ts', out);
console.log('OK', esperadas.map(p => `${p}:${bloques[p].length}`).join(' '));
