// Genera app/lib/auditor-compras-prompts.ts a partir de docs/PROMPT_5_AUDITOR_COMPRAS_COTIZACIONES.md.
// El prompt del Auditor de Compras se copia TAL CUAL del .md (no se retipea): si cambia el .md, se
// vuelve a correr este script. Uso: node scripts/generar-prompts-auditor-compras.mjs
// Partes I-VII, X y XII: el bloque de código de la parte. Partes VIII y IX (matriz de bloqueo y
// posición de precio): el texto completo de la sección, porque ahí las reglas están en prosa y tablas.
import { readFileSync, writeFileSync } from 'node:fs';

const md = readFileSync('docs/PROMPT_5_AUDITOR_COMPRAS_COTIZACIONES.md', 'utf8').replace(/\r\n/g, '\n');
const lineas = md.split('\n');
const secciones = {};
let actual = null;
for (const l of lineas) {
  const h = l.match(/^# PARTE ([IVX]+) /);
  if (h) { actual = h[1]; secciones[actual] = []; continue; }
  if (/^## CONTROL DE VERSIONES/.test(l)) actual = null;
  if (actual) secciones[actual].push(l);
}
const bloqueDeCodigo = (ls) => {
  const i = ls.findIndex(l => l.startsWith('```'));
  if (i < 0) return null;
  const f = ls.findIndex((l, j) => j > i && l.startsWith('```'));
  return ls.slice(i + 1, f).join('\n');
};
const textoSeccion = (ls) => ls.join('\n').replace(/\n---\s*$/, '').trim();

const esperadas = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const TEXTO_COMPLETO = new Set(['VIII', 'IX']);
const bloques = {};
for (const p of esperadas) {
  if (!secciones[p]) throw new Error(`Falta la PARTE ${p}`);
  bloques[p] = TEXTO_COMPLETO.has(p) ? textoSeccion(secciones[p]) : bloqueDeCodigo(secciones[p]);
  if (!bloques[p]) throw new Error(`Falta el contenido de la PARTE ${p}`);
}

const BS = String.fromCharCode(92);
const esc = s => s.split(BS).join(BS + BS).split('`').join(BS + '`').split('${').join(BS + '${');
let out = `// app/lib/auditor-compras-prompts.ts
// GENERADO por scripts/generar-prompts-auditor-compras.mjs desde docs/PROMPT_5_AUDITOR_COMPRAS_COTIZACIONES.md
// (PROMPT 5 — Auditor de Compras · Verificador de cotizaciones, v1.2). NO EDITAR A MANO: se edita el
// .md y se vuelve a generar. Cada constante es el contenido de esa PARTE, sin tocar.
`;
for (const p of esperadas) out += `\nexport const PARTE_${p} = \`${esc(bloques[p])}\`;\n`;
writeFileSync('app/lib/auditor-compras-prompts.ts', out);
console.log('OK', esperadas.map(p => `${p}:${bloques[p].length}`).join(' '));
