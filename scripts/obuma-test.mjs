// Prueba rápida del cliente de Obuma contra la API real. Útil para reverificar cuando Obuma
// habilite v2.0 (Proyectos): ese día, agregar OBUMA_ACCESS_URL a .env.local y volver a correr esto.
// Uso: npx tsx scripts/obuma-test.mjs
import { readFileSync } from 'node:fs';
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const obuma = await import('../app/lib/obuma.ts');

const prov = await obuma.listarProveedores({ limit: 2 });
console.log('proveedores total:', prov['data-total-items']);

const oc = await obuma.listarComprasOc({ limit: 2 });
console.log('comprasOc total:', oc['data-total-items']);

try {
  const p = await obuma.listarProyectos({ limit: 2 });
  console.log('proyectos total:', p['data-total-items']);
  console.log('EJEMPLO REAL (para diseñar el cruce con facturas):');
  console.log(JSON.stringify(p.data?.[0], null, 2));
} catch (e) {
  console.log('proyectos (se espera que falle sin OBUMA_ACCESS_URL):', e.message);
}
