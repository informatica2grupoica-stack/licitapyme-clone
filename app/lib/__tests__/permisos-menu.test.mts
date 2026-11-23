// El menú de privilegios (Admin → Usuarios) y el código deben decir lo mismo.
//   npx tsx --test app/lib/__tests__/permisos-menu.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync('app/lib/api-auth.ts', 'utf8');
const pagina = readFileSync('app/admin/usuarios/page.tsx', 'utf8');
const sesion = readFileSync('app/lib/session-context.tsx', 'utf8');

const tipo = [...(api.match(/export type Permiso =([\s\S]*?);\nexport type Permisos/)![1]).matchAll(/'(\w+)'/g)].map(m => m[1]);
const admin = api.match(/const PERMISOS_ADMIN: Record<Permiso, boolean> = \{([\s\S]*?)\n\};/)![1];
const catalogo = [...pagina.matchAll(/\{ key: '(\w+)',\s+label:/g)].map(m => m[1]);
const interfazPagina = pagina.match(/interface Permisos \{([\s\S]*?)\n\}/)![1];

test('hay permisos y se leyeron bien', () => {
  assert.ok(tipo.length > 40, `solo se leyeron ${tipo.length} permisos del tipo`);
  assert.ok(catalogo.length > 40, `solo se leyeron ${catalogo.length} casillas del menú`);
});

test('todo permiso del tipo tiene valor para admin', () => {
  for (const k of tipo) assert.match(admin, new RegExp(`\\b${k}:`), `PERMISOS_ADMIN no define ${k}`);
});

test('todo permiso del tipo tiene su casilla en el menú de privilegios', () => {
  for (const k of tipo) assert.ok(catalogo.includes(k), `el menú no tiene la casilla «${k}»`);
});

test('la interfaz de la página y la sesión conocen cada permiso', () => {
  for (const k of tipo) {
    assert.match(interfazPagina, new RegExp(`\\b${k}\\??:`), `interfaz de la página sin ${k}`);
    if (k !== 'reglas_ia') assert.match(sesion, new RegExp(`\\b${k}\\??:`), `session-context sin ${k}`);
  }
});

test('cada casilla del menú tiene descripción de al menos 25 caracteres', () => {
  for (const m of pagina.matchAll(/\{ key: '(\w+)',\s+label: '(?:[^'\\]|\\.)*',\s+desc: '((?:[^'\\]|\\.)*)'/g)) {
    assert.ok(m[2].length >= 25, `«${m[1]}» tiene una descripción muy corta`);
  }
});
