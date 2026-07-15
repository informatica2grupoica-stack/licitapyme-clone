// app/api/dashboard/analitica/route.ts
// Payload ÚNICO para el dashboard de gestión interactivo (solo admin / ver_otros_negocios).
//
// Filosofía: el servidor devuelve UNA fila por negocio ya enriquecida y el FRONTEND hace
// todo el cruce y la medición al instante (estados × analistas × empresa recalculan KPIs sin
// volver a pegarle al servidor). Ese es el patrón "selectivo que va midiendo".
//
// Datos DERIVADOS sin migración nueva:
//   · triageDias   → desde negocios.created_at (momento de la asignación) hasta el 1er cambio
//                    a EN_PROCESO o DESCARTADA, reconstruido de actividad_usuario.
//   · nivelDescarte→ nivel del descarte (N1 recién asignada / N2 tras análisis / Error de
//                    Gestión en Anexos+) inferido del máximo estado alcanzado antes del descarte.
//   · mpEstado     → estado EFECTIVO de Mercado Público (Publicada vencida → Cerrada).
//   · resultado    → ganada/perdida/evaluación desde estado_pipeline (el cron lo auto-promueve).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { estadoEfectivoNombre } from '@/app/lib/estado-mp';
import { normalizarEstado, ESTADOS_PIPELINE } from '@/app/lib/pipeline';
import { rutsNuestros, normRut } from '@/app/lib/adjudicacion';

function getUser(request: NextRequest) {
  const id = request.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  if (isNaN(n)) return null;
  return { id: n, email: request.headers.get('x-user-email') || '', rol: request.headers.get('x-user-rol') || 'usuario' };
}

// Query tolerante: si una tabla/columna falta, degrada en vez de romper el tablero. PERO deja
// rastro en el log: un catch mudo aquí hizo que el endpoint sirviera datos del respaldo (sin
// apertura ni adjudicación) durante semanas y nadie se enteró — los KPIs se veían normales,
// solo que mentían.
async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  try { const [rows] = await pool.query(sql, params); return rows as T[]; }
  catch (e) {
    console.error('[dashboard/analitica] query falló → se degrada:', String(e).slice(0, 200));
    return [];
  }
}

// Índice de una etapa dentro del flujo (para saber "hasta dónde llegó" un negocio).
const RANK: Record<string, number> = Object.fromEntries(
  ['ASIGNADO', 'EN_PROCESO', 'ANEXOS', 'ANEXO_LISTO', 'VISADO', 'POSTULADA'].map((id, i) => [id, i]),
);
const MS_DIA = 86_400_000;

export async function GET(request: NextRequest) {
  const sesion = getUser(request);
  if (!sesion) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const permisos = await permisosDeUsuario(sesion.id, sesion.rol);
  const verOtros = sesion.rol === 'admin' || !!permisos.ver_otros_negocios;
  if (!verOtros) return NextResponse.json({ error: 'Sin permiso' }, { status: 403 });

  try {
    // ── 1) Negocios activos + joins tolerantes (empresa, apertura, adjudicación) ──────────
    // OJO con el COLLATE: negocios.licitacion_codigo es utf8mb4_general_ci y las otras dos
    // tablas son utf8mb4_unicode_ci. Sin forzarlo, el JOIN muere con "Illegal mix of
    // collations", q() lo capturaba mudo y TODO el tablero caía al fallback de abajo: apertura
    // siempre 0 y el resultado derivado del estado_pipeline en vez del acta de MP (se veía
    // "5 adjudicadas" cuando MP había adjudicado 28). Se colacciona el lado de `negocios` a
    // unicode_ci —y no al revés— para que los índices de ap/ac sigan siendo usables.
    // El arreglo de fondo es alinear el esquema: migration-24 paso 2.
    const base = await q<any>(
      `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo,
              n.licitacion_monto, n.licitacion_cierre, n.licitacion_estado, n.licitacion_tipo,
              COALESCE(n.estado_pipeline,'ASIGNADO') AS estado_pipeline,
              n.descarte_motivo, n.descarte_at, n.monto_ofertado, n.empresa_id, n.created_at,
              n.asignado_a, u.nombre AS analista_nombre, u.email AS analista_email,
              e.razon_social AS empresa_nombre,
              ap.aperturada AS aperturada, ap.detectada_en AS apertura_en,
              ac.es_adjudicada AS es_adjudicada, ac.monto_adjudicado_total AS monto_adjudicado,
              ac.lineas AS adj_lineas
       FROM negocios n
       LEFT JOIN usuarios u            ON u.id = n.asignado_a
       LEFT JOIN empresas e            ON e.id = n.empresa_id
       LEFT JOIN licitacion_apertura ap ON ap.licitacion_codigo = n.licitacion_codigo COLLATE utf8mb4_unicode_ci
       LEFT JOIN adjudicacion_cache ac  ON ac.licitacion_codigo = n.licitacion_codigo COLLATE utf8mb4_unicode_ci
       WHERE n.activo = TRUE`,
    );

    // Fallback si algún JOIN raro rompiera la query (tabla ausente): traer lo mínimo.
    const negocios = base.length ? base : await q<any>(
      `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo,
              n.licitacion_monto, n.licitacion_cierre, n.licitacion_estado, n.licitacion_tipo,
              COALESCE(n.estado_pipeline,'ASIGNADO') AS estado_pipeline,
              n.descarte_motivo, n.descarte_at, n.monto_ofertado, n.empresa_id, n.created_at,
              n.asignado_a, u.nombre AS analista_nombre, u.email AS analista_email
       FROM negocios n LEFT JOIN usuarios u ON u.id = n.asignado_a
       WHERE n.activo = TRUE`,
    );

    const ids = negocios.map(n => n.id);

    // ── 2) Línea de tiempo (cambios de estado + (re)asignaciones) ─────────────────────────
    // Una sola query: cambios de pipeline (para triage, nivel de descarte, POSIBLE_ADJ) y
    // eventos de asignación (para reiniciar el reloj de triage tras una reasignación).
    const timeline = ids.length
      ? await q<{ negocio_id: string; accion: string; estado: string | null; t: string }>(
          `SELECT entidad_id AS negocio_id, accion,
                  JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.estado_pipeline')) AS estado,
                  created_at AS t
           FROM actividad_usuario
           WHERE accion IN ('cambio_pipeline','asignacion') AND entidad_tipo = 'negocio'
             AND entidad_id IN (${ids.map(() => '?').join(',')})
           ORDER BY created_at ASC`,
          ids.map(String),
        )
      : [];

    const eventos = new Map<string, { estado: string; t: number }[]>();      // cambios de pipeline
    const asignaciones = new Map<string, number[]>();                        // timestamps de (re)asignación
    for (const ev of timeline) {
      const key = String(ev.negocio_id);
      const t = new Date(ev.t).getTime();
      if (ev.accion === 'asignacion') {
        const arr = asignaciones.get(key) || []; arr.push(t); asignaciones.set(key, arr);
      } else if (ev.estado) {
        const arr = eventos.get(key) || [];
        arr.push({ estado: normalizarEstado(ev.estado), t });
        eventos.set(key, arr);
      }
    }

    // Línea de negocio = etiquetas del negocio (EQUIPAMIENTO / MATERIALES / … = Ferretería).
    const etiquetasRows = ids.length
      ? await q<{ negocio_id: number; nombre: string }>(
          `SELECT ne.negocio_id, e.nombre
           FROM negocios_etiquetas ne JOIN etiquetas e ON e.id = ne.etiqueta_id
           WHERE ne.negocio_id IN (${ids.map(() => '?').join(',')})`,
          ids,
        )
      : [];
    const lineasPorNegocio = new Map<number, string[]>();
    for (const r of etiquetasRows) {
      const arr = lineasPorNegocio.get(r.negocio_id) || []; arr.push(r.nombre); lineasPorNegocio.set(r.negocio_id, arr);
    }

    // ── 3) Enriquecer cada negocio ────────────────────────────────────────────────────────
    // RUT de nuestras empresas: para decidir "ganamos" igual que Postuladas (por RUT en las
    // líneas adjudicadas), SIN depender de que el cron haya promovido estado_pipeline.
    const nuestros = await rutsNuestros();
    const UNIVERSO_POSTULADA = ['POSTULADA', 'POSIBLE_ADJ', 'ADJUDICADA', 'PERDIDA'];

    const rows = negocios.map(n => {
      const estado = normalizarEstado(n.estado_pipeline);
      const evs = eventos.get(String(n.id)) || [];
      const creado = n.created_at ? new Date(n.created_at).getTime() : null;

      // triage: desde la ÚLTIMA (re)asignación hasta la 1ª decisión (En Proceso o Descartada).
      // El reloj se reinicia al reasignar (§2.2 de la ficha): arranca en la asignación más
      // reciente; si no hay eventos de asignación registrados, cae al created_at.
      const asigs = asignaciones.get(String(n.id)) || [];
      const inicioTriage = asigs.length ? Math.max(...asigs) : creado;
      let triageDias: number | null = null;
      const primeraDecision = evs.find(e =>
        (e.estado === 'EN_PROCESO' || e.estado === 'DESCARTADA') && inicioTriage != null && e.t >= inicioTriage);
      const tDecision = primeraDecision?.t
        ?? (estado === 'DESCARTADA' && n.descarte_at ? new Date(n.descarte_at).getTime() : null);
      if (inicioTriage && tDecision && tDecision >= inicioTriage) {
        triageDias = Math.round(((tDecision - inicioTriage) / MS_DIA) * 10) / 10;
      }

      // Postuladas (Módulo 3): ¿se marcó alguna vez POSIBLE_ADJ? y ¿cuándo? → precisión + SLA.
      const fuePosibleAdj = estado === 'POSIBLE_ADJ' || evs.some(e => e.estado === 'POSIBLE_ADJ');
      const posEvent = evs.find(e => e.estado === 'POSIBLE_ADJ');
      const aperturaEnMs = n.apertura_en ? new Date(n.apertura_en).getTime() : null;
      // SLA de revisión de apertura: días desde la apertura técnica hasta que se marcó/revisó.
      let slaAperturaDias: number | null = null;
      if (aperturaEnMs && posEvent && posEvent.t >= aperturaEnMs) {
        slaAperturaDias = Math.round(((posEvent.t - aperturaEnMs) / MS_DIA) * 10) / 10;
      }

      // nivel de descarte: máximo estado alcanzado antes del descarte.
      let nivelDescarte: 'N1' | 'N2' | 'error_gestion' | null = null;
      if (estado === 'DESCARTADA') {
        const maxRank = evs.reduce((m, e) => Math.max(m, RANK[e.estado] ?? -1), -1);
        nivelDescarte = maxRank >= RANK.ANEXOS ? 'error_gestion' : maxRank >= RANK.EN_PROCESO ? 'N2' : 'N1';
      }

      const mpEstado = estadoEfectivoNombre(n.licitacion_estado, n.licitacion_cierre);
      const mpCerrada = !!mpEstado && mpEstado !== 'Publicada';

      // Resultado ganada/perdida/evaluación derivado del CACHE DE ADJUDICACIÓN (misma fuente
      // que Postuladas: MP adjudicó y ≥1 línea la ganó una de nuestras empresas por RUT).
      // No depende de estado_pipeline, que puede seguir en POSTULADA (el cron no promueve).
      let resultado: 'ganada' | 'perdida' | 'evaluacion' | null = null;
      let montoNeto: number | null = null;
      if (UNIVERSO_POSTULADA.includes(estado)) {
        if (n.es_adjudicada) {
          let lineas: any[] = [];
          try { lineas = n.adj_lineas ? JSON.parse(n.adj_lineas) : []; } catch { lineas = []; }
          let ganamos = false, montoNuestro = 0;
          for (const l of lineas) {
            if (l?.rutProveedor && nuestros.has(normRut(l.rutProveedor))) {
              ganamos = true;
              montoNuestro += (Number(l.montoUnitario) || 0) * (Number(l.cantidad) || 1);
            }
          }
          resultado = ganamos ? 'ganada' : 'perdida';
          montoNeto = ganamos ? (montoNuestro || Number(n.monto_adjudicado ?? n.monto_ofertado ?? 0) || null) : null;
        } else if (estado === 'ADJUDICADA') {
          resultado = 'ganada';
          montoNeto = Number(n.monto_adjudicado ?? n.monto_ofertado ?? n.licitacion_monto ?? 0) || null;
        } else if (estado === 'PERDIDA') {
          resultado = 'perdida';
        } else {
          resultado = 'evaluacion';
        }
      }

      return {
        id: n.id,
        codigo: n.licitacion_codigo,
        nombre: n.licitacion_nombre,
        organismo: n.licitacion_organismo,
        estado,
        analistaId: n.asignado_a,
        analista: n.analista_nombre || n.analista_email || 'Sin asignar',
        analistaEmail: n.analista_email || null,
        monto: Number(n.licitacion_monto ?? 0),
        empresaId: n.empresa_id ?? null,
        empresa: n.empresa_nombre ?? null,
        tipo: n.licitacion_tipo ?? null,
        mpEstado, mpCerrada,
        aperturada: n.aperturada ? 1 : 0,
        triageDias, nivelDescarte,
        descarteMotivo: n.descarte_motivo ?? null,
        resultado,
        montoNeto,
        montoOfertado: n.monto_ofertado != null ? Number(n.monto_ofertado) : null,
        creadoAt: n.created_at ?? null,
        descarteAt: n.descarte_at ?? null,
        // Módulo 3 + §4.5
        lineas: lineasPorNegocio.get(n.id) ?? [],
        fuePosibleAdj,
        slaAperturaDias,
        aperturaEn: n.apertura_en ?? null,
      };
    });

    // ── 4) Catálogos para los filtros ─────────────────────────────────────────────────────
    const analistasMap = new Map<number, { id: number; nombre: string; email: string | null }>();
    const empresasMap = new Map<number, { id: number; nombre: string }>();
    const lineasSet = new Set<string>();
    for (const r of rows) {
      if (r.analistaId && !analistasMap.has(r.analistaId))
        analistasMap.set(r.analistaId, { id: r.analistaId, nombre: r.analista, email: r.analistaEmail });
      if (r.empresaId && r.empresa && !empresasMap.has(r.empresaId))
        empresasMap.set(r.empresaId, { id: r.empresaId, nombre: r.empresa });
      for (const l of r.lineas) lineasSet.add(l);
    }

    return NextResponse.json({
      success: true,
      rows,
      analistas: [...analistasMap.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      empresas: [...empresasMap.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      lineas: [...lineasSet].sort((a, b) => a.localeCompare(b, 'es')),
      estados: ESTADOS_PIPELINE,
    });
  } catch (error) {
    console.error('Error en dashboard/analitica:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
