// app/lib/cierres-proximos.ts
// Aviso "cierra pronto": licitaciones ASIGNADAS (negocios) cuyo cierre cae dentro de una
// ventana (por defecto 48 h) y que siguen sin resolver (ni postuladas ni descartadas).
// Por cada una se empuja UNA notificación a la campana del perfil asignado y se manda un
// correo digest por perfil. Dedup vía historial_eventos: no se re-avisa la misma en días.
//
// Se engancha al cron existente (/api/cron/alertas), como paso final best-effort: si algo
// falla (tabla faltante, SMTP), NO rompe el cron.

import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { publicar } from '@/app/lib/sse-bus';
import { enviarDigestCierresProximos, type LicitacionDigest } from '@/app/lib/email';

// Estados que "cierran el ciclo" → ya no se avisa (mismos que el modal de vencidas).
const ESTADOS_RESUELTOS = ['POSTULADA', 'DESCARTADA', 'ADJUDICADA', 'POSIBLE_ADJ', 'PERDIDA'];

interface FilaCierre {
  id: number; licitacion_codigo: string; licitacion_nombre: string | null;
  licitacion_organismo: string | null; licitacion_monto: number | null; licitacion_cierre: string;
  asignado_a: number; email: string | null; nombre: string | null;
}

const TOP_CORREO = 15; // máx licitaciones listadas por correo

// Avisa (campana + correo) las asignadas que cierran dentro de `horas` y no están resueltas.
// Devuelve cuántos eventos de campana y cuántos correos se generaron.
export async function avisarCierresProximos(horas = 48): Promise<{ eventos: number; correos: number }> {
  let eventos = 0, correos = 0;
  try {
    const ahora    = ahoraChileSQL();
    const limite   = ahoraChileSQL(new Date(Date.now() + horas * 3_600_000));
    const ph       = ESTADOS_RESUELTOS.map(() => '?').join(',');

    // Asignadas activas que cierran entre AHORA y AHORA+horas, sin resolver, y que NO se
    // hayan avisado ya (evento CIERRE_PROXIMO del mismo perfil+código en los últimos 3 días).
    // La ventana anti-duplicado usa NOW() del server (mismo reloj que created_at) → consistente.
    const [rows] = await pool.query(
      `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_organismo,
              n.licitacion_monto, n.licitacion_cierre, n.asignado_a,
              u.email, u.nombre
       FROM negocios n
       JOIN usuarios u ON u.id = n.asignado_a AND u.activo = TRUE
       WHERE n.activo = TRUE
         AND n.licitacion_cierre IS NOT NULL
         AND n.licitacion_cierre >= ?
         AND n.licitacion_cierre <= ?
         AND COALESCE(n.estado_pipeline, 'ASIGNADO') NOT IN (${ph})
         AND NOT EXISTS (
           SELECT 1 FROM historial_eventos h
           WHERE h.tipo = 'CIERRE_PROXIMO'
             AND h.licitacion_codigo = n.licitacion_codigo
             AND h.usuario_id = n.asignado_a
             AND h.created_at >= (NOW() - INTERVAL 3 DAY)
         )
       ORDER BY n.asignado_a, n.licitacion_cierre ASC`,
      [ahora, limite, ...ESTADOS_RESUELTOS],
    ) as any[];

    const filas = rows as FilaCierre[];
    if (filas.length === 0) return { eventos: 0, correos: 0 };

    // Campana: UN SOLO INSERT masivo (no 1 round-trip por fila — el cron tiene presupuesto
    // ajustado y Bluehost tiene latencia alta). El SSE se empuja en memoria después.
    const mensajes = filas.map(f => `Cierra pronto (${fmtHoraCL(f.licitacion_cierre)}): ${f.licitacion_nombre || f.licitacion_codigo}`);
    const values: unknown[] = [];
    for (let i = 0; i < filas.length; i++) {
      const f = filas[i];
      values.push('CIERRE_PROXIMO', f.licitacion_codigo, f.licitacion_nombre, f.asignado_a, f.nombre,
        null, null, mensajes[i], JSON.stringify({ cierre: f.licitacion_cierre }));
    }
    const ph2 = filas.map(() => '(?,?,?,?,?,?,?,?,?)').join(',');
    let baseId = 0;
    const [ins] = await pool.query(
      `INSERT INTO historial_eventos
         (tipo, licitacion_codigo, licitacion_nombre, usuario_id, usuario_nombre, actor_id, actor_nombre, mensaje, metadata)
       VALUES ${ph2}`,
      values,
    ) as any[];
    baseId = (ins as any).insertId || 0; // MySQL: insertId del PRIMER registro del lote
    eventos = filas.length;

    // SSE en vivo (en memoria, sin BD): al que esté con la app abierta le aparece al toque.
    filas.forEach((f, i) => {
      publicar(f.asignado_a, {
        id: baseId ? baseId + i : undefined, tipo: 'CIERRE_PROXIMO', mensaje: mensajes[i],
        licitacion_codigo: f.licitacion_codigo, leido: false, created_at: new Date().toISOString(),
      });
    });

    // Agrupar por perfil para el correo.
    const porUsuario = new Map<number, { email: string | null; nombre: string | null; items: LicitacionDigest[] }>();
    for (const f of filas) {
      let g = porUsuario.get(f.asignado_a);
      if (!g) { g = { email: f.email, nombre: f.nombre, items: [] }; porUsuario.set(f.asignado_a, g); }
      g.items.push({
        codigo: f.licitacion_codigo, nombre: f.licitacion_nombre,
        organismo: f.licitacion_organismo, monto: f.licitacion_monto, cierre: f.licitacion_cierre,
      });
    }

    // Correo por perfil (best-effort; kill-switch compartido ALERTAS_EMAIL=false).
    if (process.env.ALERTAS_EMAIL !== 'false') {
      for (const [, g] of porUsuario) {
        if (!g.email) continue;
        const enviado = await enviarDigestCierresProximos({
          to: g.email, nombre: g.nombre, horas,
          licitaciones: g.items.slice(0, TOP_CORREO),
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
