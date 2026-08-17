// Test end-to-end del generador de costeo sobre informes REALES guardados en BD.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
for (const l of readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'').trim();
}
const mysql = (await import('mysql2/promise')).default;
const ExcelJS = (await import('exceljs')).default;
const { generarCosteoExcel, adaptarViabilidadACosteo } = await import('@/app/lib/generar-costeo');
const OUT = process.argv[2] || 'C:/Users/droku/AppData/Local/Temp/claude/D--licitapyme-clone/b67acbfc-3cb2-4c74-b902-72ed9eb3c997/scratchpad/costeo-e2e';
mkdirSync(OUT, { recursive: true });
const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT||'3306'), connectTimeout: 20000 });
const [rows]: any = await pool.query(
  `SELECT licitacion_codigo, informe_ejecutivo FROM viabilidad_licitacion
   WHERE informe_ejecutivo IS NOT NULL ORDER BY updated_at DESC LIMIT 40`);
let ok=0, fail=0;
for (const r of rows) {
  let ie: any; try { ie = typeof r.informe_ejecutivo==='string'?JSON.parse(r.informe_ejecutivo):r.informe_ejecutivo; } catch { continue; }
  const inf = ie?._informe_ia_v3; if (!inf) continue;
  const cod = r.licitacion_codigo;
  try {
    const d = adaptarViabilidadACosteo(cod, inf);
    const nItemsInf = (inf.manifiesto_productos||[]).length;
    const nItemsCosteo = d.grupos.reduce((a:any,g:any)=>a+g.items.length,0);
    if (!nItemsCosteo) { console.log(`- ${cod.padEnd(20)} manifiesto vacío (inf=${nItemsInf}) → sin Excel`); continue; }
    const buf = await generarCosteoExcel(d);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any);
    const hojas = wb.worksheets.map(w=>w.name);
    // Chequeos duros
    const problemas: string[] = [];
    if (buf.length < 5000) problemas.push('Excel sospechosamente chico');
    if (!hojas.some(h=>/costeo/i.test(h))) problemas.push('sin hoja de Costeo');
    const esperadas = d.grupos.length;
    const hojasCosteo = hojas.filter(h=>/costeo/i.test(h)).length;
    if (esperadas>1 && hojasCosteo<esperadas) problemas.push(`hojas ${hojasCosteo} < grupos ${esperadas}`);
    if (nItemsCosteo !== nItemsInf) problemas.push(`filtro: inf=${nItemsInf} → costeo=${nItemsCosteo}`);
    writeFileSync(`${OUT}/${cod}.xlsx`, buf);
    const marca = problemas.length ? '✗' : '✓';
    if (problemas.length) fail++; else ok++;
    console.log(`${marca} ${cod.padEnd(20)} ${String(nItemsCosteo).padStart(3)} ítems · ${esperadas} grupo(s) · ${hojas.length} hojas · ${(buf.length/1024).toFixed(0)}KB ${problemas.length?'· '+problemas.join('; '):''}`);
  } catch (e:any) { fail++; console.log(`✗ ${cod.padEnd(20)} EXCEPCIÓN: ${e.message}`); }
}
console.log(`\n── ${ok} ok · ${fail} con problema · Excels en ${OUT}`);
await pool.end();
