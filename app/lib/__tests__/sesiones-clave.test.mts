// Cambiar la clave cierra las sesiones abiertas (QA 2026-11-27, S-5). Base de datos simulada: no conecta a ninguna.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pool from '../db';
import { sesionRevocada, cerrarSesionesDeUsuario, revocarSesion } from '../sesiones-revocadas';

type Fila = { jti: string; usuario_id: number; corte: number };
const tabla = new Map<string, Fila>();
const db: any = (pool as any).query ? pool : (pool as any).default;
db.query = async (sql: string, p: any[] = []) => {
  if (/^\s*SELECT/i.test(sql)) return [[...tabla.values()]];
  if (/ON DUPLICATE KEY/i.test(sql)) tabla.set(p[0], { jti: p[0], usuario_id: p[1], corte: p[3] });
  else if (/^\s*INSERT/i.test(sql)) tabla.set(p[0], { jti: p[0], usuario_id: p[1], corte: Math.floor(Date.now() / 1000) });
  return [[]];
};
const ahora = () => Math.floor(Date.now() / 1000);

test('cambiar la clave: caen las sesiones anteriores (con y sin jti), no la nueva ni las de otra persona', async () => {
  const antes = ahora() - 3600;
  assert.equal(await sesionRevocada('vieja', 7, antes), false);
  await cerrarSesionesDeUsuario(7);
  assert.equal(await sesionRevocada('vieja', 7, antes), true);
  assert.equal(await sesionRevocada(undefined, 7, antes), true, 'token sin jti');
  assert.equal(await sesionRevocada('nueva', 7, ahora()), false, 'la que se entrega al cambiar la clave');
  assert.equal(await sesionRevocada('otra', 8, antes), false);
  assert.ok(tabla.has('todas:7'), 'queda guardado para los otros procesos y tras reiniciar');
});

test('«Salir» sigue cerrando solo esa sesión', async () => {
  await revocarSesion('mia', 9, ahora() + 100);
  assert.equal(await sesionRevocada('mia', 9, ahora()), true);
  assert.equal(await sesionRevocada('la-del-telefono', 9, ahora()), false);
});

test('guardia: toda ruta que cambia una clave cierra las sesiones, y las 3 comprobaciones miran al usuario', () => {
  for (const f of ['app/api/auth/perfil/route.ts', 'app/api/auth/restablecer/route.ts', 'app/api/equipo/route.ts', 'app/api/admin/clientes/route.ts', 'app/api/admin/usuarios/route.ts'])
    assert.match(readFileSync(f, 'utf8'), /await cerrarSesionesDeUsuario\(/, f);
  for (const f of ['proxy.ts', 'app/lib/api-auth.ts', 'app/api/auth/me/route.ts'])
    assert.match(readFileSync(f, 'utf8'), /sesionRevocada\([\w.]+\.jti, [\w.]+, [\w.]+\.iat\)/, f);
  assert.doesNotMatch(readFileSync('app/api/auth/perfil/route.ts', 'utf8'), /SignJWT/, 'un solo lugar arma los tokens');
});
