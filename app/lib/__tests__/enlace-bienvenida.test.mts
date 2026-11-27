// Enlace de bienvenida: la persona crea su clave. Base de datos SIMULADA; usa la ruta real que fija la contraseña.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import pool from '../db';
import { crearEnlaceBienvenida, VIGENCIA_BIENVENIDA_HORAS } from '../enlace-clave';
import { GET, POST } from '../../api/auth/restablecer/route';

interface Fila { id: number; usuario_id: number; token_hash: string; vence: number; usado: boolean }
const filas: Fila[] = [];
const claves = new Map<number, string>();
const sesionesCerradas: number[] = [];
const db: any = (pool as any).query ? pool : (pool as any).default;
db.query = async (sql: string, p: any[] = []) => {
  if (/INSERT INTO password_resets/.test(sql)) filas.push({ id: filas.length + 1, usuario_id: p[0], token_hash: p[1], vence: Date.now() + p[2] * 3_600_000, usado: false });
  else if (/FROM password_resets/.test(sql)) return [filas.filter(f => f.token_hash === p[0] && !f.usado && f.vence > Date.now())];
  else if (/UPDATE password_resets SET usado_en = NOW\(\) WHERE usuario_id/.test(sql)) filas.filter(f => f.usuario_id === p[0]).forEach(f => { f.usado = true; });
  else if (/UPDATE password_resets SET usado_en = NOW\(\) WHERE id/.test(sql)) filas.find(f => f.id === p[0])!.usado = true;
  else if (/UPDATE usuarios SET password_hash/.test(sql)) claves.set(p[1], p[0]);
  else if (/INSERT INTO sesiones_revocadas/.test(sql)) sesionesCerradas.push(p[1]);
  return [[]];
};

const tokenDe = (ruta: string) => new URL(ruta, 'https://x.cl').searchParams.get('token')!;
const valido = async (t: string) => (await (await GET(new NextRequest(`http://x/api/auth/restablecer?token=${t}`))).json()).valido;
const fijar = (token: string, password: string) => POST(new NextRequest('http://x/api/auth/restablecer', { method: 'POST', body: JSON.stringify({ token, password }) }));

test('el enlace sirve una sola vez, guarda solo la huella y deja la clave que eligió la persona', async () => {
  const ruta = await crearEnlaceBienvenida(42);
  assert.match(ruta, /^\/restablecer\?token=[0-9a-f]{64}&bienvenida=1$/);
  const token = tokenDe(ruta);
  assert.equal(filas.at(-1)!.token_hash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.ok(!JSON.stringify(filas).includes(token), 'el token no se guarda');
  assert.ok(Math.abs(filas.at(-1)!.vence - Date.now() - VIGENCIA_BIENVENIDA_HORAS * 3_600_000) < 5000);
  assert.equal(await valido(token), true);
  assert.equal((await fijar(token, 'corta')).status, 400);
  assert.equal((await fijar(token, 'clave-de-prueba-123')).status, 200);
  assert.ok(await bcrypt.compare('clave-de-prueba-123', claves.get(42)!));
  assert.deepEqual(sesionesCerradas, [42]);
  assert.equal(await valido(token), false);
  assert.equal((await fijar(token, 'otra-clave-123456')).status, 400, 'no se puede reutilizar');
});

test('un enlace nuevo anula el anterior; uno vencido o inventado no sirve y no afecta a otra persona', async () => {
  const viejo = tokenDe(await crearEnlaceBienvenida(7)), ajeno = tokenDe(await crearEnlaceBienvenida(8));
  const nuevo = tokenDe(await crearEnlaceBienvenida(7));
  assert.deepEqual([await valido(viejo), await valido(nuevo), await valido(ajeno)], [false, true, true]);
  filas.at(-1)!.vence = Date.now() - 1;
  assert.equal(await valido(nuevo), false);
  assert.equal(await valido('a'.repeat(64)), false);
});

test('guardia: solo un admin de LICITANK crea enlaces, nunca para usuarios de ICA ni inactivos, y el enlace no se registra', () => {
  const s = readFileSync('app/api/admin/clientes/route.ts', 'utf8');
  const bloque = s.slice(s.indexOf("b.accion === 'usuario_estado' || b.accion === 'usuario_clave' || b.accion === 'usuario_enlace'"), s.indexOf("if (b.accion === 'usuario')"));
  assert.ok(bloque.indexOf('=== CLIENTE_ICA') >= 0 && bloque.indexOf('=== CLIENTE_ICA') < bloque.indexOf('crearEnlaceBienvenida(uid)'));
  assert.match(bloque, /if \(!uu\.activo\) return[\s\S]{0,200}crearEnlaceBienvenida\(uid\)/);
  assert.match(bloque, /'usuario_enlace', \{ email: uu\.email \}\)/);
  for (const f of ['app/api/admin/clientes/route.ts', 'app/api/admin/solicitudes/route.ts']) assert.match(readFileSync(f, 'utf8'), /const g = await exigirAdminLicitank\(req\);/, f);
  assert.doesNotMatch(readFileSync('app/restablecer/page.tsx', 'utf8'), /ICA Licitaciones/);
});
