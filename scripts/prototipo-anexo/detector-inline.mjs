// Prototipo Frente E, paso 5 — segunda técnica: blancos tipo subrayado (____) metidos DENTRO
// de un mismo <w:t>, no como párrafo aparte. Acá no hay "celda vacía que rellenar": hay que
// partir el texto de la oración en el punto exacto de cada corrida de guiones bajos y meter
// el valor ahí, dejando el resto de la oración intacto (mismo <w:r>, mismo <w:p> — el conteo
// de párrafos NO cambia, es el mismo mecanismo de fondo, solo que editando adentro de un
// run en vez de rellenando uno vacío).
//
// Cada corrida de "___" se etiqueta con el texto que viene INMEDIATAMENTE antes (hasta la
// coma/paréntesis previos) — así "Yo___" y "RUT N°___" (que se repite dos veces en la misma
// oración: una para el representante, otra para la empresa) quedan identificados por orden
// de aparición + su contexto, no solo por el nombre del campo.
import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'fs';

const RUTA_ORIGEN = process.argv[2];
const RUTA_SALIDA = process.argv[3];
if (!RUTA_ORIGEN || !RUTA_SALIDA) { console.error('Uso: node detector-inline.mjs <origen.docx> <salida.docx>'); process.exit(1); }

const RE_BLANCO = /_{4,}/g;

// Extrae, de un fragmento de texto ANTES de un blanco, la "etiqueta" más útil: desde la
// última coma/punto/apertura de paréntesis, recortada a 40 chars.
function etiquetaDe(fragmentoPrevio) {
  const corte = fragmentoPrevio.split(/[,.;]|\(\*+\)/).pop() || fragmentoPrevio;
  return corte.trim().slice(-40);
}

async function main() {
  const buf = readFileSync(RUTA_ORIGEN);
  const zip = await JSZip.loadAsync(buf);
  let xml = await zip.file('word/document.xml').async('string');
  const parrafosAntes = (xml.match(/<w:p /g) || []).length;

  // Encuentra cada <w:t ...>contenido</w:t> que tenga al menos un blanco, y lista sus blancos
  // en orden con su etiqueta de contexto.
  const runs = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)];
  const hallazgos = [];
  runs.forEach((m, runIdx) => {
    const texto = m[1];
    if (!RE_BLANCO.test(texto)) return;
    RE_BLANCO.lastIndex = 0;
    let ultimo = 0;
    let orden = 0;
    let match;
    while ((match = RE_BLANCO.exec(texto))) {
      const etiqueta = etiquetaDe(texto.slice(ultimo, match.index));
      hallazgos.push({ runIdx, ordenEnRun: orden++, etiqueta, largoBlanco: match[0].length, posEnTexto: match.index });
      ultimo = match.index + match[0].length;
    }
  });

  console.log(`Blancos inline detectados: ${hallazgos.length}\n`);
  hallazgos.forEach(h => console.log(`  [run ${h.runIdx} · #${h.ordenEnRun}] "...${h.etiqueta}" → ____ (${h.largoBlanco} guiones)`));

  // ── Simulación de relleno (misma empresa que en los pasos 1-3) ─────────────────────────
  const respuestas = {
    Yo: 'Lidia Valenzuela',
    'N°': null, // ambiguo, se resuelve por orden abajo
  };
  // Mapa por [runIdx, ordenEnRun] → valor. Se arma a mano ahora (así funcionaría la pantalla
  // de "completar a mano": el humano ve la lista de arriba con su etiqueta de contexto y
  // escribe al lado de cada una).
  const runIdxDelSaludo = hallazgos[0]?.runIdx;
  const valoresPorOrden = {
    0: 'Lidia Valenzuela',                 // "Yo___" → nombre representante
    1: '6.736.698-0',                      // "RUT N°___" (1º) → rut representante
    2: 'sociedadcomercialmp@gmail.com',    // "correo electrónico___"
    3: 'Comercial MP SpA',                 // "la empresa (*) ___" → razón social
    4: '78.388.175-6',                     // "RUT N°___" (2º) → rut empresa
    5: 'Camino El Oliveto N° 575 N° 6, Talagante', // "domiciliados en___"
  };

  const objetivo = hallazgos.filter(h => h.runIdx === runIdxDelSaludo);
  let texto = runs[runIdxDelSaludo][1];
  // Reemplaza de ATRÁS hacia ADELANTE para que los índices de los blancos anteriores no se
  // corran al cambiar el largo del texto con cada reemplazo.
  for (let i = objetivo.length - 1; i >= 0; i--) {
    const h = objetivo[i];
    let valor = valoresPorOrden[h.ordenEnRun];
    if (valor == null) continue;
    // El texto justo antes del blanco a veces NO trae espacio ("Yo____", "en____") porque en
    // el Word original el espacio lo daba visualmente la línea de subrayado — al reemplazarla
    // por el valor real hay que devolver ese espacio a mano, o queda "YoLidia Valenzuela".
    const charPrevio = texto[h.posEnTexto - 1] || '';
    if (/[A-Za-zÀ-ÿ0-9]/.test(charPrevio)) valor = ' ' + valor;
    texto = texto.slice(0, h.posEnTexto) + valor + texto.slice(h.posEnTexto + h.largoBlanco);
  }

  // Vuelve a insertar el <w:t> modificado en el XML completo (match único por posición del run).
  const runOriginal = runs[runIdxDelSaludo][0];
  const runNuevo = runOriginal.replace(/<w:t([^>]*)>([^<]*)<\/w:t>/, (_, attrs) => `<w:t${attrs} xml:space="preserve">${texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</w:t>`);
  xml = xml.replace(runOriginal, runNuevo);

  const parrafosDespues = (xml.match(/<w:p /g) || []).length;
  console.log(`\nOración resultante:\n"${texto.slice(0, 260)}..."`);
  console.log(`\nPárrafos antes ${parrafosAntes} → después ${parrafosDespues} · ${parrafosAntes === parrafosDespues ? '✅ IGUAL' : '❌ CAMBIÓ'}`);

  zip.file('word/document.xml', xml);
  const salida = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(RUTA_SALIDA, salida);
  console.log('Guardado en', RUTA_SALIDA);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
