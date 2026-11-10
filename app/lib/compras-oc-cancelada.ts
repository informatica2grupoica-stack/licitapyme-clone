// app/lib/compras-oc-cancelada.ts
// La OC del cliente se canceló en Mercado Público (pedido del dueño, 10-nov-2026; migration-187).
//
// Qué pasa:
//   1. Si el organismo cancela la orden y no queda otra vigente de esa licitación, el negocio sale de
//      Compras a «Compras cerradas» (cierre_legado = 'OC_CANCELADA', «Sistema»). Si ya había compras a
//      proveedores emitidas NO se saca solo: queda en Compras y el aviso lo dice (ahí hay plata en juego).
//   2. Aviso por WhatsApp (regla 'oc_cancelada': comercial + encargados de Compras + admins). Las anteriores a
//      AVISOS_NUEVOS_DESDE van solo a Compras y admins, como «pasadas, ya se están resolviendo». El correo de
//      «la OC pasó a Cancelada» lo manda el cron de órdenes (ordenes-compra.ts → avisarOrdenes).
//   3. SOLO quien tiene Área «Compras» en el perfil tiene que escribir por qué
//      se canceló: les sale un modal que no se cierra (ModalFundamentoCancelacion en AppLayout). Los demás, solo el aviso.
//   4. Si después llega una OC vigente, el cierre automático se deshace solo.
//
// No importa nada de compras.ts (compras.ts sí importa este archivo): así no se arma un ciclo.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { publicarCambio } from '@/app/lib/sse-bus';
import { destinatariosDe, personasDeEmpresa } from '@/app/lib/avisos-destinatarios';
import { equipoDe } from '@/app/lib/avisos-reglas';
import { encolarAvisoWhatsapp } from '@/app/lib/whatsapp-avisos';

export const MIN_FUNDAMENTO = 20;
/** Decisión del dueño (10-nov-2026): por ahora la cancelación se avisa SOLO por WhatsApp (sin campana ni correo). Poner false para sumar la campana. */
export const AVISAR_SOLO_POR_WHATSAPP = true;
export const esEstadoCancelada = (estado: string | null | undefined) => /^cancel/i.test(String(estado || '').trim());

const sinTabla = (e: any) => e?.code === 'ER_NO_SUCH_TABLE';

/** Cancelaciones anteriores a esta fecha se avisan como «pasadas, ya se están resolviendo» y no como nuevas (decisión del dueño, 10-nov-2026). */
export const AVISOS_NUEVOS_DESDE = '2026-11-10';

/** Solo el equipo de Compras de ese negocio: encargado y coencargados (sin el comercial que postuló). */
async function encargadosComprasDe(negocioId: number): Promise<number[]> {
  const [rows] = await pool.query(
    `SELECT ca.asignado_a AS uid FROM compras_asignacion ca WHERE ca.negocio_id = ? AND ca.asignado_a IS NOT NULL
     UNION SELECT cc.usuario_id FROM compras_coencargado cc WHERE cc.negocio_id = ?`,
    [negocioId, negocioId],
  ) as any;
  return [...new Set((rows as any[]).map(r => Number(r.uid)).filter(n => n > 0))];
}

/** Encargados de la licitación: comercial que la postuló + encargado y coencargados de Compras. */
async function encargadosDe(negocioId: number): Promise<number[]> {
  const [rows] = await pool.query(
    `SELECT ca.asignado_a AS uid FROM compras_asignacion ca WHERE ca.negocio_id = ? AND ca.asignado_a IS NOT NULL
     UNION SELECT n.asignado_a FROM negocios n WHERE n.id = ? AND n.asignado_a IS NOT NULL
     UNION SELECT cc.usuario_id FROM compras_coencargado cc WHERE cc.negocio_id = ?`,
    [negocioId, negocioId, negocioId],
  ) as any;
  return [...new Set((rows as any[]).map(r => Number(r.uid)).filter(n => n > 0))];
}

/** ¿Hay compras a proveedores vigentes? (OC Obuma no anuladas, OC propias no anuladas, compras rápidas). */
async function tieneComprasEmitidas(negocioId: number): Promise<boolean> {
  const consultas = [
    `SELECT COUNT(*) n FROM compras_orden_compra_obuma o LEFT JOIN obuma_compras c ON c.compra_oc_id = o.obuma_compra_oc_id
      WHERE o.negocio_id = ? AND (c.estado IS NULL OR UPPER(c.estado) NOT LIKE '%ANULAD%')`,
    `SELECT COUNT(*) n FROM compras_oc_propia WHERE negocio_id = ? AND estado <> 'ANULADA'`,
    `SELECT COUNT(*) n FROM compras_compra_rapida WHERE negocio_id = ?`,
  ];
  for (const sql of consultas) {
    try {
      const [[r]] = await pool.query(sql, [negocioId]) as any;
      if (Number(r?.n) > 0) return true;
    } catch (e) { if (!sinTabla(e)) throw e; }
  }
  return false;
}

/**
 * Revisa un negocio cuya OC del cliente figura Cancelada y aplica el cierre + aviso. Idempotente: una
 * cancelación ya registrada (mismo negocio y misma OC) no se vuelve a procesar ni a avisar.
 * Devuelve true si registró una cancelación nueva.
 */
export async function procesarOcCancelada(negocioId: number): Promise<boolean> {
  const [[f]] = await pool.query(
    `SELECT ca.negocio_id, ca.licitacion_codigo, ca.oc_codigo_mp, ca.oc_estado_mp, ca.cierre_legado,
            COALESCE(n.cliente_id, 1) AS cliente_id, n.licitacion_nombre
       FROM compras_asignacion ca JOIN negocios n ON n.id = ca.negocio_id WHERE ca.negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  if (!f || !f.oc_codigo_mp || !esEstadoCancelada(f.oc_estado_mp)) return false;

  // Otra OC nuestra vigente para la misma licitación = no se cayó el negocio, solo se reemplazó la orden.
  const [[viva]] = await pool.query(
    `SELECT COUNT(*) n FROM ordenes_compra WHERE licitacion_codigo = ? AND es_nuestra = 1 AND codigo <> ?
        AND COALESCE(estado, '') NOT LIKE 'Cancel%'`,
    [f.licitacion_codigo, f.oc_codigo_mp],
  ) as any;
  if (Number(viva?.n) > 0) return false;

  const [[oc]] = await pool.query(
    `SELECT DATE_FORMAT(fecha_cancelacion, '%Y-%m-%d') AS fc FROM ordenes_compra WHERE codigo = ? LIMIT 1`, [f.oc_codigo_mp],
  ) as any;
  const canceladaAt: string | null = oc?.fc ?? null;
  const conCompras = await tieneComprasEmitidas(negocioId);
  const cierra = !conCompras && !f.cierre_legado;
  const ahora = ahoraChileSQL();

  const [ins] = await pool.query(
    `INSERT IGNORE INTO compras_oc_cancelacion (cliente_id, negocio_id, licitacion_codigo, oc_codigo, cancelada_at, cerro_compras, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [Number(f.cliente_id), negocioId, f.licitacion_codigo, f.oc_codigo_mp, canceladaAt, cierra ? 1 : 0, ahora],
  ) as any;
  if (!Number(ins?.affectedRows)) return false;   // ya registrada antes

  const fechaTxt = canceladaAt ? ` el ${canceladaAt.split('-').reverse().join('-')}` : '';
  if (cierra) {
    await pool.query(
      `UPDATE compras_asignacion
          SET cierre_legado = 'OC_CANCELADA', cierre_legado_nota = ?, cierre_legado_por = NULL,
              cierre_legado_por_nombre = 'Sistema', cierre_legado_at = ?
        WHERE negocio_id = ? AND cierre_legado IS NULL`,
      [`El organismo canceló la orden de compra ${f.oc_codigo_mp}${fechaTxt}.`, ahora, negocioId],
    );
  }

  const encargados = await encargadosDe(negocioId);
  const mensaje = cierra
    ? `🚫 El organismo canceló la orden de compra ${f.oc_codigo_mp} de ${f.licitacion_codigo}${fechaTxt}. El negocio pasó a Compras cerradas. Los encargados deben fundamentar por qué se canceló.`
    : `🚫 El organismo canceló la orden de compra ${f.oc_codigo_mp} de ${f.licitacion_codigo}${fechaTxt}, y ya hay compras a proveedores emitidas: el negocio sigue en Compras para resolverlas. Los encargados deben fundamentar por qué se canceló.`;
  // Quién se entera: encargado de la licitación + encargado y coencargados de Compras + admins (regla 'oc_cancelada').
  if (!AVISAR_SOLO_POR_WHATSAPP) {
    const destinatarios = new Set<number>(encargados);
    try {
      for (const d of await destinatariosDe('oc_cancelada', Number(f.cliente_id), encargados)) destinatarios.add(Number(d.id));
    } catch (e) { console.warn('[compras][oc-cancelada] destinatarios:', String(e).slice(0, 150)); }
    for (const uid of destinatarios) {
      await registrarEvento({
        tipo: 'COMPRAS_OC_CANCELADA', licitacionCodigo: f.licitacion_codigo, licitacionNombre: f.licitacion_nombre ?? null,
        usuarioId: uid, actorId: null, actorNombre: 'Mercado Público', mensaje,
        metadata: { negocio_id: negocioId, oc_codigo: f.oc_codigo_mp, cancelada_at: canceladaAt, cerro_compras: cierra, con_compras: conCompras },
      });
    }
  }
  // Pasada (cancelada antes de ${AVISOS_NUEVOS_DESDE}): solo Compras y admins, con el texto «no es nueva, se está resolviendo».
  // Nueva: el comercial que postuló + encargado y coencargados de Compras + admins (regla 'oc_cancelada').
  const pasada = !canceladaAt || canceladaAt < AVISOS_NUEVOS_DESDE;
  const accion = cierra ? 'El negocio pasó a Compras cerradas.' : 'Ya hay compras a proveedores emitidas: el negocio sigue en Compras.';
  let destinoIds: number[] | undefined;
  if (pasada) {
    const ids = new Set<number>(await encargadosComprasDe(negocioId));
    for (const u of await personasDeEmpresa(Number(f.cliente_id))) {
      if (u.rol === 'admin' || equipoDe(u.area) === 'compras') ids.add(Number(u.id));
    }
    destinoIds = [...ids];
  }
  await encolarAvisoWhatsapp({
    tipo: 'oc_cancelada', codigo: f.licitacion_codigo, nombre: f.licitacion_nombre ?? null, asignadoId: null, encargadosIds: encargados,
    clienteId: Number(f.cliente_id), ordenCodigo: f.oc_codigo_mp, destinoIds,
    detalle: pasada
      ? `Es una cancelación anterior, no es nueva: Compras ya la está resolviendo. ${accion} Desde ahora los avisos de cancelaciones nuevas saldrán así.`
      : `${accion} Hay que fundamentar por qué se canceló.`,
  });
  publicarCambio('compras');
  console.log(`[compras] OC ${f.oc_codigo_mp} cancelada · negocio ${negocioId}${cierra ? ' → Compras cerradas' : conCompras ? ' (con compras emitidas, sigue abierto)' : ''}`);
  return true;
}

/** Llegó una OC vigente: si el negocio estaba cerrado SOLO por la cancelación automática, vuelve a Compras. */
export async function reabrirSiOcVigente(negocioId: number, ocCodigo: string): Promise<void> {
  const [r] = await pool.query(
    `UPDATE compras_asignacion
        SET cierre_legado = NULL, cierre_legado_nota = NULL, cierre_legado_por = NULL, cierre_legado_por_nombre = NULL, cierre_legado_at = NULL
      WHERE negocio_id = ? AND cierre_legado = 'OC_CANCELADA' AND cierre_legado_por_nombre = 'Sistema'`,
    [negocioId],
  ) as any;
  if (Number(r?.affectedRows)) {
    console.log(`[compras] negocio ${negocioId} vuelve a Compras: llegó la OC vigente ${ocCodigo}`);
    publicarCambio('compras');
  }
}

/** Barrido del cron: toda OC del cliente cancelada que todavía no tenga su cancelación registrada (incluye las que ya estaban). */
export async function barrerOcCanceladas(): Promise<{ revisadas: number; registradas: number }> {
  const res = { revisadas: 0, registradas: 0 };
  let rows: any[];
  try {
    [rows] = await pool.query(
      `SELECT ca.negocio_id FROM compras_asignacion ca
        WHERE ca.oc_estado_mp LIKE 'Cancel%' AND ca.oc_codigo_mp IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM compras_oc_cancelacion x WHERE x.negocio_id = ca.negocio_id AND x.oc_codigo = ca.oc_codigo_mp)`,
    ) as any;
  } catch (e) {
    if (sinTabla(e)) return res;   // migration-187 pendiente
    throw e;
  }
  for (const r of rows) {
    res.revisadas++;
    try { if (await procesarOcCancelada(Number(r.negocio_id))) res.registradas++; }
    catch (e) { console.warn(`[compras][oc-cancelada] negocio ${r.negocio_id}:`, String(e).slice(0, 200)); }
  }
  return res;
}

export interface CancelacionPendiente {
  id: number; negocioId: number; licitacionCodigo: string; licitacionNombre: string | null; organismo: string | null;
  ocCodigo: string; canceladaAt: string | null; montoOc: number | null; cerroCompras: boolean;
}

/**
 * Cancelaciones sin fundamento que le tocan a este usuario (lo que dispara el modal). SOLO quien tiene Área «Compras» en el perfil
 * (decisión del dueño, 10-nov-2026): ve todas las de la empresa. Admins, comercial y los demás solo reciben el aviso.
 */
export async function cancelacionesPendientesDe(usuarioId: number, clienteId: number): Promise<CancelacionPendiente[]> {
  try {
    const [[ur]] = await pool.query(`SELECT area FROM usuarios WHERE id = ? LIMIT 1`, [usuarioId]) as any;
    if (equipoDe(ur?.area) !== 'compras') return [];
    const [rows] = await pool.query(
      `SELECT x.id, x.negocio_id, x.licitacion_codigo, x.oc_codigo, DATE_FORMAT(x.cancelada_at, '%Y-%m-%d') AS cancelada_at, x.cerro_compras,
              n.licitacion_nombre, COALESCE(NULLIF(n.licitacion_organismo, ''), o.comprador_organismo) AS organismo, o.total AS monto_oc
         FROM compras_oc_cancelacion x
         JOIN negocios n ON n.id = x.negocio_id
         JOIN compras_asignacion ca ON ca.negocio_id = x.negocio_id
         LEFT JOIN ordenes_compra o ON o.codigo = x.oc_codigo
        WHERE x.cliente_id = ? AND x.fundamentado_at IS NULL
        ORDER BY x.cancelada_at, x.id`,
      [clienteId],
    ) as any;
    return (rows as any[]).map(r => ({
      id: Number(r.id), negocioId: Number(r.negocio_id), licitacionCodigo: r.licitacion_codigo, licitacionNombre: r.licitacion_nombre ?? null,
      organismo: r.organismo ?? null, ocCodigo: r.oc_codigo, canceladaAt: r.cancelada_at ?? null,
      montoOc: r.monto_oc == null ? null : Number(r.monto_oc), cerroCompras: !!r.cerro_compras,
    }));
  } catch (e) {
    if (sinTabla(e)) return [];
    throw e;
  }
}

/** Guarda el fundamento. Solo Área Compras (ver cancelacionesPendientesDe), una sola vez. */
export async function fundamentarCancelacion(
  id: number, usuarioId: number, usuarioNombre: string | null, clienteId: number, texto: string,
): Promise<void> {
  const fundamento = String(texto || '').trim();
  if (fundamento.length < MIN_FUNDAMENTO) throw new Error(`Escribe al menos ${MIN_FUNDAMENTO} caracteres explicando por qué se canceló.`);
  const pendientes = await cancelacionesPendientesDe(usuarioId, clienteId);
  const c = pendientes.find(p => p.id === id);
  if (!c) throw new Error('Esa cancelación no está pendiente o no eres del Área Compras.');
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_oc_cancelacion SET fundamento = ?, fundamentado_por = ?, fundamentado_por_nombre = ?, fundamentado_at = ?
      WHERE id = ? AND fundamentado_at IS NULL`,
    [fundamento.slice(0, 4000), usuarioId, usuarioNombre, ahora, id],
  ) as any;
  if (!Number(r?.affectedRows)) throw new Error('Otro encargado ya fundamentó esta cancelación.');
  await registrarEvento({
    tipo: 'COMPRAS_OC_CANCELADA_FUNDAMENTO', licitacionCodigo: c.licitacionCodigo, actorId: usuarioId, actorNombre: usuarioNombre,
    mensaje: `${usuarioNombre || 'Un encargado'} fundamentó la cancelación de la OC ${c.ocCodigo}: "${fundamento.slice(0, 300)}"`,
    metadata: { negocio_id: c.negocioId, oc_codigo: c.ocCodigo, cancelacion_id: id },
  });
  publicarCambio('compras');
}

/** Una orden de compra NUESTRA de esa licitación, con las fechas que informa Mercado Público (para ver si se aceptó y cuándo se cayó). */
export interface OcDeCerrada {
  codigo: string; estado: string | null; totalNeto: number | null; total: number | null; moneda: string | null;
  enviadaAt: string | null; aceptadaAt: string | null; canceladaAt: string | null;
}

export interface CompraCerrada {
  negocioId: number; licitacionCodigo: string; licitacionNombre: string | null; organismo: string | null;
  motivo: string; nota: string | null; cerradaAt: string | null; cerradaPor: string | null;
  montoNuestro: number | null; encargado: string | null; postuladoPor: string | null; ganadoAt: string | null;
  ordenes: OcDeCerrada[];
  cancelacion: { ocCodigo: string; canceladaAt: string | null; fundamento: string | null; fundamentadoPor: string | null; fundamentadoAt: string | null } | null;
}

/** «Compras cerradas»: todo negocio de Compras con cierre, del cliente, el más reciente primero. */
export async function listarComprasCerradas(clienteId: number): Promise<CompraCerrada[]> {
  const [rows] = await pool.query(
    `SELECT ca.negocio_id, ca.licitacion_codigo, ca.cierre_legado, ca.cierre_legado_nota, ca.cierre_legado_por_nombre, ca.resumen_json,
            DATE_FORMAT(ca.cierre_legado_at, '%Y-%m-%d %H:%i:%s') AS cerrada_at, DATE_FORMAT(ca.ganado_at, '%Y-%m-%d') AS ganado_at,
            n.licitacion_nombre, NULLIF(n.licitacion_organismo, '') AS organismo, u.nombre AS encargado, up.nombre AS postulado_por
       FROM compras_asignacion ca
       JOIN negocios n ON n.id = ca.negocio_id
       LEFT JOIN usuarios u ON u.id = ca.asignado_a
       LEFT JOIN usuarios up ON up.id = n.asignado_a
      WHERE ca.cierre_legado IS NOT NULL AND COALESCE(n.cliente_id, 1) = ?
      ORDER BY ca.cierre_legado_at DESC, ca.negocio_id DESC`,
    [clienteId],
  ) as any;
  const ids = (rows as any[]).map(r => Number(r.negocio_id));
  const canc = new Map<number, CompraCerrada['cancelacion']>();
  const orgOc = new Map<string, string>();
  const ocsPorLic = new Map<string, OcDeCerrada[]>();
  if (ids.length) {
    const lics = [...new Set((rows as any[]).map(r => String(r.licitacion_codigo)))];
    const [ocs] = await pool.query(
      `SELECT licitacion_codigo, codigo, estado, total_neto, total, moneda,
              DATE_FORMAT(fecha_envio, '%Y-%m-%d') AS envio, DATE_FORMAT(fecha_aceptacion, '%Y-%m-%d') AS acepto, DATE_FORMAT(fecha_cancelacion, '%Y-%m-%d') AS cancelo
         FROM ordenes_compra WHERE licitacion_codigo IN (?) AND es_nuestra = 1 ORDER BY fecha_creacion, id`, [lics]) as any;
    for (const o of ocs as any[]) {
      const l = ocsPorLic.get(o.licitacion_codigo) ?? [];
      l.push({
        codigo: o.codigo, estado: o.estado ?? null, totalNeto: o.total_neto == null ? null : Number(o.total_neto), total: o.total == null ? null : Number(o.total),
        moneda: o.moneda ?? null, enviadaAt: o.envio ?? null, aceptadaAt: o.acepto ?? null, canceladaAt: o.cancelo ?? null,
      });
      ocsPorLic.set(o.licitacion_codigo, l);
    }
    try {
      const [cr] = await pool.query(
        `SELECT negocio_id, oc_codigo, DATE_FORMAT(cancelada_at, '%Y-%m-%d') AS cancelada_at, fundamento, fundamentado_por_nombre,
                DATE_FORMAT(fundamentado_at, '%Y-%m-%d %H:%i:%s') AS fundamentado_at
           FROM compras_oc_cancelacion WHERE negocio_id IN (?) ORDER BY id`, [ids]) as any;
      for (const c of cr as any[]) canc.set(Number(c.negocio_id), {   // la última manda
        ocCodigo: c.oc_codigo, canceladaAt: c.cancelada_at ?? null, fundamento: c.fundamento ?? null,
        fundamentadoPor: c.fundamentado_por_nombre ?? null, fundamentadoAt: c.fundamentado_at ?? null,
      });
    } catch (e) { if (!sinTabla(e)) throw e; }
    const cods = (rows as any[]).filter(r => !r.organismo).map(r => r.licitacion_codigo);
    if (cods.length) {
      const [or] = await pool.query(
        `SELECT licitacion_codigo, MAX(comprador_organismo) AS org FROM ordenes_compra WHERE licitacion_codigo IN (?) AND comprador_organismo <> '' GROUP BY licitacion_codigo`,
        [cods]) as any;
      for (const o of or as any[]) orgOc.set(o.licitacion_codigo, o.org);
    }
  }
  return (rows as any[]).map(r => {
    let monto: number | null = null;
    try { monto = JSON.parse(r.resumen_json)?.montoNuestro ?? null; } catch { /* sin resumen */ }
    return {
      negocioId: Number(r.negocio_id), licitacionCodigo: r.licitacion_codigo, licitacionNombre: r.licitacion_nombre ?? null,
      organismo: r.organismo ?? orgOc.get(r.licitacion_codigo) ?? null,
      motivo: r.cierre_legado, nota: r.cierre_legado_nota ?? null, cerradaAt: r.cerrada_at ?? null, cerradaPor: r.cierre_legado_por_nombre ?? null,
      montoNuestro: monto == null ? null : Number(monto), encargado: r.encargado ?? null, postuladoPor: r.postulado_por ?? null,
      ganadoAt: r.ganado_at ?? null, ordenes: ocsPorLic.get(r.licitacion_codigo) ?? [], cancelacion: canc.get(Number(r.negocio_id)) ?? null,
    };
  });
}
