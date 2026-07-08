// app/api/negocios/route.ts
// Lista y crea asignaciones de licitaciones
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarActividad } from '@/app/lib/actividad';
import { tienePermiso } from '@/app/lib/api-auth';
import { registrarEvento } from '@/app/lib/historial';
import { enviarCorreoAsignacion } from '@/app/lib/email';
import { extractTipoFromCodigo } from '@/app/lib/tipos-licitacion';

function getUser(req: NextRequest) {
  const id  = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// GET — lista negocios
// Admin: puede ver ?usuarioId=X  o todos si no pasa filtro
// Usuario normal: solo los suyos
export async function GET(request: NextRequest) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const filtroUsuario = searchParams.get('usuarioId');

  try {
    // Verificación de tabla (migración) + permiso EN PARALELO. La latencia a Bluehost
    // es ~160ms por viaje, así que cada round-trip evitado cuenta. El _migrationPending
    // se decide solo por la verificación de tabla; el permiso degrada a false si falla.
    const [existRes, permRes] = await Promise.allSettled([
      pool.query('SELECT 1 FROM negocios LIMIT 1'),
      tienePermiso(request, 'ver_otros_negocios'),
    ]);
    if (existRes.status === 'rejected') {
      return NextResponse.json({ success: true, negocios: [], usuarios: [], _migrationPending: true });
    }
    const verOtros = permRes.status === 'fulfilled' ? (permRes.value as boolean) : false;

    let whereClause = '';
    let params: any[] = [];

    if (verOtros && filtroUsuario) {
      whereClause = 'WHERE n.asignado_a = ? AND n.activo = TRUE';
      params = [parseInt(filtroUsuario)];
    } else if (verOtros && !filtroUsuario) {
      whereClause = 'WHERE n.activo = TRUE';
    } else {
      whereClause = 'WHERE n.asignado_a = ? AND n.activo = TRUE';
      params = [userId];
    }

    // Carga de trabajo (independiente del filtro) y lista de usuarios (si ve otros):
    // se lanzan EN PARALELO con el query principal — no dependen de su resultado.
    const filtroCarga = verOtros ? '' : 'AND n.asignado_a = ?';
    const pCarga = verOtros ? [] : [userId];

    const [rowsRes, cargaRes, usuariosRes] = await Promise.all([
      pool.query(
        `SELECT
           n.id, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo,
           n.licitacion_monto, n.licitacion_cierre, n.licitacion_estado,
           n.licitacion_tipo, n.licitacion_region, n.monto_ofertado,
           COALESCE(n.estado_pipeline, 'ASIGNADO') AS estado_pipeline,
           n.created_at, n.updated_at,
           u.nombre AS usuario_nombre, u.email AS usuario_email,
           GROUP_CONCAT(DISTINCT e.nombre ORDER BY e.nombre SEPARATOR ',') AS etiquetas_nombres,
           GROUP_CONCAT(DISTINCT CONCAT(e.id,':',e.nombre,':',e.color) ORDER BY e.nombre SEPARATOR '|') AS etiquetas_raw,
           (SELECT COUNT(*) FROM comentarios_negocio cn WHERE cn.negocio_id = n.id) AS comentarios_count
         FROM negocios n
         JOIN usuarios u ON u.id = n.asignado_a
         LEFT JOIN negocios_etiquetas ne ON ne.negocio_id = n.id
         LEFT JOIN etiquetas e ON e.id = ne.etiqueta_id
         ${whereClause}
         GROUP BY n.id
         ORDER BY n.updated_at DESC`,
        params),
      pool.query(
        `SELECT n.asignado_a AS usuario_id, u.nombre, u.email, n.licitacion_codigo AS codigo,
                COALESCE(n.estado_pipeline, 'ASIGNADO') AS estado_pipeline
         FROM negocios n JOIN usuarios u ON u.id = n.asignado_a
         WHERE n.activo = TRUE ${filtroCarga}`, pCarga),
      verOtros
        ? pool.query(`SELECT id, nombre, email FROM usuarios WHERE activo = TRUE ORDER BY nombre ASC`)
        : Promise.resolve([[]] as any),
    ]);
    const rows = (rowsRes as any)[0];
    const cargaRows = (cargaRes as any)[0];
    const usuarios = ((usuariosRes as any)[0] || []) as any[];

    // Parsear etiquetas_raw a objetos
    const negocios = (rows as any[]).map(row => ({
      ...row,
      etiquetas: row.etiquetas_raw
        ? row.etiquetas_raw.split('|').map((e: string) => {
            const [id, nombre, color] = e.split(':');
            return { id: parseInt(id), nombre, color };
          })
        : [],
      etiquetas_raw: undefined,
      etiquetas_nombres: undefined,
    }));

    // Enriquecer cada negocio con: ¿tiene documentos? y su viabilidad (semáforo/score).
    // Las dos consultas son independientes → EN PARALELO. Desacopladas del query
    // principal (sin JOINs → sin choque de collation) y resilientes.
    const codigos = negocios.map(n => n.licitacion_codigo).filter(Boolean);
    if (codigos.length) {
      const ph = codigos.map(() => '?').join(',');
      const [docsRes, viabRes] = await Promise.allSettled([
        pool.query(`SELECT DISTINCT licitacion_codigo FROM documentos_cache WHERE licitacion_codigo IN (${ph})`, codigos),
        pool.query(`SELECT licitacion_codigo, semaforo, score_total FROM viabilidad_licitacion WHERE licitacion_codigo IN (${ph})`, codigos),
      ]);
      if (docsRes.status === 'fulfilled') {
        const setDocs = new Set(((docsRes.value as any)[0] as any[]).map(r => r.licitacion_codigo));
        for (const n of negocios) n.tiene_documentos = setDocs.has(n.licitacion_codigo) ? 1 : 0;
      }
      if (viabRes.status === 'fulfilled') {
        const mapViab = new Map(((viabRes.value as any)[0] as any[]).map(r => [r.licitacion_codigo, r]));
        for (const n of negocios) {
          const v = mapViab.get(n.licitacion_codigo) as any;
          n.viabilidad_semaforo = v?.semaforo ?? null;
          n.viabilidad_score = v?.score_total ?? null;
        }
      }
    }

    // Carga de trabajo por usuario, con DESGLOSE POR TIPO (L1/LE/LP/...). El tipo se
    // deriva del código en Node (extractTipoFromCodigo).
    // `total` = SOLO las que se están trabajando (excluye DESCARTADA); `descartadas` aparte,
    // para mostrarlas como detalle chico. El desglose por tipo tampoco cuenta las descartadas.
    const mapCarga = new Map<number, any>();
    for (const r of cargaRows as any[]) {
      let e = mapCarga.get(r.usuario_id);
      if (!e) { e = { usuario_id: r.usuario_id, nombre: r.nombre, email: r.email, total: 0, descartadas: 0, porTipo: {} as Record<string, number> }; mapCarga.set(r.usuario_id, e); }
      if (r.estado_pipeline === 'DESCARTADA') { e.descartadas++; continue; }
      e.total++;
      const tipo = extractTipoFromCodigo(r.codigo || '') || '—';
      e.porTipo[tipo] = (e.porTipo[tipo] || 0) + 1;
    }
    const carga = Array.from(mapCarga.values()).sort((a, b) => b.total - a.total);

    return NextResponse.json({ success: true, negocios, usuarios, carga });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST — asignar licitación a usuario (solo admin)
export async function POST(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Solo el admin puede asignar licitaciones' }, { status: 403 });

  try {
    const {
      licitacion_codigo, asignado_a, etiqueta_ids = [],
      licitacion_nombre, licitacion_organismo, licitacion_monto,
      licitacion_cierre, licitacion_estado, licitacion_tipo,
      licitacion_region, licitacion_descripcion,
    } = await request.json();

    if (!licitacion_codigo || !asignado_a)
      return NextResponse.json({ error: 'licitacion_codigo y asignado_a son requeridos' }, { status: 400 });

    // ¿Ya estaba asignada a alguien distinto? → es una REASIGNACIÓN.
    let prevAsignado: number | null = null;
    try {
      const [prev] = await pool.query(
        `SELECT asignado_a FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE ORDER BY id DESC LIMIT 1`,
        [licitacion_codigo]);
      prevAsignado = (prev as any[])[0]?.asignado_a ?? null;
    } catch { /* tabla nueva */ }
    const reasignacion = prevAsignado != null && Number(prevAsignado) !== Number(asignado_a);

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
        licitacion_codigo,
        licitacion_nombre || null, licitacion_organismo || null,
        licitacion_monto || null,
        licitacion_cierre ? new Date(licitacion_cierre) : null,
        licitacion_estado || null, licitacion_tipo || null,
        licitacion_region || null, licitacion_descripcion || null,
        asignado_a, userId,
      ]
    );

    const negocioId = (result as any).insertId || null;

    // Si tenemos el id (INSERT) asignar etiquetas
    if (negocioId && etiqueta_ids.length > 0) {
      for (const eId of etiqueta_ids) {
        await pool.query(
          `INSERT IGNORE INTO negocios_etiquetas (negocio_id, etiqueta_id) VALUES (?, ?)`,
          [negocioId, eId]
        );
      }
    }

    // Notificar al asignado: historial + tiempo real (SSE) + correo. Best-effort.
    try {
      const [uRows] = await pool.query(`SELECT nombre, email FROM usuarios WHERE id = ?`, [asignado_a]);
      const u = (uRows as any[])[0];
      const destino = u?.nombre || u?.email || `usuario ${asignado_a}`;
      const [aRows] = await pool.query(`SELECT nombre, email FROM usuarios WHERE id = ?`, [userId]);
      const actor = (aRows as any[])[0];
      const actorNombre = actor?.nombre || actor?.email || 'Un administrador';

      // Log de actividad antiguo (se mantiene).
      registrarActividad({
        usuarioId: userId, accion: 'asignacion',
        entidadTipo: 'negocio', entidadId: String(negocioId || licitacion_codigo),
        descripcion: `${reasignacion ? 'Reasignó' : 'Asignó'} la licitación ${licitacion_codigo} a ${destino}`,
        metadata: { licitacion_codigo, licitacion_nombre: licitacion_nombre || null, asignado_a, asignado_a_nombre: destino, reasignacion },
      });

      // Historial nuevo + push en tiempo real al destinatario (campana).
      await registrarEvento({
        tipo: reasignacion ? 'REASIGNACION' : 'ASIGNACION',
        licitacionCodigo: licitacion_codigo, licitacionNombre: licitacion_nombre || null,
        usuarioId: Number(asignado_a), usuarioNombre: destino,
        actorId: userId, actorNombre,
        mensaje: `${actorNombre} te ${reasignacion ? 'reasignó' : 'asignó'} la licitación ${licitacion_nombre || licitacion_codigo}`,
        metadata: { licitacion_codigo, reasignacion },
      });

      // Correo (fire-and-forget: no demora la respuesta).
      if (u?.email) {
        enviarCorreoAsignacion({
          to: u.email, nombre: u.nombre, codigo: licitacion_codigo,
          licitacionNombre: licitacion_nombre || null, organismo: licitacion_organismo || null,
          monto: licitacion_monto || null, cierre: licitacion_cierre || null,
          actorNombre, reasignacion,
        }).catch(() => { /* registrado dentro de la función */ });
      }
    } catch { /* nunca bloquear la asignación por un fallo de notificación */ }

    // ── Descarga automática de documentos AL ASIGNAR ───────────────────────────
    // Estrategia elegida: en vez de bajar TODAS las que pasan el prefiltro (muchas se
    // descartan aunque pasen), se bajan SOLO las que realmente se van a trabajar = las
    // asignadas. Requiere IP chilena → corre en el notebook. Fire-and-forget: no bloquea
    // la respuesta de asignación. Salta si la licitación ya tiene documentos.
    // Kill-switch: DESCARGA_AL_ASIGNAR=false.
    if (process.env.DESCARGA_AL_ASIGNAR !== 'false') {
      (async () => {
        try {
          const [dc] = await pool.query(
            `SELECT 1 FROM documentos_cache WHERE licitacion_codigo = ? LIMIT 1`, [licitacion_codigo]);
          if ((dc as any[]).length) return; // ya tiene documentos → nada que bajar
          const { descargarDocumentosLicitacion } = await import('@/app/lib/mp-descarga-orquestador');
          const res = await descargarDocumentosLicitacion(licitacion_codigo);
          // Solo PRE-OCR: calienta la caché de texto (OCR incluido) tras la descarga, para que
          // el posterior "Analizar" MANUAL encuentre el texto ya en BD y sea rápido. NO se corre
          // la viabilidad aquí: el análisis/viabilidad es una acción MANUAL (botón "Analizar").
          // Flag: PRE_OCR_AL_ASIGNAR=false lo desactiva.
          if (res.exito && process.env.PRE_OCR_AL_ASIGNAR !== 'false') {
            try {
              const { calentarCacheDocumentos } = await import('@/app/lib/viabilidad-ia');
              await calentarCacheDocumentos(licitacion_codigo);
            } catch (e) { console.warn(`[negocios] pre-OCR al asignar ${licitacion_codigo}:`, String(e)); }
          }
        } catch (e) { console.error('[negocios] auto-descarga al asignar falló:', String(e)); }
      })();
    }

    return NextResponse.json({ success: true, id: negocioId });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
