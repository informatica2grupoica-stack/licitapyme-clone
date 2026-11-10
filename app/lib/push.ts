// Avisos push a la app móvil (Expo → Firebase/FCM). Cada aviso que llega a la campana de una persona (registrarEvento en
// app/lib/historial.ts) se manda también a sus teléfonos registrados en push_tokens (migration-188).
//
// Nunca bloquea ni rompe la acción que lo origina: todo va en try/catch y sin await en quien llama.
// Sin tabla (migration sin aplicar) o sin tokens, no hace nada. Los tokens que Expo marca como inexistentes se borran.
import pool from '@/app/lib/db';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

interface Aviso { titulo: string; cuerpo: string; datos?: Record<string, unknown> }

export async function enviarPushAUsuario(usuarioId: number, aviso: Aviso): Promise<void> {
  try {
    const [rows] = await pool.query('SELECT token FROM push_tokens WHERE usuario_id = ?', [usuarioId]);
    const tokens = (rows as Array<{ token: string }>).map(r => r.token).filter(Boolean);
    if (tokens.length === 0) return;

    const mensajes = tokens.map(to => ({
      to, title: aviso.titulo, body: aviso.cuerpo, data: aviso.datos ?? {}, sound: 'default', channelId: 'default', priority: 'high',
    }));
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    // Opcional: con «seguridad mejorada» de Expo se manda su token de acceso (EXPO_ACCESS_TOKEN en .env.local).
    if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

    const res = await fetch(EXPO_PUSH, { method: 'POST', headers, body: JSON.stringify(mensajes), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) { console.error('[push] Expo respondió', res.status); return; }
    const j = await res.json().catch(() => null) as { data?: Array<{ status: string; details?: { error?: string } }> } | null;

    // Teléfonos que ya no existen (app desinstalada): se borran para no reintentar.
    const muertos = (j?.data ?? []).map((d, i) => (d.status === 'error' && d.details?.error === 'DeviceNotRegistered' ? tokens[i] : null)).filter(Boolean) as string[];
    if (muertos.length) await pool.query('DELETE FROM push_tokens WHERE token IN (?)', [muertos]);
  } catch (e) {
    console.error('[push] no se pudo enviar:', String(e));
  }
}
