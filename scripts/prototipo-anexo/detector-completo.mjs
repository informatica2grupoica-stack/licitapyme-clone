// Prototipo Frente E, paso 8 — pasada de detección COMPLETA (los 3 patrones a la vez, sin
// rellenar nada) sobre un documento nuevo, para medir qué tanto generaliza sin intervención
// manual. Solo lectura/reporte — no modifica el archivo.
import JSZip from 'jszip';
import { readFileSync } from 'fs';

const RUTA = process.argv[2];
if (!RUTA) { console.error('Uso: node detector-completo.mjs <ruta.docx>'); process.exit(1); }

function textoDe(cuerpo) { return [...cuerpo.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join(''); }

async function main() {
  const buf = readFileSync(RUTA);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');

  console.log(`=== ${RUTA.split('/').pop()} ===\n`);

  // ── 1) Párrafos y patrón "etiqueta corta + vacío" (celdas de tabla / campos simples) ──
  const parrafos = [...xml.matchAll(/<w:p [^>]*w14:paraId="([0-9A-F]+)"[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map(([, paraId, cuerpo]) => ({ paraId, texto: textoDe(cuerpo).trim(), vacio: !/<w:r[ >]/.test(cuerpo) }));
  console.log(`Total párrafos: ${parrafos.length}`);

  const camposTabla = [];
  for (let i = 0; i < parrafos.length - 1; i++) {
    if (parrafos[i].texto && parrafos[i].texto.length <= 60 && parrafos[i + 1].vacio) {
      camposTabla.push({ etiqueta: parrafos[i].texto, paraId: parrafos[i + 1].paraId });
    }
  }
  console.log(`\n[Patrón 1: celda vacía] ${camposTabla.length} candidatos`);
  camposTabla.slice(0, 10).forEach(c => console.log(`  "${c.etiqueta}"`));
  if (camposTabla.length > 10) console.log(`  … y ${camposTabla.length - 10} más`);

  // ── 2) Subrayados inline dentro de un mismo run ──────────────────────────────────────
  const runs = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]);
  let totalBlancosInline = 0;
  const muestraInline = [];
  for (const texto of runs) {
    const matches = [...texto.matchAll(/_{4,}/g)];
    totalBlancosInline += matches.length;
    for (const m of matches) {
      if (muestraInline.length < 10) {
        const antes = texto.slice(Math.max(0, m.index - 30), m.index);
        muestraInline.push(antes.trim());
      }
    }
  }
  console.log(`\n[Patrón 2: subrayado inline] ${totalBlancosInline} candidatos`);
  muestraInline.forEach(s => console.log(`  "...${s}"`));

  // ── 3) Secciones Persona Natural/Jurídica/UTP ────────────────────────────────────────
  const PATRONES = [
    { tipo: 'PERSONA_NATURAL', re: /persona\s+natural/i },
    { tipo: 'PERSONA_JURIDICA', re: /persona\s+jur[íi]dica/i },
    { tipo: 'UTP', re: /uni[óo]n\s+temporal\s+de\s+proveedores/i },
  ];
  const encabezados = [];
  parrafos.forEach((p, idx) => {
    if (p.texto.length > 80) return;
    for (const pat of PATRONES) if (pat.re.test(p.texto)) { encabezados.push({ idx, tipo: pat.tipo, texto: p.texto }); break; }
  });
  console.log(`\n[Patrón 3: secciones por tipo de oferente] ${encabezados.length} encabezados`);
  encabezados.forEach(h => console.log(`  [párrafo ${h.idx}] ${h.tipo}: "${h.texto}"`));
  if (!encabezados.length) console.log('  (documento de un solo tipo de oferente, o sin variantes — no aplica)');

  // ── 4) Media (logos) presentes ────────────────────────────────────────────────────────
  const media = Object.keys(zip.files).filter(f => f.startsWith('word/media/'));
  console.log(`\n[Media] ${media.length} imagen(es) incrustada(s)`);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
