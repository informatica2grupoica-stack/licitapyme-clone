// app/api/negocios/route.ts
// Lista y crea asignaciones de licitaciones
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { tienePermiso } from '@/app/lib/api-auth';
import { asignarLicitacion } from '@/app/lib/asignar-licitacion';
import { resumirCarga, type FilaCarga } from '@/app/lib/carga-perfiles';
import { respuestaDesdeCache, enriquecer } from '@/app/lib/adjudicacion';
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
           n.licitacion_monto, n.licitacion_cierre, n.fecha_fin_preguntas, n.licitacion_estado,
           n.licitacion_tipo, n.licitacion_region, n.monto_ofertado,
           COALESCE(n.estado_pipeline, 'ASIGNADO') AS estado_pipeline,
           n.empresa_id, emp.razon_social AS empresa_nombre,
           n.created_at, n.updated_at,
           u.nombre AS usuario_nombre, u.email AS usuario_email,
           GROUP_CONCAT(DISTINCT e.nombre ORDER BY e.nombre SEPARATOR ',') AS etiquetas_nombres,
           GROUP_CONCAT(DISTINCT CONCAT(e.id,':',e.nombre,':',e.color) ORDER BY e.nombre SEPARATOR '|') AS etiquetas_raw,
           (SELECT COUNT(*) FROM comentarios_negocio cn WHERE cn.negocio_id = n.id) AS comentarios_count
         FROM negocios n
         JOIN usuarios u ON u.id = n.asignado_a
         LEFT JOIN empresas emp ON emp.id = n.empresa_id
         LEFT JOIN negocios_etiquetas ne ON ne.negocio_id = n.id
         LEFT JOIN etiquetas e ON e.id = ne.etiqueta_id
         ${whereClause}
         GROUP BY n.id
         ORDER BY n.updated_at DESC`,
        params),
      pool.query(
        `SELECT n.asignado_a AS usuario_id, u.nombre, u.email, n.licitacion_codigo AS codigo,
                n.licitacion_cierre,
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
      const [docsRes, viabRes, aperturaRes, adjRes] = await Promise.allSettled([
        pool.query(`SELECT DISTINCT licitacion_codigo FROM documentos_cache WHERE licitacion_codigo IN (${ph})`, codigos),
        pool.query(`SELECT licitacion_codigo, semaforo, score_total FROM viabilidad_licitacion WHERE licitacion_codigo IN (${ph})`, codigos),
        // Estado de apertura detectado por el poller del portal (migración 41). Tolerante:
        // si la tabla no existe aún, degrada a "sin apertura conocida" sin romper la lista.
        pool.query(`SELECT licitacion_codigo, aperturada, detectada_en FROM licitacion_apertura WHERE licitacion_codigo IN (${ph})`, codigos),
        // Adjudicación REAL desde la API (cache poblado por el cron). Es la MISMA fuente que usa
        // el apartado Postuladas: por línea, con RUT del adjudicado. De aquí sale si GANAMOS
        // nosotros (adj_ganamos) o si se adjudicó a terceros (perdida). Migración 35; tolerante.
        pool.query(`SELECT * FROM adjudicacion_cache WHERE licitacion_codigo IN (${ph})`, codigos),
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
      if (aperturaRes.status === 'fulfilled') {
        const mapAp = new Map(((aperturaRes.value as any)[0] as any[]).map(r => [r.licitacion_codigo, r]));
        for (const n of negocios) {
          const a = mapAp.get(n.licitacion_codigo) as any;
          n.aperturada = a?.aperturada ? 1 : 0;
          n.apertura_detectada_en = a?.detectada_en ?? null;
        }
      }
      // Adjudicación REAL (por RUT): marca cada negocio con su resultado autoritativo de MP.
      //   adj_es_adjudicada = MP ya adjudicó el proceso (a alguien).
      //   adj_ganamos       = una de NUESTRAS empresas ganó ≥1 línea (comparación de RUT).
      // Con esto el badge de Negocios muestra "Ganada" SOLO cuando de verdad ganamos, y "Perdida"
      // cuando se adjudicó a terceros — sin inventar (antes se asumía ganada por estar postulada).
      if (adjRes.status === 'fulfilled') {
        const mapAdj = new Map(((adjRes.value as any)[0] as any[]).map(r => [r.licitacion_codigo, r]));
        for (const n of negocios) {
          const row = mapAdj.get(n.licitacion_codigo) as any;
          if (!row) { n.adj_es_adjudicada = 0; n.adj_ganamos = 0; continue; }
          const adj = await enriquecer(respuestaDesdeCache(n.licitacion_codigo, row));
          n.adj_es_adjudicada = adj.esAdjudicada ? 1 : 0;
          n.adj_ganamos       = adj.ganamos ? 1 : 0;
          n.adj_monto_nuestro = adj.montoNuestro ?? null;
        }
      }
    }

    // Carga de trabajo vigente por perfil. La REGLA (qué cuenta y qué no) vive en
    // app/lib/carga-perfiles.ts porque el Puente del Radar reparte nivelando este mismo
    // número: dos definiciones distintas = repartos torcidos sin que nadie lo note.
    const carga = resumirCarga(cargaRows as FilaCarga[]);

    return NextResponse.json({ success: true, negocios, usuarios, carga });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST — asignar licitación a usuario (solo admin)
// La lógica vive en app/lib/asignacion.ts: el Puente del Radar hace lo mismo en lote y no
// puede haber dos copias de estas reglas (mover en vez de duplicar, marcar la alerta leída,
// avisar por campana/correo, bajar los documentos). Esta ruta solo valida y traduce.
export async function POST(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Solo el admin puede asignar licitaciones' }, { status: 403 });

  try {
    const body = await request.json();
    const { licitacion_codigo, asignado_a } = body;
    if (!licitacion_codigo || !asignado_a)
      return NextResponse.json({ error: 'licitacion_codigo y asignado_a son requeridos' }, { status: 400 });

    const r = await asignarLicitacion({
      licitacion_codigo,
      asignado_a: Number(asignado_a),
      asignado_por: userId,
      etiqueta_ids: Array.isArray(body.etiqueta_ids) ? body.etiqueta_ids : [],
      licitacion_nombre: body.licitacion_nombre ?? null,
      licitacion_organismo: body.licitacion_organismo ?? null,
      licitacion_monto: body.licitacion_monto ?? null,
      licitacion_cierre: body.licitacion_cierre ?? null,
      licitacion_estado: body.licitacion_estado ?? null,
      licitacion_tipo: body.licitacion_tipo ?? null,
      licitacion_region: body.licitacion_region ?? null,
      licitacion_descripcion: body.licitacion_descripcion ?? null,
      origen: 'radar',
    });

    if (!r.ok) return NextResponse.json({ error: r.error || 'No se pudo asignar' }, { status: 500 });
    return NextResponse.json({ success: true, id: r.id });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
