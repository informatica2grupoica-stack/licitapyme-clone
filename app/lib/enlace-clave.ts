// app/lib/enlace-clave.ts — ENLACE DE BIENVENIDA: la persona crea su propia clave y nadie tiene que copiar ni dictar una clave temporal.
// Usa la misma tabla y la misma pantalla que «olvidé mi contraseña» (password_resets, /restablecer): token al azar, en la base solo su
// huella, un solo uso y con vencimiento. NO envía correos: quien da el alta copia el enlace y se lo entrega a la persona.
// Quien tenga el enlace puede fijar la clave de esa cuenta: se entrega solo a su dueño y no se registra en ninguna bitácora ni log.
import crypto from 'node:crypto';
import pool from '@/app/lib/db';

export const VIGENCIA_BIENVENIDA_HORAS = 72;

/** Crea el enlace (deja sin efecto los anteriores de esa persona). Devuelve la RUTA; el dominio lo pone el navegador de quien lo copia,
 *  así sale con la misma dirección con la que está usando el sistema. */
export async function crearEnlaceBienvenida(usuarioId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const huella = crypto.createHash('sha256').update(token).digest('hex');
  await pool.query('UPDATE password_resets SET usado_en = NOW() WHERE usuario_id = ? AND usado_en IS NULL', [usuarioId]);
  await pool.query('INSERT INTO password_resets (usuario_id, token_hash, expira_en) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR))', [usuarioId, huella, VIGENCIA_BIENVENIDA_HORAS]);
  return `/restablecer?token=${token}&bienvenida=1`;
}
