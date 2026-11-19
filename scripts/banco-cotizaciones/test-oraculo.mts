// TEST A (sin IA): ¿el validador del programa acepta lo que decidió el equipo? Se le entregan, como si las hubiera propuesto la IA, las asignaciones
// del comparativo del equipo (datos/verdad-<negocio>.json) y se mira cuáles rechaza o cambia de precio. Si rechaza decisiones del equipo, el problema
// está en nuestras reglas y no en el modelo.
//   npx tsx scripts/banco-cotizaciones/test-oraculo.mts --negocio=1356 [--equivalencias]
import fs from 'fs';
import path from 'path';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_0-9]+)=([^#\r]*)/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim(); }
const { validarPareoGlobal, lineasDelNegocio } = await import('../../app/lib/compras-pareo-global-core');
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1];
const negocio = Number(arg('negocio'));
const dir = path.join('scripts', 'banco-cotizaciones', 'datos');
const bancos = fs.readdirSync(dir).filter(f => f.startsWith('cot-')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter(b => b.negocio_id === negocio)
  .sort((a, b) => String(a.creada).localeCompare(String(b.creada)) || a.id - b.id);
const productos = bancos[0].productos.map((p: any) => ({ id: p.id, descripcion: p.descripcion, cantidad: p.cantidad, unidad: p.unidad, montoUnitario: p.montoUnitario }));
const cotizaciones = bancos.map(b => ({ id: b.id, archivo_nombre: b.archivo_nombre, ...b.cotiz }));
const V = JSON.parse(fs.readFileSync(path.join(dir, `verdad-${negocio}.json`), 'utf8')).verdad.filter((v: any) => v.fuente === 'cotizacion' && v.producto_id && v.precio != null && cotizaciones.some(c => c.id === v.cotizacion_id));
const equivalencias = process.argv.includes('--equivalencias') && fs.existsSync(path.join(dir, `equivalencias-${negocio}.json`)) ? JSON.parse(fs.readFileSync(path.join(dir, `equivalencias-${negocio}.json`), 'utf8')) : [];
const lineas = lineasDelNegocio(cotizaciones);
const cerca = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.012);

// Para cada decisión del equipo se busca LA LÍNEA del documento que trae ese precio (tal cual, o por metro/kilo de un rollo/caja).
const asignaciones: any[] = []; const sinLinea: string[] = [];
for (const v of V) {
  const ls = lineas.filter(l => l.cotizacionId === v.cotizacion_id && l.precioNeto != null);
  const l = ls.find(x => cerca(x.precioNeto!, v.precio)) ?? ls.find(x => [6, 25, 50, 100].some(k => cerca(x.precioNeto! * k, v.precio) || cerca(x.precioNeto!, v.precio * k)));
  const idx = productos.findIndex((p: any) => p.id === v.producto_id);
  if (!l || idx < 0) { sinLinea.push(`r${v.renglon} «${String(v.desc).slice(0, 36)}» $${v.precio}: ninguna línea de la cotización ${v.cotizacion_id} trae ese precio`); continue; }
  asignaciones.push({ producto: `P${idx + 1}`, linea: l.codigo, cantidad: productos[idx].cantidad ?? 1, precioUnitario: v.precio, confianza: 'alta', _v: v });
}
const R = validarPareoGlobal({ productos, lineas, cotizaciones, equivalencias }, { asignaciones: asignaciones.map(({ _v, ...a }) => a) });
const desc = (id: number) => String(productos.find((p: any) => p.id === id)?.descripcion ?? id).slice(0, 44);
let igual = 0, otroPrecio = 0, alterna = 0, perdida = 0; const det: string[] = [];
for (const a of asignaciones) {
  const v = a._v;
  const r = R.asignaciones.find(x => x.productoId === v.producto_id);
  if (r && r.cotizacionId === v.cotizacion_id && cerca(r.precioUnitarioClp, v.precio)) { igual++; continue; }
  if (r && r.cotizacionId === v.cotizacion_id) { otroPrecio++; det.push(`  PRECIO OTRO  r${v.renglon} «${desc(v.producto_id)}» equipo $${v.precio} · el programa $${Math.round(r.precioUnitarioClp)}${r.factor > 1 ? ' (convirtió × ' + r.factor + ')' : ''} ${r.avisos.join('; ').slice(0, 90)}`); continue; }
  if (R.alternativas.some(x => x.productoId === v.producto_id && x.cotizacionId === v.cotizacion_id)) { alterna++; det.push(`  A ALTERNATIVA r${v.renglon} «${desc(v.producto_id)}» equipo ${v.cotizacion_id} $${v.precio} · el programa eligió ${r ? r.cotizacionId + ' $' + Math.round(r.precioUnitarioClp) : 'nada'}`); continue; }
  perdida++; det.push(`  RECHAZADA    r${v.renglon} «${desc(v.producto_id)}» $${v.precio}: ${R.descartes.filter(d => d.producto === v.producto_id).map(d => d.motivo).join('; ') || 'sin motivo'}`.slice(0, 260));
}
console.log(`\n=== TEST A · ${negocio} · decisiones del equipo con cotización: ${V.length} · con línea encontrada: ${asignaciones.length} · sin línea con ese precio: ${sinLinea.length}`);
console.log(`el programa las ACEPTA igual: ${igual} · con otro precio: ${otroPrecio} · pasa a alternativa (otra más barata): ${alterna} · las rechaza: ${perdida}`);
console.log(det.join('\n')); console.log('\nSin línea con ese precio:\n  ' + sinLinea.join('\n  '));
process.exit(0);
