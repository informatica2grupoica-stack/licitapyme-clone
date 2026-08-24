// app/api/negocios/[id]/comercial/route.ts
// MÓDULO "INFORMACIÓN COMERCIAL" — el auditor de la etapa ANEXOS.
//
//   GET   → checklist del negocio (lo materializa desde la viabilidad la primera vez) + resumen
//   POST  → { accion: 'resincronizar' } agrega los puntos nuevos tras un re-análisis
//           { accion: 'agregar', ... }  punto manual que la IA no vio
//   PATCH → { itemId, accion: 'CARGAR'|'APROBAR'|'OBSERVAR'|'REABRIR', ... }
//
// DOBLE FIRMA: el asistente CARGA, el asesor APRUEBA. Cada acción notifica al otro lado EN EL
// ACTO (SSE + campana), porque el flujo real es "sube a las 10:32, se aprueba a las 10:33" —
// un digest agrupado llegaría cuando la licitación ya cerró.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { publicarCambio } from '@/app/lib/sse-bus';
import { puedeVerNegocioAsignado, permisosDeUsuario } from '@/app/lib/api-auth';
import { ahoraChileSQL } from '@/app/lib/tz';
import {
  generarItemsDesdeViabilidad, resumirChecklist, transicion, tieneInformacionComercial,
  esPorLinea, modalidadDudosa, estadoDeBloque, lineasDelInforme, excluirYaExistentes, type EstadoItem,
  CLAVE_ITEM_PLAZO, rangoPlazoDeDescripcion, validarPlazoOfertado, reubicacionDeItemGuardado,
} from '@/app/lib/checklist-comercial';
import { calcularSemaforo, causalesDeBloqueo } from '@/app/lib/semaforo-auditor';
import { leerCachePreguntas } from '@/app/lib/preguntas-respuestas';
import { revisarDeltaForo } from '@/app/lib/control-foro';
import { leerCongelamiento, yaCongelado } from '@/app/lib/congelamiento';
import { agregarDocumentos, bitacora } from '@/app/lib/checklist-comercial-db';

import { decidirGeneracion, type DocumentoCandidato, type BloqueGenerable } from '@/app/lib/auditor-generacion';
import { recalcularAlertasCosteo } from '@/app/lib/motor-comercial-recalculo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// Exportado: reusado por la ruta hermana .../[itemId]/caracteristicas (Auditor Técnico, Fase 1).
export const COLS = `id, negocio_id, bloque, tipo, titulo, descripcion, criticidad, ponderacion, fuente_cita,
  origen, clave_origen, generable, plantilla_id, linea_numero, ofertamos, estado, valor_texto,
  valor_numero, observacion, orden,
  cargado_por, cargado_por_nombre, cargado_at, aprobado_por, aprobado_por_nombre, aprobado_at`;

/** Negocio + datos de la empresa con la que se postula (los que alimentan los anexos). */
export async function cargarNegocio(id: string) {
  const [rows] = await pool.query(
    `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.estado_pipeline, n.asignado_a,
            n.empresa_id, n.licitacion_cierre, u.nombre AS asignado_nombre,
            e.razon_social, e.rut, e.direccion, e.region, e.giro, e.tipo_persona_juridica,
            e.representante_nombre, e.representante_rut, e.representante_cargo,
            e.email1, e.telefono1, e.banco_tipo_cuenta, e.banco_numero, e.banco_nombre
       FROM negocios n
       LEFT JOIN usuarios u ON u.id = n.asignado_a
       LEFT JOIN empresas e ON e.id = n.empresa_id
      WHERE n.id = ? AND n.activo = TRUE
      LIMIT 1`,
    [id],
  ) as any;
  return (rows as any[])[0] || null;
}

/** Informe de viabilidad guardado (v3 preferido, v2 de respaldo) — misma lectura que usa el panel. */
export async function leerInforme(codigo: string): Promise<any | null> {
  try {
    const [rows] = await pool.query(
      `SELECT informe_ejecutivo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
    const row = (rows as any[])[0];
    if (!row) return null;
    const ie = typeof row.informe_ejecutivo === 'string' ? JSON.parse(row.informe_ejecutivo) : row.informe_ejecutivo;
    return ie?._informe_ia_v3 ?? ie?._informe_ia ?? null;
  } catch { return null; }
}

/** ¿Este usuario visa? Admin siempre; otro perfil solo con el permiso aprobar_comercial. */
export async function esAsesor(userId: number, rol: string | null): Promise<boolean> {
  if (rol === 'admin') return true;
  const p = await permisosDeUsuario(userId, rol);
  return !!p.aprobar_comercial;
}

/** A quién avisar cuando el asistente carga algo: todos los que pueden visar. */
export async function asesores(): Promise<Array<{ id: number; nombre: string }>> {
  try {
    const [rows] = await pool.query(
      // JSON_UNQUOTE(...)='true' y no `= TRUE`: comparar un valor JSON contra el booleano
      // de SQL depende de la versión de MySQL y falla en silencio (no encuentra a nadie).
      `SELECT id, nombre FROM usuarios
        WHERE activo = TRUE
          AND (rol = 'admin' OR JSON_UNQUOTE(JSON_EXTRACT(permisos, '$.aprobar_comercial')) = 'true')`,
    ) as any;
    return rows as any[];
  } catch {
    // Sin columna `permisos` (migración 28 pendiente) o sin `activo`: caer a los admin.
    try {
      const [rows] = await pool.query(`SELECT id, nombre FROM usuarios WHERE rol = 'admin'`) as any;
      return rows as any[];
    } catch { return []; }
  }
}

/**
 * ¿Están creadas las tablas? Las migraciones se aplican a mano en phpMyAdmin, así que el
 * módulo tiene que decir "falta la migración 48" en vez de reventar con un 500 opaco.
 */
async function migracionAplicada(): Promise<boolean> {
  try { await pool.query('SELECT 1 FROM checklist_comercial LIMIT 1'); return true; }
  catch { return false; }
}

/** Documentos de TODOS los puntos de un negocio, en una sola consulta (agrupados por item_id). */
async function leerDocumentosPorItem(negocioId: number): Promise<Map<number, any[]>> {
  const porItem = new Map<number, any[]>();
  try {
    const [rows] = await pool.query(
      `SELECT id, item_id, url, nombre, subido_por_nombre, subido_at
         FROM checklist_comercial_documentos WHERE negocio_id = ? ORDER BY subido_at, id`,
      [negocioId],
    ) as any;
    for (const r of rows as any[]) {
      const arr = porItem.get(r.item_id) || [];
      arr.push({ id: r.id, url: r.url, nombre: r.nombre, subidoPorNombre: r.subido_por_nombre, subidoAt: r.subido_at });
      porItem.set(r.item_id, arr);
    }
  } catch { /* migración 49 pendiente → cada punto queda sin documentos, no revienta */ }
  return porItem;
}

export // Resumen agregado (1 query, no N+1) por línea técnica — alimenta el nivel 1 de FilaLineaTecnica
// ("12 de 14 cumple") sin traer el detalle completo de características en cada carga de página.
async function leerResumenesTecnicos(negocioId: number): Promise<Map<number, any>> {
  const porItem = new Map<number, any>();
  try {
    const [rows] = await pool.query(
      `SELECT item_id,
              COUNT(*) AS total,
              SUM(veredicto = 'CUMPLE') AS cumplen,
              SUM(veredicto = 'NO_CUMPLE') AS no_cumplen,
              SUM(veredicto = 'CUMPLE_CON_COMPLEMENTO') AS con_complemento,
              SUM(veredicto IS NULL) AS sin_evaluar,
              SUM(pendiente_confirmacion_proveedor = 1) AS pendientes_proveedor
         FROM checklist_comercial_caracteristicas WHERE negocio_id = ? GROUP BY item_id`,
      [negocioId],
    ) as any;
    for (const r of rows as any[]) {
      porItem.set(r.item_id, {
        total: Number(r.total), cumplen: Number(r.cumplen), noCumplen: Number(r.no_cumplen),
        conComplemento: Number(r.con_complemento), sinEvaluar: Number(r.sin_evaluar),
        pendientesProveedor: Number(r.pendientes_proveedor),
      });
    }
  } catch { /* migración 50 pendiente → cada línea técnica queda sin resumen, no revienta */ }
  return porItem;
}

export async function leerItems(negocioId: number) {
  const [rows] = await pool.query(
    `SELECT ${COLS} FROM checklist_comercial WHERE negocio_id = ? ORDER BY bloque, orden, id`,
    [negocioId],
  ) as any;
  const documentos = await leerDocumentosPorItem(negocioId);
  const resumenesTecnicos = await leerResumenesTecnicos(negocioId);
  return (rows as any[]).map(r => ({
    ...r,
    generable: !!r.generable,
    ofertamos: r.ofertamos === null ? null : !!r.ofertamos,
    ponderacion: r.ponderacion === null ? null : Number(r.ponderacion),
    valor_numero: r.valor_numero === null ? null : Number(r.valor_numero),
    documentos: documentos.get(r.id) || [],
    resumen_tecnico: r.tipo === 'linea_tecnica' ? (resumenesTecnicos.get(r.id) || { total: 0, cumplen: 0, noCumplen: 0, conComplemento: 0, sinEvaluar: 0, pendientesProveedor: 0 }) : null,
  }));
}

// agregarDocumentos y bitacora viven en app/lib/checklist-comercial-db.ts (el motor de
// comparación masiva las necesita y este route lo importa: dejarlas aquí sería un ciclo).
// Se re-exportan para no tocar a quienes ya las traían desde este módulo.
export { agregarDocumentos, bitacora };

/**
 * Materializa el checklist desde el informe. Idempotente: `INSERT IGNORE` contra la unique
 * (negocio_id, clave_origen), así que resincronizar tras un re-análisis AGREGA lo nuevo y
 * nunca pisa lo que el asesor ya aprobó.
 */
async function sincronizar(negocioId: number, codigo: string, informe: any): Promise<number> {
  let items = generarItemsDesdeViabilidad(informe);
  if (!items.length) return 0;

  // Cierra el hueco que el INSERT IGNORE de abajo no cubre: un re-análisis puede redactar el
  // MISMO Anexo/Formato N°X con otras palabras, y como clave_origen es el slug de ESE texto, el
  // UNIQUE(negocio_id, clave_origen) no lo detecta como repetido — ver excluirYaExistentes().
  const [existentesRows] = await pool.query(
    `SELECT titulo FROM checklist_comercial WHERE negocio_id = ? AND bloque = 'ADMINISTRATIVO'`,
    [negocioId],
  );
  items = excluirYaExistentes(items, (existentesRows as Array<{ titulo: string }>).map(r => r.titulo));

  let nuevos = 0;
  for (const it of items) {
    const [r] = await pool.query(
      `INSERT IGNORE INTO checklist_comercial
         (negocio_id, licitacion_codigo, bloque, tipo, titulo, descripcion, criticidad, ponderacion,
          fuente_cita, origen, clave_origen, generable, linea_numero, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        negocioId, codigo, it.bloque, it.tipo, it.titulo, it.descripcion, it.criticidad,
        it.ponderacion, it.fuenteCita, it.origen, it.claveOrigen, it.generable ? 1 : 0,
        it.lineaNumero, it.orden,
      ],
    ) as any;
    if ((r as any).affectedRows) nuevos++;
  }

  await reubicarExistentes(negocioId);
  return nuevos;
}

/** Mueve al bloque/sección correctos las filas insertadas con la clasificación vieja — ver
 *  reubicacionDeItemGuardado(). Solo bloque/tipo: estado, valores y firmas quedan intactos. */
async function reubicarExistentes(negocioId: number): Promise<void> {
  try {
    const [rows] = await pool.query(
      `SELECT id, clave_origen, titulo, bloque, tipo FROM checklist_comercial WHERE negocio_id = ?`,
      [negocioId],
    );
    for (const row of rows as any[]) {
      const destino = reubicacionDeItemGuardado(row);
      if (!destino) continue;
      await pool.query(`UPDATE checklist_comercial SET bloque = ?, tipo = ? WHERE id = ?`,
        [destino.bloque, destino.tipo, row.id]);
    }
  } catch {
    /* nunca romper la sincronización por un reacomodo visual */
  }
}

/** ¿El informe de viabilidad se guardó DESPUÉS de la última vez que se materializó el checklist?
 *  Dos lecturas de una fila cada una — mucho más barato que correr sincronizar() a ciegas. */
async function viabilidadMasNuevaQueChecklist(negocioId: number, codigo: string): Promise<boolean> {
  try {
    const [rows] = await pool.query(
      `SELECT (SELECT updated_at FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1) AS viabilidad,
              (SELECT MAX(created_at) FROM checklist_comercial WHERE negocio_id = ?)            AS checklist`,
      [codigo, negocioId],
    );
    const f = (rows as any[])[0];
    if (!f?.viabilidad || !f?.checklist) return false;
    return new Date(f.viabilidad).getTime() > new Date(f.checklist).getTime();
  } catch {
    return false;   // nunca romper la pantalla por esto: en el peor caso queda el botón manual
  }
}

/** Semáforo + causales de bloqueo del negocio (Fase 3, spec §9) — a partir de lo que ya se leyó
 *  (items con su resumen_tecnico adjunto) más la fecha de cierre, sin queries nuevas. */
function semaforoDelNegocio(negocio: any, items: any[]) {
  const horasRestantes = negocio.licitacion_cierre
    ? (new Date(negocio.licitacion_cierre).getTime() - Date.now()) / 3_600_000
    : null;

  let itemsNoCumpleSinResolver = 0, itemsPendientesProveedor = 0;
  for (const it of items) {
    if (it.tipo !== 'linea_tecnica' || !it.resumen_tecnico) continue;
    itemsNoCumpleSinResolver += it.resumen_tecnico.noCumplen || 0;
    itemsPendientesProveedor += it.resumen_tecnico.pendientesProveedor || 0;
  }

  const bloqueAprobado = (bloque: string) => {
    const del = estadoDeBloque(items.filter(i => i.bloque === bloque));
    return del === 'APROBADO' || del === 'SIN_ITEMS';
  };
  const bloqueTecnicoAprobado = bloqueAprobado('TECNICO');
  const bloqueComercialAprobado = bloqueAprobado('COMERCIAL');

  const resumen = resumirChecklist(items);
  const semaforo = calcularSemaforo({
    horasRestantes,
    bloqueantesPendientes: resumen.bloqueantesPendientes,
    faltaAprobacionVigente: !bloqueTecnicoAprobado || !bloqueComercialAprobado,
  });
  const causales = causalesDeBloqueo({
    bloqueantesPendientes: resumen.bloqueantesPendientes,
    itemsNoCumpleSinResolver, itemsPendientesProveedor,
    bloqueTecnicoAprobado, bloqueComercialAprobado, horasRestantes,
  });

  return { semaforo, causales, horasRestantes };
}

// ═══ GET ════════════════════════════════════════════════════════════════════════
/**
 * Decide, para los bloques COMERCIAL y TÉCNICO, si ya se puede generar su anexo. Todo el juicio
 * vive en auditor-generacion.ts (módulo puro y testeado); acá solo se juntan los datos.
 *
 * Los documentos candidatos son SIEMPRE los .docx que se bajaron de Mercado Público, con la
 * categoría que anexos-dividir.ts les puso al separarlos. Nunca una plantilla nuestra: por eso se
 * excluye DOCUMENTOS_PROPIOS, que es donde caen los archivos que la app ya generó.
 */
const CATEGORIA_CAJA_A_ANEXO: Record<string, DocumentoCandidato['categoria']> = {
  ANEXOS_ADMINISTRATIVOS: 'administrativo',
  ANEXOS_TECNICOS: 'tecnico',
  ANEXOS_ECONOMICOS: 'economico',
  ANEXOS_OFERENTE: 'sin_clasificar',
};

async function decidirGeneracionDeBloques(negocio: any) {
  const [docRows] = await pool.query(
    `SELECT id, documento_nombre, categoria, documento_url_local FROM documentos_cache
      WHERE licitacion_codigo = ? AND categoria <> 'DOCUMENTOS_PROPIOS'
        AND (documento_nombre LIKE '%.docx' OR documento_nombre LIKE '%.doc')`,
    [negocio.licitacion_codigo],
  ) as any;
  const documentos: DocumentoCandidato[] = (docRows as any[]).map(d => ({
    id: d.id, nombre: d.documento_nombre, url: d.documento_url_local,
    categoria: CATEGORIA_CAJA_A_ANEXO[d.categoria] ?? 'sin_clasificar',
  }));

  const [costeoRows] = await pool.query(
    `SELECT id FROM checklist_comercial_costeo WHERE negocio_id = ? AND vigente = 1 LIMIT 1`,
    [negocio.id],
  ) as any;
  const hayCosteoVigente = (costeoRows as any[]).length > 0;

  const items = await leerItems(negocio.id);
  const porBloque = (b: BloqueGenerable) => items
    .filter((i: any) => i.bloque === b)
    .map((i: any) => ({ estado: i.estado, ofertamos: i.ofertamos }));

  // ¿El bloque COMERCIAL ya tiene algo APROBADO y con valor cargado? (ver el comentario en
  // decidirGeneracion) — si sí, no hace falta exigir además un costeo para generar el anexo.
  const hayDatosAuditorComercial = items.some((i: any) =>
    i.bloque === 'COMERCIAL' && i.ofertamos !== false && i.estado === 'APROBADO'
    && (i.valor_texto || i.valor_numero != null),
  );

  return {
    COMERCIAL: decidirGeneracion({ bloque: 'COMERCIAL', items: porBloque('COMERCIAL'), hayCosteoVigente, hayDatosAuditorComercial, documentos }),
    TECNICO: decidirGeneracion({ bloque: 'TECNICO', items: porBloque('TECNICO'), hayCosteoVigente, documentos }),
  };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    if (!(await migracionAplicada())) {
      return NextResponse.json({
        success: true, migracionPendiente: true, activo: tieneInformacionComercial(negocio.estado_pipeline),
        items: [], resumen: resumirChecklist([]), puedeAprobar: false, sinViabilidad: false,
        modalidad: null, empresa: null,
        semaforo: 'VERDE' as const, causalesBloqueo: [], horasRestantesCierre: null,
      });
    }

    const activo = tieneInformacionComercial(negocio.estado_pipeline);
    const informe = await leerInforme(negocio.licitacion_codigo);

    let items = await leerItems(negocio.id);
    // Primera entrada a ANEXOS: se materializa el checklist. Solo si la etapa está activa,
    // para no generar trabajo en licitaciones que aún están en análisis.
    //
    // …y si el checklist YA existe pero la viabilidad se re-analizó después, se vuelve a
    // sincronizar sola. Antes la condición era solo `items.length === 0`, así que un re-análisis
    // que descubría anexos nuevos NO se reflejaba acá hasta que alguien apretara "Resincronizar"
    // a mano — el informe mostraba 11 anexos y el auditor seguía con los 7 del primer análisis,
    // que es justo el punto donde no se puede confiar en el checklist. sincronizar() es
    // INSERT IGNORE contra la unique (negocio_id, clave_origen): agrega lo nuevo y jamás pisa lo
    // que el asesor ya cargó o aprobó. Se compara contra la fecha del informe para no correr los
    // ~20 INSERT en cada carga de pantalla, solo cuando de verdad hay algo más nuevo.
    if (activo && informe && (items.length === 0 || await viabilidadMasNuevaQueChecklist(negocio.id, negocio.licitacion_codigo))) {
      await sincronizar(negocio.id, negocio.licitacion_codigo, informe);
      items = await leerItems(negocio.id);
    }

    // ── Control de cambios del foro (Fase 6, spec §11) ──────────────────────────────
    // Solo lee el CACHÉ ya scrapeado por el cron (preguntas_respuestas_cache) — nunca abre un
    // navegador real en el camino de una petición GET normal. Si el foro cambió desde la última
    // revisión, revierte a OBSERVADO cualquier bloque TECNICO/COMERCIAL que ya estuviera
    // APROBADO y avisa — por eso `items` se vuelve a leer si hubo delta.
    let cambiosForo: Awaited<ReturnType<typeof revisarDeltaForo>> = [];
    if (activo) {
      try {
        const foroCache = await leerCachePreguntas(negocio.licitacion_codigo);
        if (foroCache && foroCache.preguntas.length > 0) {
          cambiosForo = await revisarDeltaForo({
            negocioId: negocio.id, licitacionCodigo: negocio.licitacion_codigo, licitacionNombre: negocio.licitacion_nombre,
            asignadoA: negocio.asignado_a, asignadoNombre: negocio.asignado_nombre,
            preguntasActuales: foroCache.preguntas, bitacora, asesores,
          });
          if (cambiosForo.length > 0) items = await leerItems(negocio.id);
        }
      } catch (e) { console.error('[comercial][GET] control-foro falló:', String(e)); }
    }
    let foroSnapshotInfo: { ultimoDelta: any[]; ultimoDeltaAt: string | null; bloquesRevertidos: string[] } | null = null;
    try {
      const [rows] = await pool.query(
        `SELECT ultimo_delta, ultimo_delta_at, bloques_revertidos FROM checklist_comercial_foro_snapshot WHERE negocio_id = ? LIMIT 1`,
        [negocio.id],
      ) as any;
      const row = (rows as any[])[0];
      if (row?.ultimo_delta) {
        foroSnapshotInfo = {
          ultimoDelta: JSON.parse(row.ultimo_delta),
          ultimoDeltaAt: row.ultimo_delta_at,
          bloquesRevertidos: row.bloques_revertidos ? row.bloques_revertidos.split(',') : [],
        };
      }
    } catch { /* migración 54 pendiente */ }

    const { semaforo, causales, horasRestantes } = semaforoDelNegocio(negocio, items);
    const congelamiento = await leerCongelamiento(negocio.id);
    const generacion = await decidirGeneracionDeBloques(negocio);

    return NextResponse.json({
      success: true,
      activo,
      sinViabilidad: !informe,
      items,
      congelado: congelamiento ? { congeladoAt: congelamiento.congeladoAt, congeladoPorNombre: congelamiento.congeladoPorNombre } : null,
      foroSnapshot: foroSnapshotInfo,
      resumen: resumirChecklist(items),
      semaforo, causalesBloqueo: causales, horasRestantesCierre: horasRestantes,
      // ¿Ya se puede generar el anexo económico / técnico desde acá? Ver auditor-generacion.ts:
      // la UI muestra el botón o el motivo por el que todavía no, nunca un botón muerto.
      generacion,
      puedeAprobar: await esAsesor(userId, rol),
      esAsignado: Number(negocio.asignado_a) === Number(userId),
      modalidad: {
        porLinea: informe ? esPorLinea(informe) : false,
        dudosa: informe ? modalidadDudosa(informe) : true,
        tipo: informe?.modalidad?.tipo ?? null,
        comoSeAdjudica: informe?.modalidad?.como_se_adjudica ?? null,
      },
      empresa: negocio.empresa_id ? {
        id: negocio.empresa_id, razon_social: negocio.razon_social, rut: negocio.rut,
        direccion: negocio.direccion, region: negocio.region, giro: negocio.giro,
        tipo_persona_juridica: negocio.tipo_persona_juridica,
        representante_nombre: negocio.representante_nombre, representante_rut: negocio.representante_rut,
        representante_cargo: negocio.representante_cargo, email1: negocio.email1, telefono1: negocio.telefono1,
        banco_tipo_cuenta: negocio.banco_tipo_cuenta, banco_numero: negocio.banco_numero, banco_nombre: negocio.banco_nombre,
      } : null,
    });
  } catch (error) {
    console.error('[comercial][GET]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ═══ POST — resincronizar / agregar punto manual ════════════════════════════════
export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (await yaCongelado(negocio.id))
      return NextResponse.json({ error: 'Este negocio ya se postuló: el Auditor Técnico quedó congelado, de solo lectura.' }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const accion = String(body.accion || 'resincronizar');

    if (accion === 'resincronizar') {
      const informe = await leerInforme(negocio.licitacion_codigo);
      if (!informe) return NextResponse.json({ error: 'Esta licitación aún no tiene informe de viabilidad.' }, { status: 400 });
      const nuevos = await sincronizar(negocio.id, negocio.licitacion_codigo, informe);
      const items = await leerItems(negocio.id);
      return NextResponse.json({ success: true, nuevos, items, resumen: resumirChecklist(items) });
    }

    if (accion === 'agregar') {
      const titulo = String(body.titulo || '').trim();
      if (!titulo) return NextResponse.json({ error: 'Falta el título del punto.' }, { status: 400 });
      const bloque = ['ADMINISTRATIVO', 'TECNICO', 'COMERCIAL'].includes(body.bloque) ? body.bloque : 'ADMINISTRATIVO';
      const clave = `manual:${Date.now()}:${titulo.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 80)}`;
      await pool.query(
        `INSERT INTO checklist_comercial
           (negocio_id, licitacion_codigo, bloque, tipo, titulo, descripcion, criticidad, origen, clave_origen, orden)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?, 999)`,
        [negocio.id, negocio.licitacion_codigo, bloque, body.tipo === 'dato' ? 'dato' : 'documento',
         titulo.slice(0, 280), body.descripcion || null,
         body.criticidad === 'ADMISIBILIDAD_DURA' ? 'ADMISIBILIDAD_DURA' : 'INFORMATIVO', clave],
      );
      const items = await leerItems(negocio.id);
      return NextResponse.json({ success: true, items, resumen: resumirChecklist(items) });
    }

    // 'comparar_documento_masivo' se mudó a .../comercial/comparacion-masiva (POST arranca un
    // trabajo de fondo, GET informa el avance): con 88 líneas técnicas no cabía en esta petición.
    // Ver app/lib/auditor-comparacion-masiva.ts.

    return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 });
  } catch (error) {
    console.error('[comercial][POST]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ═══ PATCH — cargar / aprobar / observar / reabrir ══════════════════════════════
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    // Congelado (spec §12.1): registro histórico inmutable, no reabrible — nada se escribe.
    if (await yaCongelado(negocio.id))
      return NextResponse.json({ error: 'Este negocio ya se postuló: el Auditor Técnico quedó congelado como registro histórico, de solo lectura.' }, { status: 409 });

    const body = await request.json().catch(() => ({}));
    const itemId = Number(body.itemId);
    const accion = String(body.accion || '') as 'CARGAR' | 'APROBAR' | 'OBSERVAR' | 'REABRIR' | 'ELIMINAR_DOCUMENTO';
    if (!itemId || !['CARGAR', 'APROBAR', 'OBSERVAR', 'REABRIR', 'ELIMINAR_DOCUMENTO'].includes(accion))
      return NextResponse.json({ error: 'Petición inválida' }, { status: 400 });

    const [rows] = await pool.query(
      `SELECT ${COLS} FROM checklist_comercial WHERE id = ? AND negocio_id = ? LIMIT 1`,
      [itemId, negocio.id],
    ) as any;
    const item = (rows as any[])[0];
    if (!item) return NextResponse.json({ error: 'Punto no encontrado' }, { status: 404 });

    const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || 'Usuario';

    // ── Eliminar un documento (error de carga). Cualquiera que pueda cargar puede corregirlo,
    // igual que "Corregir" ya permite reemplazar texto/precio. Si el punto ya estaba APROBADO,
    // sacarle una evidencia lo devuelve a revisión: no puede quedar "aprobado" con menos respaldo
    // del que el asesor vio.
    if (accion === 'ELIMINAR_DOCUMENTO') {
      const documentoId = Number(body.documentoId);
      if (!documentoId) return NextResponse.json({ error: 'Falta el documento a eliminar' }, { status: 400 });
      const [docRows] = await pool.query(
        `SELECT id, nombre FROM checklist_comercial_documentos WHERE id = ? AND item_id = ?`,
        [documentoId, itemId],
      ) as any;
      const doc = (docRows as any[])[0];
      if (!doc) return NextResponse.json({ error: 'Documento no encontrado' }, { status: 404 });

      await pool.query(`DELETE FROM checklist_comercial_documentos WHERE id = ?`, [documentoId]);

      const nuevoEstado = item.estado === 'APROBADO' ? 'CARGADO' : item.estado;
      if (nuevoEstado !== item.estado) {
        await pool.query(
          `UPDATE checklist_comercial SET estado = 'CARGADO', aprobado_por = NULL, aprobado_por_nombre = NULL, aprobado_at = NULL WHERE id = ?`,
          [itemId],
        );
      }
      await bitacora(itemId, negocio.id, 'ELIMINAR_DOCUMENTO', item.estado, nuevoEstado, `Eliminó "${doc.nombre}"`, userId, nombreActor);
      publicarCambio('checklist_comercial');
      const items = await leerItems(negocio.id);
      return NextResponse.json({ success: true, items, resumen: resumirChecklist(items) });
    }

    const visa = await esAsesor(userId, rol);
    if ((accion === 'APROBAR' || accion === 'OBSERVAR' || accion === 'REABRIR') && !visa)
      return NextResponse.json({ error: 'Solo el asesor puede visar los puntos.' }, { status: 403 });

    const anterior = item.estado as EstadoItem;

    // ── Marcar/desmarcar una línea que NO se oferta. No es una transición de estado: es
    // decidir que ese punto no entra en la oferta, así que sale del cálculo de avance.
    if (accion === 'CARGAR' && item.tipo === 'precio' && body.ofertamos === false) {
      await pool.query(
        `UPDATE checklist_comercial SET ofertamos = 0, valor_numero = NULL, estado = 'PENDIENTE' WHERE id = ?`,
        [itemId],
      );
      await bitacora(itemId, negocio.id, 'EDITAR', anterior, 'PENDIENTE', 'No se oferta esta línea', userId, nombreActor);
      const items = await leerItems(negocio.id);
      publicarCambio('checklist_comercial');
      return NextResponse.json({ success: true, items, resumen: resumirChecklist(items) });
    }

    // ── El plazo ofertado no puede pasarse del máximo admisible ────────────────────────────
    // Se valida acá y no solo en la pantalla: fuera de rango la oferta entera es inadmisible, así
    // que ni cargarlo ni visarlo debe ser posible por ninguna vía (caso real 2724-35-LP26: 31
    // días cargados y aprobados contra un tope de 30).
    if ((accion === 'CARGAR' || accion === 'APROBAR') && item.clave_origen === CLAVE_ITEM_PLAZO) {
      const texto = accion === 'CARGAR' ? String(body.valorTexto ?? '') : String(item.valor_texto || '');
      const v = validarPlazoOfertado(texto, rangoPlazoDeDescripcion(item.descripcion));
      if (v.nivel === 'error')
        return NextResponse.json({ error: v.mensaje }, { status: 400 });
    }

    const nuevo = transicion(anterior, accion);
    if (!nuevo) return NextResponse.json({ error: `No se puede ${accion.toLowerCase()} un punto en estado ${anterior}.` }, { status: 400 });

    if (accion === 'OBSERVAR' && !String(body.observacion || '').trim())
      return NextResponse.json({ error: 'La observación es obligatoria: el asistente necesita saber qué corregir.' }, { status: 400 });

    const ahora = ahoraChileSQL();

    if (accion === 'CARGAR') {
      // El asistente carga evidencia. Si el punto ya estaba aprobado, vuelve a CARGADO: un
      // valor aprobado que cambia sin que nadie lo vea es justo lo que esto viene a evitar.
      await pool.query(
        `UPDATE checklist_comercial
            SET estado = 'CARGADO', valor_texto = ?, valor_numero = ?,
                ofertamos = ?, observacion = NULL,
                cargado_por = ?, cargado_por_nombre = ?, cargado_at = ?,
                aprobado_por = NULL, aprobado_por_nombre = NULL, aprobado_at = NULL
          WHERE id = ?`,
        [
          body.valorTexto ?? item.valor_texto ?? null,
          body.valorNumero != null && body.valorNumero !== '' ? Number(body.valorNumero) : item.valor_numero,
          item.tipo === 'precio' ? 1 : item.ofertamos,
          userId, nombreActor, ahora, itemId,
        ],
      );
      // Documentos: SE ACUMULAN, nunca se reemplazan — un punto puede necesitar varias evidencias.
      const nuevosDocs = Array.isArray(body.documentos)
        ? body.documentos.filter((d: any) => d?.url && d?.nombre).map((d: any) => ({ url: String(d.url), nombre: String(d.nombre) }))
        : [];
      await agregarDocumentos(itemId, negocio.id, nuevosDocs, userId, nombreActor);
    } else if (accion === 'APROBAR') {
      await pool.query(
        `UPDATE checklist_comercial
            SET estado = 'APROBADO', observacion = NULL,
                aprobado_por = ?, aprobado_por_nombre = ?, aprobado_at = ?
          WHERE id = ?`,
        [userId, nombreActor, ahora, itemId],
      );
    } else if (accion === 'OBSERVAR') {
      await pool.query(
        `UPDATE checklist_comercial
            SET estado = 'OBSERVADO', observacion = ?,
                aprobado_por = NULL, aprobado_por_nombre = NULL, aprobado_at = NULL
          WHERE id = ?`,
        [String(body.observacion).trim().slice(0, 2000), itemId],
      );
    } else { // REABRIR
      await pool.query(
        `UPDATE checklist_comercial
            SET estado = 'PENDIENTE', aprobado_por = NULL, aprobado_por_nombre = NULL, aprobado_at = NULL
          WHERE id = ?`,
        [itemId],
      );
    }

    await bitacora(itemId, negocio.id, accion, anterior, nuevo, body.observacion || null, userId, nombreActor);

    // ── Aviso instantáneo al otro lado del circuito ──────────────────────────────
    const lic = { licitacionCodigo: negocio.licitacion_codigo, licitacionNombre: negocio.licitacion_nombre };
    if (accion === 'CARGAR') {
      // Al asesor: hay algo esperando su visto bueno. Uno por asesor, en el acto.
      for (const a of await asesores()) {
        if (Number(a.id) === Number(userId)) continue;   // no avisarse a sí mismo
        await registrarEvento({
          tipo: 'COMERCIAL_POR_APROBAR', ...lic,
          usuarioId: a.id, usuarioNombre: a.nombre,
          actorId: userId, actorNombre: nombreActor,
          mensaje: `${nombreActor} cargó "${item.titulo}" y espera tu aprobación`,
          metadata: { negocioId: negocio.id, itemId, bloque: item.bloque },
        });
      }
    } else if (accion === 'APROBAR' || accion === 'OBSERVAR') {
      // Al asistente: aprobado o devuelto. El rebote también avisa, no solo la subida.
      if (negocio.asignado_a && Number(negocio.asignado_a) !== Number(userId)) {
        await registrarEvento({
          tipo: accion === 'APROBAR' ? 'COMERCIAL_APROBADO' : 'COMERCIAL_OBSERVADO', ...lic,
          usuarioId: negocio.asignado_a, usuarioNombre: negocio.asignado_nombre,
          actorId: userId, actorNombre: nombreActor,
          mensaje: accion === 'APROBAR'
            ? `${nombreActor} aprobó "${item.titulo}"`
            : `${nombreActor} observó "${item.titulo}": ${String(body.observacion).trim().slice(0, 160)}`,
          metadata: { negocioId: negocio.id, itemId, bloque: item.bloque },
        });
      }
    }
    // Si lo que cambió fue un PRECIO, las alertas del costeo quedaron obsoletas: se recalculan acá
    // mismo. BUG REAL (19-ago-2026, 3489-29-LP26): se calculaban solo al SUBIR el costeo y quedaban
    // congeladas, así que tras corregir el precio ofertado la alerta seguía citando la cifra vieja
    // — mostraba dos montos que ya no existían en ninguna parte. Ver motor-comercial-recalculo.ts.
    if (item.tipo === 'precio') {
      try {
        const informe = await leerInforme(negocio.licitacion_codigo);
        const itemsActuales = await leerItems(negocio.id);
        await recalcularAlertasCosteo({
          negocioId: negocio.id,
          lineasPublicadas: informe ? lineasDelInforme(informe) : [],
          lineasExcluidas: new Set(
            itemsActuales
              .filter((i: any) => i.bloque === 'COMERCIAL' && i.tipo === 'precio' && i.ofertamos === false && i.linea_numero != null)
              .map((i: any) => i.linea_numero as number),
          ),
        });
      } catch (e) {
        // Recalcular es una mejora del diagnóstico, no parte de guardar el precio: si falla, el
        // precio igual quedó guardado y las alertas se refrescan en la próxima subida de costeo.
        console.warn('[comercial][PATCH] no se pudieron recalcular las alertas del costeo:', String(e));
      }
    }

    publicarCambio('checklist_comercial');

    const items = await leerItems(negocio.id);
    return NextResponse.json({ success: true, items, resumen: resumirChecklist(items) });
  } catch (error) {
    console.error('[comercial][PATCH]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}


export async function nombreDe(userId: number): Promise<string | null> {
  try {
    const [rows] = await pool.query('SELECT nombre FROM usuarios WHERE id = ? LIMIT 1', [userId]) as any;
    return (rows as any[])[0]?.nombre ?? null;
  } catch { return null; }
}
