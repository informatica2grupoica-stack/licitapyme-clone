// app/lib/propuesta-descripcion.ts — Propuesta de configuración a partir de la descripción (servidor).
// El gasto de IA se anota a ESA empresa y respeta su tope mensual (conCliente + crearChatIA). Si la empresa está virgen, además
// queda armada (armar-plataforma.ts); si ya tiene algo propio, solo quedan las sugerencias para que su admin elija.
import pool from '@/app/lib/db';
import { conCliente } from '@/app/lib/medidor-cliente';
import { proponerConIA } from '@/app/lib/evaluar-empresa-rut';
import { armarPlataforma } from '@/app/lib/armar-plataforma';
import { validarDescripcion, resultadoDesdePropuesta } from '@/app/lib/propuesta-descripcion-core';

export async function proponerDesdeDescripcion(clienteId: number, descripcion: unknown): Promise<{ ok: true; armada: boolean } | { ok: false; error: string }> {
  const v = validarDescripcion(descripcion);
  if (!v.ok) return v;
  return conCliente(clienteId, async () => {
    const [[c]] = await pool.query('SELECT nombre FROM clientes WHERE id = ?', [clienteId]) as any;
    const propuesta = await proponerConIA(String(c?.nombre || 'Empresa'), v.texto, [], [], true);
    if (!propuesta.sugeridas.length) return { ok: false as const, error: 'No pudimos sacar palabras clave de esa descripción. Agrega ejemplos de lo que vendes.' };
    await pool.query(
      `INSERT INTO cliente_evaluacion (cliente_id, estado, progreso, resultado) VALUES (?, 'LISTO', 'Propuesta hecha desde la descripción de la empresa', ?)
       ON DUPLICATE KEY UPDATE estado = 'LISTO', progreso = VALUES(progreso), resultado = VALUES(resultado), \`cursor\` = NULL, reintentar_at = NULL`,
      [clienteId, JSON.stringify(resultadoDesdePropuesta(propuesta))]);
    const armado = await armarPlataforma(clienteId);
    return { ok: true as const, armada: armado.hecho };
  });
}

/** Lo que la empresa escribió en el formulario de alta («¿Qué vendes o a qué licitaciones postulas?»), si pidió su acceso por ahí. */
export async function descripcionDeSuSolicitud(clienteId: number): Promise<string | null> {
  try {
    const [rows] = await pool.query('SELECT mensaje FROM cliente_solicitud WHERE cliente_id = ? AND mensaje IS NOT NULL ORDER BY id DESC LIMIT 1', [clienteId]) as any;
    const v = validarDescripcion((rows as Array<{ mensaje: string }>)[0]?.mensaje);
    return v.ok ? v.texto : null;
  } catch { return null; } // sin la tabla de solicitudes
}
