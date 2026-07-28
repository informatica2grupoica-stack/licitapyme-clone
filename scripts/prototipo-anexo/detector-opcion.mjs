// Prototipo Frente E, paso 7 — tercer patrón: blancos de OPCIÓN (marcar uno de dos), no un
// dato a escribir. Ejemplo real: "...es ____ / no es ____ cónyuge o pariente...". Acá NO hay
// un valor "correcto" que el sistema pueda sacar de la base de datos — es una declaración
// jurada, y el principio del plan es tajante: "el sistema propone, el humano confirma antes
// de comprometer". Por eso este patrón queda SIEMPRE en categoría B (requiere selección
// humana), nunca se autocompleta solo. Lo que sí se prueba acá es la parte mecánica: que el
// sistema SEPA marcar la opción correcta una vez que una persona la eligió, sin tocar la otra
// ni mover el resto de la oración.
import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'fs';

const RUTA_ORIGEN = process.argv[2];
const RUTA_SALIDA = process.argv[3];
if (!RUTA_ORIGEN || !RUTA_SALIDA) { console.error('Uso: node detector-opcion.mjs <origen.docx> <salida.docx>'); process.exit(1); }

// Detecta el patrón "A ____ / B ____" (dos blancos separados por una barra "/", cada uno
// precedido de una palabra corta tipo "es"/"no es") DENTRO de un mismo run de texto.
const RE_OPCION = /([A-Za-zÀ-ÿ\s]{1,15})_{3,}\s*\/\s*([A-Za-zÀ-ÿ\s]{1,15})_{3,}/;

async function main() {
  const buf = readFileSync(RUTA_ORIGEN);
  const zip = await JSZip.loadAsync(buf);
  let xml = await zip.file('word/document.xml').async('string');
  const parrafosAntes = (xml.match(/<w:p /g) || []).length;

  const runs = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)];
  let encontrado = null;
  for (const m of runs) {
    const match = m[1].match(RE_OPCION);
    if (match) { encontrado = { runXml: m[0], texto: m[1], match }; break; }
  }
  if (!encontrado) { console.log('No se encontró el patrón de opción en este documento.'); return; }

  console.log('Patrón encontrado:', JSON.stringify(encontrado.match[0]));
  console.log(`  Opción 1: "${encontrado.match[1].trim()}"`);
  console.log(`  Opción 2: "${encontrado.match[2].trim()}"`);
  console.log('→ Categoría B: NO se autocompleta. Simulando que un humano confirmó la opción 2 ("no es").');

  // Marca SOLO el segundo blanco con "X", deja el primero como estaba (sin marcar).
  const textoOriginal = encontrado.texto;
  const idxSegundoBlanco = textoOriginal.indexOf(encontrado.match[0]) + encontrado.match[0].lastIndexOf('_'.repeat(1));
  // Ubicación exacta: la 2ª corrida de guiones bajos dentro del match completo.
  const corridas = [...encontrado.match[0].matchAll(/_{3,}/g)];
  const segunda = corridas[1];
  const posAbsoluta = textoOriginal.indexOf(encontrado.match[0]) + segunda.index;
  const textoNuevo = textoOriginal.slice(0, posAbsoluta) + 'X' + textoOriginal.slice(posAbsoluta + segunda[0].length);

  const runNuevo = encontrado.runXml.replace(/<w:t([^>]*)>([^<]*)<\/w:t>/, (_, attrs) =>
    `<w:t${attrs} xml:space="preserve">${textoNuevo.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</w:t>`);
  xml = xml.replace(encontrado.runXml, runNuevo);

  const parrafosDespues = (xml.match(/<w:p /g) || []).length;
  console.log(`\nResultado: "...${textoNuevo.slice(Math.max(0, posAbsoluta - 60), posAbsoluta + 40)}..."`);
  console.log(`Párrafos antes ${parrafosAntes} → después ${parrafosDespues} · ${parrafosAntes === parrafosDespues ? '✅ IGUAL' : '❌ CAMBIÓ'}`);

  zip.file('word/document.xml', xml);
  const salida = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(RUTA_SALIDA, salida);
  console.log('Guardado en', RUTA_SALIDA);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
