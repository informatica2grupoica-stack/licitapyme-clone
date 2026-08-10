import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const { parsearCosteo, itemsPrecioDeCosteo } = await import('@/app/lib/motor-comercial');

const url = 'https://pub-722f3e1c29d74bcb8ee49776fe8a2c0d.r2.dev/2908-16-LE26/1785251344506_COSTEO_2908-16-LE26_2026-07-28.xlsx';
const res = await fetch(url);
console.log('status:', res.status);
const buffer = Buffer.from(await res.arrayBuffer());
console.log('bytes:', buffer.length);
try {
  const filas = await parsearCosteo(buffer);
  console.log('filas parseadas:', filas.length);
  console.log(JSON.stringify(filas.slice(0, 10), null, 1));
  const items = itemsPrecioDeCosteo(filas);
  console.log('items con precio:', items.length);
  console.log(JSON.stringify(items, null, 1));
} catch (e: any) {
  console.log('ERROR parseando:', e?.message || e);
}
