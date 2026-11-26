// app/lib/compras-por-decidir.ts
// «POR DECIDIR»: capa de BD sobre compras-por-decidir-core.ts. Lista los casos de un negocio (sin IA, solo comparación de textos y precios) y guarda la
// decisión de una persona: «Sí sirve» (se asigna y queda como equivalencia de la EMPRESA), «Solo aquí» (se asigna en este negocio) o «No sirve» (no se
// vuelve a ofrecer). Todo es del cliente dueño del negocio.
import pool from '@/app/lib/db';
import { listarProductosCompra } from '@/app/lib/compras';
import { esSubestadoFuera } from '@/app/lib/compras-no-adjudicadas';
import { lineasDelNegocio } from '@/app/lib/compras-pareo-global-core';
import { detectarPorDecidir, patronDeLinea, type CasoPorDecidir, type Decision } from '@/app/lib/compras-por-decidir-core';
import { emparejarAMano } from '@/app/lib/compras-pareo-global';
import { listarEquivalencias, guardarEquivalencia } from '@/app/lib/compras-equivalencias';
import { clienteDeNegocio } from '@/app/lib/tenant';
import { ahoraChileSQL } from '@/app/lib/tz';

let lista = false;
async function asegurarTabla() {
  if (lista) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS compras_pareo_decision (
    id INT AUTO_INCREMENT PRIMARY KEY, cliente_id INT NOT NULL, negocio_id INT NOT NULL, clave VARCHAR(190) NOT NULL,
    cotizacion_id INT NOT NULL, producto_id INT NOT NULL, decision VARCHAR(12) NOT NULL, patron VARCHAR(120) NULL,
    decidido_por_nombre VARCHAR(160) NULL, created_at DATETIME NOT NULL,
    UNIQUE KEY uq_negocio_clave (negocio_id, clave), KEY idx_cliente (cliente_id)
  ) DEFAULT CHARSET=utf8mb4`);
  lista = true;
}

async function casosDelNegocio(negocioId: number, incluirDecididas = false): Promise<CasoPorDecidir[]> {
  await asegurarTabla();
  const [cots]: any = await pool.query(
    `SELECT id, proveedor_nombre, moneda, tipo_cambio_usado, notas, descuento_pct, precio_total, flete_monto, descripcion_libre, archivo_nombre
       FROM compras_cotizacion WHERE negocio_id = ? AND descripcion_libre IS NOT NULL AND descripcion_libre <> '' ORDER BY created_at, id`, [negocioId]);
  if (!cots.length) return [];
  const productos = (await listarProductosCompra(negocioId)).filter(p => !esSubestadoFuera(p.subestado) && !p.esServicio);
  const [items]: any = await pool.query(
    `SELECT ci.cotizacion_id, ci.producto_id, ci.precio_base FROM compras_cotizacion_item ci JOIN compras_cotizacion q ON q.id = ci.cotizacion_id WHERE q.negocio_id = ?`, [negocioId]);
  const [dec]: any = incluirDecididas ? [[]] : await pool.query('SELECT clave FROM compras_pareo_decision WHERE negocio_id = ?', [negocioId]);
  const nombre = new Map<number, string>(cots.map((c: any) => [Number(c.id), String(c.proveedor_nombre || 'Proveedor')]));
  return detectarPorDecidir({
    productos: productos.map(p => ({ id: p.id, descripcion: p.descripcion, cantidad: p.cantidad, unidad: p.unidad, subestado: p.subestado })),
    lineas: lineasDelNegocio(cots),
    itemsGuardados: (items as any[]).map(x => ({ cotizacionId: Number(x.cotizacion_id), productoId: Number(x.producto_id), precioBase: x.precio_base == null ? null : Number(x.precio_base) })),
    proveedorDe: id => nombre.get(id) ?? 'Proveedor',
    decididas: new Set((dec as any[]).map(d => String(d.clave))),
  });
}

export async function listarPorDecidir(negocioId: number): Promise<CasoPorDecidir[]> {
  return casosDelNegocio(negocioId);
}

/** La decisión se vuelve a calcular en el servidor: lo único que manda el navegador es la clave y qué se decidió. */
export async function decidirCaso(negocioId: number, clave: string, decision: Decision, actor: { id: number; nombre: string | null }): Promise<{ equivalenciaCreada: string | null }> {
  if (!['SI_SIRVE', 'NO_SIRVE', 'SOLO_AQUI'].includes(decision)) throw new Error('Decisión no válida.');
  const clienteId = await clienteDeNegocio(negocioId);
  if (!clienteId) throw new Error('Negocio no encontrado.');
  const caso = (await casosDelNegocio(negocioId)).find(c => c.clave === clave);
  if (!caso) throw new Error('Ese caso ya no está por decidir (alguien lo resolvió o cambió la cotización). Recarga la lista.');
  let patron: string | null = null;
  let equivalenciaCreada: string | null = null;
  if (decision !== 'NO_SIRVE') {
    await emparejarAMano(negocioId, {
      cotizacionId: caso.cotizacionId, productoId: caso.productoId, precio: caso.precioNeto, linea: caso.lineaTexto, cumple: 'INFERIOR_NEGOCIABLE',
      aviso: `Equivalente decidido por ${actor.nombre ?? 'el equipo'} (${decision === 'SI_SIRVE' ? 'queda como equivalencia de la empresa' : 'solo en este negocio'})`,
    }, actor);
  }
  if (decision === 'SI_SIRVE') {
    patron = patronDeLinea(caso.lineaTexto);
    const ya = (await listarEquivalencias(clienteId)).some(e => e.patron.toLowerCase() === patron!.toLowerCase());
    if (!ya) { await guardarEquivalencia(clienteId, patron, caso.productoDescripcion, actor.nombre); equivalenciaCreada = patron; }   // no se pisa una que el equipo ya fijó
  }
  await pool.query(
    `INSERT INTO compras_pareo_decision (cliente_id, negocio_id, clave, cotizacion_id, producto_id, decision, patron, decidido_por_nombre, created_at) VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE decision = VALUES(decision), patron = VALUES(patron), decidido_por_nombre = VALUES(decidido_por_nombre), created_at = VALUES(created_at)`,
    [clienteId, negocioId, caso.clave, caso.cotizacionId, caso.productoId, decision, patron, actor.nombre, ahoraChileSQL()]);
  return { equivalenciaCreada };
}
