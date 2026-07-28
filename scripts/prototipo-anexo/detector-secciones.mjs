// Prototipo Frente E, paso 6 — categoría C del plan: "omitir sin preguntar" persona natural
// y UTP. Antes de rellenar cualquier campo hay que saber en qué SECCIÓN del documento cae,
// porque un mismo anexo puede traer las 3 variantes juntas (como ya vimos en ANEXOS.docx:
// 1a natural / 1b jurídica / 1c UTP) y las etiquetas se repiten entre secciones ("Nombre",
// "Razón social" pueden aparecer más de una vez si hay más de un anexo jurídico en el mismo
// archivo).
//
// Estrategia: ubicar los encabezados "(Persona natural)" / "(Persona jurídica)" / "(Unión
// temporal de proveedores)" EN ORDEN DE PÁRRAFO (no de texto plano, para poder acotar por
// índice de párrafo), y definir cada sección como "desde su encabezado hasta el próximo
// encabezado de cualquier tipo (o fin de documento)". Solo la sección jurídica queda
// habilitada para rellenar; las otras se marcan para saltarse.
import JSZip from 'jszip';
import { readFileSync } from 'fs';

const RUTA = process.argv[2];
if (!RUTA) { console.error('Uso: node detector-secciones.mjs <ruta.docx>'); process.exit(1); }

const PATRONES = [
  { tipo: 'PERSONA_NATURAL', re: /persona\s+natural/i, decision: 'OMITIR (categoría C)' },
  { tipo: 'PERSONA_JURIDICA', re: /persona\s+jur[íi]dica/i, decision: 'RELLENAR (somos siempre persona jurídica)' },
  { tipo: 'UTP', re: /uni[óo]n\s+temporal\s+de\s+proveedores/i, decision: 'OMITIR (categoría C — nunca UTP)' },
];

function textoDe(cuerpo) {
  return [...cuerpo.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('');
}

async function main() {
  const buf = readFileSync(RUTA);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');

  const parrafos = [...xml.matchAll(/<w:p [^>]*w14:paraId="([0-9A-F]+)"[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map(([, paraId, cuerpo]) => ({ paraId, texto: textoDe(cuerpo) }));

  // Encuentra, EN ORDEN, el índice de párrafo donde aparece cada encabezado de sección.
  // Un encabezado de sección real es un párrafo CORTO donde la frase es casi todo el
  // contenido (p.ej. "(Persona jurídica)" solo) — no una mención de paso dentro de una
  // oración larga ("...sea esta persona natural o jurídica..." es prosa, no un título).
  // Primer intento (sin este filtro) dio falsos positivos reales en el 2º documento de
  // prueba: encontró "persona natural/jurídica" dentro de notas al pie explicativas.
  const LARGO_MAX_ENCABEZADO = 80;
  const encabezados = [];
  parrafos.forEach((p, idx) => {
    if (p.texto.length > LARGO_MAX_ENCABEZADO) return;
    for (const pat of PATRONES) {
      if (pat.re.test(p.texto)) { encabezados.push({ idx, tipo: pat.tipo, decision: pat.decision, texto: p.texto.slice(0, 60) }); break; }
    }
  });

  if (!encabezados.length) {
    console.log('No se encontraron encabezados de Persona Natural/Jurídica/UTP en este documento — no aplica la regla de sección (probablemente ya es un anexo de un solo tipo, o usa otro formato de encabezado).');
    return;
  }

  console.log(`Encabezados de sección encontrados: ${encabezados.length}\n`);
  encabezados.forEach((h, i) => {
    const finIdx = encabezados[i + 1]?.idx ?? parrafos.length;
    console.log(`  [párrafo ${h.idx}] "${h.texto}" → ${h.tipo} · ${h.decision}`);
    console.log(`      sección abarca párrafos ${h.idx}..${finIdx - 1} (${finIdx - h.idx} párrafos)`);
  });

  // Verificación cruzada: confirmar que "Razón social" cae DENTRO del rango de la sección
  // jurídica y NO en las otras — si esto falla, la regla de sección está mal calculada.
  const jur = encabezados.find(h => h.tipo === 'PERSONA_JURIDICA');
  const finJur = encabezados[encabezados.indexOf(jur) + 1]?.idx ?? parrafos.length;
  const idxRazonSocial = parrafos.findIndex(p => /raz[óo]n\s+social/i.test(p.texto));
  const dentro = idxRazonSocial >= jur.idx && idxRazonSocial < finJur;
  console.log(`\nVerificación: "Razón social" está en el párrafo ${idxRazonSocial}, dentro del rango jurídica [${jur.idx}, ${finJur}) → ${dentro ? '✅ correcto' : '❌ MAL, revisar'}`);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
