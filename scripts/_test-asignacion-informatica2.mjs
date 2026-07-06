// PRUEBA EN VIVO: asigna una licitación a informatica2@grupoica.cl (id 8) actuando como
// admin, y luego observa si se descargan los documentos automáticamente (documentos_cache).
// Verifica los dos efectos del POST /api/negocios: correo de asignación + descarga-al-asignar.
import mysql from 'mysql2/promise';
import { SignJWT } from 'jose';
import { readFileSync } from 'node:fs';

const env = {};
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({ host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, port: +(env.DB_PORT || 3306) });
const q = async (s, a = []) => (await pool.query(s, a))[0];

const BASE = 'http://localhost:3000';
const CODIGO = process.argv[2] || '3498-16-LP26';   // licitación a asignar (PASA, sin docs)
const DESTINO = 8;                                    // informatica2@grupoica.cl

try {
  // Datos de la licitación (para el body de asignación).
  const [[lic]] = await pool.query(
    `SELECT MAX(licitacion_nombre) nombre, MAX(licitacion_organismo) org, MAX(licitacion_monto) monto,
            MAX(licitacion_cierre) cierre, MAX(licitacion_region) region
     FROM alertas_licitaciones WHERE licitacion_codigo=?`, [CODIGO]);

  // Docs previos (para comparar después).
  const [[{ n: docsAntes }]] = await pool.query('SELECT COUNT(*) n FROM documentos_cache WHERE licitacion_codigo=?', [CODIGO]);
  console.log(`Licitación ${CODIGO} — docs antes: ${docsAntes}`);
  console.log(`  "${(lic.nombre || '').slice(0, 60)}"`);

  // Mint JWT de admin (id 7, carlos@grupoica.cl) — mismo payload que crearToken().
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const token = await new SignJWT({ userId: 7, email: 'carlos@grupoica.cl', nombre: 'Asesor', empresa: null, rol: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(secret);

  // POST asignación.
  const resp = await fetch(`${BASE}/api/negocios`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `licitapyme_session=${token}` },
    body: JSON.stringify({
      licitacion_codigo: CODIGO, asignado_a: DESTINO,
      licitacion_nombre: lic.nombre, licitacion_organismo: lic.org,
      licitacion_monto: lic.monto, licitacion_cierre: lic.cierre, licitacion_region: lic.region,
    }),
  });
  const data = await resp.json();
  console.log(`\nPOST /api/negocios => ${resp.status}`, JSON.stringify(data));
  if (!resp.ok) { console.log('❌ La asignación falló — no sigo.'); await pool.end(); process.exit(1); }
  console.log('✅ Asignada. La descarga corre en segundo plano (fire-and-forget). Observando documentos_cache...');

  // Poll de docs por ~3 min.
  const t0 = Date.now();
  let visto = docsAntes;
  while (Date.now() - t0 < 180_000) {
    await new Promise(r => setTimeout(r, 10_000));
    const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM documentos_cache WHERE licitacion_codigo=?', [CODIGO]);
    const seg = Math.round((Date.now() - t0) / 1000);
    if (n !== visto) { console.log(`  [+${seg}s] documentos_cache = ${n} (antes ${docsAntes})`); visto = n; }
    else process.stdout.write(`  [+${seg}s] docs=${n}\r`);
    if (n > docsAntes) { console.log(`\n✅ DESCARGA AUTOMÁTICA OK: ${n - docsAntes} documento(s) nuevos.`); break; }
  }
  if (visto === docsAntes) console.log('\n⚠️ En 3 min no aparecieron documentos nuevos (ver logs del server).');
} catch (x) { console.log('ERROR', x.message); }
finally { await pool.end(); }
