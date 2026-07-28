import { readFileSync } from 'fs';
import { abrirDocx } from '../../app/lib/anexos-docx';
import { analizarAnexo } from '../../app/lib/anexos-detectar';

const DIR = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/41955866-1828-496c-b110-04eb2062688d/scratchpad/anexo-test/';
const archivos = ['ANEXOS.docx', 'ANEXO2.docx', 'ANEXO3_normalizado.docx', 'ANEXO4.docx'];

for (const nombre of archivos) {
  const { xml } = await abrirDocx(readFileSync(DIR + nombre));
  const r = analizarAnexo(xml);
  console.log(`\n=== ${nombre} ===`);
  console.log(`párrafos: ${r.parrafos.length} · candidatos celda: ${r.candidatosCelda.length} (antes de acotar por sección: sin acotar no se sabe, ver secciones) · blancos inline: ${r.blancosInline.length}`);
  console.log(`secciones detectadas: ${r.secciones.length}`);
  r.secciones.forEach(s => console.log(`  [${s.indiceInicio}-${s.indiceFin}] ${s.tipo} → ${s.decision} :: "${s.textoEncabezado}"`));
}

// Verificación extra: confirmar que el acotamiento por sección funciona de verdad.
import { detectarCandidatosCelda, detectarSecciones } from '../../app/lib/anexos-detectar';
import { listarParrafos } from '../../app/lib/anexos-docx';
const { xml: xmlUno } = await abrirDocx(readFileSync(DIR + 'ANEXOS.docx'));
const parrafosUno = listarParrafos(xmlUno);
const secciones = detectarSecciones(parrafosUno);
const crudos = detectarCandidatosCelda(parrafosUno);
console.log(`\n=== Verificación de acotamiento (ANEXOS.docx) ===`);
console.log(`Candidatos SIN acotar: ${crudos.length} · etiquetas de ejemplo:`, crudos.slice(0, 3).map(c => c.etiqueta));
const razonSocialCrudo = crudos.filter(c => /raz[óo]n social/i.test(c.etiqueta));
console.log(`Cuántas veces aparece "Razón social" sin acotar: ${razonSocialCrudo.length} (una por cada sección jurídica repetida en el doc)`);
