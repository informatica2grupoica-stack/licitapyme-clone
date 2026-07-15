// app/lib/detectar-aperturas.ts
// Detección de APERTURA para las POSTULADAS leyendo el portal de MP (como la descarga de docs).
//
// Dos disparadores usan las MISMAS primitivas para que la alerta salga UNA sola vez:
//   · El cron /api/cron/aperturas (scheduler, IP chilena) → detectarAperturas(lote).
//   · La carga del apartado Postuladas → refrescarAperturas(codigos) vía /api/postuladas/estado,
//     así el chip "Aperturada" aparece sin depender de que el cron esté configurado.
//
// "Tiempo real" con MP: MP no empuja eventos. Lo más cercano es sondear seguido; en cuanto
// una corrida (cron o visita a la página) ve el cambio, empuja la notificación por SSE a la
// campana del/los perfil(es) al instante. La latencia = cada cuánto se sondea.
//
// Requiere IP chilena (WAF). Idempotente: al marcar aperturada se dispara la alerta una vez
// (transición no-aperturada → aperturada) y el código no se vuelve a consultar.

import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { detectarAperturaPortal } from '@/app/lib/mp-apertura';

const CONCURRENCIA   = 3;       // fichas del portal en paralelo (gentil con MP)
const PRESUPUESTO_MS = 280_000; // margen bajo maxDuration=300 del cron

// Minutos que un "aún sin apertura" se considera fresco antes de re-consultar el portal.
// Evita que cada visita al apartado Postuladas re-lea la ficha de las que siguen sin abrir.
const REVERIFICAR_MIN = 20;

interface EstadoApertura { aperturada: boolean; verificadoHaceMin: number | null }

// ── Lectura de estado desde la tabla (rápida, sin tocar el portal) ────────────
async function leerAperturasDetalle(codigos: string[]): Promise<Map<string, EstadoApertura>> {
  const map = new Map<string, EstadoApertura>();
  if (codigos.length === 0) return map;
  try {
    const ph = codigos.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT licitacion_codigo, aperturada,
              TIMESTAMPDIFF(MINUTE, verificado_en, NOW()) AS hace_min
       FROM licitacion_apertura WHERE licitacion_codigo IN (${ph})`,
      codigos,
    ) as any[];
    for (const r of rows as any[]) {
      map.set(r.licitacion_codigo, { aperturada: !!r.aperturada, verificadoHaceMin: r.hace_min == null ? null : Number(r.hace_min) });
    }
  } catch { /* tabla ausente (migración 41 pendiente) → todo desconocido */ }
  return map;
}

export async function leerAperturas(codigos: string[]): Promise<Map<string, boolean>> {
  const det = await leerAperturasDetalle(codigos);
  const map = new Map<string, boolean>();
  for (const [k, v] of det) map.set(k, v.aperturada);
  return map;
}

// ── Marcar aperturada + avisar a los perfiles (una sola vez) ──────────────────
// Persiste el resultado. Si es una TRANSICIÓN a aperturada (antes no lo estaba), avisa por
// campana+SSE a todos los perfiles que la postularon. Devuelve si disparó la alerta.
async function marcarYAvisar(codigo: string, aperturada: boolean, evidencia: string): Promise<boolean> {
  // ¿Ya estaba marcada aperturada? → no re-avisar.
  let yaAperturada = false;
  try {
    const [r] = await pool.query(
      `SELECT aperturada FROM licitacion_apertura WHERE licitacion_codigo = ? LIMIT 1`, [codigo],
    ) as any[];
    yaAperturada = !!(r as any[])[0]?.aperturada;
  } catch { /* tabla ausente → tratamos como no marcada */ }

  // Persistir SIEMPRE (marca verificado_en aunque siga sin apertura).
  try {
    await pool.query(
      `INSERT INTO licitacion_apertura (licitacion_codigo, aperturada, evidencia, detectada_en)
       VALUES (?, ?, ?, ${aperturada ? 'NOW()' : 'NULL'})
       ON DUPLICATE KEY UPDATE
         aperturada    = VALUES(aperturada),
         evidencia     = VALUES(evidencia),
         detectada_en  = IF(VALUES(aperturada) = 1 AND detectada_en IS NULL, NOW(), detectada_en),
         verificado_en = NOW()`,
      [codigo, aperturada ? 1 : 0, evidencia],
    );
  } catch { /* migración 41 pendiente → no persiste, pero igual podemos avisar abajo */ }

  if (!aperturada || yaAperturada) return false;

  // Transición → aperturada: avisar a cada perfil que la postuló.
  try {
    const [rows] = await pool.query(
      `SELECT n.asignado_a, n.licitacion_nombre, u.nombre AS usuario_nombre
       FROM negocios n JOIN usuarios u ON u.id = n.asignado_a AND u.activo = TRUE
       WHERE n.activo = TRUE AND n.estado_pipeline = 'POSTULADA' AND n.licitacion_codigo = ?`,
      [codigo],
    ) as any[];
    for (const n of rows as any[]) {
      await registrarEvento({
        tipo: 'APERTURA',
        licitacionCodigo: codigo, licitacionNombre: n.licitacion_nombre,
        usuarioId: n.asignado_a, usuarioNombre: n.usuario_nombre,
        actorId: null, actorNombre: 'Mercado Público',
        mensaje: `📂 Apertura realizada: ${n.licitacion_nombre || codigo} — ya puedes revisar las ofertas`,
        metadata: { licitacion_codigo: codigo, evidencia },
      });
    }
  } catch (e) { console.error(`[detectar-aperturas] aviso ${codigo} falló:`, String(e)); }
  return true;
}

// ── Refrescar un conjunto de códigos leyendo el portal (con presupuesto) ──────
// Solo consulta el portal para los que NO están ya marcados aperturados. Devuelve el mapa
// COMPLETO (tabla + recién detectados) para que el caller pinte los chips.
export async function refrescarAperturas(
  codigos: string[],
  opts: { maxDetectar?: number; presupuestoMs?: number } = {},
): Promise<Map<string, boolean>> {
  const maxDetectar  = opts.maxDetectar ?? 12;
  const presupuesto  = opts.presupuestoMs ?? 12_000;
  const inicio = Date.now();

  const detalle = await leerAperturasDetalle(codigos);
  const estado = new Map<string, boolean>();
  for (const c of codigos) estado.set(c, !!detalle.get(c)?.aperturada);

  // Candidatos a consultar el portal: NO aperturados y (sin fila o verificados hace rato).
  // Los verificados hace poco se dejan como están (el cron los reintenta en su cadencia).
  const pendientes = codigos.filter(c => {
    const d = detalle.get(c);
    if (d?.aperturada) return false;
    if (!d) return true;                                  // nunca verificado
    return d.verificadoHaceMin == null || d.verificadoHaceMin >= REVERIFICAR_MIN;
  }).slice(0, Math.max(0, maxDetectar));
  if (pendientes.length === 0) return estado;

  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, pendientes.length) }, async () => {
    while (i < pendientes.length) {
      const codigo = pendientes[i++];
      if (Date.now() - inicio > presupuesto) return;
      const r = await detectarAperturaPortal(codigo);
      if (!r) continue; // portal no legible → se reintenta luego
      await marcarYAvisar(codigo, r.aperturada, r.evidencia);
      estado.set(codigo, r.aperturada);
    }
  }));
  return estado;
}

// ── Cuántas POSTULADAS cerradas quedan por verificar (para el GET del cron) ───
export async function contarPendientesApertura(): Promise<number> {
  try {
    const [rows] = await pool.query(
      // COLLATE obligatorio: negocios.licitacion_codigo es general_ci y licitacion_apertura
      // unicode_ci. Sin él, MySQL lanza "Illegal mix of collations", el catch de abajo lo
      // convertía en 0 y el cron creía que no había NADA pendiente → nunca detectó una apertura.
      `SELECT COUNT(DISTINCT n.licitacion_codigo) AS n
       FROM negocios n
       LEFT JOIN licitacion_apertura la ON la.licitacion_codigo = n.licitacion_codigo COLLATE utf8mb4_unicode_ci
       WHERE n.activo = TRUE
         AND n.estado_pipeline = 'POSTULADA'
         AND n.licitacion_cierre IS NOT NULL
         AND n.licitacion_cierre < NOW()
         AND (la.aperturada IS NULL OR la.aperturada = 0)`,
    ) as any[];
    return Number((rows as any[])[0]?.n) || 0;
  } catch (e) {
    // No enmudecer: un 0 silencioso aquí es indistinguible de "está todo al día".
    console.error('[detectar-aperturas] contarPendientes falló:', String(e).slice(0, 200));
    return 0;
  }
}

// ── Poller del cron: postuladas cerradas aún no aperturadas ───────────────────
export async function detectarAperturas(lote = 40): Promise<{
  verificadas: number; aperturas: number; errores: number;
}> {
  const stats = { verificadas: 0, aperturas: 0, errores: 0 };
  const inicio = Date.now();

  let codigos: string[] = [];
  try {
    const [rows] = await pool.query(
      // COLLATE: ver la nota de contarPendientesApertura. Sin él la lista salía vacía y el
      // cron no verificaba ninguna.
      `SELECT DISTINCT n.licitacion_codigo AS codigo, MAX(n.licitacion_cierre) AS cierre
       FROM negocios n
       LEFT JOIN licitacion_apertura la ON la.licitacion_codigo = n.licitacion_codigo COLLATE utf8mb4_unicode_ci
       WHERE n.activo = TRUE
         AND n.estado_pipeline = 'POSTULADA'
         AND n.licitacion_cierre IS NOT NULL
         AND n.licitacion_cierre < NOW()
         AND (la.aperturada IS NULL OR la.aperturada = 0)
       GROUP BY n.licitacion_codigo
       ORDER BY cierre DESC
       LIMIT ${Math.max(1, Math.min(lote, 200))}`,
    ) as any[];
    codigos = (rows as any[]).map(r => r.codigo as string);
  } catch (e) {
    console.error('[detectar-aperturas] carga inicial falló:', String(e));
    return stats;
  }
  if (codigos.length === 0) return stats;

  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, codigos.length) }, async () => {
    while (i < codigos.length) {
      const codigo = codigos[i++];
      if (Date.now() - inicio > PRESUPUESTO_MS) return;
      try {
        const r = await detectarAperturaPortal(codigo);
        stats.verificadas++;
        if (!r) continue;
        const aviso = await marcarYAvisar(codigo, r.aperturada, r.evidencia);
        if (aviso) stats.aperturas++;
      } catch (e) {
        stats.errores++;
        console.error(`[detectar-aperturas] "${codigo}" falló:`, String(e));
      }
    }
  }));
  return stats;
}
