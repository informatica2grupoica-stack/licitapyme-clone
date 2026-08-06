import fs from 'node:fs';
const xml = fs.readFileSync('scripts/_out-frag-N2.xml', 'utf8');
const tags = ['<w:txbxContent', '</w:txbxContent>', '<wps:txbx', '</wps:txbx>', '<mc:AlternateContent', '</mc:AlternateContent>', '<w:pict', '</w:pict>', '<w:drawing', '</w:drawing>', 'ANEXO N', '<w:p w14:paraId'];
for (const t of tags) {
  const positions = [];
  let idx = 0;
  while (true) {
    const i = xml.indexOf(t, idx);
    if (i < 0) break;
    positions.push(i);
    idx = i + 1;
  }
  console.log(t, '->', positions.length, positions.slice(0, 15));
}
