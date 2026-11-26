// Multiempresa: el gasto del OCR (GLM-OCR y el respaldo con Gemini) tiene que quedar en ia_uso, módulo «ocr» (2026-11-26).
// Antes era invisible: solo crearChatIA registraba uso. Este test falla si alguno de los dos puntos deja de registrarlo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULOS_IA } from '../ia-uso';

const leer = (f: string) => readFileSync(join(process.cwd(), 'app', 'lib', f), 'utf8');

test('el módulo «ocr» existe en el panel de gasto de IA', () => {
  assert.ok('ocr' in MODULOS_IA);
});

test('GLM-OCR registra su gasto (ocr.glm)', () => {
  const s = leer('zai-ocr.ts');
  assert.match(s, /registrarUsoIA\(\{[^}]*etiqueta:\s*'ocr\.glm'/);
});

test('el OCR de respaldo con Gemini registra su gasto (ocr.gemini)', () => {
  const s = leer('gemini.ts');
  assert.match(s, /registrarUsoIA\(\{[^}]*etiqueta:\s*'ocr\.gemini'/);
});
