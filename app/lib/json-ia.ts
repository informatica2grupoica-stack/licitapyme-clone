// app/lib/json-ia.ts
// Parseo TOLERANTE de JSON generado por LLM. Los modelos (GLM/DeepSeek/Gemini) a veces
// devuelven JSON con problemas que rompen JSON.parse:
//   1. Caracteres de control LITERALES dentro de strings (saltos de línea/tabs sin escapar)
//      → "Bad control character in string literal" (el error que tumbó la clasificación).
//   2. Vienen envueltos en ```json ... ``` o con texto antes/después.
//   3. Truncados por límite de tokens (finish=length): faltan llaves/corchetes de cierre.
// Este módulo centraliza el saneo para que TODA la cadena (clasificación, análisis,
// viabilidad, prefiltro) parse de forma robusta y NUNCA falle por estos motivos.

// Reemplaza los caracteres de control ilegales (código < 32) que aparecen crudos:
// tab(9)/newline(10)/CR(13) → espacio (whitespace válido para JSON y aceptable dentro de
// strings); el resto se elimina. NO toca escapes válidos (\n, \t son 2 chars: '\' + 'n').
// Implementado con charCodeAt (sin regex de control-chars) para máxima portabilidad.
export function sanearControlChars(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 32) { out += s[i]; continue; }
    if (code === 9 || code === 10 || code === 13) out += ' ';
    // otros control chars (0-8, 11, 12, 14-31) → se descartan
  }
  return out;
}

// Cierra llaves/corchetes abiertos de un JSON truncado (respeta strings y escapes).
export function repararJSONTruncado(s: string): string {
  let t = s.trimEnd();
  t = t.replace(/,\s*$/, '');
  t = t.replace(/:\s*"[^"]*$/, ': null');                 // string sin cerrar al final
  t = t.replace(/:\s*(nul?l?|tru?e?|fals?e?)\s*$/, ': null');
  t = t.replace(/:\s*\d+\.?\d*\s*$/, ': null');
  // Clave colgante al final (`{"id":` o `,"id":`) sin valor → descartar ese par incompleto.
  t = t.replace(/([{,])\s*"[^"]*"\s*:\s*$/, '$1');
  t = t.replace(/,\s*$/, '');                              // coma que pudo quedar tras el descarte
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const c of t) {
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if ((c === '}' || c === ']') && stack.length) stack.pop();
  }
  return t + stack.reverse().join('');
}

// Parseo tolerante en cascada. Devuelve el objeto o null (nunca lanza).
//   1) Directo (quitando ```fences``` y recortando al {…} exterior).
//   2) Saneando caracteres de control.
//   3) Reparando truncado + saneando.
export function parseJsonIA<T = any>(raw: string | null | undefined): T | null {
  if (raw == null) return null;
  const limpio = String(raw).trim()
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '');

  const tryParse = (x: string): T | null => {
    try { const p = JSON.parse(x); return (p && typeof p === 'object') ? (p as T) : null; }
    catch { return null; }
  };

  // 1) La cadena completa (soporta tanto objeto {…} como array […] top-level).
  let r = tryParse(limpio) ?? tryParse(sanearControlChars(limpio));
  if (r) return r;

  // 2) Recorte al bloque JSON exterior (el que abra primero), sea { o [.
  const firsts = [limpio.indexOf('{'), limpio.indexOf('[')].filter((i) => i >= 0);
  if (!firsts.length) return null;
  const start = Math.min(...firsts);
  const end = Math.max(limpio.lastIndexOf('}'), limpio.lastIndexOf(']'));
  // Si hay cierre, recortamos; si NO hay ningún cierre (truncado duro), usamos desde el inicio
  // del bloque para que el reparador cierre las estructuras.
  const cand = end > start ? limpio.slice(start, end + 1) : limpio.slice(start);

  return tryParse(cand)
      ?? tryParse(sanearControlChars(cand))
      // 3) Reparar truncado (cierra estructuras abiertas) + sanear.
      ?? tryParse(sanearControlChars(repararJSONTruncado(limpio.slice(start))));
}
