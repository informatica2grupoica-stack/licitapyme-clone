// Fusiona los productos de Compras que quedaron REPETIDOS (misma línea y mismo texto) por el bug de sincronización con el costeo
// (caso #415: 5 productos pasaron a 13). Lo que colgaba de las copias (cotizaciones, veredictos, auditorías, SKU, incidencias,
// aprobaciones por producto y el escenario de compra) se pasa al producto ORIGINAL (el de menor id) y las copias se borran.
//
//   Simular (no escribe nada):  npx tsx --env-file=.env.local scripts/fusionar-productos-duplicados.mts 415
//   Aplicar (guarda respaldo):  npx tsx --env-file=.env.local scripts/fusionar-productos-duplicados.mts 415 --aplicar
//
// Respaldo: scripts/scratch/_respaldo-fusion-<negocio>-<fecha>.json (filas tal como estaban, para poder revertir a mano).
import { writeFileSync } from 'node:fs';
const pm: any = await import('../app/lib/db');
const pool = pm.default?.getConnection ? pm.default : pm.default?.default;

const negocioId = Number(process.argv[2]);
const aplicar = process.argv.includes('--aplicar');
if (!Number.isInteger(negocioId) || negocioId <= 0) { console.error('Uso: fusionar-productos-duplicados.mts <negocioId> [--aplicar]'); process.exit(1); }

const norm = (s: string | null) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const ORDEN = ['PENDIENTE', 'COTIZANDO', 'COMPRADO', 'EN_BODEGA', 'LISTO_ENTREGA', 'ENTREGADO'];
// Tablas que cuelgan de compras_producto.producto_id. Con restricción única (cotizacion+producto, producto) lo que choca con el original se descarta.
const TABLAS = ['compras_cotizacion_item', 'compras_veredicto', 'compras_auditoria_cotizacion', 'compras_cotizacion_adicional', 'compras_sku', 'compras_incidencia', 'compras_aprobacion_linea'];

const [prods]: any = await pool.query(`SELECT * FROM compras_producto WHERE negocio_id = ? ORDER BY id`, [negocioId]);
const grupos = new Map<string, any[]>();
for (const p of prods) { const k = `${p.correlativo ?? 'x'}|${norm(p.descripcion)}`; grupos.set(k, [...(grupos.get(k) ?? []), p]); }
const duplicados = [...grupos.values()].filter(g => g.length > 1);
if (duplicados.length === 0) { console.log(`Negocio ${negocioId}: no hay productos repetidos.`); process.exit(0); }

const mapa = new Map<number, number>();   // copia -> original
for (const g of duplicados) {
  const [orig, ...copias] = g;
  const raros = g.filter(p => ['RENUNCIADO', 'NO_ADJUDICADA'].includes(p.subestado));
  if (raros.length && raros.length !== g.length) { console.log(`OMITIDO «${String(orig.descripcion).slice(0, 50)}»: mezcla estados de renuncia/no adjudicada; revisar a mano.`); continue; }
  console.log(`«${String(orig.descripcion).slice(0, 55)}» → queda #${orig.id}; se fusionan ${copias.map(c => `#${c.id}`).join(', ')}`);
  for (const c of copias) mapa.set(c.id, orig.id);
}
const copiasIds = [...mapa.keys()];
if (copiasIds.length === 0) process.exit(0);

const colgando: Record<string, any[]> = {};
for (const t of TABLAS) { const [r]: any = await pool.query(`SELECT * FROM ${t} WHERE producto_id IN (?)`, [copiasIds]); colgando[t] = r; console.log(`  ${t}: ${r.length} fila(s) cuelgan de las copias`); }
const [escenarios]: any = await pool.query(`SELECT id, detalle_json FROM compras_escenario WHERE negocio_id = ?`, [negocioId]);
const escConCopias = escenarios.filter((e: any) => copiasIds.some(id => String(e.detalle_json).includes(`"productoId":${id}`)));
console.log(`  compras_escenario: ${escConCopias.length} escenario(s) mencionan una copia`);

if (!aplicar) { console.log('\nSIMULACIÓN: no se escribió nada. Agrega --aplicar para fusionar (guarda respaldo antes).'); process.exit(0); }

const archivo = `scripts/scratch/_respaldo-fusion-${negocioId}-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(archivo, JSON.stringify({ negocioId, mapa: [...mapa], productos: prods.filter((p: any) => mapa.has(p.id) || [...mapa.values()].includes(p.id)), colgando, escenarios: escConCopias }, null, 1));
console.log(`\nRespaldo guardado en ${archivo}`);

const remapear = (v: any): any => Array.isArray(v) ? v.map(remapear)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'productoId' && mapa.has(Number(x)) ? mapa.get(Number(x)) : remapear(x)]))
  : v;

const cx = await pool.getConnection();
try {
  await cx.beginTransaction();
  for (const [copia, orig] of mapa) {
    for (const t of TABLAS) {
      await cx.query(`UPDATE IGNORE ${t} SET producto_id = ? WHERE producto_id = ?`, [orig, copia]);
      await cx.query(`DELETE FROM ${t} WHERE producto_id = ?`, [copia]);      // lo que chocó con el original (ya lo tiene)
    }
    // El estado más avanzado del grupo queda en el original.
    const [[c]]: any = await cx.query(`SELECT subestado FROM compras_producto WHERE id = ?`, [copia]);
    const [[o]]: any = await cx.query(`SELECT subestado FROM compras_producto WHERE id = ?`, [orig]);
    if (ORDEN.indexOf(c.subestado) > ORDEN.indexOf(o.subestado) && ORDEN.indexOf(o.subestado) >= 0) await cx.query(`UPDATE compras_producto SET subestado = ? WHERE id = ?`, [c.subestado, orig]);
    await cx.query(`DELETE FROM compras_producto WHERE id = ? AND negocio_id = ?`, [copia, negocioId]);
  }
  for (const e of escConCopias) await cx.query(`UPDATE compras_escenario SET detalle_json = ? WHERE id = ?`, [JSON.stringify(remapear(JSON.parse(e.detalle_json))), e.id]);
  await cx.commit();
  console.log(`Listo: ${mapa.size} producto(s) repetido(s) fusionados.`);
} catch (e) {
  await cx.rollback();
  console.error('Falló y se deshizo todo:', e);
  process.exit(1);
} finally {
  cx.release();
}
process.exit(0);
