// app/lib/viabilidad-al-asignar.ts
// VIABILIDAD AUTOMÁTICA EN CUANTO SE ASIGNA (20-ago-2026, pedido del usuario).
//
// Antes el análisis era MANUAL (botón "Analizar") y el único camino automático era el cron
// `/api/cron/viabilidad-perfil`, que corre a las :35 cada 4 horas — o sea, entre asignar y ver el
// informe podían pasar hasta 4 horas, y con lote 2×3 pasadas solo alcanzaban 6 licitaciones por
// corrida. Para los perfiles del piloto (permiso `viabilidad_automatica`) eso ya no basta: apenas
// se les asigna una licitación, el análisis arranca solo.
//
// El cron NO se elimina ni se toca: sigue siendo la red de seguridad que recoge lo que este
// camino no alcanzó a hacer (proceso reiniciado a mitad, descarga de documentos que falló y se
// recuperó después, licitaciones asignadas antes de que esto existiera).
//
// COLA SERIALIZADA (concurrencia 1): asignar es una acción de LOTE — el radar permite seleccionar
// varias y asignarlas de una vez. Disparar N análisis en paralelo pondría N llamadas simultáneas
// a la cadena GLM (cada una de varios minutos y varios centavos). Se encolan y salen de a una.
// Si el proceso muere con la cola a medias, el cron las recoge en su siguiente pasada.
import type { RowDataPacket } from 'mysql2';
import pool from '@/app/lib/db';
import { procesarLicitacionCompleta } from '@/app/lib/pipeline-licitacion';
import { ahoraChileSQL } from '@/app/lib/tz';

/** Kill-switch: VIABILIDAD_AL_ASIGNAR=false apaga este camino (el cron sigue funcionando igual). */
function habilitado(): boolean {
  return process.env.VIABILIDAD_AL_ASIGNAR !== 'false';
}

/** Tope por análisis. Si se pasa, se abandona y queda para el cron — no bloquea la cola. */
const TOPE_MS = Math.max(120_000, Number(process.env.VIABILIDAD_AL_ASIGNAR_TIMEOUT_MS) || 15 * 60_000);

/** Tope de la descarga + pre-OCR de una licitación del puente (antes no tenía: una descarga colgada
 *  bloqueaba toda la cola). */
const TOPE_DESCARGA_MS = Math.max(120_000, Number(process.env.PUENTE_DESCARGA_TIMEOUT_MS) || 10 * 60_000);

// ── COLA DURABLE DEL PUENTE (migration-136, tabla `puente_cola`) ────────────────────────────
// La cola en memoria se pierde si el servidor reinicia. Cada licitación empujada al puente queda
// también en BD con su estado e intentos; el job del scheduler (/api/cron/puente-cola) la retoma
// aunque se apague el PC o se cierre el navegador. Todo best-effort: sin la tabla (migración sin
// aplicar) el camino en memoria sigue funcionando como antes.
const MAX_INTENTOS_PUENTE = 6;
const BACKOFF_MIN = [10, 30, 120, 360, 720];   // espera tras el fallo n° 1, 2, 3...

async function persistirEncolada(codigo: string, yaListo: boolean): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO puente_cola (licitacion_codigo, estado, intentos, proximo_intento)
       VALUES (?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE estado = VALUES(estado), intentos = 0, ultimo_error = NULL,
                               proximo_intento = VALUES(proximo_intento)`,
      [codigo, yaListo ? 'LISTO' : 'PENDIENTE', ahoraChileSQL()]);
  } catch { /* tabla ausente: solo cola en memoria */ }
}

async function persistirResultado(
  codigo: string,
  r: { ok: true } | { ok: false; error: string; terminal?: boolean },
): Promise<void> {
  try {
    if (r.ok) {
      await pool.query(`UPDATE puente_cola SET estado='LISTO', ultimo_error=NULL WHERE licitacion_codigo=?`, [codigo]);
      return;
    }
    if (r.terminal) {
      await pool.query(`UPDATE puente_cola SET estado='EXCLUIDA', ultimo_error=? WHERE licitacion_codigo=?`,
        [r.error.slice(0, 300), codigo]);
      return;
    }
    const [filas] = await pool.query<RowDataPacket[]>(
      `SELECT intentos FROM puente_cola WHERE licitacion_codigo=?`, [codigo]);
    const intentos = Number(filas[0]?.intentos ?? 0) + 1;
    const agotada = intentos >= MAX_INTENTOS_PUENTE;
    const espera = BACKOFF_MIN[Math.min(intentos - 1, BACKOFF_MIN.length - 1)];
    await pool.query(
      `UPDATE puente_cola SET estado=?, intentos=?, ultimo_error=?,
              proximo_intento = DATE_ADD(?, INTERVAL ? MINUTE)
        WHERE licitacion_codigo=?`,
      [agotada ? 'AGOTADA' : 'PENDIENTE', intentos, r.error.slice(0, 300), ahoraChileSQL(), espera, codigo]);
    if (agotada) console.error(`[viabilidad-al-asignar] ${codigo}: AGOTADA tras ${intentos} intentos — ${r.error.slice(0, 160)}`);
  } catch { /* tabla ausente */ }
}

// `descargar`: viene del PUENTE (todavía no hay dueño ni documentos) → antes de la viabilidad se
// bajan los documentos y se calienta el OCR. Al asignar los documentos ya vienen bajados.
const cola: Array<{ codigo: string; usuarioId: number; descargar?: boolean }> = [];
let corriendo = false;

/** Descarga los documentos (si no hay) y calienta el OCR. false = no hay nada que analizar. */
async function asegurarDocumentos(codigo: string): Promise<boolean> {
  const [dc] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM documentos_cache WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
  if (dc.length > 0) return true;
  const { descargarDocumentosLicitacion } = await import('@/app/lib/mp-descarga-orquestador');
  const res = await descargarDocumentosLicitacion(codigo);
  if (!res.exito) return false;
  if (process.env.PRE_OCR_AL_ASIGNAR !== 'false') {
    try {
      const { calentarCacheDocumentos } = await import('@/app/lib/viabilidad-ia');
      await calentarCacheDocumentos(codigo);
    } catch (e) { console.warn(`[viabilidad-al-asignar] pre-OCR ${codigo}:`, String(e)); }
  }
  return true;
}

/** El puente congela el semáforo al entrar (vacío si aún no había análisis): se refresca al terminar. */
async function refrescarSemaforoPuente(codigo: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE puente_radar SET viabilidad_semaforo =
         (SELECT semaforo FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1)
       WHERE licitacion_codigo = ?`, [codigo, codigo]);
  } catch { /* puente sin la fila (ya repartida) o tabla ausente: no importa */ }
}

/** ¿El perfil al que se le asignó tiene el permiso del piloto? Se lee el JSON de permisos igual
 *  que el cron (GATE_PERMISO), no la lógica de PERMISOS_ADMIN: acá manda lo que está guardado,
 *  para que "automático" sea una decisión explícita por perfil y no algo que herede todo admin. */
async function tieneViabilidadAutomatica(usuarioId: number): Promise<boolean> {
  try {
    const [rows] = await pool.query<Array<{ permisos: string | null }> & RowDataPacket[]>(
      `SELECT permisos FROM usuarios WHERE id = ? LIMIT 1`, [usuarioId]);
    const raw = rows[0]?.permisos;
    const p = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    return (p as Record<string, unknown>)?.viabilidad_automatica === true;
  } catch { return false; }
}

async function yaTieneViabilidad(codigo: string): Promise<boolean> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 1 FROM viabilidad_licitacion WHERE licitacion_codigo = ? LIMIT 1`, [codigo]);
    return rows.length > 0;
  } catch { return false; }
}

async function vaciarCola(): Promise<void> {
  if (corriendo) return;
  corriendo = true;
  try {
    while (cola.length) {
      const { codigo, descargar } = cola.shift()!;
      // Se re-chequea acá y no solo al encolar: entre que entró a la cola y le llegó el turno,
      // el usuario pudo haber apretado "Analizar" a mano, o el cron pudo habérsela llevado.
      if (await yaTieneViabilidad(codigo)) {
        console.log(`[viabilidad-al-asignar] ${codigo}: ya tiene informe, se omite.`);
        await refrescarSemaforoPuente(codigo);
        if (descargar) await persistirResultado(codigo, { ok: true });
        continue;
      }
      if (descargar) {
        try {
          const hay = await Promise.race([
            asegurarDocumentos(codigo),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`descarga/OCR sobre el tope de ${Math.round(TOPE_DESCARGA_MS / 60_000)} min`)), TOPE_DESCARGA_MS)),
          ]);
          if (!hay) {
            console.warn(`[viabilidad-al-asignar] ${codigo}: sin documentos descargables — se reintenta.`);
            await persistirResultado(codigo, { ok: false, error: 'sin documentos descargables' });
            continue;
          }
        } catch (e) {
          console.warn(`[viabilidad-al-asignar] ${codigo}: descarga falló — ${String(e).slice(0, 160)}`);
          await persistirResultado(codigo, { ok: false, error: `descarga: ${String(e).slice(0, 250)}` });
          continue;
        }
      }
      const t0 = Date.now();
      console.log(`[viabilidad-al-asignar] ${codigo}: analizando… (${cola.length} en cola)`);
      try {
        const r = await Promise.race([
          procesarLicitacionCompleta(codigo),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`tope de ${Math.round(TOPE_MS / 60_000)} min`)), TOPE_MS)),
        ]);
        const segs = ((Date.now() - t0) / 1000).toFixed(1);
        if (r?.ok) {
          console.log(`[viabilidad-al-asignar] ${codigo}: listo en ${segs}s.`);
          await refrescarSemaforoPuente(codigo);
          if (descargar) await persistirResultado(codigo, { ok: true });
        } else {
          const motivo = r?.error ?? 'motivo desconocido';
          console.warn(`[viabilidad-al-asignar] ${codigo}: sin informe tras ${segs}s — ${motivo} (queda para reintento).`);
          if (descargar) await persistirResultado(codigo, { ok: false, error: motivo, terminal: /EXCLUIDA/i.test(motivo) });
        }
      } catch (e) {
        console.warn(`[viabilidad-al-asignar] ${codigo}: abandonado tras ${((Date.now() - t0) / 1000).toFixed(1)}s — ${String(e).slice(0, 160)} (queda para reintento).`);
        if (descargar) await persistirResultado(codigo, { ok: false, error: String(e).slice(0, 250) });
      }
    }
  } finally {
    corriendo = false;
  }
}

/**
 * PUENTE: al empujar licitaciones del radar al puente se descargan sus documentos y luego se
 * analiza la viabilidad, en la misma cola serial. Sin gate de permiso: aún no hay perfil dueño
 * (quien puede empujar ya está autorizado por `repartir_puente`). No espera y NUNCA lanza.
 */
export async function encolarViabilidadPuente(codigos: string[]): Promise<void> {
  try {
    if (!habilitado()) return;
    for (const codigo of codigos) {
      if (!codigo || cola.some(c => c.codigo === codigo)) continue;
      const listo = await yaTieneViabilidad(codigo);
      await persistirEncolada(codigo, listo);
      if (listo) continue;
      cola.push({ codigo, usuarioId: 0, descargar: true });
    }
    console.log(`[viabilidad-al-asignar] puente: ${cola.length} en cola.`);
    void vaciarCola();
  } catch (e) {
    console.error('[viabilidad-al-asignar] no se pudo encolar desde el puente:', String(e).slice(0, 200));
  }
}

/**
 * Encola el análisis de `codigo` si el perfil asignado tiene el permiso del piloto. No espera a
 * que termine (el análisis dura minutos) y NUNCA lanza: la asignación no puede fallar por esto.
 */
export async function encolarViabilidadAlAsignar(codigo: string, usuarioId: number): Promise<void> {
  try {
    if (!habilitado() || !codigo || !usuarioId) return;
    if (!(await tieneViabilidadAutomatica(usuarioId))) return;
    if (await yaTieneViabilidad(codigo)) return;
    if (cola.some(c => c.codigo === codigo)) return;   // ya encolada por otra asignación
    cola.push({ codigo, usuarioId });
    console.log(`[viabilidad-al-asignar] ${codigo}: encolada (${cola.length} pendiente/s).`);
    void vaciarCola();
  } catch (e) {
    console.error('[viabilidad-al-asignar] no se pudo encolar:', String(e).slice(0, 200));
  }
}

/**
 * Retoma lo que quedó a medias o falló (lo llama el scheduler cada pocos minutos). Siembra la cola
 * durable con lo que ya estaba en el puente antes de existir la tabla, y encola lo PENDIENTE cuyo
 * reintento ya toca. Si la cola en memoria está trabajando no hace nada: ya hay un proceso vivo.
 * No espera a que termine el análisis (dura minutos) y nunca lanza.
 */
export async function reanudarPuenteCola(): Promise<{ corriendo: boolean; encoladas: number; pendientes: number }> {
  try {
    if (!habilitado()) return { corriendo: false, encoladas: 0, pendientes: 0 };
    await pool.query(
      `INSERT IGNORE INTO puente_cola (licitacion_codigo, estado, proximo_intento)
       SELECT pr.licitacion_codigo, 'PENDIENTE', ? FROM puente_radar pr
        WHERE NOT EXISTS (SELECT 1 FROM viabilidad_licitacion v WHERE v.licitacion_codigo = pr.licitacion_codigo)`,
      [ahoraChileSQL()]);
    const [tot] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM puente_cola WHERE estado='PENDIENTE'`);
    const pendientes = Number(tot[0]?.n ?? 0);
    if (corriendo) return { corriendo: true, encoladas: 0, pendientes };
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT licitacion_codigo FROM puente_cola
        WHERE estado='PENDIENTE' AND proximo_intento <= ?
        ORDER BY proximo_intento ASC LIMIT 30`, [ahoraChileSQL()]);
    let encoladas = 0;
    for (const r of rows) {
      const codigo = r.licitacion_codigo as string;
      if (cola.some(c => c.codigo === codigo)) continue;
      cola.push({ codigo, usuarioId: 0, descargar: true });
      encoladas++;
    }
    if (encoladas > 0) void vaciarCola();
    return { corriendo: false, encoladas, pendientes };
  } catch (e) {
    console.error('[viabilidad-al-asignar] reanudar cola del puente:', String(e).slice(0, 200));
    return { corriendo: false, encoladas: 0, pendientes: 0 };
  }
}
