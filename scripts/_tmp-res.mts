import { readFileSync } from 'node:fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0 && /^[A-Z_]+$/.test(l.slice(0, i))) process.env[l.slice(0, i)] = l.slice(i + 1).replace(/\r$/, '').replace(/ +#.*$/, '').trim(); }
const { listarProyectosObuma } = await import('../app/lib/compras-proyectos-obuma');
const { resumenGastosCompra } = await import('../app/lib/compras-oc-obuma');
const { resumenComparativoCompra } = await import('../app/lib/compras-resumen-comparativo');
const { proyectos } = await listarProyectosObuma();
const pr = proyectos.find(p => p.negociosCoincidentes.some(n => n.negocioId === 1191))!;
const re = /PUNTA RANCO|LOCKERS|ROCO/i;
console.log('DOCS', pr.documentos.filter(d => re.test(d.proveedorNombre || '')));
console.log('OCS proyecto', pr.ocs.filter(o => re.test(o.proveedorNombre || '')).map(o => ({ f: o.folio, e: o.estado, n: o.neto, p: o.proveedorNombre })));
const g = await resumenGastosCompra(1191, null);
console.log('FACT linked', g.facturas.detalle.filter(f => re.test(f.proveedor || '')));
console.log('DESCARTADAS', g.facturas.descartadas.filter(f => re.test(f.proveedor || '')));
const r = await resumenComparativoCompra(1191);
console.log('PORoc', r.porOc.filter(o => re.test(o.proveedor || '')));
console.log('CUADRE fact', JSON.stringify(r.cuadre?.facturas, null, 1));
process.exit(0);
