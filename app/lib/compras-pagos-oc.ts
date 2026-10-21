// app/lib/compras-pagos-oc.ts
// PAGOS A PROVEEDORES POR ORDEN DE COMPRA (migration-157, pedido del dueño 21-oct-2026). Antes había
// UN solo «Pago registrado» y UN «Anticipo pagado» por negocio, que no decían a qué proveedor se le
// pagó cuando el negocio tiene varias OC (el 1191 tiene 16). Ahora cada pago cuelga de su OC, con
// tipo (anticipo / pago total / saldo), monto, fecha y comprobante obligatorio. La factura de cada OC
// no se registra a mano: llega sola desde Obuma (obuma_compras.facturas_json).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { comprasObumaDeLicitacion, esOcDeGarantia } from '@/app/lib/obuma-compras';

export type TipoPagoOc = 'ANTICIPO' | 'PAGO_TOTAL' | 'SALDO';
export const TIPOS_PAGO_OC: TipoPagoOc[] = ['ANTICIPO', 'PAGO_TOTAL', 'SALDO'];

export interface PagoOc {
  id: number; ocFolio: string; proveedorNombre: string | null; tipo: TipoPagoOc; monto: number; fecha: string;
  archivoUrl: string; archivoNombre: string | null; nota: string | null; creadoPorNombre: string | null; createdAt: string;
  /** Todos los comprobantes del pago; el primero es archivoUrl (migration-161: puede haber varios). */
  adjuntos: AdjuntoPago[];
}

export interface AdjuntoPago { url: string; nombre: string | null }

/** Una OC real de Obuma de la licitación, con sus facturas (para mostrar «Factura N° … · Ver XML»). */
export interface OcConFacturas {
  folio: string; estado: string | null; total: number | null; proveedorRut: string | null;
  facturas: Array<{ folio: string; fecha: string | null; total: number | null; s3Link: string | null }>;
}

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

export async function listarPagosOc(negocioId: number): Promise<PagoOc[]> {
  const [rows] = await pool.query(
    `SELECT id, oc_folio, proveedor_nombre, tipo, monto, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, archivo_url, archivo_nombre, adjuntos_json, nota,
            creado_por_nombre, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM compras_oc_pago WHERE negocio_id = ? ORDER BY fecha, id`,
    [negocioId],
  ) as any;
  return (rows as any[]).map(r => ({
    id: r.id, ocFolio: r.oc_folio, proveedorNombre: r.proveedor_nombre, tipo: r.tipo, monto: Number(r.monto), fecha: r.fecha,
    archivoUrl: r.archivo_url, archivoNombre: r.archivo_nombre, nota: r.nota, creadoPorNombre: r.creado_por_nombre, createdAt: r.created_at,
    adjuntos: [{ url: r.archivo_url, nombre: r.archivo_nombre }, ...(r.adjuntos_json ? JSON.parse(r.adjuntos_json) as AdjuntoPago[] : [])],
  }));
}

/** OC reales (no anuladas, no de garantía) de la licitación del negocio, con sus facturas. Solo lee la BD. */
export async function ocsConFacturas(negocioId: number): Promise<OcConFacturas[]> {
  const codigo = await licitacionDeNegocio(negocioId);
  if (!codigo) return [];
  const compras = await comprasObumaDeLicitacion(codigo);
  return compras
    .filter(c => !/anulad/i.test(c.estado || '') && !esOcDeGarantia(c))
    .map(c => ({
      folio: c.folio || c.compraOcId, estado: c.estado, total: c.total, proveedorRut: c.proveedorRut,
      facturas: c.facturas.map(f => ({ folio: f.folioDte, fecha: f.fecha, total: f.total, s3Link: f.s3Link })),
    }));
}

/** Una OC está pagada cuando tiene un pago total o el saldo registrado (un anticipo solo es pago parcial). */
export function ocPagada(pagos: PagoOc[], folio: string): boolean {
  return pagos.some(p => p.ocFolio === folio && (p.tipo === 'PAGO_TOTAL' || p.tipo === 'SALDO'));
}

const ETIQUETA: Record<TipoPagoOc, string> = { ANTICIPO: 'Anticipo', PAGO_TOTAL: 'Pago total', SALDO: 'Saldo' };

export async function registrarPagoOc(
  negocioId: number,
  datos: { ocFolio: string; proveedorNombre: string | null; tipo: TipoPagoOc; monto: number; fecha: string; adjuntos: AdjuntoPago[]; nota: string | null },
  actorId: number, actorNombre: string | null,
): Promise<void> {
  if (!datos.ocFolio.trim()) throw new Error('Falta la orden de compra.');
  if (!TIPOS_PAGO_OC.includes(datos.tipo)) throw new Error('Tipo de pago desconocido.');
  if (!(datos.monto > 0)) throw new Error('El monto tiene que ser mayor que cero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) throw new Error('Falta la fecha del pago.');
  const [principal, ...extras] = datos.adjuntos;
  if (!principal?.url) throw new Error('Falta el comprobante del pago.');
  await pool.query(
    `INSERT INTO compras_oc_pago (negocio_id, oc_folio, proveedor_nombre, tipo, monto, fecha, archivo_url, archivo_nombre, adjuntos_json, nota, creado_por, creado_por_nombre, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [negocioId, datos.ocFolio.trim(), datos.proveedorNombre, datos.tipo, Math.round(datos.monto), datos.fecha,
      principal.url, principal.nombre, extras.length ? JSON.stringify(extras) : null, datos.nota?.trim() || null, actorId, actorNombre, ahoraChileSQL()],
  );
  await registrarEvento({
    tipo: 'COMPRAS_PAGO_OC', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `${ETIQUETA[datos.tipo]} de $${Math.round(datos.monto).toLocaleString('es-CL')} a ${datos.proveedorNombre ?? 'proveedor'} (OC ${datos.ocFolio}), pagado el ${datos.fecha}.`,
    metadata: { negocio_id: negocioId, oc_folio: datos.ocFolio, tipo: datos.tipo, monto: datos.monto },
  });
}

/** Quita un pago registrado por error. Queda en el historial quién lo quitó y qué decía. */
export async function quitarPagoOc(negocioId: number, pagoId: number, actorId: number, actorNombre: string | null): Promise<void> {
  const pago = (await listarPagosOc(negocioId)).find(p => p.id === pagoId);
  if (!pago) throw new Error('Ese pago no existe en este negocio.');
  await pool.query(`DELETE FROM compras_oc_pago WHERE id = ? AND negocio_id = ?`, [pagoId, negocioId]);
  await registrarEvento({
    tipo: 'COMPRAS_PAGO_OC', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se quitó el ${ETIQUETA[pago.tipo].toLowerCase()} de $${pago.monto.toLocaleString('es-CL')} a ${pago.proveedorNombre ?? 'proveedor'} (OC ${pago.ocFolio}, del ${pago.fecha}).`,
    metadata: { negocio_id: negocioId, pago },
  });
}
