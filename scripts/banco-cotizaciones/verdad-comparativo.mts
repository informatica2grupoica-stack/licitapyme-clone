// Convierte un COMPARATIVO del equipo (Excel «costeo real»: renglón, descripción, cantidad, estado, proveedor, costo neto, respaldo) en la respuesta
// esperada de un negocio del banco. Liga cada renglón a su producto (por texto + cantidad) y cada «Cot. … N°12345» a la cotización del banco cuyo
// archivo trae ese número. Sirve para cualquier negocio con un comparativo en ese formato.
//   npx tsx scripts/banco-cotizaciones/verdad-comparativo.mts "<ruta.xlsx>" <negocioId>
// Sale a scripts/banco-cotizaciones/datos/verdad-<negocio>.json (fuera de git). NO es ORO: es el criterio del equipo, pendiente de revisión.
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { puntajeLineaProducto } from '../../app/lib/compras-cotizacion-emparejar';

const [ruta, negArg] = process.argv.slice(2);
const negocio = Number(negArg);
const dir = path.join('scripts', 'banco-cotizaciones', 'datos');
const cots = fs.readdirSync(dir).filter(f => f.startsWith('cot-')).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter(b => b.negocio_id === negocio);
if (!cots.length) throw new Error('el negocio no está en el banco');
const productos: any[] = cots[0].productos;

const wb = XLSX.read(fs.readFileSync(ruta), { type: 'buffer' });
const filas: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
const iCab = filas.findIndex(f => f.some(c => /descripci/i.test(String(c))) && f.some(c => /cant/i.test(String(c))));
const cab = filas[iCab].map(c => String(c).toLowerCase());
const col = (re: RegExp) => cab.findIndex(c => re.test(c));
const C = { ren: col(/rengl|n°|nro/), desc: col(/descripci/), cant: col(/^cant/), uni: col(/^unidad/), est: col(/estado/), prov: col(/^proveedor/), comprar: col(/comprar/), costo: col(/costo neto unit/), resp: col(/respaldo/), obs: col(/observ/) };
const renglones = filas.slice(iCab + 1).filter(f => Number(f[C.ren]) > 0 && String(f[C.desc]).trim()).map(f => ({
  renglon: Number(f[C.ren]), desc: String(f[C.desc]), cant: Number(f[C.cant]) || null, estado: String(f[C.est]).toUpperCase(), proveedor: String(f[C.prov]),
  comprar: String(f[C.comprar]), costo: Number(f[C.costo]) || null, respaldo: String(f[C.resp]), obs: String(f[C.obs] || ''),
}));

// Producto ↔ renglón: mejor puntaje de texto + cantidad igual, asignación única de mayor a menor puntaje.
const pares: Array<{ r: number; p: number; s: number }> = [];
renglones.forEach((r, ri) => productos.forEach((p, pi) => {
  let s = puntajeLineaProducto({ descripcion: r.desc, cantidad: r.cant, precioUnitario: 1, total: 1, descuentoPct: null } as any, { id: p.id, descripcion: p.descripcion, cantidad: p.cantidad }, undefined, { penalizar: false }).puntaje;
  if (r.cant != null && p.cantidad != null && Math.abs(r.cant - p.cantidad) < 1e-6) s += 0.3;
  // Números en común desempatan modelos parecidos («SS 624/22» vs «SS 624/20»).
  const nums = (t: string) => new Set(String(t).match(/\d+(?:[.,]\d+)?/g) ?? []);
  const np = nums(p.descripcion); s += Math.min(0.3, [...nums(r.desc)].filter(n => np.has(n)).length * 0.06);
  if (s > 0.35) pares.push({ r: ri, p: pi, s });
}));
pares.sort((a, b) => b.s - a.s);
const rUsado = new Set<number>(), pUsado = new Set<number>(), liga = new Map<number, number>();
for (const x of pares) { if (rUsado.has(x.r) || pUsado.has(x.p)) continue; rUsado.add(x.r); pUsado.add(x.p); liga.set(x.r, x.p); }

// Respaldo «Cot. INGAP N°176397» → la cotización del banco cuyo archivo (o texto) trae ese número.
const cotDe = (resp: string) => {
  if (!/cot/i.test(resp)) return null;
  const nums = (resp.match(/\d{4,}/g) ?? []).filter(n => !/^20\d\d$/.test(n));
  return cots.find(b => nums.some(n => String(b.archivo_nombre || '').includes(n) || String(b.cotiz.descripcion_libre || '').slice(0, 4000).includes(n)))?.id ?? null;
};
const verdad = renglones.map((r, ri) => {
  const p = liga.has(ri) ? productos[liga.get(ri)!] : null;
  const cotizacion_id = cotDe(r.respaldo);
  const fuente = r.estado.startsWith('PEND') ? 'pendiente' : cotizacion_id ? 'cotizacion' : 'otro';
  return { renglon: r.renglon, desc: r.desc, cant: r.cant, producto_id: p?.id ?? null, producto: p?.descripcion ?? null, estado: r.estado, fuente, cotizacion_id, precio: r.costo, proveedor: r.proveedor, comprar: r.comprar, obs: r.obs };
});
const sinLigar = verdad.filter(v => v.producto_id == null);
fs.writeFileSync(path.join(dir, `verdad-${negocio}.json`), JSON.stringify({ negocio, origen: path.basename(ruta), nivel: 'comparativo del equipo (pendiente de revisión, no ORO)', verdad }, null, 1));
console.log(`renglones ${verdad.length} · ligados a producto ${verdad.length - sinLigar.length} · con cotización del banco ${verdad.filter(v => v.fuente === 'cotizacion').length} · otro respaldo ${verdad.filter(v => v.fuente === 'otro').length} · pendientes ${verdad.filter(v => v.fuente === 'pendiente').length}`);
if (sinLigar.length) console.log('sin producto:', sinLigar.map(v => `${v.renglon} ${v.desc.slice(0, 40)}`).join(' | '));
for (const v of verdad.filter(v => v.fuente === 'cotizacion')) console.log(`  ${String(v.renglon).padStart(3)} ${v.desc.slice(0, 42).padEnd(42)} → P«${String(v.producto).slice(0, 38)}» · cot ${v.cotizacion_id} · $${v.precio}`);
