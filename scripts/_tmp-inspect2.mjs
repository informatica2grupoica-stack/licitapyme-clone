import fs from 'node:fs';
const xml = fs.readFileSync('scripts/_out-combinado.xml', 'utf8');

function findAll(needle) {
  const positions = [];
  let idx = 0;
  while (true) {
    const i = xml.indexOf(needle, idx);
    if (i < 0) break;
    positions.push(i);
    idx = i + 1;
  }
  return positions;
}

const anexoHeaders = findAll('ANEXO N');
console.log('ANEXO N occurrences:', anexoHeaders);

const txbxOpen = findAll('<w:txbxContent');
const txbxClose = findAll('</w:txbxContent>');
console.log('txbxContent open:', txbxOpen);
console.log('txbxContent close:', txbxClose);

const drawOpen = findAll('<w:drawing');
const drawClose = findAll('</w:drawing>');
console.log('drawing open:', drawOpen);
console.log('drawing close:', drawClose);

// For each anexoHeader position, print 200 chars around it plus whether it's inside a txbx range
for (const pos of anexoHeaders) {
  const insideTxbx = txbxOpen.some((o, i) => o < pos && (txbxClose[i] === undefined || txbxClose[i] > pos));
  console.log('---header at', pos, 'insideTxbx guess:', insideTxbx);
  console.log(xml.slice(Math.max(0, pos - 150), pos + 100));
}
