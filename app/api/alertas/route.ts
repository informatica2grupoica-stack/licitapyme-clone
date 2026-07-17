// app/api/alertas/route.ts
// Listar y marcar como leídas las alertas de licitaciones encontradas
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { ahoraChileSQL } from '@/app/lib/tz';

function getUserId(req: NextRequest): number | null {
  const id = req.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}

// ¿El usuario es admin? (rol auténtico desde la BD, no del header que manda el cliente).
// Un admin = "super": ve el radar COMPLETO de la empresa, no solo sus propias keywords.
async function usuarioEsAdmin(userId: number): Promise<boolean> {
  try {
    const [rows] = await pool.query(`SELECT rol FROM usuarios WHERE id = ? LIMIT 1`, [userId]);
    return (rows as any[])[0]?.rol === 'admin';
  } catch {
    return false; // ante error, comportamiento conservador (solo lo propio)
  }
}

// GET — lista TODAS las alertas del usuario (sin límite artificial)
// ?noLeidas=true → solo las no leídas
// ?limit=N       → opcional; sin ?limit devuelve todas
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const soloNoLeidas = searchParams.get('noLeidas') === 'true';
  const limitParam   = searchParams.get('limit');
  // RENDIMIENTO: por defecto el radar solo trae licitaciones ACTIVAS (cierre futuro o sin
  // cierre). Las vencidas (histórico) son ~4× el volumen y casi nunca se necesitan al abrir
  // el radar; se cargan bajo demanda con ?incluirVencidas=1 (botón "ver histórico" del front).
  const incluirVencidas = searchParams.get('incluirVencidas') === '1';

  // Por defecto se traen TODAS las alertas: el front filtra en cliente sobre el
  // total y pagina la visualización. El ?limit/?offset es opcional (uso puntual).
  const hayLimit = limitParam != null && limitParam !== '';
  const limit  = hayLimit ? Math.min(Math.max(parseInt(limitParam, 10) || 1, 1), 5000) : null;
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

  try {
    // Ven el radar COMPLETO (super) los admin y los usuarios con permiso acceso_radar.
    // Un usuario sin ese permiso solo vería sus propias alertas (en la práctica ninguna,
    // porque no puede crear palabras clave).
    const esAdminReal = await usuarioEsAdmin(userId);
    const esAdmin = esAdminReal || (await permisosDeUsuario(userId, 'usuario')).acceso_radar === true;
    const whereExtra = soloNoLeidas ? ' AND a.leida = FALSE' : '';

    // Ámbito del radar:
    //  • admin → una fila por licitación de TODA la empresa. Deduplicamos quedándonos
    //    con el MAX(id) por código vía un JOIN a una tabla derivada: se materializa
    //    UNA sola vez y une por PK (eq_ref). Mucho más rápido que `a.id IN (subquery)`,
    //    que la semi-unía/reevaluaba en cada fila.
    //  • usuario → solo sus propias alertas.
    const adminJoin = esAdmin
      ? 'JOIN (SELECT MAX(id) AS mid FROM alertas_licitaciones GROUP BY licitacion_codigo) latest ON latest.mid = a.id'
      : '';
    const whereScope = esAdmin ? '1 = 1' : 'a.usuario_id = ?';
    const scopeParams: unknown[] = esAdmin ? [] : [userId];
    // Filtro de actividad (por defecto solo activas). Zona horaria de Chile: NO comparar
    // contra NOW() del servidor MySQL (otra zona) → usar ahoraChileSQL().
    const vencClause = incluirVencidas ? '' : ' AND (a.licitacion_cierre >= ? OR a.licitacion_cierre IS NULL)';
    const vencParams: unknown[] = incluirVencidas ? [] : [ahoraChileSQL()];
    const params: unknown[] = [...scopeParams, ...vencParams, ...(hayLimit ? [limit, offset] : [])];
    const limitClause = hayLimit ? ' LIMIT ? OFFSET ?' : '';

    // Intentar primero con las columnas nuevas; si no existen (migración pendiente)
    // caer a la versión sin ellas para no dejar el radar en blanco.
    let rows: unknown[];
    try {
      // Ordenar por: no leídas primero → fecha publicación más reciente → created_at como fallback
      const selectCols =
        `SELECT a.id, a.keyword_texto, a.licitacion_codigo, a.licitacion_nombre,
                a.licitacion_organismo, a.licitacion_monto, a.licitacion_cierre,
                a.licitacion_fecha_publicacion,
                a.licitacion_estado, a.licitacion_region, a.licitacion_tipo,
                a.match_fuente, a.match_score, a.leida, a.created_at,
                v.score_total AS viabilidad_score,
                v.semaforo    AS viabilidad_semaforo,
                v.area_negocio AS viabilidad_area,
                pf.decision  AS prefiltro_decision,
                pf.categoria AS prefiltro_categoria,
                pf.motivo    AS prefiltro_motivo,
                pf.confianza AS prefiltro_confianza,
                cat.nombre AS categoria_nombre,
                cat.color  AS categoria_color
         FROM alertas_licitaciones a
         ${adminJoin}
         LEFT JOIN viabilidad_licitacion v ON v.licitacion_codigo = a.licitacion_codigo
         LEFT JOIN prefiltro_licitacion pf ON pf.licitacion_codigo = a.licitacion_codigo
         LEFT JOIN palabras_clave pc ON pc.id = a.palabra_clave_id
         LEFT JOIN etiquetas cat ON cat.id = pc.categoria_id
         WHERE ${whereScope}${whereExtra}${vencClause}
         ORDER BY COALESCE(a.licitacion_fecha_publicacion, a.created_at) DESC`;
      const query = `${selectCols}${limitClause}`;
      [rows] = await pool.query(query, params) as any[];
    } catch {
      // Columnas nuevas no existen aún — fallback sin columnas opcionales
      const query =
        `SELECT id, keyword_texto, licitacion_codigo, licitacion_nombre,
                licitacion_organismo, licitacion_monto, licitacion_cierre,
                licitacion_estado, licitacion_region, licitacion_tipo,
                leida, created_at
         FROM alertas_licitaciones a
         ${adminJoin}
         WHERE ${whereScope}${whereExtra}${vencClause}
         ORDER BY a.created_at DESC${limitClause}`;
      [rows] = await pool.query(query, params) as any[];
    }

    // Estado de gestión (asignación + descarte) y conteo de no leídas.
    // Son 3 queries INDEPENDIENTES entre sí y del query principal → las lanzamos en
    // paralelo (antes iban en secuencia, sumando ~3 round-trips de latencia).
    // Desacopladas del query principal (sin JOINs → sin choque de collation) y
    // resilientes vía allSettled: si una tabla falta, el radar sigue funcionando.
    // El contador de "no leídas" EXCLUYE las vencidas/cerradas: una licitación cuyo cierre
    // ya pasó jamás se va a trabajar, y contarla dejaba la burbuja inflada para siempre.
    // Misma comparación de cierre (hora Chile) que el listado de activas.
    const countVenc = ' AND (a.licitacion_cierre >= ? OR a.licitacion_cierre IS NULL)';
    const countSql = esAdmin
      ? `SELECT COUNT(*) AS total FROM alertas_licitaciones a
         JOIN (SELECT MAX(id) AS mid FROM alertas_licitaciones GROUP BY licitacion_codigo) latest ON latest.mid = a.id
         WHERE a.leida = FALSE${countVenc}`
      : `SELECT COUNT(*) AS total FROM alertas_licitaciones a WHERE a.usuario_id = ? AND a.leida = FALSE${countVenc}`;
    const countParams = esAdmin ? [ahoraChileSQL()] : [userId, ahoraChileSQL()];

    // tiene_documentos se resuelve aquí (no como JOIN). El LEFT JOIN a la tabla
    // derivada de documentos_cache costaba ~2 s (sin índice + collation utf8 →
    // nested loop), mientras que el DISTINCT suelto tarda ~0.2 s y lo mapeamos en JS.
    // El resumen de viabilidad (popover del radar) se extrae APARTE, no como columna
    // del query principal: informe_ejecutivo es un JSON que incluye el informe IA
    // profundo (_informe_ia, ~0.5 MB/fila) → traerlo completo para todas las filas
    // costaba ~8 s y ~10 MB. Aquí sacamos SOLO los 3 campos cortos que el popover usa
    // (resumen/ventaja/recomendación) vía JSON_EXTRACT (guardado con JSON_VALID por si
    // alguna fila trae JSON malformado). Aislado en allSettled: si la BD no soporta
    // funciones JSON, el radar sigue mostrando el semáforo/score sin el popover.
    const [asigRes, descRes, docsRes, countRes, resumenRes] = await Promise.allSettled([
      pool.query(
        `SELECT n.licitacion_codigo, n.asignado_a, u.nombre AS asignado_nombre, u.email AS asignado_email
         FROM negocios n JOIN usuarios u ON u.id = n.asignado_a WHERE n.activo = TRUE`),
      pool.query(`SELECT licitacion_codigo FROM licitaciones_descartadas`),
      pool.query(`SELECT DISTINCT licitacion_codigo FROM documentos_cache`),
      pool.query(countSql, countParams),
      pool.query(
        `SELECT licitacion_codigo,
                CASE WHEN JSON_VALID(informe_ejecutivo) THEN JSON_UNQUOTE(JSON_EXTRACT(informe_ejecutivo,'$.resumen')) END AS resumen,
                CASE WHEN JSON_VALID(informe_ejecutivo) THEN JSON_UNQUOTE(JSON_EXTRACT(informe_ejecutivo,'$.ventaja_competitiva')) END AS ventaja_competitiva,
                CASE WHEN JSON_VALID(informe_ejecutivo) THEN JSON_UNQUOTE(JSON_EXTRACT(informe_ejecutivo,'$.recomendacion')) END AS recomendacion
         FROM viabilidad_licitacion`),
    ]);

    const lista = rows as any[];
    const mapAsig = new Map<string, any>();
    if (asigRes.status === 'fulfilled') {
      for (const r of ((asigRes.value as any)[0] as any[])) mapAsig.set(r.licitacion_codigo, r);
    }
    const setDesc = new Set<string>();
    if (descRes.status === 'fulfilled') {
      for (const r of ((descRes.value as any)[0] as any[])) setDesc.add(r.licitacion_codigo);
    }
    const setDocs = new Set<string>();
    if (docsRes.status === 'fulfilled') {
      for (const r of ((docsRes.value as any)[0] as any[])) setDocs.add(r.licitacion_codigo);
    }
    // Mapa código → resumen recortado (solo los 3 campos del popover).
    const mapResumen = new Map<string, any>();
    if (resumenRes.status === 'fulfilled') {
      for (const r of ((resumenRes.value as any)[0] as any[])) {
        if (r.resumen || r.ventaja_competitiva || r.recomendacion) {
          mapResumen.set(r.licitacion_codigo, {
            resumen: r.resumen ?? undefined,
            ventaja_competitiva: r.ventaja_competitiva ?? undefined,
            recomendacion: r.recomendacion ?? undefined,
          });
        }
      }
    }
    for (const a of lista) {
      const m = mapAsig.get(a.licitacion_codigo);
      a.asignada = !!m;
      a.asignado_a = m ? m.asignado_a : null;
      a.asignado_nombre = m ? (m.asignado_nombre || m.asignado_email || null) : null;
      a.descartada = setDesc.has(a.licitacion_codigo);
      a.tiene_documentos = setDocs.has(a.licitacion_codigo) ? 1 : 0;
      // viabilidad_informe recortado: mantiene el popover funcionando sin el JSON pesado.
      a.viabilidad_informe = mapResumen.get(a.licitacion_codigo) ?? null;
    }
    const noLeidas = countRes.status === 'fulfilled' ? (((countRes.value as any)[0] as any[])[0]?.total || 0) : 0;

    return NextResponse.json({ success: true, alertas: rows, noLeidas, total: (rows as any[]).length });
  } catch (error) {
    console.error('[alertas:GET]', String(error));
    return NextResponse.json({ error: 'No se pudieron cargar las alertas.' }, { status: 500 });
  }
}

// PATCH — marcar como leída(s)
// Body: { ids: number[] } o { all: true } para marcar todas
// ALCANCE: igual que el GET. El radar del admin muestra alertas de TODA la empresa
// (deduplicadas por licitación), así que marcar leída debe alcanzar cualquier fila.
// Antes filtraba por usuario_id siempre → el admin "marcaba" filas ajenas sin efecto
// y el contador de no leídas volvía a subir al recargar (BUG "el número no baja").
export async function PATCH(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const { ids, all } = await request.json();
    const esAdmin = (await usuarioEsAdmin(userId))
      || (await permisosDeUsuario(userId, 'usuario')).acceso_radar === true;

    if (all) {
      if (esAdmin) {
        await pool.query(`UPDATE alertas_licitaciones SET leida = TRUE WHERE leida = FALSE`);
      } else {
        await pool.query(`UPDATE alertas_licitaciones SET leida = TRUE WHERE usuario_id = ?`, [userId]);
      }
    } else if (ids?.length) {
      const placeholders = ids.map(() => '?').join(',');
      if (esAdmin) {
        // Marcar TODAS las filas de esas licitaciones (de cualquier usuario): el conteo es
        // "una fila por código", así que dejar filas hermanas sin leer lo volvería a inflar.
        const [rs] = await pool.query(
          `SELECT DISTINCT licitacion_codigo FROM alertas_licitaciones WHERE id IN (${placeholders})`, ids);
        const codigos = (rs as any[]).map(r => r.licitacion_codigo).filter(Boolean);
        if (codigos.length) {
          await pool.query(
            `UPDATE alertas_licitaciones SET leida = TRUE WHERE licitacion_codigo IN (?)`, [codigos]);
        }
      } else {
        await pool.query(
          `UPDATE alertas_licitaciones SET leida = TRUE WHERE id IN (${placeholders}) AND usuario_id = ?`,
          [...ids, userId]
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[alertas:PATCH]', String(error));
    return NextResponse.json({ error: 'No se pudieron marcar las alertas.' }, { status: 500 });
  }
}

// DELETE — eliminar alerta
export async function DELETE(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

  try {
    const esAdmin = (await usuarioEsAdmin(userId))
      || (await permisosDeUsuario(userId, 'usuario')).acceso_radar === true;
    if (esAdmin) {
      // Mismo alcance que el GET: el admin ve una fila por licitación (de cualquier usuario).
      // Borrar solo esa fila haría "reaparecer" la alerta hermana de otro usuario al recargar
      // → se elimina la licitación completa del radar (todas sus filas).
      const [rs] = await pool.query(
        `SELECT licitacion_codigo FROM alertas_licitaciones WHERE id = ? LIMIT 1`, [id]);
      const codigo = (rs as any[])[0]?.licitacion_codigo;
      if (codigo) {
        await pool.query(`DELETE FROM alertas_licitaciones WHERE licitacion_codigo = ?`, [codigo]);
      }
    } else {
      await pool.query(
        `DELETE FROM alertas_licitaciones WHERE id = ? AND usuario_id = ?`,
        [id, userId]
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[alertas:DELETE]', String(error));
    return NextResponse.json({ error: 'No se pudo eliminar la alerta.' }, { status: 500 });
  }
}
