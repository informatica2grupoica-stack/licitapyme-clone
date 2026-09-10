// app/lib/compras-fracaso.ts
// ESTADO DE FRACASO (spec §14.6) — "si el proyecto definitivamente no se puede entregar, es un
// fracaso y se registra como tal." Insumo directo de la trazabilidad (§18.2: "se registran... los
// motivos declarados y dictaminados en un fracaso") y de §18.5 ("dictamen de causa en un fracaso:
// el histórico completo de tareas realizadas y no realizadas es la evidencia con la que el jefe de
// ventas determina el motivo real").
//
// DOBLE REGISTRO DELIBERADAMENTE SEPARADO: el encargado declara SU motivo, el jefe de ventas
// dictamina el motivo REAL tras un análisis independiente — nunca se pisan entre sí. Ejemplo de la
// spec: el encargado declara "no se alcanzó a entregar en plazo" y el jefe de ventas concluye "no
// se alcanzó porque no se gestionó".
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

export interface Fracaso {
  motivoDeclarado: string; declaradoPorNombre: string | null; declaradoAt: string;
  dictamenJefeVentas: string | null; dictaminadoPorNombre: string | null; dictaminadoAt: string | null;
}

export async function obtenerFracaso(negocioId: number): Promise<Fracaso | null> {
  const [rows] = await pool.query(
    `SELECT motivo_declarado, declarado_por_nombre, DATE_FORMAT(declarado_at, '%Y-%m-%d %H:%i:%s') AS declarado_at,
            dictamen_jefe_ventas, dictaminado_por_nombre, DATE_FORMAT(dictaminado_at, '%Y-%m-%d %H:%i:%s') AS dictaminado_at
       FROM compras_fracaso WHERE negocio_id = ? LIMIT 1`,
    [negocioId],
  ) as any;
  const r = (rows as any[])[0];
  if (!r) return null;
  return {
    motivoDeclarado: r.motivo_declarado, declaradoPorNombre: r.declarado_por_nombre, declaradoAt: r.declarado_at,
    dictamenJefeVentas: r.dictamen_jefe_ventas, dictaminadoPorNombre: r.dictaminado_por_nombre, dictaminadoAt: r.dictaminado_at,
  };
}

/** Paso 1 — "el encargado de entrega verifica que no se puede entregar y declara los motivos." */
export async function declararFracaso(negocioId: number, motivo: string, actorId: number, actorNombre: string | null): Promise<void> {
  if (!motivo?.trim()) throw new Error('Falta el motivo declarado.');
  const motivoLimpio = motivo.trim();
  const ahora = ahoraChileSQL();

  // BUG REAL (10-sep-2026, auditoría estática): re-declarar con un motivo DISTINTO dejaba el
  // dictamen anterior del jefe de ventas puesto, como si siguiera vigente — pero ese dictamen
  // analizó el motivo VIEJO, no el nuevo. El jefe de ventas hace "un análisis independiente"
  // (§14.6) sobre lo que el encargado declaró; si eso cambió, el análisis anterior quedó
  // desactualizado y hay que volver a pedirlo. Si el motivo es el MISMO texto (re-guardar sin
  // cambios), no se toca el dictamen — no hay nada que invalidar.
  const [existente] = await pool.query(
    `SELECT motivo_declarado FROM compras_fracaso WHERE negocio_id = ? LIMIT 1`, [negocioId],
  ) as any;
  const motivoCambio = (existente as any[])[0] && (existente as any[])[0].motivo_declarado !== motivoLimpio;

  await pool.query(
    `INSERT INTO compras_fracaso (negocio_id, motivo_declarado, declarado_por, declarado_por_nombre, declarado_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE motivo_declarado=VALUES(motivo_declarado), declarado_por=VALUES(declarado_por),
       declarado_por_nombre=VALUES(declarado_por_nombre), declarado_at=VALUES(declarado_at), updated_at=VALUES(updated_at)
       ${motivoCambio ? ', dictamen_jefe_ventas=NULL, dictaminado_por=NULL, dictaminado_por_nombre=NULL, dictaminado_at=NULL' : ''}`,
    [negocioId, motivoLimpio, actorId, actorNombre, ahora, ahora, ahora],
  );
  await registrarEvento({
    tipo: 'COMPRAS_FRACASO_DECLARADO', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `Se declaró que el proyecto no se pudo entregar: ${motivo.trim()}.`,
    metadata: { negocio_id: negocioId },
  });
}

/** Paso 2 — "el jefe de ventas hace un análisis independiente y dictamina el motivo real"
 *  (verificado en la API, no acá). El histórico de tareas (compras_tarea) es la evidencia que
 *  consulta antes de dictaminar — no se le pasa nada precalculado, lo revisa él mismo (§18.5). */
export async function dictaminarFracaso(negocioId: number, dictamen: string, actorId: number, actorNombre: string | null): Promise<void> {
  if (!dictamen?.trim()) throw new Error('Falta el dictamen.');
  const ahora = ahoraChileSQL();
  const [r] = await pool.query(
    `UPDATE compras_fracaso SET dictamen_jefe_ventas = ?, dictaminado_por = ?, dictaminado_por_nombre = ?, dictaminado_at = ?, updated_at = ? WHERE negocio_id = ?`,
    [dictamen.trim(), actorId, actorNombre, ahora, ahora, negocioId],
  ) as any;
  if (!r?.affectedRows) throw new Error('Todavía no hay una declaración de fracaso para este negocio.');
  await registrarEvento({
    tipo: 'COMPRAS_FRACASO_DICTAMINADO', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId, actorNombre,
    mensaje: `El jefe de ventas dictaminó el motivo real del fracaso: ${dictamen.trim()}.`,
    metadata: { negocio_id: negocioId },
  });
}
