import mammoth from 'mammoth';
import fs from 'node:fs';

const path = 'C:/Users/droku/Downloads/ESPECIFICACION_Modulo_Auditor_Tecnico.docx';
const result = await mammoth.extractRawText({ path });
fs.writeFileSync('C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/78b43fbb-9cc1-479e-9b30-598535a2d16f/scratchpad/spec.txt', result.value, 'utf-8');
console.log('OK, longitud:', result.value.length);
console.log(result.messages.slice(0, 5));
