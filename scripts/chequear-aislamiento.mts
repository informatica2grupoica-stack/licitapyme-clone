// Chequeo de aislamiento multiempresa. Solo LEE: la BD LOCAL (3308) para el esquema y el código para las rutas. Se corre antes de cada deploy:
//    npx tsx scripts/chequear-aislamiento.mts            → informe; sale con error (1) si hay algo que corregir
//    npx tsx scripts/chequear-aislamiento.mts --avisos   → además lista, una por una, las rutas con aviso
//
// 1) ESQUEMA  Toda tabla tiene dueño (cliente_id / negocio_id / empresa_id / usuario_id) o está clasificada en app/lib/tablas-dueno.ts.
//             Una tabla nueva sin dueño y sin clasificar HACE FALLAR el chequeo (así nadie agrega datos de negocio sin separar por empresa).
// 2) MÓDULOS  Ninguna ruta de un módulo ya abierto a otras empresas toca una tabla PRIVADA_ICA (si es de ICA, la ruta debe nombrar CLIENTE_ICA).
// 2b) DOCS    Una ruta abierta que escribe en documentos_cache debe guardar bajo el espacio de la empresa (codigoAlmacenDocs).
// 3) RUTAS    Aviso (no falla): ruta de módulo abierto que toca una tabla con dueño y no muestra ningún filtro de empresa en todo el archivo.
Object.assign(process.env, { DB_HOST: '127.0.0.1', DB_PORT: '3308', DB_USER: 'licitank', DB_PASSWORD: 'licitank_local', DB_NAME: 'licitank_dev' });
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const { default: pool } = await import('../app/lib/db');
const { CLASE_TABLA } = await import('../app/lib/tablas-dueno');
const { moduloDeRuta, MODULOS_ACTIVABLES } = await import('../app/lib/modulos');

const [[h]] = await pool.query('SELECT DATABASE() d') as any;
if (h.d !== 'licitank_dev') throw new Error('no es la BD local');
let errores = 0;
const falla = (t: string) => { errores++; console.log('  ✘', t); };
const ok = (t: string) => console.log('  ✔', t);

// ── 1) ESQUEMA ──────────────────────────────────────────────────────────────────────────────
console.log('\n1) Esquema: ¿toda tabla tiene dueño o está clasificada?');
const [cols] = await pool.query(`SELECT TABLE_NAME t, GROUP_CONCAT(COLUMN_NAME) c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() GROUP BY TABLE_NAME`) as any;
const conCliente = new Set<string>(), conNegocio = new Set<string>(), conOtroDueno = new Set<string>(), sinDueno: string[] = [];
for (const r of cols as any[]) {
  const c = `,${r.c},`;
  if (c.includes(',cliente_id,')) conCliente.add(r.t);
  else if (c.includes(',negocio_id,')) conNegocio.add(r.t);
  else if (c.includes(',empresa_id,') || c.includes(',usuario_id,')) conOtroDueno.add(r.t);
  else sinDueno.push(r.t);
}
console.log(`   ${cols.length} tablas: ${conCliente.size} con cliente_id · ${conNegocio.size} por negocio_id · ${conOtroDueno.size} por empresa/usuario · ${sinDueno.length} sin columna de dueño`);
const sinClasificar = sinDueno.filter(t => !CLASE_TABLA[t]);
sinClasificar.length ? falla(`tablas SIN dueño y SIN clasificar: ${sinClasificar.join(', ')} → ponles cliente_id o anótalas en app/lib/tablas-dueno.ts`) : ok('toda tabla sin dueño está clasificada');
const fantasmas = Object.keys(CLASE_TABLA).filter(t => !(cols as any[]).some(r => r.t === t));
fantasmas.length ? console.log(`  ⚠ clasificadas pero que ya no existen: ${fantasmas.join(', ')}`) : ok('el mapa no tiene tablas que ya no existen');
const resumen: Record<string, number> = {};
for (const t of sinDueno) resumen[CLASE_TABLA[t] ?? '?'] = (resumen[CLASE_TABLA[t] ?? '?'] || 0) + 1;
console.log('   clasificación:', JSON.stringify(resumen));

// ── Rutas ────────────────────────────────────────────────────────────────────────────────────
const archivos: string[] = [];
const caminar = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? caminar(p) : f === 'route.ts' && archivos.push(p); } };
caminar('app/api');
const abiertos = new Set<string>(['comun', ...MODULOS_ACTIVABLES]);
const MARCADOR = /cliente_id|clienteDeHeader|getClienteId|clienteIdOrNull|negocioEsDe|filtroDocsVisibles|puedeVerLicitacion|registroEsDeMiEmpresa|clienteActual|usaViabilidadDeICA|CLIENTE_ICA|fichaCliente|clienteTieneModulo|conCliente|negocioDelCliente|x-cliente-id/;
const tablasDe = (src: string) => {
  const s = new Set<string>();
  for (const m of src.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+`?([a-z][a-z0-9_]*)`?/gi)) s.add(m[1].toLowerCase());
  return s;
};
const conDueno = new Set([...conCliente, ...conNegocio, ...conOtroDueno]);

console.log('\n2) Módulos abiertos (' + [...abiertos].join(', ') + '): ¿tocan tablas privadas de ICA?');
const avisos: string[] = [];
let revisadas = 0;
for (const f of archivos) {
  const url = '/' + f.replace(/\\/g, '/').replace(/^app\//, '').replace(/\/route\.ts$/, '');
  const mod = moduloDeRuta(url);
  if (!mod || !abiertos.has(mod)) continue;
  revisadas++;
  const src = readFileSync(f, 'utf8');
  const tablas = [...tablasDe(src)];
  const privadas = tablas.filter(t => CLASE_TABLA[t] === 'PRIVADA_ICA');
  if (privadas.length && !/CLIENTE_ICA|usaViabilidadDeICA/.test(src)) falla(`${url} [${mod}] toca tablas privadas de ICA sin restringirse a ICA: ${privadas.join(', ')}`);
  // Escribir en documentos_cache sin el espacio de la empresa deja el archivo bajo el código a secas con cliente_id=1 (= de ICA): lo vería ICA y podría pisar uno suyo.
  if (/(INSERT INTO|UPDATE|DELETE FROM)s+documentos_cache/i.test(src) && !/codigoAlmacenDocs|CLIENTE_ICA/.test(src))
    falla(`${url} [${mod}] escribe en documentos_cache sin codigoAlmacenDocs(): el archivo de una empresa-cliente caería en el espacio de ICA`);
  const propias = tablas.filter(t => conDueno.has(t));
  if (propias.length && !MARCADOR.test(src)) avisos.push(`${url} [${mod}] → ${propias.slice(0, 4).join(', ')}`);
}
console.log(`   ${revisadas} rutas revisadas`);
errores === 0 || true;
if (!errores) ok('ninguna ruta abierta toca datos privados de ICA');

console.log('\n3) Avisos: rutas abiertas que tocan tablas con dueño y no muestran ningún filtro de empresa en el archivo');
if (!avisos.length) ok('ninguna');
else {
  console.log(`   ⚠ ${avisos.length} ruta(s). Pueden estar bien (el proxy cubre /api/negocios/<id>/comercial|lineas-oferta, o filtran por usuario), pero conviene mirarlas.`);
  if (process.argv.includes('--avisos')) for (const a of avisos) console.log('     -', a);
  else console.log('     (usa --avisos para verlas)');
}

console.log(errores ? `\n✘ ${errores} problema(s) por corregir.\n` : '\n✔ Aislamiento sin problemas bloqueantes.\n');
await pool.end();
process.exit(errores ? 1 : 0);
