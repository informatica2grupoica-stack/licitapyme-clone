// scripts/corregir-hora-actividad.mjs
// Corrige de una vez el desfase histórico de actividad_usuario.created_at.
//
// EL PROBLEMA: la columna nacía con DEFAULT CURRENT_TIMESTAMP, o sea la hora del servidor MySQL
// de Bluehost (UTC-6). El proceso Node lee con TZ=America/Santiago (UTC-4 en invierno, UTC-3 en
// verano), así que el Historial mostraba todo 2-3 h en el pasado ("hace 2 h" recién ocurrido).
// Desde el fix, registrarActividad() escribe created_at explícito con ahoraChileSQL(); esto
// arregla las filas ANTERIORES a ese cambio.
//
// EL CÁLCULO: el desfase NO es constante — depende del horario de verano chileno vigente en la
// fecha de cada fila (3 h en verano, 2 h en invierno), por eso se resuelve fila por fila con la
// base de datos de zonas horarias de Node, no con un "+2 h" plano.
//
// CORRE UNA SOLA VEZ, y solo sobre las filas VIEJAS. Es obligatorio acotar con --hasta-id: una
// fila ya escrita en hora Chile (por el código nuevo) volvería a correrse +2 h si se reprocesa.
// El dry-run muestra el id máximo actual para usarlo como corte.
//
// Uso:
//   node scripts/corregir-hora-actividad.mjs                      → dry-run (no escribe nada)
//   node scripts/corregir-hora-actividad.mjs --run --hasta-id N   → respalda y escribe (id <= N)
import { readFileSync } from 'fs';
for (const line of readFileSync('D:/licitapyme-clone/.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const mysql = (await import('mysql2/promise')).default;
const ESCRIBIR = process.argv.includes('--run');
const argHasta = process.argv.indexOf('--hasta-id');
const HASTA_ID = argHasta > -1 ? parseInt(process.argv[argHasta + 1], 10) : null;
if (ESCRIBIR && !(HASTA_ID > 0)) {
  console.error('Falta --hasta-id N (id máximo a corregir). Corre primero el dry-run para verlo.');
  process.exit(1);
}

const pool = mysql.createPool({
  host: process.env.DB_HOST, port: +(process.env.DB_PORT || 3306), user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 2,
  // dateStrings: se lee el valor TAL CUAL lo guardó MySQL, sin que mysql2 lo reinterprete.
  dateStrings: true,
});

// Offset en minutos de una zona para un instante dado (respeta horario de verano).
function offsetMin(instante, zona) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(instante).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  const comoUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((comoUTC - instante.getTime()) / 60000);
}

// La zona real del servidor MySQL, medida contra el reloj de este proceso (no se asume UTC-6).
const [nowRows] = await pool.query('SELECT NOW() AS n');
const ahoraReal = new Date();
const mysqlPared = String(nowRows[0].n);
const mysqlComoUTC = Date.UTC(
  +mysqlPared.slice(0, 4), +mysqlPared.slice(5, 7) - 1, +mysqlPared.slice(8, 10),
  +mysqlPared.slice(11, 13), +mysqlPared.slice(14, 16), +mysqlPared.slice(17, 19));
const offsetMySQL = Math.round((mysqlComoUTC - ahoraReal.getTime()) / 60000 / 15) * 15; // a cuartos de hora
console.log(`Zona del servidor MySQL detectada: UTC${offsetMySQL >= 0 ? '+' : ''}${offsetMySQL / 60}`);
console.log(`Chile ahora: ${ahoraReal.toLocaleString('sv-SE', { timeZone: 'America/Santiago' })} · MySQL dice: ${mysqlPared}\n`);

const [filas] = HASTA_ID
  ? await pool.query('SELECT id, accion, created_at FROM actividad_usuario WHERE id <= ? ORDER BY id', [HASTA_ID])
  : await pool.query('SELECT id, accion, created_at FROM actividad_usuario ORDER BY id');
const [maxRow] = await pool.query('SELECT MAX(id) m FROM actividad_usuario');
console.log(`Filas a evaluar: ${filas.length}${HASTA_ID ? ` (corte id <= ${HASTA_ID})` : ''} · id máximo actual: ${maxRow[0].m}`);

const cambios = [];
for (const f of filas) {
  const s = String(f.created_at);
  // 1) La hora de pared guardada por MySQL, leída en SU zona → instante real del evento.
  const paredUTC = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13), +s.slice(14, 16), +s.slice(17, 19));
  const instante = new Date(paredUTC - offsetMySQL * 60000);
  // 2) Ese instante expresado en hora de pared de Chile (lo que el Historial debe mostrar).
  const chile = instante.toLocaleString('sv-SE', { timeZone: 'America/Santiago' });
  if (chile !== s.slice(0, 19)) cambios.push({ id: f.id, accion: f.accion, antes: s.slice(0, 19), despues: chile });
}

console.log(`Filas que cambian: ${cambios.length}\n`);
if (cambios.length) {
  const muestra = [...cambios.slice(0, 3), ...cambios.slice(-3)];
  console.log('Muestra (primeras y últimas):');
  console.table(muestra.map(c => ({
    id: c.id, accion: c.accion, antes: c.antes, despues: c.despues,
    diff: `+${((Date.parse(c.despues.replace(' ', 'T')) - Date.parse(c.antes.replace(' ', 'T'))) / 3600000).toFixed(0)} h`,
  })));
}

if (!ESCRIBIR) {
  console.log('\nDRY-RUN: no se escribió nada. Para aplicar:  node scripts/corregir-hora-actividad.mjs --run');
  await pool.end();
  process.exit(0);
}

// Respaldo completo antes de tocar una bitácora de auditoría.
await pool.query('DROP TABLE IF EXISTS actividad_usuario_bkp');
await pool.query('CREATE TABLE actividad_usuario_bkp AS SELECT * FROM actividad_usuario');
const [bkp] = await pool.query('SELECT COUNT(*) n FROM actividad_usuario_bkp');
console.log(`\nRespaldo creado: actividad_usuario_bkp (${bkp[0].n} filas)`);

let hechos = 0;
for (const c of cambios) {
  await pool.query('UPDATE actividad_usuario SET created_at = ? WHERE id = ?', [c.despues, c.id]);
  if (++hechos % 200 === 0) console.log(`  ${hechos}/${cambios.length}…`);
}
console.log(`\n✅ ${hechos} filas corregidas a hora de Chile.`);
console.log('Si algo saliera mal, se restaura con:');
console.log('  UPDATE actividad_usuario a JOIN actividad_usuario_bkp b ON b.id=a.id SET a.created_at=b.created_at;');
await pool.end();
