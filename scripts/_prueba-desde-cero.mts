// Prueba end-to-end desde cero: descarga docs → clasifica → viabilidad IA (PROMPT 2).
import fs from 'fs';
for (const l of fs.readFileSync('.env.local','utf8').split('\n')) {
  const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if(m && !process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();
}
const cod = process.argv[2] || '3603-26-LE26';
const { descargarDocumentosLicitacion } = await import('@/app/lib/mp-descarga-orquestador');
const { clasificarLicitacion } = await import('@/app/lib/clasificacion');
const { analizarYGuardarViabilidadIA } = await import('@/app/lib/viabilidad-ia');
const pool = (await import('@/app/lib/db')).default;

console.log(`\n===== 1. DESCARGA DE DOCUMENTOS: ${cod} =====`);
const d = await descargarDocumentosLicitacion(cod);
console.log('descarga:', JSON.stringify({ exito: d.exito, nuevos: d.nuevos, omitidos: d.omitidos, total: d.totalEncontrados, error: d.error }));

console.log(`\n===== 2. CLASIFICACIÓN =====`);
try { await clasificarLicitacion(cod); console.log('clasificación OK'); }
catch (e:any) { console.warn('clasificación error:', String(e?.message??e).slice(0,180)); }

console.log(`\n===== 3. VIABILIDAD IA (PROMPT 2) =====`);
const r = await analizarYGuardarViabilidadIA(cod);
if (r) {
  console.log('\n----- RESULTADO -----');
  console.log('score:', r.score_0_100, '· semáforo:', r.semaforo, '· veredicto:', r.veredicto?.nivel, r.veredicto?.gana_probable);
  console.log('presupuesto: bruto=', r.presupuesto?.bruto, 'neto=', r.presupuesto?.neto, 'gate=', r.presupuesto?.gate, 'excluyente=', r.presupuesto?.es_excluyente);
  console.log('modalidad:', r.modalidad?.tipo, '· manifiesto:', r.manifiesto_productos?.length, 'ítems');
} else console.log('SIN RESULTADO (sin documentos legibles?)');
await pool.end(); process.exit(0);
