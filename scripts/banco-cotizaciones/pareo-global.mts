// PAREO GLOBAL sobre el banco: corre parearNegocio (compras-pareo-global-core.ts, el MISMO código que usaría producción) con todas las
// cotizaciones de un negocio y lo compara con (a) el comparativo del equipo si existe (datos/verdad-<negocio>.json) y (b) el motor actual
// (lo que hoy está asignado en la BD, guardado en el banco). No escribe en la BD.
//   npx tsx scripts/banco-cotizaciones/pareo-global.mts --negocio=1356 [--modelo=glm|kimi|kimi_rapido] [--cots=342,351] [--detalle] [--refrescar] [--equivalencias] [--grupos]
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_0-9]+)=([^#\r]*)/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim(); }
const { parearNegocio } = await import('../../app/lib/compras-pareo-global-core');
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=')[1];
const flag = (n: string) => process.argv.includes(`--${n}`);
const negocio = Number(arg('negocio'));
const modelo = arg('modelo') || 'glm';
const dir = path.join('scripts', 'banco-cotizaciones');
const dirCache = path.join(dir, 'cache-pareo'); fs.mkdirSync(dirCache, { recursive: true });

let bancos = fs.readdirSync(path.join(dir, 'datos')).filter(f => f.startsWith('cot-')).map(f => JSON.parse(fs.readFileSync(path.join(dir, 'datos', f), 'utf8'))).filter(b => b.negocio_id === negocio);
const soloCots = arg('cots')?.split(',').map(Number);
if (soloCots) bancos = bancos.filter(b => soloCots.includes(b.id));
bancos.sort((a, b) => String(a.creada).localeCompare(String(b.creada)) || a.id - b.id);
if (!bancos.length) throw new Error('sin cotizaciones de ese negocio en el banco');
const productos = bancos[0].productos.map((p: any) => ({ id: p.id, descripcion: p.descripcion, cantidad: p.cantidad, unidad: p.unidad, montoUnitario: p.montoUnitario }));
const cotizaciones = bancos.map(b => ({ id: b.id, archivo_nombre: b.archivo_nombre, ...b.cotiz }));

let nuevas = 0, cache = 0, segundos = 0;
const llamarIA = async (system: string, user: string) => {
  const clave = crypto.createHash('sha1').update(modelo + '\n' + system + '\n--\n' + user).digest('hex');
  const arch = path.join(dirCache, clave + '.json');
  if (!flag('refrescar') && fs.existsSync(arch)) { cache++; return JSON.parse(fs.readFileSync(arch, 'utf8')); }
  const { crearChatIA } = await import('../../app/lib/gemini');
  const t0 = Date.now();
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const completion: any = modelo === 'glm'
    ? await crearChatIA({ messages, temperature: 0, stream: false, max_tokens: 12000, response_format: { type: 'json_object' } } as any, { timeoutMs: 300000, modeloPreferido: 'glm-4.7', soloGlm: true } as any)
    : await crearChatIA({ messages, stream: false, max_tokens: 16000 } as any, { timeoutMs: 420000, proveedorPreferido: modelo, sinRespaldo: true } as any);   // Kimi: sin json_object (rompe claves)
  segundos += (Date.now() - t0) / 1000;
  const r = { content: String(completion.choices?.[0]?.message?.content ?? ''), finishReason: completion.choices?.[0]?.finish_reason ?? null, modelo: completion.model ?? modelo };
  nuevas++;
  fs.writeFileSync(arch, JSON.stringify(r));
  return r;
};

const t0 = Date.now();
// Equivalencias modelo → familia que fijaría la empresa (en producción irían guardadas por empresa): datos/equivalencias-<negocio>.json, solo con --equivalencias.
const fe = path.join(dir, 'datos', `equivalencias-${negocio}.json`);
const equivalencias = flag('equivalencias') && fs.existsSync(fe) ? JSON.parse(fs.readFileSync(fe, 'utf8')) : [];
const R = await parearNegocio({ productos, cotizaciones, llamarIA, equivalencias, topeEntrada: flag('grupos') ? 1 : undefined });
const desc = (id: number) => String(productos.find((p: any) => p.id === id)?.descripcion ?? id).slice(0, 52);
const lin = (c: string) => R.lineas.find(l => l.codigo === c)!;
const cotNom = (id: number) => { const c = cotizaciones.find(x => x.id === id)!; return `${String(c.proveedor_nombre).slice(0, 14)} ${String(c.archivo_nombre || id).replace(/\.[a-z]+$/i, '').slice(-12)}`; };
const cerca = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.01);

console.log(`\n=== PAREO GLOBAL · negocio ${negocio} · modelo ${modelo} · ${productos.length} productos · ${cotizaciones.length} cotizaciones · ${R.lineas.length} líneas · llamadas ${R.llamadas} (nuevas ${nuevas}, caché ${cache}) · entrada ${R.entradaChars} caracteres · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`asignaciones ${R.asignaciones.length} (alta ${R.asignaciones.filter(a => a.confianza === 'alta').length} · media ${R.asignaciones.filter(a => a.confianza === 'media').length} · revisar ${R.asignaciones.filter(a => a.confianza === 'revisar').length}) · alternativas ${R.alternativas.length} · sobrantes ${R.sobrantes.length} · cargos ${R.cargos.length} · descartes del código ${R.descartes.length}`);
console.log('\nCUADRE POR COTIZACIÓN (lectura = suma de líneas vs neto del documento; asignado + sobrante + cargos = suma de líneas):');
for (const q of R.cuadres) console.log(`  ${cotNom(q.cotizacionId).padEnd(28)} líneas $${q.sumaLineas.toLocaleString('es-CL').padStart(12)} · documento $${String(q.netoDocumento?.toLocaleString('es-CL')).padStart(12)} · lectura ${q.cuadraLectura ? 'CUADRA' : 'NO cuadra (' + q.diferenciaLectura + ')'} · asignado $${q.asignado.toLocaleString('es-CL')} + sobrante $${q.sobrante.toLocaleString('es-CL')} + cargos $${q.cargos.toLocaleString('es-CL')}${Math.abs(q.asignado + q.sobrante + q.cargos - q.sumaLineas) > 2 ? ' ⚠ NO SUMA' : ''}`);

// (a) contra el comparativo del equipo
const fv = path.join(dir, 'datos', `verdad-${negocio}.json`);
if (fs.existsSync(fv)) {
  const V = JSON.parse(fs.readFileSync(fv, 'utf8'));
  const cotsEnJuego = new Set(cotizaciones.map(c => c.id));
  const conCot = V.verdad.filter((v: any) => v.fuente === 'cotizacion' && v.producto_id && cotsEnJuego.has(v.cotizacion_id));
  const motor = (v: any) => bancos.find(b => b.id === v.cotizacion_id)?.esperado.some((e: any) => e.producto_id === v.producto_id && cerca(e.precio_base, v.precio));
  let ok = 0, alt = 0, otro = 0, falta = 0, okMotor = 0;
  const det: string[] = [];
  for (const v of conCot) {
    const a = R.asignaciones.find(x => x.productoId === v.producto_id);
    if (motor(v)) okMotor++;
    if (a && a.cotizacionId === v.cotizacion_id && cerca(a.precioUnitarioClp, v.precio)) { ok++; continue; }
    if (R.alternativas.some(x => x.productoId === v.producto_id && x.cotizacionId === v.cotizacion_id && cerca(x.precioUnitarioClp, v.precio))) { alt++; det.push(`  ALTERNATIVA  r${v.renglon} «${desc(v.producto_id)}» equipo: ${cotNom(v.cotizacion_id)} $${v.precio} · pareo principal: ${a ? cotNom(a.cotizacionId) + ' $' + Math.round(a.precioUnitarioClp) : 'ninguna'}`); continue; }
    if (a) { otro++; det.push(`  DISTINTO     r${v.renglon} «${desc(v.producto_id)}» equipo: ${cotNom(v.cotizacion_id)} $${v.precio} · pareo: ${cotNom(a.cotizacionId)} $${Math.round(a.precioUnitarioClp)} [${a.confianza}] ${a.avisos.join('; ').slice(0, 80)}`); }
    else { falta++; const d = R.descartes.filter(x => x.producto === v.producto_id).map(x => x.motivo).join('; '); det.push(`  FALTA        r${v.renglon} «${desc(v.producto_id)}» equipo: ${cotNom(v.cotizacion_id)} $${v.precio}${d ? ' · descartado por el código: ' + d.slice(0, 90) : ''}`); }
  }
  const pend = V.verdad.filter((v: any) => v.fuente === 'pendiente' && v.producto_id && R.asignaciones.some(a => a.productoId === v.producto_id));
  const otroResp = V.verdad.filter((v: any) => v.fuente === 'otro' && v.producto_id && R.asignaciones.some(a => a.productoId === v.producto_id));
  console.log(`\nCONTRA EL COMPARATIVO DEL EQUIPO (${conCot.length} renglones que el equipo resolvió con estas cotizaciones):`);
  console.log(`  PAREO GLOBAL: iguales ${ok} (${(100 * ok / Math.max(1, conCot.length)).toFixed(1)} %) · como alternativa ${alt} · distinto ${otro} · faltan ${falta}`);
  console.log(`  MOTOR ACTUAL (lo guardado hoy): iguales ${okMotor} (${(100 * okMotor / Math.max(1, conCot.length)).toFixed(1)} %)`);
  console.log(`  además: el pareo asignó ${otroResp.length} productos que el equipo compró con otro respaldo (link/WhatsApp/importación) y ${pend.length} que el equipo dejó PENDIENTES (revisar si sirven)`);
  if (flag('detalle')) {
    console.log(det.join('\n'));
    for (const v of pend) { const a = R.asignaciones.find(x => x.productoId === v.producto_id)!; console.log(`  PENDIENTE→   r${v.renglon} «${desc(v.producto_id)}» ← ${cotNom(a.cotizacionId)} $${Math.round(a.precioUnitarioClp)} [${a.confianza}] ${a.motivo.slice(0, 70)}`); }
    for (const v of otroResp) { const a = R.asignaciones.find(x => x.productoId === v.producto_id)!; console.log(`  OTRO RESP.→  r${v.renglon} «${desc(v.producto_id)}» equipo: ${v.proveedor} $${v.precio} · pareo: ${cotNom(a.cotizacionId)} $${Math.round(a.precioUnitarioClp)}`); }
  }
}
if (flag('detalle')) {
  console.log('\nASIGNACIONES:');
  for (const a of R.asignaciones) console.log(`  «${desc(a.productoId)}» ← ${a.linea} ${cotNom(a.cotizacionId)} · ${a.cantidad}${a.factor > 1 ? ' × ' + a.factor : ''} · $${Math.round(a.precioUnitarioClp).toLocaleString('es-CL')} [${a.confianza}]${a.avisos.length ? ' · ' + a.avisos.join('; ').slice(0, 90) : ''}`);
  console.log('\nDESCARTES DEL CÓDIGO:'); for (const d of R.descartes) console.log(`  ${d.producto ? '«' + desc(d.producto) + '» ' : ''}${d.linea ?? ''}: ${d.motivo}`);
  console.log('\nSOBRANTES:'); for (const s of R.sobrantes) console.log(`  ${s.linea} ${cotNom(lin(s.linea).cotizacionId)} «${lin(s.linea).descripcion.slice(0, 50)}» × ${s.cantidad}: ${s.motivo}`);
}
fs.writeFileSync(path.join(dir, `ultimo-pareo-${negocio}-${modelo}.json`), JSON.stringify(R, null, 1));
process.exit(0);
