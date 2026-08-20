// app/api/puente/route.ts
// PUENTE DEL RADAR — la bandeja donde el asesor deja licitaciones para repartirlas después.
//
// GET    → qué hay en el puente + perfiles candidatos con su carga vigente + valores para armar reglas.
// POST   → empuja códigos desde el radar al puente (los datos se congelan al entrar).
// DELETE → los saca del puente (vuelven al radar tal cual estaban).
//
// Permiso: `repartir_puente` (el admin lo tiene implícito). Es el permiso del "asesor":
// reparte trabajo del equipo sin necesidad de ser administrador.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, tienePermiso } from '@/app/lib/api-auth';
import { cargaDeEquipo } from '@/app/lib/carga-perfiles';
import { registrarActividad } from '@/app/lib/actividad';

export const dynamic = 'force-dynamic';

/** Guard común: devuelve el usuario o la respuesta de error ya armada. */
async function exigirPermiso(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  if (!(await tienePermiso(request, 'repartir_puente')))
    return { error: NextResponse.json({ error: 'Sin permiso para usar el puente' }, { status: 403 }) };
  return { usuario: u };
}

const codigosDelBody = (body: unknown): string[] => {
  const arr = (body as { codigos?: unknown })?.codigos;
  if (!Array.isArray(arr)) return [];
  return Array.from(new Set(
    arr.filter((c): c is string => typeof c === 'string' && c.trim() !== '').map(c => c.trim()),
  )).slice(0, 500); // tope de cordura: nadie reparte 500 de una
};

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const g = await exigirPermiso(request);
  if (g.error) return g.error;

  // ?resumen=1 → solo el contador (lo usa el badge del menú: pedir el puente completo en
  // cada carga de página sería tirar la lista entera por un número).
  if (new URL(request.url).searchParams.get('resumen') === '1') {
    try {
      const [[fila]] = await pool.query(`SELECT COUNT(*) AS total FROM puente_radar`) as any[];
      return NextResponse.json({ success: true, total: fila?.total || 0 });
    } catch {
      return NextResponse.json({ success: true, total: 0, _migrationPending: true });
    }
  }

  try {
    // Las 3 consultas son independientes → en paralelo. `allSettled` para que un perfil sin
    // carga o una tabla recién migrada no deje la pantalla en blanco.
    const [licRes, usuRes, cargaRes] = await Promise.allSettled([
      pool.query(
        `SELECT id, licitacion_codigo, licitacion_nombre, licitacion_organismo, licitacion_monto,
                licitacion_cierre, licitacion_estado, licitacion_tipo, licitacion_region,
                categoria_nombre, viabilidad_semaforo, agregado_por, agregado_en
         FROM puente_radar
         ORDER BY agregado_en DESC, id DESC`),
      pool.query(
        `SELECT id, nombre, email, rol FROM usuarios WHERE activo = TRUE ORDER BY nombre ASC`),
      cargaDeEquipo(),
    ]);

    if (licRes.status === 'rejected') {
      // Migración 73 pendiente: la pantalla lo dice en vez de reventar.
      return NextResponse.json({ success: true, licitaciones: [], perfiles: [], _migrationPending: true });
    }

    const licitaciones = ((licRes.value as any)[0] || []) as any[];
    const usuarios = usuRes.status === 'fulfilled' ? (((usuRes.value as any)[0] || []) as any[]) : [];
    const carga = cargaRes.status === 'fulfilled' ? cargaRes.value : [];
    const mapCarga = new Map(carga.map(c => [c.usuario_id, c]));

    const perfiles = usuarios.map(u => ({
      id: u.id, nombre: u.nombre, email: u.email, rol: u.rol,
      cargaActual: mapCarga.get(u.id)?.total ?? 0,
      vencidas: mapCarga.get(u.id)?.vencidas ?? 0,
      porEstado: mapCarga.get(u.id)?.porEstado ?? {},
    }));

    // Valores presentes EN EL PUENTE, para que la UI arme las reglas solo con lo que existe
    // (no tiene sentido ofrecer "ferretería → Juan" si en el puente no hay ninguna de ferretería).
    const cuenta = (clave: (l: any) => string | null) => {
      const m = new Map<string, number>();
      for (const l of licitaciones) {
        const v = (clave(l) || '').trim();
        if (!v) continue;
        m.set(v, (m.get(v) || 0) + 1);
      }
      return Array.from(m.entries()).map(([valor, total]) => ({ valor, total }))
        .sort((a, b) => b.total - a.total || a.valor.localeCompare(b.valor));
    };

    return NextResponse.json({
      success: true,
      licitaciones,
      perfiles,
      valores: {
        categorias: cuenta(l => l.categoria_nombre),
        regiones:   cuenta(l => l.licitacion_region),
        semaforos:  cuenta(l => l.viabilidad_semaforo),
      },
      sinCategoria: licitaciones.filter(l => !l.categoria_nombre).length,
      sinMonto:     licitaciones.filter(l => l.licitacion_monto == null).length,
    });
  } catch (error) {
    console.error('[puente:GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar el puente.' }, { status: 500 });
  }
}

// ── POST: empujar al puente ───────────────────────────────────────────────────
// Body: { codigos: string[] }
// Los datos NO se copian del cliente: se hidratan desde la BD (alertas_licitaciones es la
// fuente limpia — el cliente manda acentos rotos, ver texto-limpio.ts). Se salta lo que ya
// está asignado a un perfil: para eso está reasignar, no el puente.
export async function POST(request: NextRequest) {
  const g = await exigirPermiso(request);
  if (g.error) return g.error;

  let body: unknown;
  try { body = await request.json(); } catch { body = {}; }
  const codigos = codigosDelBody(body);
  if (codigos.length === 0)
    return NextResponse.json({ error: 'No se recibió ninguna licitación' }, { status: 400 });

  try {
    const ph = codigos.map(() => '?').join(',');

    // Ya asignadas (tienen dueño) → no entran al puente.
    const [asigRows] = await pool.query(
      `SELECT n.licitacion_codigo, u.nombre, u.email
       FROM negocios n JOIN usuarios u ON u.id = n.asignado_a
       WHERE n.activo = TRUE AND n.licitacion_codigo IN (${ph})`, codigos) as any[];
    const yaAsignadas = new Map<string, string>(
      (asigRows as any[]).map(r => [r.licitacion_codigo, r.nombre || r.email]));

    // Datos de la licitación: la última alerta de cada código (deduplicada por MAX(id)) trae
    // nombre/organismo/monto/cierre/región limpios y, vía la palabra clave, su línea de negocio.
    const [datosRows] = await pool.query(
      `SELECT a.licitacion_codigo, a.licitacion_nombre, a.licitacion_organismo, a.licitacion_monto,
              a.licitacion_cierre, a.licitacion_estado, a.licitacion_tipo, a.licitacion_region,
              cat.nombre AS categoria_nombre
       FROM alertas_licitaciones a
       JOIN (SELECT MAX(id) AS mid FROM alertas_licitaciones
             WHERE licitacion_codigo IN (${ph}) GROUP BY licitacion_codigo) ult ON ult.mid = a.id
       LEFT JOIN palabras_clave pc ON pc.id = a.palabra_clave_id
       LEFT JOIN etiquetas cat     ON cat.id = pc.categoria_id`, codigos) as any[];
    const datos = new Map<string, any>((datosRows as any[]).map(r => [r.licitacion_codigo, r]));

    // Semáforo de viabilidad (si ya se analizó): sirve como criterio de reparto.
    let semaforos = new Map<string, string>();
    try {
      const [vRows] = await pool.query(
        `SELECT licitacion_codigo, semaforo FROM viabilidad_licitacion
         WHERE licitacion_codigo IN (${ph})`, codigos) as any[];
      semaforos = new Map((vRows as any[]).map(r => [r.licitacion_codigo, r.semaforo]));
    } catch { /* sin viabilidad: se reparte igual por los otros criterios */ }

    const agregadas: string[] = [];
    const omitidasAsignadas: { codigo: string; perfil: string }[] = [];
    const sinDatos: string[] = [];

    for (const codigo of codigos) {
      if (yaAsignadas.has(codigo)) {
        omitidasAsignadas.push({ codigo, perfil: yaAsignadas.get(codigo)! });
        continue;
      }
      const d = datos.get(codigo);
      if (!d) { sinDatos.push(codigo); continue; }

      // INSERT ... ON DUPLICATE KEY: volver a empujar una que ya estaba refresca sus datos
      // (por ejemplo si cambió el cierre) sin duplicar la fila ni perder quién la empujó.
      await pool.query(
        `INSERT INTO puente_radar (
           licitacion_codigo, licitacion_nombre, licitacion_organismo, licitacion_monto,
           licitacion_cierre, licitacion_estado, licitacion_tipo, licitacion_region,
           categoria_nombre, viabilidad_semaforo, agregado_por
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           licitacion_nombre = VALUES(licitacion_nombre),
           licitacion_estado = VALUES(licitacion_estado),
           licitacion_cierre = VALUES(licitacion_cierre),
           licitacion_monto  = VALUES(licitacion_monto),
           categoria_nombre  = VALUES(categoria_nombre),
           viabilidad_semaforo = VALUES(viabilidad_semaforo)`,
        [
          codigo, d.licitacion_nombre ?? null, d.licitacion_organismo ?? null,
          d.licitacion_monto ?? null,
          d.licitacion_cierre ? new Date(d.licitacion_cierre) : null,
          d.licitacion_estado ?? null, d.licitacion_tipo ?? null, d.licitacion_region ?? null,
          d.categoria_nombre ?? null, semaforos.get(codigo) ?? null,
          g.usuario!.id,
        ]);
      agregadas.push(codigo);
    }

    if (agregadas.length > 0) {
      registrarActividad({
        usuarioId: g.usuario!.id, accion: 'puente_agregar',
        entidadTipo: 'puente', entidadId: String(agregadas.length),
        descripcion: `Empujó ${agregadas.length} licitación(es) al puente del radar`,
        metadata: { codigos: agregadas },
      });
    }

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM puente_radar`) as any[];
    return NextResponse.json({
      success: true,
      agregadas: agregadas.length,
      omitidasAsignadas,
      sinDatos,
      totalEnPuente: total,
    });
  } catch (error) {
    console.error('[puente:POST]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ── DELETE: sacar del puente ──────────────────────────────────────────────────
// Body: { codigos: string[] } o { todos: true }. Salir del puente no cambia nada de la
// licitación: vuelve al radar tal cual estaba (no se asigna, no se descarta).
export async function DELETE(request: NextRequest) {
  const g = await exigirPermiso(request);
  if (g.error) return g.error;

  let body: any;
  try { body = await request.json(); } catch { body = {}; }
  const todos = body?.todos === true;
  const codigos = codigosDelBody(body);
  if (!todos && codigos.length === 0)
    return NextResponse.json({ error: 'No se recibió ninguna licitación' }, { status: 400 });

  try {
    const [r] = todos
      ? await pool.query(`DELETE FROM puente_radar`) as any[]
      : await pool.query(
          `DELETE FROM puente_radar WHERE licitacion_codigo IN (${codigos.map(() => '?').join(',')})`,
          codigos) as any[];

    registrarActividad({
      usuarioId: g.usuario!.id, accion: 'puente_quitar',
      entidadTipo: 'puente', entidadId: String((r as any).affectedRows || 0),
      descripcion: `Sacó ${(r as any).affectedRows || 0} licitación(es) del puente`,
      metadata: { codigos: todos ? 'todas' : codigos },
    });

    return NextResponse.json({ success: true, eliminadas: (r as any).affectedRows || 0 });
  } catch (error) {
    console.error('[puente:DELETE]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
