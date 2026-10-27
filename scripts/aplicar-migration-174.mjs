// Migration-174: la BD pasa de hora de Denver a hora de Chile (America/Santiago).
//
// Por qué: el MySQL del VPS quedó en America/Denver para calzar con Bluehost. Todo lo que pone la BD sola
// (DEFAULT/ON UPDATE CURRENT_TIMESTAMP, NOW()) quedaba 3 h atrás de Chile (4 h desde el 1-nov), mientras
// que la app escribe hora chilena a mano en otras columnas. Desde esta migración NOW() = hora de Chile.
//
// Qué hace con los datos ya guardados (lista decidida el 2026-10-27 leyendo quién escribe cada columna en
// el código y la huella horaria de los datos: lo de Denver se agrupa a las 5-7 h, lo chileno a las 17-19 h):
//   • TIMESTAMP (MySQL las guarda en UTC y las muestra en la zona de la sesión): las que llenó la BD se
//     corrigen SOLAS al cambiar la zona. Las que la app llenó con hora chilena se moverían 3 h adelante:
//     esas se pasan de Santiago a Denver ANTES, para que después se lean igual que hoy.
//   • DATETIME (guardan la hora tal cual): las que llenó la BD están en hora de Denver y se pasan a Chile.
//     Las que llenó la app ya están en hora chilena y no se tocan.
//   CONVERT_TZ usa las tablas de zonas de MySQL: respeta el horario de verano de cada fecha.
//
// Uso (desde la raíz del repo, con el túnel al VPS abierto):
//   node scripts/aplicar-migration-174.mjs                         → ESPEJO local (127.0.0.1:3308), solo revisa
//   node scripts/aplicar-migration-174.mjs --aplicar               → ESPEJO local, aplica
//   node scripts/aplicar-migration-174.mjs --produccion            → producción, SOLO REVISA (no escribe)
//   node scripts/aplicar-migration-174.mjs --produccion --aplicar  → producción, aplica (OK del dueño, app detenida)
// Pasos completos del corte en docs/migration-174-hora-chile.md.
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const produccion = process.argv.includes('--produccion');
const aplicar = process.argv.includes('--aplicar');
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#\r\n]*)/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const conf = produccion
  ? { host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: parseInt(env.DB_PORT || '3306') }
  : { host: '127.0.0.1', user: 'licitank', password: 'licitank_local', database: 'licitank_dev', port: 3308 };

// TIMESTAMP escritas por la app con hora chilena → Santiago a Denver (se leerán igual tras el cambio).
const TIMESTAMP_CHILE = [
  ['actividad_usuario', 'created_at'],
  ['comentarios_licitacion', 'created_at'],
  ['comentarios_negocio', 'created_at'],
  ['historial_eventos', 'created_at'],
  ['licitaciones_descartadas', 'created_at'],
  ['negocios', 'created_at'],
  ['negocios', 'descarte_at'],
];
// Fuera a propósito: preguntas_respuestas_cache.consultado_en (caché con filas de las dos horas; al no
// tocarla, las de la BD se corrigen solas) y las TIMESTAMP mixtas documentos_cache.created_at /
// texto_extraido_at y negocios.updated_at (mayoría escrita por la BD).
// DATETIME escritas por la BD (DEFAULT, ON UPDATE o NOW()) → Denver a Santiago.
const DATETIME_DENVER = [
  ['auditor_comparador_linea', 'updated_at'],
  ['checklist_comercial', 'created_at'], ['checklist_comercial', 'updated_at'],
  ['checklist_comercial_caracteristicas', 'created_at'], ['checklist_comercial_caracteristicas', 'updated_at'],
  ['cliente_evaluacion', 'aplicado_at'], ['cliente_evaluacion', 'updated_at'],
  ['cliente_perfil', 'updated_at'], ['cliente_viabilidad', 'created_at'], ['cliente_viabilidad_v4', 'created_at'],
  ['clientes_bitacora', 'created_at'],
  ['compras_agente_auditoria_negocio', 'creado_at'], ['compras_agente_uso_diario', 'actualizado_at'],
  ['empresa_documentos', 'subido_at'], ['empresa_firmas', 'subido_at'],
  ['experiencia_caso', 'created_at'], ['experiencia_caso', 'updated_at'], ['experiencia_documento', 'subido_at'],
  ['licitacion_apertura', 'verificado_en'],
  ['licitaciones_cache', 'enriched_at'], ['licitaciones_cache', 'updated_at'],
  ['login_intentos', 'creado_en'], ['mp_api_uso_diario', 'actualizado_at'],
  ['negocios', 'readjudicada_at'],
  ['obuma_compras', 'created_at'], ['obuma_compras', 'updated_at'],
  ['ordenes_compra', 'created_at'], ['ordenes_compra', 'updated_at'],
  ['password_resets', 'creado_en'], ['password_resets', 'usado_en'],
  ['pipeline_fallos', 'primer_fallo_at'], ['pipeline_fallos', 'ultimo_fallo_at'],
  ['prefiltro_licitacion', 'created_at'], ['prefiltro_licitacion', 'updated_at'],
  ['puente_cola', 'creado_en'], ['puente_radar', 'agregado_en'],
  ['viabilidad_config', 'actualizado_en'],
];
const MARCA = 'migracion_174_hora_chile';

const c = await mysql.createConnection({ ...conf, connectTimeout: 20000 });
try {
  console.log(`\n  Base: ${conf.database} (${conf.host}:${conf.port})${produccion ? '  ← PRODUCCIÓN' : '  (espejo local)'} · ${aplicar ? 'APLICA' : 'solo revisa'}`);
  const [[zona]] = await c.query(`SELECT @@system_time_zone sys, @@global.time_zone g, DATE_FORMAT(NOW(), '%H:%i') ahora,
    DATE_FORMAT(CONVERT_TZ('2026-10-27 07:00:00', 'America/Denver', 'America/Santiago'), '%H:%i') prueba`);
  console.log(`  Zona BD: system=${zona.sys} global=${zona.g} · NOW()=${zona.ahora}`);
  if (zona.prueba !== '10:00') throw new Error(`CONVERT_TZ no funciona (dio ${zona.prueba}): faltan las tablas de zonas horarias de MySQL.`);
  const [[ya]] = await c.query(`SELECT COUNT(*) n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [MARCA]);
  if (Number(ya.n)) { console.log(`  Ya aplicada (existe la tabla ${MARCA}). Correrla otra vez correría las horas dos veces: no se hace nada.`); process.exit(0); }

  // Columnas reales de cada tabla (tipo + ON UPDATE), para saltar lo que no exista y no pisar los ON UPDATE.
  const [colsRows] = await c.query(`SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE d, EXTRA e FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE IN ('timestamp', 'datetime')`);
  const info = new Map(colsRows.map(r => [`${r.t}.${r.c}`, r]));
  const onUpdate = (t) => colsRows.filter(r => r.t === t && /on update/i.test(r.e)).map(r => r.c);

  // Agrupa por tabla: un solo UPDATE por tabla y fase.
  const plan = [];
  for (const [lista, tipo, desde, hacia] of [[TIMESTAMP_CHILE, 'timestamp', 'America/Santiago', 'America/Denver'], [DATETIME_DENVER, 'datetime', 'America/Denver', 'America/Santiago']]) {
    const porTabla = new Map();
    for (const [t, col] of lista) {
      const i = info.get(`${t}.${col}`);
      if (!i) { console.log(`    ! ${t}.${col} no existe, se omite`); continue; }
      if (i.d !== tipo) { console.log(`    ! ${t}.${col} es ${i.d}, se esperaba ${tipo}: se omite (revisar a mano)`); continue; }
      if (!porTabla.has(t)) porTabla.set(t, []);
      porTabla.get(t).push(col);
    }
    for (const [t, columnas] of porTabla) plan.push({ t, columnas, tipo, desde, hacia });
  }

  // TIMESTAMP: se leen y escriben en hora de Denver, independiente de la zona que tenga hoy el servidor.
  await c.query(`SET time_zone = 'America/Denver'`);
  for (const p of plan) {
    const conv = p.columnas.map(col => `\`${col}\` = CONVERT_TZ(\`${col}\`, '${p.desde}', '${p.hacia}')`);
    // Asignar explícitamente los ON UPDATE que no se convierten: si no, MySQL los pisaría con la hora actual.
    const quietas = onUpdate(p.t).filter(col => !p.columnas.includes(col)).map(col => `\`${col}\` = \`${col}\``);
    const donde = p.columnas.map(col => `\`${col}\` IS NOT NULL`).join(' OR ');
    const [[cuenta]] = await c.query(`SELECT COUNT(*) n FROM \`${p.t}\` WHERE ${donde}`);
    const [[muestra]] = await c.query(`SELECT DATE_FORMAT(\`${p.columnas[0]}\`, '%Y-%m-%d %H:%i') antes,
      DATE_FORMAT(CONVERT_TZ(\`${p.columnas[0]}\`, '${p.desde}', '${p.hacia}'), '%Y-%m-%d %H:%i') despues
      FROM \`${p.t}\` WHERE \`${p.columnas[0]}\` IS NOT NULL ORDER BY \`${p.columnas[0]}\` DESC LIMIT 1`).catch(() => [[{}]]);
    console.log(`    ${aplicar ? '+' : '·'} ${p.tipo.padEnd(9)} ${p.t}.(${p.columnas.join(', ')}) · ${cuenta.n} filas · ej. ${muestra?.antes ?? '—'} → ${muestra?.despues ?? '—'}${quietas.length ? ` · conserva ${onUpdate(p.t).filter(x => !p.columnas.includes(x)).join(', ')}` : ''}`);
    if (aplicar) await c.query(`UPDATE \`${p.t}\` SET ${[...conv, ...quietas].join(', ')} WHERE ${donde}`);
  }
  if (aplicar) {
    await c.query(`CREATE TABLE \`${MARCA}\` (aplicada_at DATETIME NOT NULL, nota VARCHAR(255))`);
    await c.query(`INSERT INTO \`${MARCA}\` VALUES (CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', 'America/Santiago'), 'datos pasados a hora de Chile; falta reiniciar la BD con TZ=America/Santiago')`);
    console.log(`\n  Listo. Ahora reiniciar la BD con TZ=America/Santiago (docs/migration-174-hora-chile.md, paso 5).`);
  } else {
    console.log(`\n  Solo revisión: no se escribió nada. Para aplicar, agregar --aplicar.`);
  }
} finally { await c.end(); }
