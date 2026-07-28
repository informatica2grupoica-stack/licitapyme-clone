// Prototipo Frente E — relleno real de un anexo .docx ya descargado, sin alterar su formato.
// Estrategia confirmada mirando el XML real: cada campo es una fila de tabla de 2 columnas —
// celda izquierda = etiqueta ("Razón social"), celda derecha = un <w:p> vacío (mismo w14:paraId
// siempre) sin ningún <w:r> adentro. Rellenar = insertar un <w:r><w:t> DENTRO de ese <w:p> ya
// existente — nunca se agrega ni se quita un párrafo, así el conteo de párrafos no cambia
// (la regla crítica del plan: "mismo conteo de párrafos original vs. relleno").
import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'fs';

const RUTA_ORIGEN = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/41955866-1828-496c-b110-04eb2062688d/scratchpad/anexo-test/ANEXOS.docx';
const RUTA_SALIDA = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/41955866-1828-496c-b110-04eb2062688d/scratchpad/anexo-test/ANEXOS_relleno.docx';

// Escapa texto para insertarlo como contenido de <w:t> (XML-safe).
function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Inserta un <w:r> con el valor DENTRO del <w:p> identificado por su w14:paraId, justo antes
// del </w:p> de cierre (después de </w:pPr> si la trae, para heredar el mismo estilo/rPr del
// párrafo vacío). Falla explícito si el párrafo ya tenía un <w:r> (evita pisar un dato real).
function rellenarParrafo(xml, paraId, valor) {
  const re = new RegExp(`(<w:p [^>]*w14:paraId="${paraId}"[^>]*>)([\\s\\S]*?)(</w:p>)`);
  const m = xml.match(re);
  if (!m) throw new Error(`No se encontró el párrafo w14:paraId="${paraId}"`);
  const [, apertura, cuerpo, cierre] = m;
  if (/<w:r[ >]/.test(cuerpo)) throw new Error(`El párrafo ${paraId} ya tiene contenido — no se pisa`);
  // Reutiliza el rPr del párrafo (si trae uno en w:pPr) para que el texto salga con la MISMA
  // fuente/tamaño que el resto del formulario, no con el estilo por defecto de Word.
  const rPrMatch = cuerpo.match(/<w:pPr>[\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:pPr>/);
  const rPr = rPrMatch ? rPrMatch[1] : '';
  const run = `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(valor)}</w:t></w:r>`;
  const nuevoCuerpo = cuerpo + run;
  return xml.slice(0, m.index) + apertura + nuevoCuerpo + cierre + xml.slice(m.index + m[0].length);
}

async function main() {
  const buf = readFileSync(RUTA_ORIGEN);
  const zip = await JSZip.loadAsync(buf);
  let xml = await zip.file('word/document.xml').async('string');

  const parrafosAntes = (xml.match(/<w:p /g) || []).length;

  // Campos detectados a mano en la exploración previa (ANEXO N°1b — Persona jurídica):
  // etiqueta → w14:paraId del párrafo vacío INMEDIATAMENTE siguiente (la celda de al lado).
  const campos = [
    { paraId: '435B8210', etiqueta: 'Razón social',         valor: 'Comercial MP SpA' },
    { paraId: '3F619195', etiqueta: 'Rol Único Tributario',  valor: '78.388.175-6' },
    { paraId: '11D11082', etiqueta: 'Dirección',             valor: 'Camino El Oliveto N° 575 N° 6, Talagante' },
  ];

  for (const c of campos) {
    console.log(`Rellenando "${c.etiqueta}" (${c.paraId}) → "${c.valor}"`);
    xml = rellenarParrafo(xml, c.paraId, c.valor);
  }

  const parrafosDespues = (xml.match(/<w:p /g) || []).length;
  console.log(`Párrafos antes: ${parrafosAntes} · después: ${parrafosDespues} · ${parrafosAntes === parrafosDespues ? '✅ IGUAL (formato intacto)' : '❌ CAMBIÓ — algo se rompió'}`);

  zip.file('word/document.xml', xml);
  const salida = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(RUTA_SALIDA, salida);
  console.log('Guardado en', RUTA_SALIDA);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
