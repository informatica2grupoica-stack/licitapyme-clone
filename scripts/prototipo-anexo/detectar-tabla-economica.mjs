// Prototipo Frente E, paso 2 — detectar automáticamente una TABLA (no un formulario simple de
// etiqueta+celda) dentro de un anexo real: "FORMATO N°5 OFERTA ECONÓMICA". A diferencia del
// formulario de identidad (fila = 1 dato), acá cada fila es UN PRODUCTO, con columnas fijas:
// PRODUCTO O SERVICIO | CANTIDAD | VALOR UNITARIO | VALOR NETO | VALOR IVA INCLUIDO.
//
// Objetivo de esta prueba: sacar, sin tocar nada a mano, la lista de qué le falta a esta
// licitación puntual (qué celdas de precio quedan vacías, con su w14:paraId listo para
// rellenar después) — la materia prima de la futura pantalla de "completar a mano".
import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'fs';

const RUTA = 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/41955866-1828-496c-b110-04eb2062688d/scratchpad/anexo-test/ANEXOS.docx';

function textoDeCelda(tcXml) {
  return [...tcXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('').trim();
}
function paraIdDeCelda(tcXml) {
  const m = tcXml.match(/<w:p [^>]*w14:paraId="([0-9A-F]+)"/);
  return m ? m[1] : null;
}
function celdaVacia(tcXml) {
  return !/<w:r[ >]/.test(tcXml);
}

// Separa un bloque <w:tbl>...</w:tbl> en filas <w:tr>, y cada fila en celdas <w:tc>.
// No hay tablas anidadas en este formulario, así que un split simple por las etiquetas de
// apertura/cierre alcanza (más robusto que un regex único greedy/no-greedy sobre todo el bloque).
function partirEnBloques(xml, tagAbre, tagCierraLen, cierre) {
  const bloques = [];
  let i = 0;
  while (true) {
    const ini = xml.indexOf(tagAbre, i);
    if (ini === -1) break;
    const fin = xml.indexOf(cierre, ini);
    bloques.push(xml.slice(ini, fin + cierre.length));
    i = fin + cierre.length;
  }
  return bloques;
}

async function main() {
  const buf = readFileSync(RUTA);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');

  const idxTitulo = xml.indexOf('OFERTA ECON');
  const idxTabla = xml.indexOf('<w:tbl>', idxTitulo);
  const idxFinTabla = xml.indexOf('</w:tbl>', idxTabla) + '</w:tbl>'.length;
  const tablaXml = xml.slice(idxTabla, idxFinTabla);

  const filas = partirEnBloques(tablaXml, '<w:tr', 0, '</w:tr>');
  console.log(`Tabla encontrada: ${filas.length} filas (1 encabezado + ${filas.length - 1} productos)\n`);

  const resultado = [];
  filas.slice(1).forEach((fila, i) => { // salta el encabezado
    const celdas = partirEnBloques(fila, '<w:tc>', 0, '</w:tc>');
    if (celdas.length < 5) { console.log(`  fila ${i + 1}: ${celdas.length} celdas (no calza, se omite)`); return; }
    const producto = textoDeCelda(celdas[0]);
    const cantidad = textoDeCelda(celdas[1]);
    if (!producto) return; // fila vacía de relleno al final de la tabla
    const campos = ['valor_unitario', 'valor_neto', 'valor_iva_incluido'].map((campo, k) => ({
      campo,
      vacia: celdaVacia(celdas[2 + k]),
      paraId: paraIdDeCelda(celdas[2 + k]),
      valorActual: textoDeCelda(celdas[2 + k]),
    }));
    resultado.push({ producto, cantidad, campos });
  });

  console.log(`Productos detectados: ${resultado.length}\n`);
  for (const r of resultado.slice(0, 6)) {
    console.log(`· ${r.producto} (${r.cantidad})`);
    for (const c of r.campos) console.log(`    ${c.campo}: ${c.vacia ? `FALTA (paraId ${c.paraId})` : `ya tiene "${c.valorActual}"`}`);
  }
  console.log(`  … y ${Math.max(0, resultado.length - 6)} más`);

  writeFileSync(
    'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/41955866-1828-496c-b110-04eb2062688d/scratchpad/anexo-test/campos-faltantes.json',
    JSON.stringify(resultado, null, 2),
  );
  console.log('\nJSON completo guardado en campos-faltantes.json');
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
