// Genera app/lib/auditor-comparador-v3-prompts.ts a partir de docs/PROMPT_4_Comparador_Tecnico_v3_0.md (PROMPT 4 v3.0, comparador técnico del
// AUDITOR, versión simplificada del 30-09-2026). El prompt y el esquema JSON se copian TAL CUAL del .md (no se retipean): si cambia el .md se
// vuelve a correr este script. Uso: node scripts/generar-prompts-comparador-v3.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const md = readFileSync('docs/PROMPT_4_Comparador_Tecnico_v3_0.md', 'utf8').replace(/\r\n/g, '\n');
const bloque = (titulo) => {
  const i = md.indexOf(titulo);
  if (i < 0) throw new Error(`Falta la sección «${titulo}»`);
  const a = md.indexOf('```', i), b = md.indexOf('```', a + 3);
  const cuerpo = md.slice(md.indexOf('\n', a) + 1, b).trimEnd();
  if (!cuerpo) throw new Error(`Bloque vacío en «${titulo}»`);
  return cuerpo;
};
const prompt = bloque('\n## PROMPT'), esquema = bloque('\n## ESQUEMA JSON');
const BS = String.fromCharCode(92);
const esc = s => s.split(BS).join(BS + BS).split('`').join(BS + '`').split('${').join(BS + '${');
const out = `// app/lib/auditor-comparador-v3-prompts.ts
// GENERADO por scripts/generar-prompts-comparador-v3.mjs desde docs/PROMPT_4_Comparador_Tecnico_v3_0.md
// (PROMPT 4 — AUDITOR · Comparador técnico, v3.0). NO EDITAR A MANO: se edita el .md y se vuelve a generar.

export const PROMPT_V3 = \`${esc(prompt)}\`;

export const ESQUEMA_V3 = \`${esc(esquema)}\`;
`;
writeFileSync('app/lib/auditor-comparador-v3-prompts.ts', out);
console.log('OK', 'prompt', prompt.length, 'esquema', esquema.length);
