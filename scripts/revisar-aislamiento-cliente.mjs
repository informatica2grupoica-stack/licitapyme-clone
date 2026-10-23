// Revisor estático del aislamiento multi-cliente. Falla (exit 1) si una ruta/lib que un cliente puede alcanzar consulta una tabla
// PRIVADA sin mencionar la empresa (cliente_id / clienteId / clienteDeHeader / getClienteId).
// Es una red de seguridad barata, no una prueba: lo que prueba el aislamiento de verdad es scripts/cliente/probar-aislamiento-mismo-sistema.mjs.
// Uso: npx tsx scripts/revisar-aislamiento-cliente.mjs [--todo]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { moduloDeRuta } from '../app/lib/modulos.ts';

const todo = process.argv.includes('--todo');
const PRIV = ['negocios', 'etiquetas', 'palabras_clave', 'alertas_licitaciones', 'favoritos', 'licitaciones_descartadas',
  'comentarios_licitacion', 'historial_eventos', 'actividad_usuario', 'puente_radar', 'puente_cola', 'puente_repartos',
  'search_history', 'usuarios', 'empresas', 'reportes_error'];
const re = new RegExp('(?:FROM|JOIN|INTO|UPDATE)\\s+`?(' + PRIV.join('|') + ')\\b', 'gi');
const MENCIONA = /cliente_id|clienteId|clienteDeHeader|getClienteId|clienteIdOrNull|adjudicacionPorCliente|registroEsDeMiEmpresa|negocioEsDeMiEmpresa/;
// Libs de módulos que NO se venden en la Fase 1: un cliente no llega a ellas (proxy.ts las bloquea y los llamadores las condicionan con clienteTieneModulo).
const MODULO_NO_VENDIDO = /^app\/lib\/(compras|auditor|costeo|congelamiento|entrega|viabilidad|clasificacion|analisis-exhaustivo|anexos)/;
const walk = (d) => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const SEG = /\[[^\]]+\]/g;
const leer = (p) => { for (const e of ['', '.ts', '.tsx']) { try { return [p + e, readFileSync(p + e, 'utf8')]; } catch { /* sigue */ } } return [null, null]; };

const tablas = (t) => [...new Set([...t.matchAll(re)].map(m => m[1].toLowerCase()))];
const vistos = new Set();
const libs = (src, prof = 0) => {
  const out = [];
  for (const m of src.matchAll(/from '(@\/app\/lib\/[^']+)'/g)) {
    const [ruta, txt] = leer(m[1].replace('@/', ''));
    if (!ruta || vistos.has(ruta)) continue; vistos.add(ruta);
    out.push({ ruta, txt }); if (prof < 3) out.push(...libs(txt, prof + 1));
  }
  return out;
};

const problemas = [];
const rutas = walk('app/api').filter(f => f.endsWith('route.ts'))
  .map(f => ({ f, url: '/' + relative('app', f).split(sep).join('/').replace('/route.ts', '').replace(SEG, 'X') }));
for (const r of rutas) {
  const mod = moduloDeRuta(r.url);
  if (mod !== 'radar' && mod !== 'negocios' && !(todo && mod === 'comun')) continue;
  const src = readFileSync(r.f, 'utf8');
  const t = tablas(src);
  if (t.length && !MENCIONA.test(src)) problemas.push({ donde: r.f.split(sep).join('/'), tablas: t, tipo: 'ruta' });
  for (const l of libs(src)) {
    const tl = tablas(l.txt);
    if (tl.length && !MENCIONA.test(l.txt) && !MODULO_NO_VENDIDO.test(l.ruta.split(sep).join('/')) && !problemas.some(p => p.donde === l.ruta.split(sep).join('/')))
      problemas.push({ donde: l.ruta.split(sep).join('/'), tablas: tl, tipo: 'lib', desde: r.url });
  }
}
for (const p of problemas) console.log(`${p.tipo.padEnd(5)} ${p.donde}  → ${p.tablas.join(', ')}${p.desde ? '   (desde ' + p.desde + ')' : ''}`);
console.log(`\n${problemas.length} archivo(s) sin mencionar la empresa.`);
process.exit(problemas.length ? 1 : 0);
