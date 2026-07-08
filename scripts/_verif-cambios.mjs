// Verificación de los cambios de automatización (2026-07-08).
// Prueba paso a paso contra el dev server local (:3000). No gasta IA pesada:
// solo guardas de auth, rutas vivas/borradas, enriquecer en modo lectura (?peek=1)
// y un snapshot de keywords para explicar el botón "Actualizar" en gris.
import { SignJWT } from 'jose';
import mysql from 'mysql2/promise';
import { readFileSync } from 'node:fs';

const env = {};
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const BASE = 'http://localhost:3000';
const SECRET = env.CRON_SECRET || '';

const line = (n, t) => console.log(`\n[${n}] ${t}`);
const ok = (b) => (b ? '✅' : '❌');

async function req(method, path, { bearer, cookie, timeout = 30000 } = {}) {
  const headers = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (cookie) headers.cookie = cookie;
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers, signal: AbortSignal.timeout(timeout) });
    let body = {};
    try { body = await r.json(); } catch {}
    return { status: r.status, body };
  } catch (e) { return { status: 0, body: { error: String(e?.name || e) } }; }
}

// Token admin (id 7) para pruebas que deben pasar el middleware.
const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);
const tokAdmin = await new SignJWT({ userId: 7, email: 'carlos@grupoica.cl', nombre: 'Admin', empresa: null, rol: 'admin' })
  .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(jwtSecret);
const cookieAdmin = `licitapyme_session=${tokAdmin}`;

// ── 1. Rutas BORRADAS deben dar 404 (con cookie admin, para pasar el middleware) ──
line('1', 'Rutas eliminadas → 404 (probadas con sesión admin para llegar al router)');
{
  // /api/radar/* pasa por middleware (no es pública) → con cookie admin llega al router → 404 si no existe.
  const pp = await req('GET', '/api/radar/procesar-pasa', { cookie: cookieAdmin });
  console.log(`   ${ok(pp.status === 404)} GET /api/radar/procesar-pasa → HTTP ${pp.status} (esperado 404)`);
  // /api/cron/* es pública en el middleware → llega directo al router → 404 si no existe.
  const pr = await req('POST', '/api/cron/procesar-radar');
  console.log(`   ${ok(pr.status === 404)} POST /api/cron/procesar-radar → HTTP ${pr.status} (esperado 404)`);
}

// ── 2. Rutas NUEVAS vivas + guarda de auth ───────────────────────────────────
line('2', 'Ruta nueva /api/cron/enriquecer → guarda de auth');
{
  const sin = await req('GET', '/api/cron/enriquecer?peek=1');
  console.log(`   ${ok(sin.status === 401)} sin secreto → HTTP ${sin.status} (esperado 401)`);
}

// ── 3. Enriquecer en modo LECTURA (?peek=1) con secreto → cuenta real ─────────
line('3', 'Enriquecer (solo cuenta, sin gastar API de enriquecer) con CRON_SECRET');
{
  const r = await req('GET', '/api/cron/enriquecer?peek=1', { bearer: SECRET, timeout: 60000 });
  console.log(`   ${ok(r.status === 200)} HTTP ${r.status}`);
  console.log('   respuesta:', JSON.stringify(r.body));
}

// ── 4. Prefiltro (GET = solo cuenta) con secreto ─────────────────────────────
line('4', 'Prefiltro (GET = cuenta pendientes) con CRON_SECRET');
{
  const r = await req('GET', '/api/cron/prefiltro', { bearer: SECRET, timeout: 30000 });
  console.log(`   ${ok(r.status === 200)} HTTP ${r.status} → ${JSON.stringify(r.body)}`);
}

// ── 5. /api/radar/actualizar → guarda por sesión (sin cookie = 401) ──────────
line('5', '/api/radar/actualizar → guarda de sesión');
{
  const sin = await req('POST', '/api/radar/actualizar');
  console.log(`   ${ok(sin.status === 401)} sin cookie → HTTP ${sin.status} (esperado 401)`);
  // Con cookie de usuario NO admin → 403 (rol). Minteamos un token rol 'usuario'.
  const secret = new TextEncoder().encode(env.JWT_SECRET);
  const tokUser = await new SignJWT({ userId: 999, email: 't@t.cl', nombre: 'T', empresa: null, rol: 'usuario' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(secret);
  const noAdmin = await req('POST', '/api/radar/actualizar', { cookie: `licitapyme_session=${tokUser}` });
  console.log(`   ${ok(noAdmin.status === 403)} cookie no-admin → HTTP ${noAdmin.status} (esperado 403)`);
}

// ── 6. Snapshot de keywords → explica el botón "Actualizar" en gris ──────────
line('6', 'Keywords activas por usuario (el botón se pone gris si el usuario logueado tiene 0)');
{
  const pool = mysql.createPool({
    host: env.DB_HOST, user: env.DB_USER, password: env.DB_PASSWORD,
    database: env.DB_NAME, port: +(env.DB_PORT || 3306),
  });
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.rol,
              SUM(CASE WHEN pk.activo = TRUE THEN 1 ELSE 0 END) AS activas,
              COUNT(pk.id) AS total
       FROM usuarios u
       LEFT JOIN palabras_clave pk ON pk.usuario_id = u.id
       WHERE u.activo = TRUE
       GROUP BY u.id, u.email, u.rol
       ORDER BY activas DESC`);
    for (const r of rows) {
      const gris = Number(r.activas) === 0 ? '  ← botón GRIS (0 activas)' : '';
      console.log(`   #${r.id} ${r.email} [${r.rol}] · activas=${r.activas || 0} / total=${r.total || 0}${gris}`);
    }
  } finally { await pool.end(); }
}

console.log('\n── fin verificación ──');
