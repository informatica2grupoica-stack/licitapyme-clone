// app/lib/control-foro.ts
// CONTROL DE CAMBIOS DEL FORO (Auditor Técnico, Fase 6, spec §11) — entre el análisis de
// viabilidad y la auditoría pueden pasar días, y en ese lapso el organismo suele publicar
// aclaraciones. Este módulo detecta el delta del foro de preguntas/respuestas respecto a la
// última vez que se revisó, y si algún bloque (TÉCNICO/COMERCIAL) ya estaba APROBADO, revierte
// esa aprobación automáticamente (spec §11.2) — el proyecto vuelve a necesitar aprobación.
//
// preguntas_respuestas_cache (migración 44) SOBREESCRIBE en cada scrape, sin historial. Por
// eso este módulo mantiene su propia "foto" (checklist_comercial_foro_snapshot, migración 54):
// se toma la primera vez que el checklist se materializa (entrada a ANEXOS) y se actualiza cada
// vez que se procesa un delta, para no re-disparar el mismo aviso una y otra vez.
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { ahoraChileSQL } from '@/app/lib/tz';
import type { PreguntaRespuesta } from '@/app/lib/mp-preguntas-respuestas';

export interface CambioForo {
  tipo: 'PREGUNTA_NUEVA' | 'RESPUESTA_PUBLICADA' | 'CONTENIDO_CAMBIO';
  numero: number | null;
  detalle: string;
}

/** Compara dos fotos del foro por número de pregunta (identificador estable del portal MP). */
export function detectarDeltaForo(anterior: PreguntaRespuesta[], actual: PreguntaRespuesta[]): CambioForo[] {
  const cambios: CambioForo[] = [];
  const porNumero = new Map(anterior.filter(p => p.numero != null).map(p => [p.numero as number, p]));

  for (const p of actual) {
    if (p.numero == null) continue;
    const previa = porNumero.get(p.numero);
    if (!previa) {
      cambios.push({ tipo: 'PREGUNTA_NUEVA', numero: p.numero, detalle: `Pregunta N°${p.numero} nueva: "${p.pregunta.slice(0, 140)}"` });
      continue;
    }
    if (!previa.respuesta && p.respuesta) {
      cambios.push({ tipo: 'RESPUESTA_PUBLICADA', numero: p.numero, detalle: `Se publicó la respuesta a la pregunta N°${p.numero}.` });
      continue;
    }
    if (previa.respuesta && p.respuesta && previa.respuesta !== p.respuesta) {
      cambios.push({ tipo: 'CONTENIDO_CAMBIO', numero: p.numero, detalle: `La respuesta a la pregunta N°${p.numero} cambió de contenido.` });
    }
  }
  return cambios;
}

async function leerSnapshot(negocioId: number): Promise<{ preguntas: PreguntaRespuesta[]; ultimoDelta: CambioForo[]; ultimoDeltaAt: string | null } | null> {
  try {
    const [rows] = await pool.query(
      `SELECT snapshot, ultimo_delta, ultimo_delta_at FROM checklist_comercial_foro_snapshot WHERE negocio_id = ? LIMIT 1`,
      [negocioId],
    ) as any;
    const row = (rows as any[])[0];
    if (!row) return null;
    return {
      preguntas: row.snapshot ? JSON.parse(row.snapshot) : [],
      ultimoDelta: row.ultimo_delta ? JSON.parse(row.ultimo_delta) : [],
      ultimoDeltaAt: row.ultimo_delta_at,
    };
  } catch { return null; }
}

/** Primera foto del foro — se toma UNA vez, al materializar el checklist (entrada a ANEXOS).
 *  INSERT IGNORE: si ya existe, no se pisa (esa es la referencia contra la que se compara). */
export async function capturarSnapshotForoInicial(negocioId: number, preguntas: PreguntaRespuesta[]): Promise<void> {
  try {
    await pool.query(
      `INSERT IGNORE INTO checklist_comercial_foro_snapshot (negocio_id, snapshot, capturado_at)
       VALUES (?, ?, ?)`,
      [negocioId, JSON.stringify(preguntas), ahoraChileSQL()],
    );
  } catch (e) {
    console.error('[control-foro] capturarSnapshotForoInicial falló:', String(e).slice(0, 200));
  }
}

/**
 * Revisa si el foro cambió desde la última foto. Si hay delta:
 *  1) revierte a OBSERVADO cualquier ítem TECNICO/COMERCIAL que estuviera APROBADO (spec §11.2),
 *     con bitácora `REVERTIR_POR_FORO` y aviso al asistente y a los asesores.
 *  2) hace avanzar el snapshot al estado actual (para no re-disparar el mismo cambio).
 * Devuelve el delta detectado en ESTA corrida (vacío si no hubo cambios) — el llamador decide
 * qué hacer (comercial/route.ts lo expone en el GET para la banda de aviso persistente).
 */
export async function revisarDeltaForo(args: {
  negocioId: number; licitacionCodigo: string; licitacionNombre: string | null;
  asignadoA: number | null; asignadoNombre: string | null;
  preguntasActuales: PreguntaRespuesta[];
  bitacora: (itemId: number, negocioId: number, accion: string, anterior: string | null, nuevo: string, comentario: string | null, userId: number | null, userNombre: string) => Promise<void>;
  asesores: () => Promise<Array<{ id: number; nombre: string }>>;
}): Promise<CambioForo[]> {
  const previo = await leerSnapshot(args.negocioId);
  if (!previo) {
    // Sin foto todavía (checklist no se ha materializado, o migración 54 recién aplicada en un
    // negocio ya existente): se toma ahora mismo como línea base, sin alertar — no hay "antes"
    // real con qué comparar todavía.
    await capturarSnapshotForoInicial(args.negocioId, args.preguntasActuales);
    return [];
  }

  const delta = detectarDeltaForo(previo.preguntas, args.preguntasActuales);
  if (delta.length === 0) return [];

  const ahora = ahoraChileSQL();
  const bloquesRevertidos: string[] = [];

  // Revertir aprobaciones vigentes en TECNICO/COMERCIAL (spec §11.2) — ADMINISTRATIVO no
  // requiere aprobación de CA (spec §3), no aplica revertir ahí.
  const [aprobados] = await pool.query(
    `SELECT id, bloque, titulo FROM checklist_comercial
      WHERE negocio_id = ? AND bloque IN ('TECNICO','COMERCIAL') AND estado = 'APROBADO'`,
    [args.negocioId],
  ) as any;
  for (const it of aprobados as any[]) {
    await pool.query(
      `UPDATE checklist_comercial SET estado = 'OBSERVADO',
              observacion = 'Revertido automáticamente: el foro cambió después de la aprobación. Revisa qué cambió antes de volver a aprobar.',
              aprobado_por = NULL, aprobado_por_nombre = NULL, aprobado_at = NULL
        WHERE id = ?`,
      [it.id],
    );
    await args.bitacora(it.id, args.negocioId, 'REVERTIR_POR_FORO', 'APROBADO', 'OBSERVADO',
      `Cambio en el foro: ${delta.map(d => d.detalle).join(' ')}`, null, 'Sistema (control de foro)');
    if (!bloquesRevertidos.includes(it.bloque)) bloquesRevertidos.push(it.bloque);
  }

  // Avanzar el snapshot al estado actual — el mismo cambio no se vuelve a reportar la próxima vez.
  await pool.query(
    `UPDATE checklist_comercial_foro_snapshot
        SET snapshot = ?, capturado_at = ?, ultimo_delta = ?, ultimo_delta_at = ?, bloques_revertidos = ?
      WHERE negocio_id = ?`,
    [JSON.stringify(args.preguntasActuales), ahora, JSON.stringify(delta), ahora, bloquesRevertidos.join(',') || null, args.negocioId],
  );

  // Aviso: al asistente (si el foro afectó algo) y a los asesores (si hubo reversión de verdad).
  const mensajeBase = `Las bases cambiaron desde el análisis de viabilidad: ${delta.map(d => d.detalle).join(' ')}`;
  if (args.asignadoA) {
    await registrarEvento({
      tipo: 'FORO_CAMBIO', licitacionCodigo: args.licitacionCodigo, licitacionNombre: args.licitacionNombre,
      usuarioId: args.asignadoA, usuarioNombre: args.asignadoNombre,
      mensaje: bloquesRevertidos.length
        ? `${mensajeBase} Se revirtió la aprobación de ${bloquesRevertidos.join(' y ')}.`
        : mensajeBase,
      metadata: { negocioId: args.negocioId, delta, bloquesRevertidos },
    });
  }
  if (bloquesRevertidos.length > 0) {
    for (const a of await args.asesores()) {
      await registrarEvento({
        tipo: 'FORO_CAMBIO_REVIRTIO_APROBACION', licitacionCodigo: args.licitacionCodigo, licitacionNombre: args.licitacionNombre,
        usuarioId: a.id, usuarioNombre: a.nombre,
        mensaje: `${mensajeBase} Se revirtió ${bloquesRevertidos.join(' y ')} — vuelve a la bandeja.`,
        metadata: { negocioId: args.negocioId, delta, bloquesRevertidos },
      });
    }
  }

  return delta;
}
