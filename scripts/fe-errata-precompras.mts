// Fe de errata a quienes recibieron «Proyecto ganado» por una PRE-COMPRA (POSIBLE ADJ).
// Un correo por destinatario con todas sus licitaciones. Por defecto NO envía: solo lista.
// Uso: npx tsx scripts/fe-errata-precompras.mts            (simulación)
//      npx tsx scripts/fe-errata-precompras.mts --enviar   (envía de verdad)
import { cargarEnv } from './regresion/_env.js';
cargarEnv();
const pool = (await import('../app/lib/db.js')).default;
const { destinatariosAperturaCompras } = await import('../app/lib/compras.js');
const { enviarFeErrataPrecompra } = await import('../app/lib/email.js');
const enviar = process.argv.includes('--enviar');

const [rows] = await pool.query(
  `SELECT ca.negocio_id, ca.licitacion_codigo, n.licitacion_nombre, n.asignado_a
     FROM compras_asignacion ca JOIN negocios n ON n.id = ca.negocio_id WHERE ca.precompra = 1`) as any;
const porUsuario = new Map<number, Array<{ codigo: string; nombre: string | null; negocioId: number }>>();
for (const r of rows as any[]) {
  for (const uid of await destinatariosAperturaCompras(r.asignado_a)) {
    const arr = porUsuario.get(uid) || [];
    arr.push({ codigo: r.licitacion_codigo, nombre: r.licitacion_nombre, negocioId: r.negocio_id });
    porUsuario.set(uid, arr);
  }
}
const ids = [...porUsuario.keys()];
const [us] = await pool.query(`SELECT id, nombre, email FROM usuarios WHERE id IN (?)`, [ids.length ? ids : [0]]) as any;
console.log(`${enviar ? 'ENVIANDO' : 'SIMULACIÓN'} — ${(rows as any[]).length} pre-compra(s), ${porUsuario.size} destinatario(s)`);
for (const u of us as any[]) {
  const ls = porUsuario.get(Number(u.id))!;
  console.log(`  ${u.nombre} <${u.email || 'SIN CORREO'}> → ${ls.map(l => l.codigo).join(', ')}`);
  if (enviar && u.email) console.log(`    ${(await enviarFeErrataPrecompra({ to: u.email, nombre: u.nombre, licitaciones: ls })) ? 'enviado' : 'FALLÓ'}`);
}
await pool.end();
