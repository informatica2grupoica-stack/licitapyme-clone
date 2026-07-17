// app/lib/cierres-proximos.ts
// Aviso "cierra pronto": licitaciones ASIGNADAS (negocios) que siguen sin resolver
// (ni postuladas ni descartadas) y cuyo plazo se está agotando. Regla (jul-2026):
//   · Dispara cuando ya transcurrió el 65% del plazo total (publicación → cierre),
//     así el aviso se adapta al tiempo real de cada licitación (20 días → avisa a
//     los 13; 6 días → avisa a los ~4).
//   · Piso de seguridad: si faltan ≤ `horas` (72 por defecto) para el cierre, avisa
//     igual — cubre las que no tienen fecha de publicación y los plazos muy cortos.
// Por cada una se empuja UNA notificación a la campana del perfil asignado y se manda un
// correo digest por perfil. Dedup vía historial_eventos: no se re-avisa la misma en días.
//
// Se engancha al cron existente (/api/cron/alertas), como paso final best-effort: si algo
// falla (tabla faltante, SMTP), NO rompe el cron.

import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { publicar } from '@/app/lib/sse-bus';
import { enviarDigestCierresProximos } from '@/app/lib/email';

// Estados que "cierran el ciclo" → ya no se avisa (mismos que el modal de vencidas).
const ESTADOS_RESUELTOS = ['POSTULADA', 'DESCARTADA', 'ADJUDICADA', 'POSIBLE_ADJ', 'PERDIDA'];

interface FilaCierre {
  id: number; licitacion_codigo: string; licitacion_nombre: string | null;
  licitacion_organismo: string | null; licitacion_monto: number | null; licitacion_cierre: string;
  asignado_a: number; email: string | null; nombre: string | null;
}

const TOP_CORREO = 15; // máx licitaciones listadas por correo

// Fracción del plazo total (publicación → cierre) que debe haber transcurrido para avisar.
const FRACCION_PLAZO = (() => {
  const v = Number(process.env.CIERRE_FRACCION_PLAZO);
  return v > 0 && v < 1 ? v : 0.65;
})();

// Avisa (campana + correo) las asignadas sin resolver cuyo plazo se agota: transcurrió el
// 65% del plazo total, o faltan ≤ `horas` para el cierre (piso). Devuelve cuántos eventos
// de campana y cuántos correos se generaron.
export async function avisarCierresProximos(horas = 72): Promise<{ eventos: number; correos: number }> {
  let eventos = 0, correos = 0;
  try {
    const ahora    = ahoraChileSQL();
    const ph       = ESTADOS_RESUELTOS.map(() => '?').join(',');

    // Candidatas: TODAS las asignadas vivas con cierre futuro y sin resolver. El filtro fino
    // (65% del plazo o piso de horas) se decide abajo con la fecha de publicación en mano, y
    // la deduplicación (no re-avisar en 3 días) se hace POR DESTINATARIO en JS — así el perfil
    // asignado y cada admin se evalúan por separado (el admin recibe TODAS, etiquetadas por
    // perfil; el perfil recibe las suyas). seg_restantes se calcula en SQL contra el MISMO
    // reloj naive de Chile que el cierre, así no depende de la TZ del proceso Node.
    const [rows] = await pool.query(
      `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo,
              n.licitacion_monto, n.licitacion_cierre, n.asignado_a,
              u.email, u.nombre,
              TIMESTAMPDIFF(SECOND, ?, n.licitacion_cierre) AS seg_restantes
       FROM negocios n
       JOIN usuarios u ON u.id = n.asignado_a AND u.activo = TRUE
       WHERE n.activo = TRUE
         AND n.licitacion_cierre IS NOT NULL
         AND n.licitacion_cierre >= ?
         AND COALESCE(n.estado_pipeline, 'ASIGNADO') NOT IN (${ph})
       ORDER BY n.asignado_a, n.licitacion_cierre ASC`,
      [ahora, ahora, ...ESTADOS_RESUELTOS],
    ) as any[];

    const candidatas = rows as (FilaCierre & { seg_restantes: number })[];
    if (candidatas.length === 0) return { eventos: 0, correos: 0 };

    // Fecha de publicación por código, desde alertas_licitaciones (negocios no la guarda).
    // Query aparte con IN (sin JOIN: las collations mixtas de Bluehost matan los JOINs) y
    // el transcurrido se calcula también en SQL contra el mismo `ahora` chileno.
    const segDesdePub = new Map<string, number>();
    try {
      const codigos = [...new Set(candidatas.map(f => f.licitacion_codigo))];
      const phCod   = codigos.map(() => '?').join(',');
      const [pubs] = await pool.query(
        `SELECT licitacion_codigo,
                TIMESTAMPDIFF(SECOND, MAX(licitacion_fecha_publicacion), ?) AS seg_desde_pub
         FROM alertas_licitaciones
         WHERE licitacion_codigo IN (${phCod})
           AND licitacion_fecha_publicacion IS NOT NULL
         GROUP BY licitacion_codigo`,
        [ahora, ...codigos],
      ) as any[];
      for (const p of pubs as any[]) {
        if (p.seg_desde_pub != null) segDesdePub.set(p.licitacion_codigo, Number(p.seg_desde_pub));
      }
    } catch { /* sin fecha de publicación → decide solo el piso de horas */ }

    const pisoSeg = horas * 3600;
    const filas = candidatas.filter(f => {
      const restantes = Number(f.seg_restantes);
      if (!Number.isFinite(restantes) || restantes < 0) return false;
      if (restantes <= pisoSeg) return true; // piso: quedan ≤ `horas` para el cierre
      const transcurrido = segDesdePub.get(f.licitacion_codigo);
      if (transcurrido == null || transcurrido <= 0) return false; // sin publicación y lejos del piso
      const total = transcurrido + restantes; // plazo completo publicación → cierre
      return transcurrido / total >= FRACCION_PLAZO;
    });
    if (filas.length === 0) return { eventos: 0, correos: 0 };

    // Admins activos: reciben TODAS las licitaciones por cerrar del equipo, etiquetadas con
    // el perfil responsable. Los perfiles no-admin reciben solo las suyas.
    const [arows] = await pool.query(
      `SELECT id, nombre, email FROM usuarios WHERE rol = 'admin' AND activo = TRUE`,
    ) as any[];
    const admins = arows as Array<{ id: number; nombre: string | null; email: string | null }>;

    // Dedup POR DESTINATARIO (código+usuario avisado en los últimos 3 días). Un solo query
    // para todos los códigos en ventana; se arma un Set `codigo|uid`.
    const yaAvisado = new Set<string>();
    try {
      const codsVent = [...new Set(filas.map(f => f.licitacion_codigo))];
      const phv = codsVent.map(() => '?').join(',');
      const [hrows] = await pool.query(
        `SELECT licitacion_codigo, usuario_id FROM historial_eventos
         WHERE tipo = 'CIERRE_PROXIMO' AND created_at >= (NOW() - INTERVAL 3 DAY)
           AND licitacion_codigo IN (${phv})`,
        codsVent,
      ) as any[];
      for (const h of hrows as any[]) yaAvisado.add(`${h.licitacion_codigo}|${h.usuario_id}`);
    } catch { /* si falla, no deduplica (peor caso: re-aviso) */ }

    // Fan-out: cada fila va a su perfil asignado (sin etiqueta) y a cada admin (etiquetada
    // con el perfil), saltando a quien ya se le avisó en los últimos 3 días.
    type Item = { fila: FilaCierre; perfil: string | null };
    const destinatarios = new Map<number, { nombre: string | null; email: string | null; esAdmin: boolean; items: Item[] }>();
    const push = (uid: number, nombre: string | null, email: string | null, esAdmin: boolean, it: Item) => {
      if (yaAvisado.has(`${it.fila.licitacion_codigo}|${uid}`)) return;
      let g = destinatarios.get(uid);
      if (!g) { g = { nombre, email, esAdmin, items: [] }; destinatarios.set(uid, g); }
      g.items.push(it);
    };
    const adminIds = new Set(admins.map(a => Number(a.id)));
    for (const f of filas) {
      // Perfil asignado (si no es admin: los admins reciben el digest global etiquetado).
      if (!adminIds.has(Number(f.asignado_a))) {
        push(Number(f.asignado_a), f.nombre, f.email, false, { fila: f, perfil: null });
      }
      // Cada admin recibe TODAS, etiquetadas con el perfil responsable.
      for (const a of admins) {
        const propia = Number(a.id) === Number(f.asignado_a);
        push(Number(a.id), a.nombre, a.email, true, { fila: f, perfil: propia ? null : (f.nombre || null) });
      }
    }
    if (destinatarios.size === 0) return { eventos: 0, correos: 0 };

    // Mensaje de campana por item (incluye el perfil cuando es la vista de admin).
    const msgDe = (it: Item) => {
      const base = `Cierra pronto (${fmtHoraCL(it.fila.licitacion_cierre)})`;
      const nom = it.fila.licitacion_nombre || it.fila.licitacion_codigo;
      return it.perfil ? `${base} · ${it.perfil}: ${nom}` : `${base}: ${nom}`;
    };

    // Campana: UN SOLO INSERT masivo con todos los items de todos los destinatarios (el cron
    // tiene presupuesto ajustado y Bluehost tiene latencia alta). El SSE se empuja en memoria.
    const planos: Array<{ uid: number; nombre: string | null; it: Item; msg: string }> = [];
    for (const [uid, g] of destinatarios) {
      for (const it of g.items) planos.push({ uid, nombre: g.nombre, it, msg: msgDe(it) });
    }
    const values: unknown[] = [];
    for (const p of planos) {
      values.push('CIERRE_PROXIMO', p.it.fila.licitacion_codigo, p.it.fila.licitacion_nombre, p.uid, p.nombre,
        null, null, p.msg, JSON.stringify({ cierre: p.it.fila.licitacion_cierre, perfil: p.it.perfil || undefined }));
    }
    const ph2 = planos.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
    const [ins] = await pool.query(
      `INSERT INTO historial_eventos
         (tipo, licitacion_codigo, licitacion_nombre, usuario_id, usuario_nombre, actor_id, actor_nombre, mensaje, metadata)
       VALUES ${ph2}`,
      values,
    ) as any[];
    const baseId = (ins as any).insertId || 0; // MySQL: insertId del PRIMER registro del lote
    eventos = planos.length;

    // SSE en vivo (en memoria, sin BD): al que esté con la app abierta le aparece al toque.
    planos.forEach((p, i) => {
      publicar(p.uid, {
        id: baseId ? baseId + i : undefined, tipo: 'CIERRE_PROXIMO', mensaje: p.msg,
        licitacion_codigo: p.it.fila.licitacion_codigo, leido: false, created_at: new Date().toISOString(),
      });
    });

    // Correo por destinatario (best-effort; kill-switch compartido ALERTAS_EMAIL=false).
    if (process.env.ALERTAS_EMAIL !== 'false') {
      for (const [, g] of destinatarios) {
        if (!g.email) continue;
        const enviado = await enviarDigestCierresProximos({
          to: g.email, nombre: g.nombre, horas, esAdmin: g.esAdmin,
          licitaciones: g.items.slice(0, TOP_CORREO).map(it => ({
            codigo: it.fila.licitacion_codigo, nombre: it.fila.licitacion_nombre,
            organismo: it.fila.licitacion_organismo, monto: it.fila.licitacion_monto,
            cierre: it.fila.licitacion_cierre, perfil: it.perfil,
          })),
          totalNuevas: g.items.length,
        });
        if (enviado) correos++;
      }
    }
  } catch (e) {
    console.error('[cierres-proximos] falló (no crítico):', String(e));
  }
  return { eventos, correos };
}

function fmtHoraCL(f: string): string {
  try {
    return new Date(f).toLocaleString('es-CL', {
      timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}
