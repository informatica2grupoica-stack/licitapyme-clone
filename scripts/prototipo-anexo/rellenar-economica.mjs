// Prototipo Frente E, paso 3 — cierra el círculo: toma el JSON de "campos faltantes" que
// detectó el paso anterior, simula que un humano completó 2 productos a mano (lo que haría la
// futura pantalla de inputs), y los escribe en el documento real usando el MISMO mecanismo ya
// probado (insertar <w:r> en el <w:p> vacío exacto). Verifica que el conteo de párrafos no cambie.
import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'fs';

const RUTA_ORIGEN = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/41955866-1828-496c-b110-04eb2062688d/scratchpad/anexo-test/ANEXOS_relleno.docx'; // sobre el que YA tiene la identidad rellena
const RUTA_SALIDA = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/41955866-1828-496c-b110-04eb2062688d/scratchpad/anexo-test/ANEXOS_relleno_v2.docx';
const RUTA_JSON = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/41955866-1828-496c-b110-04eb2062688d/scratchpad/anexo-test/campos-faltantes.json';

function xmlEscape(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function rellenarParrafo(xml, paraId, valor) {
  const re = new RegExp(`(<w:p [^>]*w14:paraId="${paraId}"[^>]*>)([\\s\\S]*?)(</w:p>)`);
  const m = xml.match(re);
  if (!m) throw new Error(`No se encontró el párrafo w14:paraId="${paraId}"`);
  const [, apertura, cuerpo, cierre] = m;
  if (/<w:r[ >]/.test(cuerpo)) throw new Error(`El párrafo ${paraId} ya tiene contenido`);
  const rPrMatch = cuerpo.match(/<w:pPr>[\s\S]*?(<w:rPr>[\s\S]*?<\/w:rPr>)[\s\S]*?<\/w:pPr>/);
  const rPr = rPrMatch ? rPrMatch[1] : '';
  const run = `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(valor)}</w:t></w:r>`;
  return xml.slice(0, m.index) + apertura + cuerpo + run + cierre + xml.slice(m.index + m[0].length);
}

async function main() {
  const productos = JSON.parse(readFileSync(RUTA_JSON, 'utf8'));

  // Simulación de "lo que el humano escribió en la pantalla de completar a mano":
  const respuestasHumanas = {
    'Rastrillo mango de madera': { valor_unitario: '4990', valor_neto: '49900', valor_iva_incluido: '59381' },
    'Escobas': { valor_unitario: '2490', valor_neto: '622500', valor_iva_incluido: '740775' },
  };

  const buf = readFileSync(RUTA_ORIGEN);
  const zip = await JSZip.loadAsync(buf);
  let xml = await zip.file('word/document.xml').async('string');
  const parrafosAntes = (xml.match(/<w:p /g) || []).length;

  let escritos = 0;
  for (const p of productos) {
    const resp = respuestasHumanas[p.producto];
    if (!resp) continue;
    for (const c of p.campos) {
      if (resp[c.campo] == null) continue;
      console.log(`"${p.producto}" · ${c.campo} → ${resp[c.campo]}`);
      xml = rellenarParrafo(xml, c.paraId, resp[c.campo]);
      escritos++;
    }
  }

  const parrafosDespues = (xml.match(/<w:p /g) || []).length;
  console.log(`\n${escritos} celdas escritas · párrafos antes ${parrafosAntes} → después ${parrafosDespues} · ${parrafosAntes === parrafosDespues ? '✅ IGUAL' : '❌ CAMBIÓ'}`);

  zip.file('word/document.xml', xml);
  const salida = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(RUTA_SALIDA, salida);
  console.log('Guardado en', RUTA_SALIDA);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
