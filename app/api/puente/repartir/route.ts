// app/api/puente/repartir/route.ts
// EJECUTA el reparto: crea los negocios, vacía lo repartido del puente y deja bitácora.
//
// Reglas de la casa que se respetan acá:
//  · El reparto se vuelve a CALCULAR en el servidor (misma función pura + misma semilla que la
//    vista previa). El cliente no dicta a quién le toca qué; solo confirma lo que vio.
//  · Si el puente cambió entre "simular" y "confirmar" (alguien agregó o sacó licitaciones),
//    se responde 409 y se pide volver a simular: es preferible a repartir algo que nadie aprobó.
//  · UN correo por perfil con todo lo que le tocó, no uno por licitación.
//  · La descarga de documentos + viabilidad va DESPUÉS, en segundo plano y EN SERIE: 30
//    descargas simultáneas contra Mercado Público es cómo se gana un bloqueo.

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, tienePermiso } from '@/app/lib/api-auth';
import { contextoReparto, parsearConfig } from '@/app/lib/puente';
import { repartir, NOMBRE_ESTRATEGIA } from '@/app/lib/puente-reparto';
import { asignarLicitacion, dispararPostAsignacion } from '@/app/lib/asignar-licitacion';
import { publicarCambio } from '@/app/lib/sse-bus';
import { registrarActividad } from '@/app/lib/actividad';
import { enviarDigestReparto } from '@/app/lib/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // el lote hace varias escrituras por licitación

/** Máximo de asignaciones en vuelo. El pool de MySQL es de 8 conexiones: 4 deja aire al resto. */
const CONCURRENCIA = 4;

async function enLotes<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      salida[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return salida;
}

export async function POST(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!(await tienePermiso(request, 'repartir_puente')))
    return NextResponse.json({ error: 'Sin permiso para usar el puente' }, { status: 403 });

  let body: any;
  try { body = await request.json(); } catch { body = {}; }

  const parsed = parsearConfig(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const cfg = parsed.cfg;
  if (cfg.semilla == null)
    return NextResponse.json({ error: 'Falta la semilla de la simulación: vuelve a previsualizar' }, { status: 400 });

  try {
    const { licitaciones, perfiles } = await contextoReparto();
    if (licitaciones.length === 0)
      return NextResponse.json({ error: 'El puente está vacío' }, { status: 400 });

    const resultado = repartir(licitaciones, perfiles, cfg);

    // ── Control de concordancia con lo que el asesor aprobó ────────────────────
    // El cliente manda la vista previa que tenía en pantalla. Si no calza con lo recién
    // calculado, el puente cambió por debajo: no se reparte a ciegas.
    if (Array.isArray(body?.confirmacion)) {
      const vistoEnPantalla = new Map<string, number | null>(
        body.confirmacion
          .filter((c: any) => typeof c?.codigo === 'string')
          .map((c: any) => [String(c.codigo), c.usuarioId == null ? null : Number(c.usuarioId)]));
      const calculado = new Map(resultado.asignaciones.map(a => [a.codigo, a.usuarioId]));
      const iguales = vistoEnPantalla.size === calculado.size
        && Array.from(calculado.entries()).every(([k, v]) => vistoEnPantalla.get(k) === v);
      if (!iguales) {
        return NextResponse.json({
          error: 'El puente cambió desde la vista previa. Vuelve a previsualizar antes de confirmar.',
          codigo: 'DESFASADO',
        }, { status: 409 });
      }
    }

    const aAsignar = resultado.asignaciones.filter(a => a.usuarioId != null);
    if (aAsignar.length === 0)
      return NextResponse.json({ error: 'Con esta configuración no se asigna ninguna licitación' }, { status: 400 });

    const porCodigo = new Map(licitaciones.map(l => [l.licitacion_codigo, l]));

    // ── Asignaciones ──────────────────────────────────────────────────────────
    // publicar:false y postProceso:false → un solo repintado al final y las descargas
    // encadenadas después; correo:'ninguna' → un digest por perfil, no uno por licitación.
    const ejecutadas = await enLotes(aAsignar, CONCURRENCIA, async (a) => {
      const l = porCodigo.get(a.codigo)!;
      const r = await asignarLicitacion({
        licitacion_codigo: a.codigo,
        asignado_a: a.usuarioId!,
        asignado_por: u.id,
        licitacion_nombre: l.licitacion_nombre,
        licitacion_organismo: l.licitacion_organismo,
        licitacion_monto: l.licitacion_monto,
        licitacion_cierre: l.licitacion_cierre,
        licitacion_estado: l.licitacion_estado,
        licitacion_tipo: l.licitacion_tipo,
        licitacion_region: l.licitacion_region,
        correo: 'ninguna',
        publicar: false,
        postProceso: false,
        origen: 'puente',
      });
      return { codigo: a.codigo, usuarioId: a.usuarioId!, motivo: a.motivo, ok: r.ok, error: r.error };
    });

    const ok = ejecutadas.filter(e => e.ok);
    const fallidas = ejecutadas.filter(e => !e.ok);

    // ── Vaciar del puente SOLO lo que quedó asignado de verdad ─────────────────
    // Lo que falló se queda en el puente para reintentar: nunca desaparece trabajo en silencio.
    if (ok.length > 0) {
      const ph = ok.map(() => '?').join(',');
      await pool.query(`DELETE FROM puente_radar WHERE licitacion_codigo IN (${ph})`, ok.map(e => e.codigo));
    }

    // ── Bitácora de la tanda ──────────────────────────────────────────────────
    let repartoId: number | null = null;
    try {
      const [r] = await pool.query(
        `INSERT INTO puente_repartos (estrategia, config_json, resultado_json, total, total_ok, ejecutado_por)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [cfg.estrategia, JSON.stringify(cfg), JSON.stringify(ejecutadas), ejecutadas.length, ok.length, u.id]);
      repartoId = (r as any).insertId || null;
    } catch (e) { console.warn('[puente:repartir] no se pudo guardar la bitácora:', String(e)); }

    registrarActividad({
      usuarioId: u.id, accion: 'puente_repartir',
      entidadTipo: 'puente', entidadId: String(repartoId ?? ok.length),
      descripcion: `Repartió ${ok.length} licitación(es) del puente entre ${resultado.porPerfil.filter(p => p.asignadas > 0).length} perfil(es) — ${NOMBRE_ESTRATEGIA[cfg.estrategia]}`,
      metadata: { estrategia: cfg.estrategia, total: ejecutadas.length, ok: ok.length, fallidas: fallidas.length },
    });

    // Un solo repintado de los tableros abiertos para toda la tanda.
    if (ok.length > 0) publicarCambio('negocio');

    // ── UN correo por perfil con todo lo que le tocó (fire-and-forget) ─────────
    const porPerfil = new Map<number, typeof ok>();
    for (const e of ok) {
      if (!porPerfil.has(e.usuarioId)) porPerfil.set(e.usuarioId, []);
      porPerfil.get(e.usuarioId)!.push(e);
    }
    void (async () => {
      for (const [usuarioId, items] of porPerfil) {
        try {
          const [uRows] = await pool.query(`SELECT nombre, email FROM usuarios WHERE id = ?`, [usuarioId]) as any[];
          const destino = (uRows as any[])[0];
          if (!destino?.email) continue;
          await enviarDigestReparto({
            to: destino.email,
            nombre: destino.nombre,
            total: items.length,
            actorNombre: u.nombre || u.email,
            licitaciones: items.slice(0, 15).map(e => {
              const l = porCodigo.get(e.codigo)!;
              return {
                codigo: e.codigo, nombre: l.licitacion_nombre, organismo: l.licitacion_organismo,
                monto: l.licitacion_monto, cierre: l.licitacion_cierre,
              };
            }),
          });
        } catch (e) { console.warn('[puente:repartir] digest a perfil', usuarioId, String(e)); }
      }
    })();

    // ── Post-proceso EN SERIE (documentos → pre-OCR → viabilidad) ──────────────
    void (async () => {
      for (const e of ok) {
        await dispararPostAsignacion(e.codigo, e.usuarioId);
      }
    })();

    return NextResponse.json({
      success: true,
      repartoId,
      total: ejecutadas.length,
      asignadas: ok.length,
      fallidas: fallidas.map(f => ({ codigo: f.codigo, error: f.error })),
      sinAsignar: resultado.sinAsignar,
      porPerfil: resultado.porPerfil,
      estrategia: cfg.estrategia,
    });
  } catch (error) {
    console.error('[puente:repartir]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
