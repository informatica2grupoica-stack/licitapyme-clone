// app/lib/login-rate-limit.ts
// Protección de FUERZA BRUTA del login, basada en MySQL (tabla login_intentos,
// migration-36). NO depende de Redis/Upstash → funciona igual en Vercel y en el
// notebook/Docker sin infraestructura extra.
//
// Dos umbrales, ambos sobre intentos FALLIDOS dentro de una ventana:
//   · por EMAIL → frena el ataque contra UNA cuenta (probar muchas passwords).
//   · por IP    → frena el "password spraying" (1 password contra muchos emails).
//
// Filosofía del proyecto: fail-open ante error de infraestructura. Si la tabla no
// existe (migración pendiente) o la BD falla, NO bloqueamos al usuario legítimo —
// pero registramos el aviso. En operación normal la tabla existe y el control aplica.

import { type NextRequest } from 'next/server';
import pool from '@/app/lib/db';

const VENTANA_MIN   = 15;  // ventana de conteo, en minutos
const MAX_POR_EMAIL = 5;   // fallidos por email en la ventana → bloqueo de esa cuenta
const MAX_POR_IP    = 30;  // fallidos por IP en la ventana → bloqueo de esa IP (spraying)

/** IP del cliente. Cubre Vercel (x-forwarded-for), Cloudflare Tunnel (cf-connecting-ip)
 *  y proxies comunes. Toma la PRIMERA IP de x-forwarded-for (el cliente real). */
export function ipDeRequest(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim().slice(0, 64);
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    'desconocida'
  ).slice(0, 64);
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
         SUM(email = ? AND exito = 0) AS fails_email,
         SUM(ip = ?    AND exito = 0) AS fails_ip
       FROM login_intentos
       WHERE creado_en > (NOW() - INTERVAL ? MINUTE)`,
      [email, ip, VENTANA_MIN],
    );
    const r = (rows as any[])[0] || {};
    const failsEmail = Number(r.fails_email || 0);
    const failsIp    = Number(r.fails_ip || 0);
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
      await pool.query(
        `DELETE FROM login_intentos WHERE email = ? AND exito = 0`, [email],
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
