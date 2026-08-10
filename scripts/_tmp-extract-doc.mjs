import WordExtractor from 'word-extractor';
const extractor = new WordExtractor();
const path = process.argv[2];
extractor.extract(path).then(doc => {
  console.log(doc.getBody());
}).catch(e => { console.error('ERR', e); process.exit(1); });
