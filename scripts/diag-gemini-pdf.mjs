// Sube el PDF de Bases (escaneado) a la File API de Gemini y le pide los criterios.
// Prueba si Gemini lee el doc completo y encuentra lo que la extracción OCR pierde.
import { readFileSync } from 'node:fs';
const env = {};
for (const line of readFileSync('.env.local','utf8').split('\n')) { const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if(m) env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim(); }
const KEY = env.GEMINI_API_KEY;
const ruta = 'C:/Users/droku/Downloads/1782134188308_Decreto_TC_N_246_Aprueba_Bases.pdf';
const buf = readFileSync(ruta);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

// 1) Iniciar upload resumable
console.log(`\n  Subiendo ${(buf.length/1024/1024).toFixed(1)} MB a File API...`);
const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${KEY}`, {
  method:'POST',
  headers:{ 'X-Goog-Upload-Protocol':'resumable','X-Goog-Upload-Command':'start','X-Goog-Upload-Header-Content-Length':String(buf.length),'X-Goog-Upload-Header-Content-Type':'application/pdf','Content-Type':'application/json' },
  body: JSON.stringify({ file:{ display_name:'bases' } }),
});
const uploadUrl = start.headers.get('x-goog-upload-url');
if(!uploadUrl){ console.log('  ERROR start:', start.status, (await start.text()).slice(0,200)); process.exit(1); }

// 2) Subir bytes + finalizar
const up = await fetch(uploadUrl, { method:'POST', headers:{ 'X-Goog-Upload-Command':'upload, finalize','X-Goog-Upload-Offset':'0','Content-Type':'application/pdf' }, body: buf });
const upJson = await up.json();
let file = upJson.file;
console.log(`  Subido: ${file.name} estado=${file.state}`);

// 3) Esperar ACTIVE
for(let i=0;i<30 && file.state!=='ACTIVE';i++){ await sleep(2000); const g=await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${KEY}`).then(r=>r.json()); file=g; }
console.log(`  Estado final: ${file.state}`);
if(file.state!=='ACTIVE'){ console.log('  No quedó ACTIVE'); process.exit(1); }

// 4) Preguntar por criterios al modelo
for(const model of ['gemini-flash-latest']){
  const body = JSON.stringify({
    contents:[{ parts:[
      { text:'Lee este documento de bases de licitación (está escaneado). Extrae y lista: 1) los CRITERIOS DE EVALUACIÓN con su PONDERACIÓN (%), 2) las MULTAS por atraso, 3) garantías. Indica la página de cada uno. Si no encuentras algo, dilo.' },
      { fileData:{ mimeType:'application/pdf', fileUri:file.uri } },
    ]}],
    generationConfig:{ temperature:0, maxOutputTokens:4000 },
  });
  const t=performance.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`, { method:'POST', headers:{'Content-Type':'application/json'}, body, signal:AbortSignal.timeout(180000) });
  const ms=Math.round(performance.now()-t);
  if(!res.ok){ console.log(`\n  ${model}: HTTP ${res.status} — ${(await res.text()).slice(0,150)}`); continue; }
  const d=await res.json();
  const txt=d.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  console.log(`\n  ── ${model} (${ms}ms) ──\n${txt}\n`);
}
