import { readFileSync } from 'node:fs';
const { abrirDocx } = await import('@/app/lib/anexos-docx');
const buf = readFileSync(process.argv[2]);
const { xml, zip } = await abrirDocx(buf);
console.log('drawings:', (xml.match(/<w:drawing\b/g) || []).length);
console.log('descr firma:', (xml.match(/descr="firma"|name="firma"/g) || []).length);
console.log('descr timbre:', (xml.match(/descr="timbre"|name="timbre"/g) || []).length);
console.log('blips:', (xml.match(/<a:blip\b/g) || []).length);
console.log('media:', Object.keys((zip as any).files).filter(f => /media/.test(f)));
