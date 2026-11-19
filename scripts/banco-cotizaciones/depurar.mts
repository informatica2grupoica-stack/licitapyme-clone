// Depura UNA cotización del banco: qué devolvió la IA (desde el caché) y qué quedó después de cada freno. No escribe en la BD.
//   npx tsx scripts/banco-cotizaciones/depurar.mts 125
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_0-9]+)=([^#\r]*)/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim(); }
const { resolverCotizacion } = await import('../../app/lib/compras-cotizacion-resolver');
const { SYS_HOMOLOGACION } = await import('../../app/lib/compras-auditor');
const id = Number(process.argv[2]);
const b = JSON.parse(fs.readFileSync(path.join('scripts', 'banco-cotizaciones', 'datos', `cot-${id}.json`), 'utf8'));
const llamarIA = async (system: string, user: string) => {
  const arch = path.join('scripts', 'banco-cotizaciones', 'cache-ia', crypto.createHash('sha1').update(system + '\n--\n' + user).digest('hex') + '.json');
  if (!fs.existsSync(arch)) throw new Error('sin caché para esta cotización: corre evaluar.mts --ia --cot=' + id);
  return JSON.parse(fs.readFileSync(arch, 'utf8'));
};
const R = await resolverCotizacion({ productos: b.productos, cotiz: b.cotiz, sobreTotal: Number(b.cotiz.descuento_sobre_total) === 1, systemPrompt: SYS_HOMOLOGACION, llamarIA, preciosPrevios: Object.fromEntries(b.esperado.map((e: any) => [e.producto_id, e.precio_base])) });
const desc = (n: any) => b.productos[Number(String(n).replace(/\D/g, '')) - 1]?.descripcion?.slice(0, 60);
console.log('PRODUCTOS:', b.productos.length, '· tandas', R.tandas, '· productos por tanda', R.productosPorTanda);
console.log('\nLO QUE DEVOLVIÓ LA IA:');
for (const it of R.items) console.log(`  ${it.producto} ${String(it.cumple).padEnd(20)} $${it.precioUnitarioAsignado ?? '—'} ${it.incluidoEn ? '[incluido en ' + it.incluidoEn + ']' : ''} «${desc(it.producto)}» ${it.detalle ? '· ' + String(it.detalle).slice(0, 120) : ''}`);
console.log('\nFINALES:'); for (const f of R.finales) console.log(`  «${f.producto.descripcion.slice(0, 60)}» $${f.precioClp}${f.adic.length ? ' + ' + f.adic.length + ' adic' : ''}`);
console.log('\nCRUZADOS:', R.cruzados, '\nPOR MEDIDA:', R.porMedida, '\nDESAJUSTES:', R.desajustes);
console.log('\nESPERADO:'); for (const e of b.esperado) console.log(`  «${b.productos.find((p: any) => p.id === e.producto_id)?.descripcion?.slice(0, 60)}» $${e.precio_base} ${e.nivel}`);
process.exit(0);
