// app/lib/lineas-oferta.ts
// SELECTOR DE LÍNEAS A OFERTAR — lectura y escritura de la decisión "¿a qué líneas vamos?".
//
// POR QUÉ EXISTE (26-ago-2026): en una licitación por línea casi nunca se postula a todas, y el
// sistema no tenía dónde guardar esa decisión. Cada módulo la adivinaba: el checklist técnico
// creaba una línea a auditar por CADA línea del informe, el costeo dejaba que el asistente
// marcara `ofertamos = 0` fila por fila (solo en los precios, y recién al cargar el Excel), y el
// Motor Comercial alertaba descuadres contra líneas que nunca se iban a ofertar.
//
// LA TABLA ES LA FUENTE DE VERDAD; `checklist_comercial.ofertamos` ES SU PROYECCIÓN.
// Esa columna ya existía y ya la respetan auditor-generacion.ts (no bloquea la generación de
// anexos por una línea que no ofertamos) y el costeo. En vez de inventar un segundo mecanismo de
// exclusión que esos módulos tendrían que aprender, se le da un origen único al que ya funciona:
// al guardar la selección se propaga a todas las filas del checklist que tengan linea_numero.
//
// Ver docs/migration-78-lineas-a-ofertar.sql.

import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';

export interface LineaOferta {
  linea: number;
  nombre: string | null;
  ofertamos: boolean;
  decididoPor: number | null;
  decididoEn: string | null;
}

/**
 * La decisión guardada para un negocio, o `null` si TODAVÍA NO SE DECIDIÓ.
 *
 * La diferencia entre `null` y `[]` es deliberada y la respetan todos los consumidores: `null`
 * significa "nadie contestó el banner" y el sistema se comporta como antes de la migración 78
 * (se genera y se muestra todo); un array significa que hay decisión humana. Devolver `[]` en vez
 * de `null` cuando no hay filas haría que un negocio sin decidir pareciera "no ofertamos nada".
 */
export async function leerLineasOfertadas(negocioId: number): Promise<number[] | null> {
  try {
    const [rows] = await pool.query(
      `SELECT linea_numero FROM negocio_lineas_oferta
        WHERE negocio_id = ? AND ofertamos = 1 ORDER BY linea_numero`,
      [negocioId],
    ) as any;
    const filas = rows as Array<{ linea_numero: number }>;
    // Sin filas = sin decisión. OJO: si TODAS las filas guardadas son ofertamos=0 esta consulta
    // también devuelve vacío, pero ese estado no se puede alcanzar desde la UI (guardar exige al
    // menos una línea marcada) y el fail-open es la lectura segura si igual ocurriera.
    return filas.length ? filas.map(r => Number(r.linea_numero)) : null;
  } catch {
    // Migración 78 pendiente: el checklist se comporta como antes, sin filtrar. Nunca revienta el
    // GET del Auditor por una tabla que todavía no existe en ese entorno.
    return null;
  }
}

/** La decisión completa (incluidas las líneas descartadas), para pintar el selector. */
export async function leerDecisionLineas(negocioId: number): Promise<LineaOferta[]> {
  try {
    const [rows] = await pool.query(
      `SELECT linea_numero, nombre_linea, ofertamos, decidido_por, decidido_en
         FROM negocio_lineas_oferta WHERE negocio_id = ? ORDER BY linea_numero`,
      [negocioId],
    ) as any;
    return (rows as any[]).map(r => ({
      linea: Number(r.linea_numero),
      nombre: r.nombre_linea ?? null,
      ofertamos: !!r.ofertamos,
      decididoPor: r.decidido_por == null ? null : Number(r.decidido_por),
      decididoEn: r.decidido_en ?? null,
    }));
  } catch { return []; }
}

/**
 * Guarda la decisión y la proyecta sobre el checklist ya existente.
 *
 * NO BORRA NADA. Una línea que se saca de la oferta pero que ya tiene trabajo cargado (documentos,
 * características comparadas, incluso aprobadas) conserva todo: solo queda marcada `ofertamos = 0`,
 * que es como la UI la atenúa y como auditor-generacion.ts la deja de exigir. Si mañana se vuelve
 * a incluir esa línea, el trabajo sigue ahí intacto. Borrar sería irreversible y no hace falta.
 */
export async function guardarLineasOfertadas(args: {
  negocioId: number;
  licitacionCodigo: string;
  lineas: Array<{ linea: number; nombre?: string | null; ofertamos: boolean }>;
  usuarioId: number | null;
}): Promise<{ ofertadas: number[]; descartadas: number[]; sinProyectar: string[] }> {
  const { negocioId, licitacionCodigo, lineas, usuarioId } = args;
  const ahora = ahoraChileSQL();

  for (const l of lineas) {
    await pool.query(
      `INSERT INTO negocio_lineas_oferta
         (negocio_id, licitacion_codigo, linea_numero, nombre_linea, ofertamos, decidido_por, decidido_en)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         nombre_linea = VALUES(nombre_linea), ofertamos = VALUES(ofertamos),
         decidido_por = VALUES(decidido_por), decidido_en = VALUES(decidido_en)`,
      [negocioId, licitacionCodigo, l.linea, (l.nombre || '').slice(0, 300) || null,
       l.ofertamos ? 1 : 0, usuarioId, ahora],
    );
  }

  const ofertadas = lineas.filter(l => l.ofertamos).map(l => l.linea);
  const descartadas = lineas.filter(l => !l.ofertamos).map(l => l.linea);
  const conocidas = new Set(lineas.map(l => l.linea));

  // ── LA PROYECCIÓN SOLO SE APLICA DONDE LA NUMERACIÓN CALZA ────────────────────────────────
  //
  // BUG REAL (26-ago-2026, negocio 797 / 986278-14-LE26, encontrado por el usuario mirando su
  // propia pantalla): proyectar sobre `linea_numero` daba por sentado que el checklist numera
  // igual que el informe. En el bloque COMERCIAL sí. En el TÉCNICO de los 27 negocios generados
  // antes del fix de numeración, NO: están numerados 1..28 por POSICIÓN en el array de productos.
  //
  // Resultado en ese negocio: se eligió ofertar la línea real 7 y la proyección marcó
  // `ofertamos = 1` en la fila técnica nº7 — que es "Nivel laser", un producto de la línea real 5 —
  // y sacó de la oferta las filas 1..6, entre ellas tres con características ya comparadas. Marcó
  // exactamente lo contrario de lo que el usuario pidió, en silencio.
  //
  // La señal de que un grupo de filas está numerado con otra escala es objetiva y no hace falta
  // adivinarla: si trae números de línea que NO existen entre las líneas del informe (la fila 28
  // en una licitación de 7 líneas), esa numeración no es la del informe y no se puede proyectar
  // sobre ella. Ante eso NO SE TOCA NADA de ese grupo — dejar el `ofertamos` intacto conserva el
  // comportamiento anterior (fail-open), mientras que escribir a ciegas manda trabajo real fuera
  // de la oferta. Se devuelve qué grupos quedaron sin proyectar para poder decirlo en pantalla.
  const [tipoRows] = await pool.query(
    `SELECT DISTINCT tipo, linea_numero FROM checklist_comercial
      WHERE negocio_id = ? AND linea_numero IS NOT NULL`,
    [negocioId],
  ) as any;
  const porTipo = new Map<string, number[]>();
  for (const r of tipoRows as Array<{ tipo: string; linea_numero: number }>) {
    if (!porTipo.has(r.tipo)) porTipo.set(r.tipo, []);
    porTipo.get(r.tipo)!.push(Number(r.linea_numero));
  }
  const proyectables: string[] = [];
  const sinProyectar: string[] = [];
  for (const [tipo, nums] of porTipo) {
    (nums.every(n => conocidas.has(n)) ? proyectables : sinProyectar).push(tipo);
  }

  // Se hace en dos UPDATE por lista en vez de uno por línea para no disparar N consultas en una
  // licitación de 130 líneas.
  if (proyectables.length) {
    if (ofertadas.length) {
      await pool.query(
        `UPDATE checklist_comercial SET ofertamos = 1
          WHERE negocio_id = ? AND tipo IN (?) AND linea_numero IN (?)
            AND (ofertamos IS NULL OR ofertamos = 0)`,
        [negocioId, proyectables, ofertadas],
      );
    }
    if (descartadas.length) {
      await pool.query(
        `UPDATE checklist_comercial SET ofertamos = 0
          WHERE negocio_id = ? AND tipo IN (?) AND linea_numero IN (?)
            AND (ofertamos IS NULL OR ofertamos = 1)`,
        [negocioId, proyectables, descartadas],
      );
    }
  }

  return { ofertadas, descartadas, sinProyectar };
}

/**
 * Las líneas que NO se ofertan, para el Motor Comercial (alertas del costeo).
 *
 * POR QUÉ NO ALCANZA CON MIRAR EL CHECKLIST — que es lo que hacían los dos llamadores antes: una
 * línea descartada en el selector ya no genera fila de precio (ese es el punto del filtro), así
 * que buscar filas con `ofertamos = 0` no la encuentra NUNCA. El Motor Comercial seguía alertando
 * "sobre presupuesto en la línea 2" de una línea a la que no se postula, que es exactamente el
 * problema que el usuario describió. La decisión del selector se lee de su propia tabla.
 *
 * Se unen las DOS fuentes, no se reemplaza una por la otra: el marcado manual fila por fila del
 * costeo (`ofertamos = 0` en un ítem de precio) sigue siendo válido y sigue mandando. Un negocio
 * viejo, sin decisión guardada, se comporta exactamente como antes.
 *
 * `lineasPublicadas` son los números de línea del informe: sin esa lista no se puede saber qué
 * líneas quedaron FUERA de la selección (la tabla guarda las elegidas, no las que no existen).
 */
export async function lineasExcluidasDeNegocio(
  negocioId: number,
  lineasPublicadas: number[],
): Promise<Set<number>> {
  const excluidas = new Set<number>();

  const ofertadas = await leerLineasOfertadas(negocioId);
  if (ofertadas) {
    const activas = new Set(ofertadas);
    for (const l of lineasPublicadas) if (!activas.has(l)) excluidas.add(l);
  }

  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT linea_numero FROM checklist_comercial
        WHERE negocio_id = ? AND bloque = 'COMERCIAL' AND tipo = 'precio'
          AND ofertamos = 0 AND linea_numero IS NOT NULL`,
      [negocioId],
    ) as any;
    for (const r of rows as Array<{ linea_numero: number }>) excluidas.add(Number(r.linea_numero));
  } catch { /* si la consulta falla queda solo la decisión del selector, que es la fuente principal */ }

  return excluidas;
}
