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

/** Kill-switch: VIABILIDAD_AL_ASIGNAR=false apaga este camino (el cron sigue funcionando igual). */
function habilitado(): boolean {
  return process.env.VIABILIDAD_AL_ASIGNAR !== 'false';
}

/** Tope por análisis. Si se pasa, se abandona y queda para el cron — no bloquea la cola. */
const TOPE_MS = Math.max(120_000, Number(process.env.VIABILIDAD_AL_ASIGNAR_TIMEOUT_MS) || 15 * 60_000);

const cola: Array<{ codigo: string; usuarioId: number }> = [];
let corriendo = false;

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
      const { codigo } = cola.shift()!;
      // Se re-chequea acá y no solo al encolar: entre que entró a la cola y le llegó el turno,
      // el usuario pudo haber apretado "Analizar" a mano, o el cron pudo habérsela llevado.
      if (await yaTieneViabilidad(codigo)) {
        console.log(`[viabilidad-al-asignar] ${codigo}: ya tiene informe, se omite.`);
        continue;
      }
      const t0 = Date.now();
      console.log(`[viabilidad-al-asignar] ${codigo}: analizando… (${cola.length} en cola)`);
      try {
        const r = await Promise.race([
          procesarLicitacionCompleta(codigo),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`tope de ${Math.round(TOPE_MS / 60_000)} min`)), TOPE_MS)),
        ]);
        const segs = ((Date.now() - t0) / 1000).toFixed(1);
        if (r?.ok) console.log(`[viabilidad-al-asignar] ${codigo}: listo en ${segs}s.`);
        else console.warn(`[viabilidad-al-asignar] ${codigo}: sin informe tras ${segs}s — ${r?.error ?? 'motivo desconocido'} (queda para el cron).`);
      } catch (e) {
        console.warn(`[viabilidad-al-asignar] ${codigo}: abandonado tras ${((Date.now() - t0) / 1000).toFixed(1)}s — ${String(e).slice(0, 160)} (queda para el cron).`);
      }
    }
  } finally {
    corriendo = false;
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
