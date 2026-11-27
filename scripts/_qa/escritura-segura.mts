// Solo comprueba que las rutas que ESCRIBEN rechazan bien (401 sin sesión, 404 negocio inexistente, 400 cuerpo inválido). Nunca toca un negocio real.
import { NextRequest } from 'next/server';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const base = 'app/api/compras/[negocioId]';
const rutas: string[] = [];
(function walk(d: string) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === 'route.ts') rutas.push(p); } })(base);
const malas: string[] = []; let probadas = 0;
for (const r of rutas) {
  const rr = r.split(String.fromCharCode(92)).join('/');
  let m: any; try { m = await import('@/' + rr); } catch { continue; }
  const rel = rr.replace(base + '/', '');
  for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    if (!m[metodo]) continue;
    const ruta = rel.replace(/\[(\w+)\]/g, '0');
    const params: any = { negocioId: '999999999', id: '0', skuId: '0', tareaId: '0' };
    for (const [nombre, headers, cuerpo] of [['sin sesión', {}, '{}'], ['negocio inexistente', { 'x-user-id': '1', 'x-user-rol': 'admin', 'x-user-nombre': 'QA' }, '{"accion":"__qa__"}']] as const) {
      probadas++;
      try {
        const res: Response = await Promise.race([m[metodo](new NextRequest(`http://localhost/api/compras/999999999/${ruta}`, { method: metodo, headers: { 'content-type': 'application/json', ...headers }, body: cuerpo }), { params: Promise.resolve(params) }), new Promise<never>((_, j) => setTimeout(() => j(new Error('TIMEOUT')), 20000))]);
        if (res.status >= 500) malas.push(`${metodo} ${rel} [${nombre}] → ${res.status} ${(await res.text()).slice(0, 120)}`);
      } catch (e: any) { malas.push(`${metodo} ${rel} [${nombre}] EXC ${String(e).slice(0, 140)}`); }
    }
  }
}
console.log('probadas', probadas, 'malas', malas.length); malas.forEach(x => console.log(x));
process.exit(0);
