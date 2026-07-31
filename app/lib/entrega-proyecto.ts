// app/lib/entrega-proyecto.ts
// MÓDULO DE ENTREGA DE PROYECTOS (Frente F.1) — Fase 1: cimiento de datos.
//
// Cuando MP confirma que ganamos, el área de entrega necesita tomar el proyecto sin tener que
// reconstruirlo leyendo la licitación completa. Este módulo arma ese paquete y lleva el registro
// de quién debe acusar recibo.
//
// DE DÓNDE SALE CADA DATO (nada se pide de nuevo, todo ya está en el sistema):
//   · QUÉ ganamos y a qué nos comprometimos → `checklist_comercial_congelamiento` (migración 55):
//     producto validado, costeo, plazos, matriz técnica, postventa y contactos del cliente.
//     Es el paquete que el equipo congeló AL POSTULAR, o sea lo que efectivamente se ofertó.
//   · POR QUÉ lo ganamos → `adjudicacion_cache`: el acta de MP. Nuestro monto adjudicado, el
//     total adjudicado, cuántos oferentes había y qué líneas se llevó cada quién.
//   · Contra quién competimos → las líneas del acta traen RUT y nombre del proveedor adjudicado.
//     OJO: el acta NO lista las ofertas PERDEDORAS, solo las adjudicadas. Sabemos el precio
//     ganador y cuántos compitieron, no el abanico completo de ofertas.
//
// El resumen se CONGELA al abrir la entrega, por la misma razón que el traspaso a Compras: es el
// registro de lo que se entregó, no una vista que cambia si mañana alguien edita el checklist.

import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import type { PaqueteTraspaso } from '@/app/lib/congelamiento';

export interface ResumenEjecutivo {
  // ── Qué ganamos ──
  licitacionCodigo: string;
  licitacionNombre: string | null;
  organismo: string | null;
  empresaNombre: string | null;          // razón social de la empresa del grupo que se lo adjudicó
  empresaRut: string | null;
  responsableNombre: string | null;      // quién llevó el negocio

  // ── Por qué lo ganamos (acta de MP) ──
  montoOfertado: number | null;          // lo que ofertamos (dato interno)
  montoNuestro: number | null;           // lo que se nos adjudicó (acta)
  montoAdjudicadoTotal: number | null;   // total de la licitación
  numeroOferentes: number | null;        // cuántos competían
  lineasGanadas: Array<{ producto: string | null; cantidad: number | null; montoUnitario: number | null }>;
  competidoresAdjudicados: Array<{ proveedor: string | null; rut: string | null; lineas: number }>;
  urlActa: string | null;
  fechaAdjudicacion: string | null;

  // ── Con qué nos comprometimos (paquete congelado al postular) ──
  plazosComprometidos: PaqueteTraspaso['plazosComprometidos'];
  compromisosPostventa: PaqueteTraspaso['compromisosPostventa'];
  productoValidado: PaqueteTraspaso['productoValidado'];
  matrizTecnica: PaqueteTraspaso['matrizTecnicaAprobada'] | null;
  costeo: PaqueteTraspaso['costeo'];
  contactosCliente: PaqueteTraspaso['contactosCliente'];

  // ── Trazabilidad de la propia construcción ──
  // Si algo faltaba al momento de ganar, queda dicho EN el resumen en vez de aparecer como un
  // hueco silencioso que el área de entrega descubre cuando ya es tarde.
  faltantes: string[];
}

/** Construye el resumen ejecutivo juntando el paquete congelado + el acta de MP. */
export async function construirResumenEjecutivo(
  negocioId: number,
  licitacionCodigo: string,
): Promise<ResumenEjecutivo> {
  const faltantes: string[] = [];

  // ── Datos base del negocio ─────────────────────────────────────────────────
  let base: any = {};
  try {
    const [rows] = await pool.query(
      // `empresas` identifica por razon_social + rut (no tiene columna `nombre`).
      `SELECT n.licitacion_nombre, n.licitacion_organismo, n.empresa_id, n.monto_ofertado,
              u.nombre AS responsable_nombre,
              e.razon_social AS empresa_nombre, e.rut AS empresa_rut
         FROM negocios n
         LEFT JOIN usuarios u ON u.id = n.asignado_a
         LEFT JOIN empresas e ON e.id = n.empresa_id
        WHERE n.id = ? LIMIT 1`,
      [negocioId],
    ) as any;
    base = (rows as any[])[0] || {};
  } catch (e) {
    console.error('[entrega] datos base del negocio fallaron:', String(e).slice(0, 200));
    faltantes.push('No se pudieron leer los datos del negocio.');
  }
  if (!base.empresa_nombre) faltantes.push('El negocio no tiene empresa asociada.');

  // ── Paquete congelado al postular (migración 55) ───────────────────────────
  let paquete: PaqueteTraspaso | null = null;
  try {
    const [rows] = await pool.query(
      `SELECT paquete_traspaso FROM checklist_comercial_congelamiento WHERE negocio_id = ? LIMIT 1`,
      [negocioId],
    ) as any;
    const raw = (rows as any[])[0]?.paquete_traspaso;
    if (raw) paquete = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    console.error('[entrega] paquete congelado no legible:', String(e).slice(0, 200));
  }
  if (!paquete) {
    // Pasa cuando se ganó una licitación postulada ANTES de que existiera el congelamiento, o
    // cuando el congelamiento falló al postular. No bloquea la entrega: se dice y se sigue.
    faltantes.push('No hay paquete congelado del Auditor (la licitación se postuló sin él).');
  }
  if (paquete && !paquete.contactosCliente) {
    faltantes.push('El paquete congelado quedó sin contactos del cliente.');
  }

  // ── Acta de MP (adjudicacion_cache) ────────────────────────────────────────
  let acta: any = {};
  let lineas: any[] = [];
  try {
    const [rows] = await pool.query(
      // fecha_adjudicacion se formatea EN SQL a 'YYYY-MM-DD HH:mm:ss'. Antes se leía como Date y
      // se guardaba con String(), que produce el toString() de JS ("Tue Jul 14 2026 13:53:37
      // GMT-0400 (hora estándar de Chile)"): depende del locale del proceso y arrastra una
      // conversión de zona sobre un dato que ya viene en hora de Chile. Formatear en SQL entrega
      // el instante EXACTO que está almacenado, sin reinterpretarlo.
      `SELECT es_adjudicada, numero_oferentes, monto_adjudicado_total, url_acta,
              DATE_FORMAT(fecha_adjudicacion, '%Y-%m-%d %H:%i:%s') AS fecha_adjudicacion, lineas
         FROM adjudicacion_cache WHERE licitacion_codigo = ? LIMIT 1`,
      [licitacionCodigo],
    ) as any;
    acta = (rows as any[])[0] || {};
    if (acta.lineas) lineas = typeof acta.lineas === 'string' ? JSON.parse(acta.lineas) : acta.lineas;
  } catch (e) {
    console.error('[entrega] acta no legible:', String(e).slice(0, 200));
  }
  if (!acta.es_adjudicada) faltantes.push('El acta de MP todavía no confirma la adjudicación.');

  const nuestras = lineas.filter(l => l?.esNuestra);
  const montoNuestro = nuestras.reduce(
    (acc, l) => acc + (Number(l.montoUnitario) || 0) * (Number(l.cantidad) || 1), 0) || null;

  // Competidores que SÍ se adjudicaron alguna línea (los perdedores no salen en el acta).
  const porProveedor = new Map<string, { proveedor: string | null; rut: string | null; lineas: number }>();
  for (const l of lineas) {
    if (l?.esNuestra) continue;
    const clave = String(l?.rutProveedor || l?.proveedor || 'desconocido');
    const prev = porProveedor.get(clave);
    if (prev) prev.lineas++;
    else porProveedor.set(clave, { proveedor: l?.proveedor ?? null, rut: l?.rutProveedor ?? null, lineas: 1 });
  }

  return {
    licitacionCodigo,
    licitacionNombre: base.licitacion_nombre ?? null,
    organismo: base.licitacion_organismo ?? null,
    empresaNombre: base.empresa_nombre ?? null,
    empresaRut: base.empresa_rut ?? null,
    responsableNombre: base.responsable_nombre ?? null,

    montoOfertado: base.monto_ofertado ?? null,
    montoNuestro,
    montoAdjudicadoTotal: acta.monto_adjudicado_total ?? null,
    numeroOferentes: acta.numero_oferentes ?? null,
    lineasGanadas: nuestras.map(l => ({
      producto: l.producto ?? null, cantidad: l.cantidad ?? null, montoUnitario: l.montoUnitario ?? null,
    })),
    competidoresAdjudicados: Array.from(porProveedor.values()),
    urlActa: acta.url_acta ?? null,
    fechaAdjudicacion: acta.fecha_adjudicacion ? String(acta.fecha_adjudicacion) : null,

    plazosComprometidos: paquete?.plazosComprometidos ?? [],
    compromisosPostventa: paquete?.compromisosPostventa ?? [],
    productoValidado: paquete?.productoValidado ?? [],
    matrizTecnica: paquete?.matrizTecnicaAprobada ?? null,
    costeo: paquete?.costeo ?? null,
    contactosCliente: paquete?.contactosCliente ?? null,

    faltantes,
  };
}

/**
 * Quiénes deben acusar recibo de un proyecto ganado.
 *  · el responsable del negocio (siempre — es quien lo trabajó),
 *  · todos los admin (son 3 hoy),
 *  · cualquier perfil con el permiso `entrega_proyectos`.
 *
 * Se resuelve por PERMISO y no por una lista fija para que agregar a alguien al circuito de
 * entrega sea otorgarle un permiso en el panel de usuarios, no editar código.
 */
export async function involucradosEnEntrega(asignadoA: number | null): Promise<number[]> {
  const ids = new Set<number>();
  if (asignadoA) ids.add(Number(asignadoA));
  try {
    const [rows] = await pool.query(
      `SELECT id, rol, permisos FROM usuarios WHERE activo = TRUE`,
    ) as any;
    for (const u of rows as any[]) {
      if (u.rol === 'admin') { ids.add(Number(u.id)); continue; }
      if (u.rol === 'externo') continue; // el rol externo no participa del circuito interno
      const p = await permisosDeUsuario(Number(u.id), u.rol);
      if ((p as any).entrega_proyectos) ids.add(Number(u.id));
    }
  } catch (e) {
    console.error('[entrega] no se pudo resolver los involucrados:', String(e).slice(0, 200));
  }
  return Array.from(ids);
}

/**
 * Abre la entrega de un proyecto ganado. IDEMPOTENTE: si ya estaba abierta no hace nada
 * (INSERT IGNORE sobre la PK), así el cron puede llamarla en cada pasada sin duplicar avisos.
 * Nunca lanza: un fallo acá no debe romper la promoción a ADJUDICADA.
 *
 * Devuelve true solo si la ABRIÓ en esta llamada (sirve para saber si hay que notificar).
 */
export async function abrirEntregaSiCorresponde(
  negocioId: number,
  licitacionCodigo: string,
  asignadoA: number | null,
): Promise<boolean> {
  try {
    const [ya] = await pool.query(
      `SELECT 1 FROM entrega_proyecto WHERE negocio_id = ? LIMIT 1`, [negocioId],
    ) as any;
    if ((ya as any[]).length > 0) return false;

    const resumen = await construirResumenEjecutivo(negocioId, licitacionCodigo);
    const ahora = ahoraChileSQL();

    const [r] = await pool.query(
      `INSERT IGNORE INTO entrega_proyecto
         (negocio_id, licitacion_codigo, abierta_at, origen, resumen)
       VALUES (?, ?, ?, 'ACTA_MP', ?)`,
      [negocioId, licitacionCodigo, ahora, JSON.stringify(resumen)],
    ) as any;
    if (!r?.affectedRows) return false; // otra corrida la abrió primero

    // Registrar a quién le toca acusar recibo.
    const involucrados = await involucradosEnEntrega(asignadoA);
    for (const uid of involucrados) {
      try {
        await pool.query(
          `INSERT IGNORE INTO entrega_acuse (negocio_id, usuario_id, notificado_at) VALUES (?, ?, ?)`,
          [negocioId, uid, ahora],
        );
        await registrarEvento({
          tipo: 'PROYECTO_GANADO',
          licitacionCodigo, licitacionNombre: resumen.licitacionNombre,
          usuarioId: uid, usuarioNombre: null,
          actorId: null, actorNombre: 'Mercado Público',
          mensaje: `🏆 Proyecto ganado: ${resumen.licitacionNombre || licitacionCodigo}. Requiere tu acuse de recibo.`,
          metadata: { licitacion_codigo: licitacionCodigo, negocio_id: negocioId, requiere_acuse: true },
        });
      } catch (e) {
        console.error(`[entrega] no se pudo notificar al usuario ${uid}:`, String(e).slice(0, 200));
      }
    }

    console.log(`[entrega] abierta para negocio ${negocioId} (${licitacionCodigo}) · ${involucrados.length} por acusar recibo` +
      (resumen.faltantes.length ? ` · ${resumen.faltantes.length} faltante(s) en el resumen` : ''));
    return true;
  } catch (e) {
    console.error('[entrega] abrir entrega falló (no bloquea la adjudicación):', String(e).slice(0, 300));
    return false;
  }
}

/** Marca que un usuario acusó recibo. Si con eso ya no queda nadie pendiente, cierra la entrega. */
export async function acusarRecibo(negocioId: number, usuarioId: number): Promise<{ ok: boolean; completada: boolean }> {
  try {
    await pool.query(
      `UPDATE entrega_acuse SET acusado_at = ?
        WHERE negocio_id = ? AND usuario_id = ? AND acusado_at IS NULL`,
      [ahoraChileSQL(), negocioId, usuarioId],
    );
    const [pend] = await pool.query(
      `SELECT COUNT(*) AS n FROM entrega_acuse WHERE negocio_id = ? AND acusado_at IS NULL`,
      [negocioId],
    ) as any;
    const completada = Number((pend as any[])[0]?.n ?? 1) === 0;
    if (completada) {
      await pool.query(
        `UPDATE entrega_proyecto SET completada_at = ? WHERE negocio_id = ? AND completada_at IS NULL`,
        [ahoraChileSQL(), negocioId],
      );
    }
    return { ok: true, completada };
  } catch (e) {
    console.error('[entrega] acusar recibo falló:', String(e).slice(0, 200));
    return { ok: false, completada: false };
  }
}

/** Entregas que ESTE usuario todavía no acusa (lo que dispara la alerta bloqueante en Fase 3). */
export async function entregasPendientesDe(usuarioId: number): Promise<Array<{
  negocioId: number; licitacionCodigo: string; licitacionNombre: string | null; abiertaAt: string;
}>> {
  try {
    const [rows] = await pool.query(
      `SELECT e.negocio_id, e.licitacion_codigo, e.abierta_at, n.licitacion_nombre
         FROM entrega_acuse a
         JOIN entrega_proyecto e ON e.negocio_id = a.negocio_id
         JOIN negocios n ON n.id = e.negocio_id
        WHERE a.usuario_id = ? AND a.acusado_at IS NULL
        ORDER BY e.abierta_at ASC`,
      [usuarioId],
    ) as any;
    return (rows as any[]).map(r => ({
      negocioId: r.negocio_id, licitacionCodigo: r.licitacion_codigo,
      licitacionNombre: r.licitacion_nombre, abiertaAt: String(r.abierta_at),
    }));
  } catch {
    return []; // migración 58 pendiente → sin alertas de entrega, el resto del sistema sigue igual
  }
}
