// app/lib/login-rate-limit.ts
// Protección de FUERZA BRUTA del login, basada en MySQL (tabla login_intentos,
// migration-36). NO depende de Redis/Upstash → funciona igual en Vercel y en el
// notebook/Docker sin infraestructura extra.
//
// Tres umbrales, todos sobre intentos FALLIDOS dentro de una ventana:
//   · por EMAIL + IP → frena a QUIEN está probando passwords contra UNA cuenta. Es el límite fino (5): bloquea a esa IP para esa
//     cuenta, pero NO al dueño de la cuenta que entra desde otro lugar (antes bastaba escribir 5 veces mal el correo ajeno para dejarlo fuera).
//   · por EMAIL (todas las IP) → red de seguridad contra un ataque repartido entre muchas IP. Es alto (20) a propósito.
//   · por IP    → frena el "password spraying" (1 password contra muchos emails).
//
// Filosofía del proyecto: fail-open ante error de infraestructura. Si la tabla no
// existe (migración pendiente) o la BD falla, NO bloqueamos al usuario legítimo —
// pero registramos el aviso. En operación normal la tabla existe y el control aplica.

import { type NextRequest } from 'next/server';
import pool from '@/app/lib/db';

const VENTANA_MIN   = 15;  // ventana de conteo, en minutos
const MAX_POR_PAR   = 5;   // fallidos del MISMO email desde la MISMA IP → bloqueo de esa IP para esa cuenta
const MAX_POR_EMAIL = 20;  // fallidos del email sumando todas las IP → bloqueo de la cuenta (ataque distribuido)
const MAX_POR_IP    = 30;  // fallidos por IP en la ventana → bloqueo de esa IP (spraying)

/** IP del cliente. Cubre Vercel (x-forwarded-for), Cloudflare Tunnel (cf-connecting-ip)
 *  y proxies comunes. Toma la PRIMERA IP de x-forwarded-for (el cliente real). */
export function ipDeRequest(req: NextRequest): string {
  // Cloudflare (túnel) fija cf-connecting-ip con la IP real y el cliente no puede falsearla; el
  // PRIMER valor de x-forwarded-for sí lo controla el cliente (evadía el tope por IP). Va de respaldo.
  const cf = req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip');
  if (cf) return cf.trim().slice(0, 64);
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim().slice(0, 64);
  return 'desconocida';
}

export type EstadoBloqueo = { bloqueado: boolean; motivo?: 'email' | 'ip'; esperaMin: number };

/**
 * ¿Está bloqueado este intento por demasiados fallos recientes (email o IP)?
 * Una sola query con agregación condicional (mínimos round-trips a Bluehost).
 * Fail-open: ante cualquier error devuelve { bloqueado:false }.
 */
export async function estaBloqueado(email: string, ip: string): Promise<EstadoBloqueo> {
  try {
    const [rows] = await pool.query(
      `SELECT
         SUM(email = ? AND ip = ? AND exito = 0) AS fails_par,
         SUM(email = ? AND exito = 0) AS fails_email,
         SUM(ip = ?    AND exito = 0) AS fails_ip
       FROM login_intentos
       WHERE creado_en > (NOW() - INTERVAL ? MINUTE)`,
      [email, ip, email, ip, VENTANA_MIN],
    );
    const r = (rows as any[])[0] || {};
    const failsPar   = Number(r.fails_par || 0);
    const failsEmail = Number(r.fails_email || 0);
    const failsIp    = Number(r.fails_ip || 0);
    if (failsPar   >= MAX_POR_PAR)   return { bloqueado: true, motivo: 'email', esperaMin: VENTANA_MIN };
    if (failsEmail >= MAX_POR_EMAIL) return { bloqueado: true, motivo: 'email', esperaMin: VENTANA_MIN };
    if (failsIp    >= MAX_POR_IP)    return { bloqueado: true, motivo: 'ip',    esperaMin: VENTANA_MIN };
    return { bloqueado: false, esperaMin: 0 };
  } catch (e) {
    console.warn('[login-rate-limit] estaBloqueado fail-open:', String(e));
    return { bloqueado: false, esperaMin: 0 };
  }
}

/**
 * Registra el resultado de un intento de login. En un intento EXITOSO, además borra
 * los fallos previos de ese email (resetea su contador) para no penalizar a quien
 * al final acertó. Oportunamente limpia filas más viejas que la ventana. Best-effort.
 */
export async function registrarIntento(email: string, ip: string, exito: boolean): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO login_intentos (email, ip, exito) VALUES (?, ?, ?)`,
      [email, ip, exito ? 1 : 0],
    );
    if (exito) {
      // Solo los fallos de ESTA IP: los de otras IP (quizá un atacante) no se borran porque el dueño entró.
      await pool.query(
        `DELETE FROM login_intentos WHERE email = ? AND ip = ? AND exito = 0`, [email, ip],
      );
    }
    // Auto-limpieza: quita lo más viejo que la ventana (mantiene la tabla pequeña).
    await pool.query(
      `DELETE FROM login_intentos WHERE creado_en < (NOW() - INTERVAL ? MINUTE)`,
      [VENTANA_MIN],
    );
  } catch (e) {
    console.warn('[login-rate-limit] registrarIntento best-effort:', String(e));
  }
}
