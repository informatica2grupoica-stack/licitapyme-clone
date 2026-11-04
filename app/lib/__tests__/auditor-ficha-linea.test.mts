// Auditor: una ficha subida a una LÍNEA tiene que ser de lo que esa línea pide (probado con 5 fichas puestas a propósito en la línea equivocada, negocio 296).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../auditor-opciones.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../../negocios/[id]/AuditorOpcionesPanel.tsx', import.meta.url), 'utf8');

test('agregarFichaAOpcion frena la ficha que no es de la línea elegida y se puede forzar', () => {
  const f = src.slice(src.indexOf('export async function agregarFichaAOpcion'), src.indexOf('export async function quitarFichaDeOpcion'));
  assert.match(f, /if \(!opcion && !forzar\)/);
  assert.match(f, /fichaNoEsDeLaLinea\(elegido, lineaElegida, lineasAud\)/);
  assert.match(f, /estado: 'linea_distinta'/);
});
test('la verificación usa primero las palabras (puntuar ≥ 0,5) y la IA solo si no alcanzan; sin IA no bloquea', () => {
  const f = src.slice(src.indexOf('async function fichaNoEsDeLaLinea'), src.indexOf('export type ResultadoFicha'));
  assert.match(f, /puntuar\(p, linea\)\.puntaje >= 0\.5\) return null/);
  assert.match(f, /sugerirLineas\(/);
  assert.match(f, /catch \{ return null; \}/);
});
test('la pantalla del Auditor muestra el aviso «la ficha no parece de esta línea» con «pasarla a la línea correcta» y «usarla igual»', () => {
  assert.match(panel, /r\.estado === 'linea_distinta'/);
  assert.match(panel, /La ficha no parece de esta línea/);
  assert.match(panel, /resolverFicha\(\{ forzar: true, productoIdx/);
  assert.match(panel, /<RankingOpcionesAuditor/);
});
