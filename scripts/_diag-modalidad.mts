// Diagnóstico: corre el parser determinista de planilla sobre los documentos REALES
// (documentos_cache.texto_extraido) y reporta la clasificación suma_alzada vs por_linea,
// mostrando la numeración detectada para cazar los falsos "por_linea".
// Uso: npx tsx scripts/_diag-modalidad.mts [limite]
import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local','utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m&&!(m[1]in process.env))process.env[m[1]]=m[2].replace(/^["']|["']$/g,'').trim();}
const mysql=(await import('mysql2/promise')).default;
const { parsearPlanillaCosteo } = await import('@/app/lib/planilla-costeo-parser');

const LIMITE = parseInt(process.argv[2] || '60', 10);
const pool = mysql.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,port:+(process.env.DB_PORT||3306),connectTimeout:20000});

// Licitaciones que tienen documentos con texto extraído.
const [cods] = await pool.query(
  `SELECT licitacion_codigo, COUNT(*) n
   FROM documentos_cache WHERE texto_extraido IS NOT NULL AND texto_extraido <> ''
   GROUP BY licitacion_codigo ORDER BY licitacion_codigo DESC LIMIT ?`, [LIMITE]) as any[];

let porLinea=0, plana=0, porCat=0, nulo=0;
const sospechosos: string[] = [];

for (const { licitacion_codigo: cod } of cods as any[]) {
  const [docs] = await pool.query(
    `SELECT documento_nombre AS nombre, categoria, texto_extraido AS texto, metodo_extraccion AS metodo
     FROM documentos_cache WHERE licitacion_codigo = ? AND texto_extraido IS NOT NULL`, [cod]) as any[];
  let r; try { r = parsearPlanillaCosteo(docs as any); } catch(e){ r = null; }
  if (!r) { nulo++; continue; }
  if (r.estructura==='por_linea') porLinea++; else if (r.estructura==='por_categoria') porCat++; else plana++;

  const nums = r.items.map(i=>i.numero).filter(n=>n!=null);
  const secuencia = nums.slice(0,18).join(',');
  const maxNum = nums.length?Math.max(...(nums as number[])):0;
  // Sospechoso: clasificado por_linea PERO la secuencia parece continua (máximo ≈ cantidad, sin reinicios obvios)
  let bajadas=0; for(let i=1;i<nums.length;i++) if((nums[i] as number)<(nums[i-1] as number)) bajadas++;
  const pareceContinua = bajadas<=1 && maxNum>=nums.length*0.7;
  const flag = r.estructura==='por_linea' && pareceContinua ? '  <<< SOSPECHOSO (parece continua)' : '';
  if (flag) sospechosos.push(cod);

  if (r.estructura==='por_linea' || flag) {
    console.log(`${cod} · ${r.estructura} · num=${r.numeracion} · items=${r.items.length} · lineas=[${r.lineas.join(',')}] · maxNum=${maxNum} bajadas=${bajadas}`);
    console.log(`   nº: ${secuencia}${nums.length>18?'…':''}${flag}`);
  }
}
console.log(`\n== RESUMEN (${(cods as any[]).length} licitaciones) ==`);
console.log(`por_linea=${porLinea} · por_categoria=${porCat} · plana(suma_alzada)=${plana} · sin_parser=${nulo}`);
console.log(`SOSPECHOSOS (por_linea con numeración que parece continua): ${sospechosos.length}`);
if (sospechosos.length) console.log('  → ' + sospechosos.join(', '));
await pool.end();
