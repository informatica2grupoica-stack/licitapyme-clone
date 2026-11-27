// Solo lectura: a qué producto quedó cada ficha.
import fs from 'node:fs';
for (const l of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)$/); if (m) process.env[m[1]] = m[2].replace(/\s+#.*$/,'').replace(/^["']|["']$/g,'').trim(); }
const { panelFichas } = await import('./app/lib/compras-fichas');
const p = await panelFichas(891, '759-30-LE26');
for (const pr of p.productos) for (const o of pr.opciones) for (const f of o.fichas) console.log(f.nombre, '->', pr.descripcion);
for (const f of p.pendientes) console.log('POR ASIGNAR', f.documento);
for (const f of p.noSonFichas) console.log('NO ES FICHA', f.documento);
for (const f of p.conError) console.log('ERROR', f.documento, f.error);
process.exit(0);
