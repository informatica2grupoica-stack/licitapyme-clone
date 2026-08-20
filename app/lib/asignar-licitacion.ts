// app/lib/asignar-licitacion.ts
// ASIGNAR UNA LICITACIÓN A UN PERFIL — la lógica vive aquí, no en la ruta.
//
// POR QUÉ (20-ago-2026): asignar dejó de tener un solo punto de entrada. Estaba todo dentro de
// POST /api/negocios, y el Puente del Radar necesita exactamente lo mismo pero en lote y sin
// mandar 30 correos ni disparar 30 descargas simultáneas contra Mercado Público. En vez de
// duplicar 150 líneas (y que se desincronicen a la primera corrección), la ruta y el puente
// llaman a esta misma función; lo que cambia entre ambos son opciones, no código.
//
// Lo que hace una asignación, en orden:
//   1. Limpia el texto (nombre/organismo pueden venir con acentos rotos desde el cliente).
//   2. Mueve: desactiva cualquier otra asignación activa del mismo código (una licitación = un perfil).
//   3. Inserta/actualiza la fila de `negocios` y sus etiquetas.
//   4. Marca la alerta del radar como leída (asignar == revisar).
//   5. Notifica: bitácora + historial/campana + correo (opcional).
//   6. Dispara en segundo plano la descarga de documentos + pre-OCR + viabilidad automática.
//
// Los pasos 5 y 6 son best-effort: si fallan, la asignación YA ocurrió y no se revierte.

import pool from '@/app/lib/db';
import { registrarActividad } from '@/app/lib/actividad';
import { registrarEvento } from '@/app/lib/historial';
import { publicarCambio } from '@/app/lib/sse-bus';
import { textoLimpioDeLicitacion } from '@/app/lib/texto-limpio';
import { enviarCorreoAsignacion } from '@/app/lib/email';

export interface DatosLicitacion {
  licitacion_codigo: string;
  licitacion_nombre?: string | null;
  licitacion_organismo?: string | null;
  licitacion_monto?: number | null;
  licitacion_cierre?: string | Date | null;
  licitacion_estado?: string | null;
  licitacion_tipo?: string | null;
  licitacion_region?: string | null;
  licitacion_descripcion?: string | null;
}

export interface OpcionesAsignacion extends DatosLicitacion {
  asignado_a: number;
  /** Quién asigna (para la bitácora y `negocios.asignado_por`). */
  asignado_por: number;
  etiqueta_ids?: number[];
  /**
   * 'individual' → correo de asignación por licitación (comportamiento del radar).
   * 'ninguna'    → sin correo (el Puente manda UN digest por perfil al terminar la tanda).
   */
  correo?: 'individual' | 'ninguna';
  /** Repintar tableros por SSE. El lote lo apaga y publica UNA vez al final. */
  publicar?: boolean;
  /**
   * Descarga de documentos + pre-OCR + viabilidad automática, en segundo plano.
   * El lote lo apaga y los encadena EN SERIE después (30 descargas simultáneas
   * contra Mercado Público es exactamente cómo se gana un bloqueo).
   */
  postProceso?: boolean;
  /** Texto que se guarda en la bitácora para saber de dónde vino la asignación. */
  origen?: 'radar' | 'puente' | 'manual';
}

export interface ResultadoAsignacion {
  ok: boolean;
  id: number | null;
  reasignacion: boolean;
  destinoNombre: string | null;
  destinoEmail: string | null;
  error?: string;
}

/** Asigna UNA licitación a UN perfil. No lanza: devuelve `{ ok:false, error }`. */
export async function asignarLicitacion(o: OpcionesAsignacion): Promise<ResultadoAsignacion> {
  const codigo = o.licitacion_codigo;
  const base: ResultadoAsignacion = { ok: false, id: null, reasignacion: false, destinoNombre: null, destinoEmail: null };
  if (!codigo || !o.asignado_a) return { ...base, error: 'licitacion_codigo y asignado_a son requeridos' };

  try {
    // TEXTO LIMPIO: el nombre/organismo llegan desde el CLIENTE y hay rutas que los traen con el
    // acento ya destruido (U+FFFD: "Adquisici<?>n"). La BD es la fuente limpia — ver el comentario
    // largo en el historial de app/api/negocios/route.ts.
    const { nombre: nombreLimpio, organismo: organismoLimpio } =
      await textoLimpioDeLicitacion(codigo, o.licitacion_nombre ?? null, o.licitacion_organismo ?? null);

    // ¿Ya estaba asignada a alguien distinto? → es una REASIGNACIÓN.
    let prevAsignado: number | null = null;
    try {
      const [prev] = await pool.query(
        `SELECT asignado_a FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE ORDER BY id DESC LIMIT 1`,
        [codigo]);
      prevAsignado = (prev as any[])[0]?.asignado_a ?? null;
    } catch { /* tabla nueva */ }
    const reasignacion = prevAsignado != null && Number(prevAsignado) !== Number(o.asignado_a);

    // REGLA: una licitación pertenece a UN SOLO perfil. Antes de asignar, desactivamos cualquier
    // OTRA asignación activa del mismo código → reasignar = MOVER, nunca duplicar.
    try {
      await pool.query(
        `UPDATE negocios SET activo = FALSE
         WHERE licitacion_codigo = ? AND asignado_a <> ? AND activo = TRUE`,
        [codigo, o.asignado_a]);
    } catch { /* tabla nueva / sin filas: seguir */ }

    const [result] = await pool.query(
      `INSERT INTO negocios (
         licitacion_codigo, licitacion_nombre, licitacion_organismo, licitacion_monto,
         licitacion_cierre, licitacion_estado, licitacion_tipo, licitacion_region,
         licitacion_descripcion, asignado_a, asignado_por
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         licitacion_nombre = COALESCE(VALUES(licitacion_nombre), licitacion_nombre),
         licitacion_estado = COALESCE(VALUES(licitacion_estado), licitacion_estado),
         asignado_a = VALUES(asignado_a),
         asignado_por = VALUES(asignado_por),
         activo = TRUE`,
      [
        codigo, nombreLimpio, organismoLimpio,
        o.licitacion_monto || null,
        o.licitacion_cierre ? new Date(o.licitacion_cierre) : null,
        o.licitacion_estado || null, o.licitacion_tipo || null,
        o.licitacion_region || null, o.licitacion_descripcion || null,
        o.asignado_a, o.asignado_por,
      ]);
    const negocioId = (result as any).insertId || null;

    // Fecha de cierre de preguntas: se pide a MP de inmediato (fire-and-forget) para que la
    // alerta del slider "Destacadas" no espere el refresco de 2 h.
    import('@/app/lib/refrescar-estados')
      .then(({ refrescarEstadoCodigo }) => refrescarEstadoCodigo(codigo, o.licitacion_estado || null))
      .catch(() => { /* el refresco periódico lo cubre igual */ });

    // Asignar cuenta como REVISAR: la alerta del radar queda leída para todos.
    pool.query(
      `UPDATE alertas_licitaciones SET leida = TRUE WHERE licitacion_codigo = ? AND leida = FALSE`,
      [codigo],
    ).catch(() => { /* nunca bloquear la asignación */ });

    if (negocioId && (o.etiqueta_ids?.length || 0) > 0) {
      for (const eId of o.etiqueta_ids!) {
        await pool.query(
          `INSERT IGNORE INTO negocios_etiquetas (negocio_id, etiqueta_id) VALUES (?, ?)`,
          [negocioId, eId]);
      }
    }

    if (o.publicar !== false) publicarCambio('negocio');

    // ── Notificaciones (best-effort) ──────────────────────────────────────────
    let destinoNombre: string | null = null;
    let destinoEmail: string | null = null;
    try {
      const [uRows] = await pool.query(`SELECT nombre, email FROM usuarios WHERE id = ?`, [o.asignado_a]);
      const u = (uRows as any[])[0];
      destinoNombre = u?.nombre || u?.email || `usuario ${o.asignado_a}`;
      destinoEmail = u?.email || null;
      const [aRows] = await pool.query(`SELECT nombre, email FROM usuarios WHERE id = ?`, [o.asignado_por]);
      const actor = (aRows as any[])[0];
      const actorNombre = actor?.nombre || actor?.email || 'Un administrador';

      registrarActividad({
        usuarioId: o.asignado_por, accion: 'asignacion',
        entidadTipo: 'negocio', entidadId: String(negocioId || codigo),
        descripcion: `${reasignacion ? 'Reasignó' : 'Asignó'} la licitación ${codigo} a ${destinoNombre}`,
        metadata: {
          licitacion_codigo: codigo, licitacion_nombre: o.licitacion_nombre || null,
          asignado_a: o.asignado_a, asignado_a_nombre: destinoNombre, reasignacion,
          origen: o.origen || 'manual',
        },
      });

      await registrarEvento({
        tipo: reasignacion ? 'REASIGNACION' : 'ASIGNACION',
        licitacionCodigo: codigo, licitacionNombre: o.licitacion_nombre || null,
        usuarioId: Number(o.asignado_a), usuarioNombre: destinoNombre,
        actorId: o.asignado_por, actorNombre,
        mensaje: `${actorNombre} te ${reasignacion ? 'reasignó' : 'asignó'} la licitación ${o.licitacion_nombre || codigo}`,
        metadata: { licitacion_codigo: codigo, reasignacion, origen: o.origen || 'manual' },
      });

      if (o.correo !== 'ninguna' && destinoEmail) {
        enviarCorreoAsignacion({
          to: destinoEmail, nombre: u?.nombre, codigo,
          licitacionNombre: o.licitacion_nombre || null, organismo: o.licitacion_organismo || null,
          monto: o.licitacion_monto || null,
          cierre: o.licitacion_cierre ? String(o.licitacion_cierre) : null,
          actorNombre, reasignacion,
        }).catch(() => { /* registrado dentro de la función */ });
      }
    } catch { /* nunca bloquear la asignación por un fallo de notificación */ }

    if (o.postProceso !== false) {
      void dispararPostAsignacion(codigo, Number(o.asignado_a));
    }

    return { ok: true, id: negocioId, reasignacion, destinoNombre, destinoEmail };
  } catch (error) {
    console.error(`[asignacion] ${codigo} → usuario ${o.asignado_a}:`, String(error));
    return { ...base, error: String(error) };
  }
}

/**
 * POST-ASIGNACIÓN (segundo plano): descarga de documentos → pre-OCR → viabilidad automática.
 *
 * Estrategia elegida hace tiempo: no se bajan TODAS las que pasan el prefiltro, sino solo las
 * que de verdad se van a trabajar = las asignadas. Requiere IP chilena → corre en el VPS.
 * Kill-switches: DESCARGA_AL_ASIGNAR=false · PRE_OCR_AL_ASIGNAR=false · VIABILIDAD_AL_ASIGNAR=false.
 *
 * Se exporta para que el reparto en lote pueda encadenarlas EN SERIE en vez de disparar 30
 * descargas a la vez. Nunca lanza.
 */
export async function dispararPostAsignacion(codigo: string, asignadoA: number): Promise<void> {
  if (process.env.DESCARGA_AL_ASIGNAR === 'false') return;
  try {
    const [dc] = await pool.query(
      `SELECT 1 FROM documentos_cache WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
    const yaTeniaDocs = (dc as any[]).length > 0;

    if (!yaTeniaDocs) {
      const { descargarDocumentosLicitacion } = await import('@/app/lib/mp-descarga-orquestador');
      const res = await descargarDocumentosLicitacion(codigo);
      if (!res.exito) return; // sin documentos no hay nada que analizar — lo reintenta el cron
      if (process.env.PRE_OCR_AL_ASIGNAR !== 'false') {
        try {
          const { calentarCacheDocumentos } = await import('@/app/lib/viabilidad-ia');
          await calentarCacheDocumentos(codigo);
        } catch (e) { console.warn(`[asignacion] pre-OCR ${codigo}:`, String(e)); }
      }
    }

    const { encolarViabilidadAlAsignar } = await import('@/app/lib/viabilidad-al-asignar');
    await encolarViabilidadAlAsignar(codigo, asignadoA);
  } catch (e) {
    console.error(`[asignacion] post-proceso de ${codigo} falló:`, String(e));
  }
}
