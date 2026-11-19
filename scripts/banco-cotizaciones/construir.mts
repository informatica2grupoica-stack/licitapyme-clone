// BANCO DE COTIZACIONES REALES — constructor (SOLO LECTURA de la BD).
// Saca de la BD todas las cotizaciones con tabla «LÍNEAS DEL DOCUMENTO» y guarda, por cada una, los productos de su negocio, el texto y lo que HOY
// tiene asignado (la «respuesta esperada»). Va a scripts/banco-cotizaciones/datos/ (FUERA de git: trae proveedores, RUT y precios reales).
//
//   npx tsx scripts/banco-cotizaciones/construir.mts            → reconstruye el banco completo
//
// Dos niveles de confianza de la respuesta esperada:
//   · ORO   = el producto fue APROBADO por una persona y esta cotización es la elegida para él (aprobación + escenario elegido).
//   · PLATA = lo que hay asignado hoy (lo hizo el agente o lo corrigió alguien; sirve para detectar regresiones, no para dar la razón).
import fs from 'fs';
import path from 'path';
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_0-9]+)=([^#\r]*)/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim(); }
const mysql = (await import('mysql2/promise')).default;
const { esSubestadoFuera } = await import('../../app/lib/compras-no-adjudicadas');
const { seleccionDesdeClave } = await import('../../app/lib/compras-auditor');

const c = await mysql.createConnection({ host: '127.0.0.1', port: Number(process.env.DB_PORT || 3307), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true });
const q = async (sql: string, p: any[] = []) => (await c.query(sql, p))[0] as any[];
const [{ h }] = await q('SELECT @@hostname h'); console.log('BD:', h);

const cots = await q(`SELECT c.*, n.licitacion_codigo FROM compras_cotizacion c JOIN negocios n ON n.id = c.negocio_id
                       WHERE c.descripcion_libre LIKE 'LÍNEAS DEL DOCUMENTO%' AND c.cotizacion_padre_id IS NULL ORDER BY c.negocio_id, c.id`).catch(async () =>
  await q(`SELECT c.*, n.licitacion_codigo FROM compras_cotizacion c JOIN negocios n ON n.id = c.negocio_id
            WHERE c.descripcion_libre LIKE 'LÍNEAS DEL DOCUMENTO%' ORDER BY c.negocio_id, c.id`));
console.log('cotizaciones con tabla:', cots.length);

const negocios = [...new Set(cots.map(x => x.negocio_id))];
const salida = path.join('scripts', 'banco-cotizaciones', 'datos');
fs.mkdirSync(salida, { recursive: true });
for (const f of fs.readdirSync(salida)) if (f.endsWith('.json')) fs.unlinkSync(path.join(salida, f));

let nOro = 0, nPlata = 0, nQuotes = 0;
for (const negocio of negocios) {
  const productos = (await q(`SELECT id, producto_padre_id, descripcion, cantidad, unidad, subestado, monto_unitario FROM compras_producto WHERE negocio_id = ? ORDER BY id`, [negocio]))
    .filter(p => !esSubestadoFuera(p.subestado));
  const aprobados = new Set((await q(`SELECT producto_id FROM compras_aprobacion_linea WHERE negocio_id = ? AND estado = 'APROBADA'`, [negocio])).map(x => Number(x.producto_id)));
  // elección vigente: producto → cotización
  const elegido: Record<number, number> = {};
  for (const e of await q(`SELECT detalle_json FROM compras_escenario WHERE negocio_id = ? AND elegido = 1`, [negocio]).catch(() => [])) {
    try { const dj = typeof e.detalle_json === 'string' ? JSON.parse(e.detalle_json) : e.detalle_json; Object.assign(elegido, seleccionDesdeClave(dj?.clave)); } catch { /* sin clave */ }
  }
  for (const cot of cots.filter(x => x.negocio_id === negocio)) {
    const items = await q(`SELECT i.producto_id, i.precio_unitario, i.precio_base, i.cumple FROM compras_cotizacion_item i WHERE i.cotizacion_id = ?`, [cot.id]);
    const adics = await q(`SELECT producto_id, concepto, cantidad, precio_unitario, creado_por FROM compras_cotizacion_adicional WHERE cotizacion_id = ?`, [cot.id]);
    const esperado = items.map(i => {
      const oro = aprobados.has(Number(i.producto_id)) && Number(elegido[Number(i.producto_id)]) === Number(cot.id);
      if (oro) nOro++; else nPlata++;
      return {
        producto_id: Number(i.producto_id), precio_unitario: i.precio_unitario == null ? null : Number(i.precio_unitario), precio_base: i.precio_base == null ? null : Number(i.precio_base),
        cumple: i.cumple, nivel: oro ? 'oro' : 'plata',
        adicionales: adics.filter(a => Number(a.producto_id) === Number(i.producto_id)).map(a => ({ concepto: a.concepto, cantidad: Number(a.cantidad), precio_unitario: Number(a.precio_unitario), manual: a.creado_por != null })),
      };
    });
    const registro = {
      id: Number(cot.id), negocio_id: Number(negocio), licitacion: cot.licitacion_codigo, origen: cot.origen,
      cotiz: {
        proveedor_nombre: cot.proveedor_nombre, precio_unitario: cot.precio_unitario, precio_total: cot.precio_total, moneda: cot.moneda, descripcion_libre: cot.descripcion_libre,
        tipo_cambio_usado: cot.tipo_cambio_usado, notas: cot.notas, descuento_pct: cot.descuento_pct, precio_unitario_clp: cot.precio_unitario_clp,
        precio_unitario_bruto: cot.precio_unitario_bruto, flete_monto: cot.flete_monto, descuento_sobre_total: cot.descuento_sobre_total ?? null,
      },
      productos: productos.map(p => ({ id: Number(p.id), descripcion: p.descripcion, cantidad: p.cantidad == null ? null : Number(p.cantidad), unidad: p.unidad, productoPadreId: p.producto_padre_id == null ? null : Number(p.producto_padre_id), montoUnitario: p.monto_unitario == null ? null : Number(p.monto_unitario) })),
      esperado,
    };
    fs.writeFileSync(path.join(salida, `cot-${cot.id}.json`), JSON.stringify(registro));
    nQuotes++;
  }
}
console.log(`banco: ${nQuotes} cotizaciones, ${negocios.length} negocios, ${nOro} asignaciones ORO y ${nPlata} PLATA → ${salida}`);
await c.end();
process.exit(0);
