// Baja de Obuma a nuestra BD (tabla obuma_registro, migration-209). SIN IA: solo API de Obuma → BD.
//   npx tsx scripts/sincronizar-obuma-espejo.mts                          → solo muestra el estado (no llama a Obuma)
//   npx tsx scripts/sincronizar-obuma-espejo.mts --aplicar                → modo RÁPIDO (el del cron): solo lo nuevo o cambiado, ~10 llamadas en un día tranquilo
//   npx tsx scripts/sincronizar-obuma-espejo.mts --aplicar --completo     → baja los listados enteros (primera carga o reconciliación manual, ~100 llamadas)
//   npx tsx scripts/sincronizar-obuma-espejo.mts --aplicar --solo cliente,venta   → solo esas
//   --paginas N → tope de páginas por entidad (prueba: --paginas 1 baja 1.000 filas)
// Escribe en la BD de .env.local (hoy: producción por el túnel). Requiere migration-209. Cada entidad completa gasta 1–19 llamadas.
import fs from 'fs';

for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) {
    let v = m[2].trim();
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '').trim();
    process.env[m[1]] = v.replace(/^["']|["']$/g, '');
  }
}
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const aplicar = process.argv.includes('--aplicar');
const ORDEN = ['cliente', 'cobro_venta', 'producto', 'proveedor', 'gasto', 'compra_oc', 'venta', 'compra_dte', 'compra', 'pago_compra'];

async function main() {
  const pool = (await import('@/app/lib/db')).default;
  const { sincronizarEntidadObuma } = await import('@/app/lib/obuma-espejo');
  const [est]: any = await pool.query('SELECT entidad, total_obuma, filas_local, llamadas, ultima_sync, ultimo_error FROM obuma_sync_estado WHERE cliente_id = 1 ORDER BY entidad');
  console.table(est);
  if (!aplicar) { console.log('Solo estado. Para bajar de Obuma: --aplicar'); await pool.end(); return; }
  const solo = arg('--solo')?.split(',');
  const maxPaginas = Number(arg('--paginas')) || 60;
  for (const e of ORDEN.filter(x => !solo || solo.includes(x))) {
    const r = await sincronizarEntidadObuma(e, 1, process.argv.includes('--completo') ? 'completo' : 'rapido', maxPaginas);
    console.log(`${e} (${r.modo}): ${r.filasLocal} en BD de ${r.totalObuma ?? '?'} en Obuma · ${r.nuevas} nuevas, ${r.cambiadas} cambiadas, ${r.refrescadas} refrescadas · ${r.llamadas} llamadas${r.error ? ` · ERROR: ${r.error}` : ''}`);
    if (r.error) break;
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
