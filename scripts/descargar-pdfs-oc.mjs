// Descarga el PDF de las órdenes de compra propias que todavía no lo tienen.
// Uso: npx tsx scripts/descargar-pdfs-oc.mjs [max]
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const { descargarPdfsPendientes } = await import('../app/lib/ordenes-compra.ts');

const max = Math.max(1, parseInt(process.argv[2] || '20', 10));
const r = await descargarPdfsPendientes(max);
console.log(JSON.stringify(r, null, 2));
process.exit(0);
