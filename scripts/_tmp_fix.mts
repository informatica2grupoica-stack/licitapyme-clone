import * as dbm from '@/app/lib/db'; const pool: any = (dbm as any).default?.default ?? (dbm as any).default ?? dbm;
import { emparejarAMano } from '@/app/lib/compras-pareo-global';
import { recalcularPreciosDeCotizacion } from '@/app/lib/compras-adicionales';
const [u]: any = await pool.query(`SELECT id, nombre FROM usuarios WHERE email LIKE 'tobaralexis%' LIMIT 1`);
const actor = { id: u[0].id, nombre: u[0].nombre };
console.log('actor', actor);
// 1) Panelli 6" 30HP lleva UN motor, no dos.
await pool.query(`UPDATE compras_cotizacion_adicional SET cantidad = 1 WHERE id = 1224 AND cotizacion_id = 476 AND producto_id = 740`);
await recalcularPreciosDeCotizacion(476);
// 2) 4SR6m/13 no es la 4SR 12M-9 del producto 811.
await pool.query(`DELETE FROM compras_cotizacion_adicional WHERE cotizacion_id=476 AND producto_id=811 AND creado_por IS NULL`);
await pool.query(`DELETE FROM compras_cotizacion_item WHERE cotizacion_id=476 AND producto_id=811`);
await pool.query(`DELETE FROM compras_auditoria_cotizacion WHERE cotizacion_id=476 AND producto_id=811`).catch(() => {});
// 3) Koslan #474: dosificadora Aqua HC151+ CST M80 = lo que el equipo definió para BETA 5, SB 1008 y BETA 4.
for (const pid of [724, 754, 801])
  await emparejarAMano(1356, { cotizacionId: 474, productoId: pid, precio: 171884.33, linea: '109368 BOMBA DOSIFICADORA AQUA HC151+ CST M80', cumple: 'INFERIOR_NEGOCIABLE', aviso: 'Verificar 8 l/h a 10 bar (homologación del Excel del equipo)' }, actor);
const [r]: any = await pool.query(`SELECT ci.cotizacion_id c, ci.producto_id pid, ci.precio_unitario pu, ci.precio_base pb FROM compras_cotizacion_item ci WHERE ci.cotizacion_id IN (474) OR (ci.cotizacion_id=476 AND ci.producto_id IN (740,811))`);
console.log(r);
process.exit(0);
