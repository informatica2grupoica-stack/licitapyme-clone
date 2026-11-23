// Copia los DATOS de la base de PRODUCCIÓN (por el túnel SSH, puerto 3307) a la base LOCAL de Docker (puerto 3308).
//   node scripts/sincronizar-bd-local.mjs            → copia todo menos documentos_cache y las tablas *_captura (las pesadas)
//   node scripts/sincronizar-bd-local.mjs --todo     → copia todo, incluidas las pesadas (~1,3 GB)
//   node scripts/sincronizar-bd-local.mjs --tablas negocios,usuarios   → solo esas tablas
//
// SEGURIDAD
//  · De producción SOLO LEE (una transacción de solo lectura con foto consistente). Nunca escribe allá.
//  · Escribe ÚNICAMENTE en 127.0.0.1:3308 / licitank_dev; si el destino es otro, se niega a correr.
// MIGRACIONES LOCALES
//  · No reemplaza las tablas: vacía cada tabla local y le inserta las columnas que existen en AMBAS bases.
//    Así las columnas/tablas que solo existen en local (migraciones aún sin subir a producción) se conservan.
//  · Las tablas que existen en producción y no en local se crean con su definición.
import mysql from 'mysql2/promise';
import { readFileSync, existsSync } from 'node:fs';

function leerEnv(ruta) {
  const env = {};
  if (!existsSync(ruta)) return env;
  for (const l of readFileSync(ruta, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

const args = process.argv.slice(2);
const TODO = args.includes('--todo');
const soloTablas = (args[args.indexOf('--tablas') + 1] && args.includes('--tablas')) ? args[args.indexOf('--tablas') + 1].split(',').map(s => s.trim()).filter(Boolean) : null;

const src = leerEnv('.env.local');
const dst = leerEnv('.env.development.local');

if (String(dst.DB_HOST) !== '127.0.0.1' || String(dst.DB_PORT) !== '3308' || dst.DB_NAME !== 'licitank_dev') {
  console.error('ABORTADO: el destino no es la base local de Docker (127.0.0.1:3308 / licitank_dev). Revisa .env.development.local.');
  process.exit(1);
}
if (String(src.DB_PORT) === '3308' || src.DB_NAME === 'licitank_dev' || !src.DB_HOST) {
  console.error('ABORTADO: .env.local no apunta a producción (debe ser el túnel 127.0.0.1:3307).');
  process.exit(1);
}

const opcionesComunes = {
  dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, multipleStatements: false,
  typeCast: (field, next) => (field.type === 'JSON' ? field.string('utf8') : next()),
};
const prod = await mysql.createConnection({ host: src.DB_HOST, port: Number(src.DB_PORT || 3306), user: src.DB_USER, password: src.DB_PASSWORD, database: src.DB_NAME, ...opcionesComunes });
const local = await mysql.createConnection({ host: dst.DB_HOST, port: 3308, user: dst.DB_USER, password: dst.DB_PASSWORD, database: 'licitank_dev', ...opcionesComunes });

await prod.query(`SET time_zone = '+00:00'`);
await local.query(`SET time_zone = '+00:00'`);
await local.query(`SET FOREIGN_KEY_CHECKS = 0`);
await local.query(`SET SESSION sql_mode = 'NO_ENGINE_SUBSTITUTION'`);
await local.query(`SET SESSION max_allowed_packet = 268435456`).catch(() => {});

// Foto consistente y de solo lectura de producción: todas las tablas salen del mismo instante.
await prod.query(`START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`);

const [tablasProd] = await prod.query(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name`);
const [tablasLocal] = await local.query(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`);
const enLocal = new Set(tablasLocal.map(r => r.t.toLowerCase()));

const esPesada = t => t === 'documentos_cache' || t.endsWith('_captura');
let lista = tablasProd.map(r => r.t);
if (soloTablas) lista = lista.filter(t => soloTablas.includes(t));
else if (!TODO) lista = lista.filter(t => !esPesada(t));

const columnas = async (conn, t) => {
  const [r] = await conn.query(`SELECT column_name AS c, extra AS e FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`, [t]);
  return r.filter(x => !/GENERATED/i.test(x.e || '')).map(x => x.c);
};

const resumen = { ok: 0, errores: [], filas: 0, soloProd: [] };
const inicio = Date.now();
console.log(`Origen: producción (${src.DB_HOST}:${src.DB_PORT}) · Destino: Docker local 127.0.0.1:3308 · ${lista.length} tablas${TODO ? ' (modo --todo)' : soloTablas ? ' (selección)' : ' (sin documentos_cache ni *_captura)'}`);

for (const t of lista) {
  const t0 = Date.now();
  try {
    if (!enLocal.has(t.toLowerCase())) {
      const [[c]] = await prod.query(`SHOW CREATE TABLE \`${t}\``);
      await local.query(c['Create Table']);
    }
    const cp = await columnas(prod, t); const cl = await columnas(local, t);
    const setL = new Set(cl); const comunes = cp.filter(c => setL.has(c));
    const faltanLocal = cp.filter(c => !setL.has(c));
    if (faltanLocal.length) resumen.soloProd.push(`${t}: ${faltanLocal.join(', ')}`);
    if (!comunes.length) throw new Error('sin columnas en común');

    await local.query(`TRUNCATE TABLE \`${t}\``);
    const lista_cols = comunes.map(c => `\`${c}\``).join(',');
    const q = prod.connection.query({ sql: `SELECT ${lista_cols} FROM \`${t}\``, rowsAsArray: true });
    const stream = q.stream({ highWaterMark: 500 });
    let lote = [], bytes = 0, n = 0;
    const volcar = async () => {
      if (!lote.length) return;
      await local.query(`INSERT INTO \`${t}\` (${lista_cols}) VALUES ?`, [lote]);
      n += lote.length; lote = []; bytes = 0;
    };
    for await (const fila of stream) {
      lote.push(fila);
      bytes += fila.reduce((s, v) => s + (typeof v === 'string' ? v.length : Buffer.isBuffer(v) ? v.length : 8), 0);
      if (lote.length >= 500 || bytes > 8_000_000) await volcar();
    }
    await volcar();
    resumen.ok++; resumen.filas += n;
    console.log(`  ✓ ${t}: ${n} filas (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    resumen.errores.push(`${t}: ${String(e.message || e).slice(0, 160)}`);
    console.log(`  ✗ ${t}: ${String(e.message || e).slice(0, 160)}`);
  }
}

await prod.query(`ROLLBACK`).catch(() => {});
await local.query(`SET FOREIGN_KEY_CHECKS = 1`).catch(() => {});
await prod.end(); await local.end();

console.log(`\nListo en ${((Date.now() - inicio) / 60000).toFixed(1)} min: ${resumen.ok}/${lista.length} tablas, ${resumen.filas} filas.`);
if (resumen.soloProd.length) console.log(`Columnas que están en producción y NO en local (no se copiaron; aplica la migración local):\n  ${resumen.soloProd.join('\n  ')}`);
if (resumen.errores.length) { console.log(`Con error (${resumen.errores.length}):\n  ${resumen.errores.join('\n  ')}`); process.exit(2); }
