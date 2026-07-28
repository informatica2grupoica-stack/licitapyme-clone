import { normalizarParaIds } from './normalizar-paraids.mjs';
import JSZip from 'jszip';
import { readFileSync, writeFileSync } from 'fs';

const RUTA_ORIGEN = process.argv[2];
const RUTA_SALIDA = process.argv[3];

const buf = readFileSync(RUTA_ORIGEN);
const zip = await JSZip.loadAsync(buf);
const xmlOriginal = await zip.file('word/document.xml').async('string');
const parrafosAntes = (xmlOriginal.match(/<w:p\b/g) || []).length;

const { xml, agregados } = normalizarParaIds(xmlOriginal);
const parrafosDespues = (xml.match(/<w:p\b/g) || []).length;

console.log(`w14:paraId agregados: ${agregados}`);
console.log(`Párrafos antes ${parrafosAntes} → después ${parrafosDespues} · ${parrafosAntes === parrafosDespues ? '✅ IGUAL' : '❌ CAMBIÓ'}`);

zip.file('word/document.xml', xml);
const salida = await zip.generateAsync({ type: 'nodebuffer' });
writeFileSync(RUTA_SALIDA, salida);
console.log('Guardado en', RUTA_SALIDA);
