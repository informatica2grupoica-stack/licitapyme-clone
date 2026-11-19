// BANCO DE COTIZACIONES REALES — evaluador. Corre el MISMO núcleo que producción (compras-cotizacion-resolver.ts) sobre cada cotización del banco y
// compara con la respuesta esperada. No escribe nada en la BD.
//
//   npx tsx scripts/banco-cotizaciones/evaluar.mts --det                 capa determinista (sin IA, segundos): ¿el producto correcto llega a la IA?
//   npx tsx scripts/banco-cotizaciones/evaluar.mts --ia                  capa completa con IA (usa el caché en disco; llama a la IA solo lo nuevo)
//   opciones: --negocio=1356,1191  --cot=342,351  --sin1356  --refrescar (ignora el caché)  --detalle (lista cada falla)  --concurrencia=3
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_0-9]+)=([^#\r]*)/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim(); }

const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1];
const flag = (n: string) => process.argv.includes(`--${n}`);
const MODO_IA = flag('ia'); const DETALLE = flag('detalle');
const dirDatos = path.join('scripts', 'banco-cotizaciones', 'datos');
// --cache=cache-ia-corrida1 para evaluar el código actual sobre otra corrida guardada de la IA (mide cuánto varía la IA de una vez a otra)
const dirCache = path.join('scripts', 'banco-cotizaciones', arg('cache') || 'cache-ia');
fs.mkdirSync(dirCache, { recursive: true });

const L = await import('../../app/lib/compras-cotizacion-lineas');
const E = await import('../../app/lib/compras-cotizacion-emparejar');
const { resolverCotizacion } = await import('../../app/lib/compras-cotizacion-resolver');
const { SYS_HOMOLOGACION } = await import('../../app/lib/compras-auditor');

let bancos = fs.readdirSync(dirDatos).filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(path.join(dirDatos, f), 'utf8')));
const fNeg = arg('negocio')?.split(',').map(Number), fCot = arg('cot')?.split(',').map(Number);
if (fNeg) bancos = bancos.filter(b => fNeg.includes(b.negocio_id));
if (fCot) bancos = bancos.filter(b => fCot.includes(b.id));
if (flag('sin1356')) bancos = bancos.filter(b => b.negocio_id !== 1356);

// ── IA con caché en disco (la clave es el texto exacto que se le manda: si cambia el prompt o los candidatos, se vuelve a llamar)
let llamadasNuevas = 0, aciertosCache = 0;
let activas = 0; const cola: Array<() => void> = []; const maxConc = Number(arg('concurrencia') || 3);
const cupo = async <T,>(f: () => Promise<T>): Promise<T> => { if (activas >= maxConc) await new Promise<void>(r => cola.push(r)); activas++; try { return await f(); } finally { activas--; cola.shift()?.(); } };
const llamarIA = async (system: string, user: string) => {
  const clave = crypto.createHash('sha1').update(system + '\n--\n' + user).digest('hex');
  const arch = path.join(dirCache, clave + '.json');
  if (!flag('refrescar') && fs.existsSync(arch)) { aciertosCache++; return JSON.parse(fs.readFileSync(arch, 'utf8')); }
  const { crearChatIA } = await import('../../app/lib/gemini');
  const r = await cupo(async () => {
    const completion: any = await crearChatIA({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, stream: false, max_tokens: 4500, response_format: { type: 'json_object' } } as any, { timeoutMs: 90000, modeloPreferido: 'glm-4.7', soloGlm: true } as any);
    return { content: String(completion.choices?.[0]?.message?.content ?? ''), finishReason: completion.choices?.[0]?.finish_reason ?? null, modelo: completion.model ?? null };
  });
  llamadasNuevas++;
  fs.writeFileSync(arch, JSON.stringify(r));
  return r;
};

const factores = (c: any) => L.factoresPrecioDeCotizacion({ moneda: c.moneda, tipoCambioUsado: c.tipo_cambio_usado != null ? Number(c.tipo_cambio_usado) : null, notas: c.notas });
const tol = (esperado: number) => Math.max(2, Math.abs(esperado) * 0.01);
const corto = (s: string, n = 60) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

// ════════════ CAPA DETERMINISTA ════════════
if (!MODO_IA) {
  let paresF = 0, recallF = 0;
  let pares = 0, sinLinea = 0, recall = 0, noLlega = 0, exclFalsa = 0, noPlausible = 0, candTotal = 0, candLineas = 0;
  const fallas: string[] = [];
  for (const b of bancos) {
    const lineas = L.lineasDesdeTabla(b.cotiz.descripcion_libre).filter((l: any) => (l.total ?? l.precioUnitario ?? 0) !== 0);
    for (const l of lineas) { candTotal += E.productosCandidatos([l], b.productos.map((p: any) => ({ id: p.id, descripcion: p.descripcion, cantidad: p.cantidad }))).size; candLineas++; }
    for (const e of b.esperado) {
      const p = b.productos.find((x: any) => x.id === e.producto_id); if (!p || !(e.precio_base > 0)) continue;
      const fp = { factoresPrecio: factores(b.cotiz) };
      const prodUno = [{ id: p.id, descripcion: p.descripcion, precioBase: e.precio_base }];
      const conMismoPrecio = lineas.filter((l: any) => { const c = L.productoQueCubreLaLinea(l, prodUno, fp); return !!c && c.como !== 'nombre'; });
      const linea = conMismoPrecio.sort((x: any, y: any) => E.puntajeLineaProducto(y, { id: p.id, descripcion: p.descripcion }, undefined, { penalizar: false }).puntaje - E.puntajeLineaProducto(x, { id: p.id, descripcion: p.descripcion }, undefined, { penalizar: false }).puntaje)[0];
      if (!linea) { sinLinea++; continue; }                       // el precio esperado no se puede ligar a una línea (kit, descuento…): no se mide aquí
      pares++;
      const cand = E.productosCandidatos([linea], b.productos.map((x: any) => ({ id: x.id, descripcion: x.descripcion, cantidad: x.cantidad })));
      const filtra = b.productos.length > 30;
      if (filtra) { paresF++; if (cand.has(p.id)) recallF++; }
      if (cand.has(p.id)) recall++; else { noLlega++; fallas.push(`NO LLEGA${b.productos.length > 30 ? '[filtro]' : ''}  cot ${b.id} (${b.licitacion}) «${corto(p.descripcion)}» ← línea «${corto(linea.descripcion)}»`); }
      if (E.conflictosMedibles(p.descripcion, linea.descripcion).some((c: any) => c.grave) && E.lineaConElMismoModelo(p.descripcion, lineas) !== linea) { exclFalsa++; fallas.push(`EXCLUSIÓN FALSA cot ${b.id} (${b.licitacion}) «${corto(p.descripcion)}» ← «${corto(linea.descripcion)}»: ${E.conflictosMedibles(p.descripcion, linea.descripcion).filter((c: any) => c.grave).map((c: any) => c.texto).join('; ')}`); }
      const resp = E.respaldoDelPrecio(p.descripcion, lineas, linea.precioUnitario);
      if (resp && !resp.plausible) { noPlausible++; fallas.push(`SIN PARECIDO cot ${b.id} (${b.licitacion}) «${corto(p.descripcion)}» ← «${corto(linea.descripcion)}»`); }
    }
  }
  console.log(`\n=== CAPA DETERMINISTA · ${bancos.length} cotizaciones ===`);
  console.log(`pares producto↔línea ligados por precio: ${pares} (otros ${sinLinea} no se pueden ligar a una sola línea)`);
  console.log(`el producto correcto llega a la IA entre los candidatos: ${recall}/${pares} = ${(100 * recall / Math.max(1, pares)).toFixed(1)} %`);
  console.log(`  · solo donde el filtro actúa (negocios con más de 30 productos): ${recallF}/${paresF} = ${(100 * recallF / Math.max(1, paresF)).toFixed(1)} %`);
  console.log(`candidatos que ve la IA por línea: ${(candTotal / Math.max(1, candLineas)).toFixed(1)} en promedio (${candLineas} líneas)`);
  console.log(`exclusiones FALSAS por medida distinta: ${exclFalsa} · pares correctos que el freno de «sin parecido» rechazaría: ${noPlausible}`);
  if (DETALLE || fallas.length <= 40) console.log('\n' + fallas.join('\n'));
  else console.log(`\n(${fallas.length} fallas; usa --detalle)`);
  process.exit(0);
}

// ════════════ CAPA COMPLETA CON IA ════════════
interface Resultado { cot: number; negocio: number; lic: string; ok: number; precio: number; falta: number; extra: number; okOro: number; totOro: number; lineas: number; sinAsignar: number; detalle: string[]; tandas: number; error?: string }
const resultados: Resultado[] = [];
const trabajo = async (b: any): Promise<Resultado> => {
  const r: Resultado = { cot: b.id, negocio: b.negocio_id, lic: b.licitacion, ok: 0, precio: 0, falta: 0, extra: 0, okOro: 0, totOro: 0, lineas: 0, sinAsignar: 0, detalle: [], tandas: 0 };
  try {
    const preciosPrevios = Object.fromEntries(b.esperado.map((e: any) => [e.producto_id, e.precio_base]));
    const R = await resolverCotizacion({ productos: b.productos, cotiz: b.cotiz, sobreTotal: Number(b.cotiz.descuento_sobre_total) === 1, systemPrompt: SYS_HOMOLOGACION, llamarIA, preciosPrevios });
    r.tandas = R.tandas;
    const porId = new Map<number, any>(R.finales.map((f: any) => [f.producto.id, f]));
    const esperadosIds = new Set<number>(b.esperado.filter((e: any) => b.productos.some((x: any) => x.id === e.producto_id)).map((e: any) => e.producto_id));
    for (const e of b.esperado) {
      const p = b.productos.find((x: any) => x.id === e.producto_id); const desc = corto(p?.descripcion || '?', 50);
      if (!p) continue;   // el producto ya salió de la compra (renunciado / no adjudicado): no se puede asignar y no se cuenta
      if (e.nivel === 'oro') r.totOro++;
      const got = porId.get(e.producto_id);
      if (!got) { r.falta++; r.detalle.push(`FALTA   «${desc}» esperado $${e.precio_base}${e.nivel === 'oro' ? ' [ORO]' : ''}`); continue; }
      const pb = got.esIncluido ? 0 : got.precioClp;
      const okPrecio = pb != null && e.precio_base != null && Math.abs(pb - e.precio_base) <= tol(e.precio_base);
      if (okPrecio) { r.ok++; if (e.nivel === 'oro') r.okOro++; }
      else { r.precio++; r.detalle.push(`PRECIO  «${desc}» esperado $${e.precio_base} y salió $${pb}${e.nivel === 'oro' ? ' [ORO]' : ''}`); }
    }
    for (const f of R.finales) if (!esperadosIds.has(f.producto.id)) { r.extra++; r.detalle.push(`EXTRA   «${corto(f.producto.descripcion, 50)}» $${f.precioClp} (no estaba asignado)`); }
    // carga manual: líneas con precio que no quedaron en ningún producto (mismo criterio que las notas «Revisa la asignación»)
    const prods = R.finales.map((f: any) => ({ id: f.producto.id, descripcion: f.producto.descripcion, precioBase: f.precioClp }));
    const conPrecio = R.lineasDelDoc.filter((l: any) => (l.total ?? l.precioUnitario ?? 0) !== 0);
    r.lineas = conPrecio.length;
    const fp = { factoresPrecio: factores(b.cotiz) };
    const noCub = conPrecio.filter((l: any) => !L.productoQueCubreLaLinea(l, prods, fp));
    const adicConceptos = R.finales.flatMap((f: any) => f.adic.map((a: any) => String(a.concepto)));
    const sinNombres = L.lineasSinAsignar(noCub, [...prods.flatMap((x: any) => [x.descripcion, x.descripcion.split(' - ')[0]]), ...adicConceptos]);
    const alt = L.lineasAlternativas(conPrecio, prods, fp).filter((l: any) => !sinNombres.includes(l) && L.lineasSinAsignar([l], adicConceptos).length > 0);
    const sin = [...sinNombres, ...alt].filter((l: any) => !/flete|transport|despacho|env[ií]o|shipping|freight|descuento|\biva\b|total/i.test(l.descripcion));
    r.sinAsignar = sin.length;
    for (const l of sin) r.detalle.push(`LÍNEA SIN ASIGNAR «${corto(l.descripcion, 60)}» $${l.precioUnitario}`);
  } catch (err) { r.error = String(err).slice(0, 160); }
  return r;
};
await Promise.all(bancos.map(async b => { resultados.push(await trabajo(b)); if (resultados.length % 10 === 0) console.error(`… ${resultados.length}/${bancos.length}`); }));
resultados.sort((a, b) => a.negocio - b.negocio || a.cot - b.cot);

const suma = (f: (r: Resultado) => number, g?: (r: Resultado) => boolean) => resultados.filter(g ?? (() => true)).reduce((a, r) => a + f(r), 0);
const pct = (a: number, b: number) => b ? (100 * a / b).toFixed(1) + ' %' : '—';
const tot = (g?: (r: Resultado) => boolean) => ({ ok: suma(r => r.ok, g), precio: suma(r => r.precio, g), falta: suma(r => r.falta, g), extra: suma(r => r.extra, g), oroOk: suma(r => r.okOro, g), oroTot: suma(r => r.totOro, g), lin: suma(r => r.lineas, g), sin: suma(r => r.sinAsignar, g) });
const resumen = (nombre: string, g?: (r: Resultado) => boolean) => {
  const t = tot(g); const esp = t.ok + t.precio + t.falta;
  console.log(`${nombre.padEnd(22)} esperadas ${String(esp).padStart(4)} · AUTOMÁTICAS BIEN ${String(t.ok).padStart(4)} (${pct(t.ok, esp).padStart(7)}) · precio mal ${String(t.precio).padStart(3)} · faltan ${String(t.falta).padStart(3)} · extras ${String(t.extra).padStart(3)} · ORO ${t.oroOk}/${t.oroTot} · líneas sin asignar ${t.sin}/${t.lin} (${pct(t.sin, t.lin)})`);
};
console.log(`\n=== CAPA COMPLETA CON IA · ${resultados.length} cotizaciones · llamadas nuevas a la IA: ${llamadasNuevas} · del caché: ${aciertosCache} ===`);
resumen('TODAS'); resumen('sin 1356 (justo)', r => r.negocio !== 1356); resumen('solo 1356 (afinado)', r => r.negocio === 1356);
console.log('\nPor cotización (esperadas = ok+precio+falta):');
for (const r of resultados) {
  const esp = r.ok + r.precio + r.falta;
  if (r.error) { console.log(`  cot ${String(r.cot).padStart(4)} ${r.lic.padEnd(18)} ERROR ${r.error}`); continue; }
  const marca = r.precio ? ' ✖PRECIO' : r.falta ? ' ·falta' : '';
  console.log(`  cot ${String(r.cot).padStart(4)} ${r.lic.padEnd(18)} ${r.ok}/${esp} bien · extras ${r.extra} · sin asignar ${r.sinAsignar}/${r.lineas} · tandas ${r.tandas}${marca}`);
}
if (DETALLE) { console.log('\nDETALLE:'); for (const r of resultados) if (r.detalle.length) { console.log(`\n— cot ${r.cot} (${r.lic})`); for (const d of r.detalle) console.log('   ' + d); } }
fs.writeFileSync(path.join('scripts', 'banco-cotizaciones', 'ultimo-reporte.json'), JSON.stringify(resultados, null, 1));
process.exit(0);
