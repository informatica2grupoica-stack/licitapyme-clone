// app/lib/texto-limpio.ts
// Rescate de texto con acentos destruidos (U+FFFD).
//
// EL PROBLEMA: `negocios.licitacion_nombre` y `licitacion_organismo` llegan desde el CLIENTE en el
// POST de asignación, y alguna ruta del front los entrega con el acento ya perdido — no como "?"
// sino como U+FFFD (bytes EF BF BD), el carácter de reemplazo que produce decodificar con la
// codificación equivocada. Es IRREVERSIBLE en el string: el byte original ya no está.
//
// LA SUERTE: el radar y el caché SÍ tienen el texto bueno. Medido el 2026-07-30 sobre la base real:
//   negocios.licitacion_nombre     88 de 731 rotas
//   negocios.licitacion_organismo  27 de 731 rotas
//   alertas_licitaciones            0 de 12.312   ← limpio
//   licitaciones_cache              0 de 21.227   ← limpio
// O sea: no hay que reconstruir nada, hay que COPIAR de donde está bien.

import pool from '@/app/lib/db';

/** ¿Este texto perdió caracteres al decodificarse? */
export function textoRoto(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.includes('�');
}

/**
 * Devuelve el nombre/organismo BUENOS para una licitación: usa los que vienen del cliente salvo
 * que estén rotos, en cuyo caso los reemplaza por los de `alertas_licitaciones` o
 * `licitaciones_cache` (en ese orden). Si tampoco hay copia limpia, deja el valor original: es
 * mejor un acento perdido que un nombre vacío.
 *
 * Nunca lanza: esto no puede impedir que se asigne una licitación.
 */
export async function textoLimpioDeLicitacion(
  codigo: string,
  nombreEntrante: string | null | undefined,
  organismoEntrante: string | null | undefined,
): Promise<{ nombre: string | null; organismo: string | null }> {
  let nombre = nombreEntrante || null;
  let organismo = organismoEntrante || null;

  // Nada roto → no se consulta la BD (caso normal, sin costo).
  if (!textoRoto(nombre) && !textoRoto(organismo)) return { nombre, organismo };

  try {
    const [rows] = await pool.query(
      `SELECT a.licitacion_nombre AS n_alerta, a.licitacion_organismo AS o_alerta,
              lc.nombre AS n_cache, lc.organismo AS o_cache
         FROM (SELECT ? AS cod) x
         LEFT JOIN alertas_licitaciones a ON a.licitacion_codigo = x.cod
         LEFT JOIN licitaciones_cache  lc ON lc.codigo           = x.cod
        LIMIT 1`,
      [codigo],
    ) as any;
    const f = (rows as any[])[0] || {};

    if (textoRoto(nombre)) {
      const alt = [f.n_alerta, f.n_cache].find(v => typeof v === 'string' && v && !textoRoto(v));
      if (alt) nombre = alt;
    }
    if (textoRoto(organismo)) {
      const alt = [f.o_alerta, f.o_cache].find(v => typeof v === 'string' && v && !textoRoto(v));
      if (alt) organismo = alt;
    }
  } catch (e) {
    console.error('[texto-limpio] no se pudo rescatar el texto:', String(e).slice(0, 200));
  }

  return { nombre, organismo };
}
