// QA de solo lectura: llama el GET de cada ruta de Compras por negocio y reporta 5xx / excepciones / respuestas lentas.
import { NextRequest } from 'next/server';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const pool = ((await import('@/app/lib/db')) as any).default;
const base = 'app/api/compras/[negocioId]';
const rutas: string[] = [];
(function walk(d: string) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === 'route.ts') rutas.push(p); } })(base);
const SALTAR = /obuma|agente-documentos|auditor-costeo|extraer|sincronizar|\[id\]|\[skuId\]|\[tareaId\]|reloj\/|emparejar|parear|homologar|auditar|combustible|factura-venta|oc-envio|documentos-generados|documentos-logos|documentos-plantillas|captura|evidencia/;
const solo = process.argv[2] ? new RegExp(process.argv[2]) : null;
const [negs] = await pool.query(`SELECT negocio_id AS id, licitacion_codigo AS codigo FROM compras_asignacion ORDER BY negocio_id DESC`) as any;
const mods: Array<{ ruta: string; GET: any }> = [];
for (const r of rutas) {
  const rr = r.split('\\').join('/');
  const rel = rr.replace(base + '/', '').replace('/route.ts', '').replace('route.ts', '(raiz)');
  if (SALTAR.test(rel) || (solo && !solo.test(rel))) continue;
  try { const m = await import('@/' + rr); if (m.GET) mods.push({ ruta: rel, GET: m.GET }); } catch (e: any) { console.log('IMPORT-FALLA', rel, String(e).slice(0, 200)); }
}
console.log('rutas GET a probar:', mods.map(m => m.ruta).join(', '));
const resumen = new Map<string, { ok: number; mal: number; ejemplo: string }>();
let _i = 0;
for (const n of negs) {
  console.log('NEG', ++_i + '/' + negs.length, n.id, n.codigo);
  for (const m of mods) {
    const req = new NextRequest(`http://localhost/api/compras/${n.id}/${m.ruta}`, { headers: { 'x-user-id': '1', 'x-user-rol': 'admin', 'x-user-nombre': 'QA' } });
    const t0 = Date.now();
    try {
      const res: Response = await Promise.race([m.GET(req, { params: Promise.resolve({ negocioId: String(n.id) }) }), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('TIMEOUT 20s')), 20000))]);
      const ms = Date.now() - t0;
      const k = m.ruta; const s = resumen.get(k) || { ok: 0, mal: 0, ejemplo: '' };
      if (res.status >= 500) { console.log('MAL', m.ruta, n.id, res.status); s.mal++; if (!s.ejemplo) s.ejemplo = `neg ${n.id} (${n.codigo}) ${res.status} ${(await res.text()).slice(0, 160)}`; } else s.ok++;
      if (ms > 15000) console.log('LENTO', m.ruta, n.id, ms + 'ms');
      resumen.set(k, s);
    } catch (e: any) { console.log('EXC', m.ruta, n.id, String(e).slice(0,160)); const k = m.ruta; const s = resumen.get(k) || { ok: 0, mal: 0, ejemplo: '' }; s.mal++; if (!s.ejemplo) s.ejemplo = `neg ${n.id} EXCEPCIÓN ${String(e?.stack || e).slice(0, 300)}`; resumen.set(k, s); }
  }
}
for (const [k, s] of resumen) console.log(s.mal ? 'FALLA' : 'ok   ', k.padEnd(34), `ok=${s.ok} mal=${s.mal}`, s.ejemplo);
process.exit(0);
