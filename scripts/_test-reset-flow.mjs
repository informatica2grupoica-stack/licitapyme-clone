// Prueba E2E del flujo de recuperación con un usuario DESECHABLE (no toca cuentas reales).
// 1) crea usuario test  2) genera token + hash en password_resets  3) llama a
// /api/auth/restablecer  4) verifica que la clave cambió (bcrypt.compare)  5) borra todo.
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';

const e = {};
for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const pool = mysql.createPool({ host: e.DB_HOST, user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME, port: +(e.DB_PORT || 3306) });
const q = async (s, a = []) => (await pool.query(s, a))[0];
const EMAIL = 'test_reset_desechable_zzz@example.com';
const BASE = 'http://localhost:3000';

try {
  // Limpieza previa por si quedó de una corrida anterior
  const [old] = await pool.query('SELECT id FROM usuarios WHERE email=?', [EMAIL]);
  for (const u of old) { await q('DELETE FROM password_resets WHERE usuario_id=?', [u.id]); await q('DELETE FROM usuarios WHERE id=?', [u.id]); }

  // 1) crear usuario test con clave vieja
  const hashViejo = await bcrypt.hash('claveVieja123', 12);
  const r = await q(`INSERT INTO usuarios (email, password_hash, nombre, rol, activo) VALUES (?,?,?,'usuario',TRUE)`, [EMAIL, hashViejo, 'Test Reset']);
  const userId = r.insertId;
  console.log('1) usuario test creado id=', userId);

  // 2) token + hash
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await q(`INSERT INTO password_resets (usuario_id, token_hash, expira_en) VALUES (?,?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))`, [userId, tokenHash]);
  console.log('2) token de reset insertado');

  // 3) llamar al endpoint con la clave nueva
  const CLAVE_NUEVA = 'claveNueva456';
  const resp = await fetch(`${BASE}/api/auth/restablecer`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password: CLAVE_NUEVA }),
  });
  const data = await resp.json();
  console.log('3) POST /restablecer =>', resp.status, JSON.stringify(data));

  // 4) verificar en BD que la clave cambió y el token quedó usado
  const [[u2]] = await pool.query('SELECT password_hash FROM usuarios WHERE id=?', [userId]);
  const okNueva = await bcrypt.compare(CLAVE_NUEVA, u2.password_hash);
  const okViejaYaNo = !(await bcrypt.compare('claveVieja123', u2.password_hash));
  const [[tk]] = await pool.query('SELECT usado_en FROM password_resets WHERE usuario_id=?', [userId]);
  console.log('4) clave nueva válida:', okNueva, '· clave vieja ya no:', okViejaYaNo, '· token marcado usado:', !!tk.usado_en);

  // 4b) reusar el mismo token debe fallar (un solo uso)
  const resp2 = await fetch(`${BASE}/api/auth/restablecer`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, password: 'otraClave789' }),
  });
  console.log('4b) reuso del token =>', resp2.status, '(debe ser 400)');

  // 5) limpiar
  await q('DELETE FROM password_resets WHERE usuario_id=?', [userId]);
  await q('DELETE FROM usuarios WHERE id=?', [userId]);
  console.log('5) usuario test eliminado');

  const veredicto = okNueva && okViejaYaNo && !!tk.usado_en && resp2.status === 400;
  console.log('\n', veredicto ? '✅ FLUJO DE RECUPERACIÓN OK' : '❌ ALGO FALLÓ');
} catch (x) { console.log('ERROR', x.message); }
finally { await pool.end(); }
