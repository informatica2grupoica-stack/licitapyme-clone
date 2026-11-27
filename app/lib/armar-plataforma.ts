// app/lib/armar-plataforma.ts
// PLATAFORMA ARMADA DESDE EL RUT (pedido del dueño, 2026-11-27): cuando la evaluación por RUT termina, una empresa NUEVA queda lista
// para usar sin que nadie escriba nada: perfil (lo usa la viabilidad), palabras clave y de descarte, primeras alertas del radar y los
// datos oficiales de su razón social. No marca la configuración como confirmada: el admin la ve en Mi empresa, quita lo que no quiera y guarda.
import pool from '@/app/lib/db';
import { CLIENTE_ICA } from '@/app/lib/tenant';
import { leerPerfil, guardarPerfil } from '@/app/lib/cliente-viabilidad';
import { actualizarRadarDeCliente } from '@/app/lib/radar-cliente';
import { ahoraChileSQL } from '@/app/lib/tz';
import { puedeArmarse, type ArmadoAutomatico, type DatosProveedorMP } from '@/app/lib/armar-plataforma-core';

/** Completa SOLO los campos vacíos de la razón social con lo que MP publica de ella. */
export async function completarRazonSocial(clienteId: number, datos: DatosProveedorMP[]): Promise<void> {
  const [rows] = await pool.query('SELECT id, rut FROM empresas WHERE cliente_id = ? AND activo = TRUE', [clienteId]) as any;
  for (const e of rows as Array<{ id: number; rut: string }>) {
    const d = datos.find(x => x.rut === String(e.rut || '').replace(/[^0-9kK]/g, '').toUpperCase());
    if (!d) continue;
    await pool.query(
      `UPDATE empresas SET giro = COALESCE(NULLIF(giro, ''), NULLIF(?, '')), direccion = COALESCE(NULLIF(direccion, ''), NULLIF(?, '')),
              region = COALESCE(NULLIF(region, ''), NULLIF(?, '')) WHERE id = ? AND cliente_id = ?`,
      [d.giro, d.direccion.slice(0, 200), d.region.slice(0, 100), e.id, clienteId]);
  }
}

export async function armarPlataforma(clienteId: number): Promise<{ hecho: boolean; motivo?: string; armado?: ArmadoAutomatico }> {
  if (!clienteId || clienteId === CLIENTE_ICA) return { hecho: false, motivo: 'No aplica a Grupo ICA' };
  const [[ev]] = await pool.query('SELECT estado, resultado, aplicado_at FROM cliente_evaluacion WHERE cliente_id = ?', [clienteId]) as any;
  const r = typeof ev?.resultado === 'string' ? JSON.parse(ev.resultado) : ev?.resultado;
  const perfil = await leerPerfil(clienteId);
  const [[kw]] = await pool.query('SELECT COUNT(*) AS n FROM palabras_clave WHERE cliente_id = ?', [clienteId]) as any;
  if (!r || !puedeArmarse({
    estado: ev?.estado, confirmada: !!ev?.aplicado_at, yaArmada: !!r?.armado,
    conPerfil: !!(perfil && `${perfil.descripcion}${perfil.productos_si}${perfil.rubros}`.trim()), palabras: Number(kw?.n) || 0,
  })) return { hecho: false, motivo: 'La empresa ya tiene configuración propia o la evaluación no está lista' };

  // El radar solo considera palabras de un usuario activo: van a nombre del admin de la empresa.
  const [[admin]] = await pool.query(`SELECT id FROM usuarios WHERE cliente_id = ? AND activo = TRUE ORDER BY (rol = 'admin') DESC, id LIMIT 1`, [clienteId]) as any;
  if (!admin) return { hecho: false, motivo: 'La empresa no tiene ningún usuario activo' };

  // Lo automático nunca RESTRINGE: las «reglas propias» que redacta la IA («postular solo si…») quedan vacías, y las regiones y los montos del perfil bajan el nivel de las licitaciones que quedan fuera. El monto de
  // las órdenes de compra no es el presupuesto de una licitación (prueba real: 4 de 7 alertas superaban el «máximo»). Se muestran como
  // historial en Mi empresa y los fija el admin si quiere.
  if (r.perfil) await guardarPerfil(clienteId, { ...r.perfil, regiones: '', monto_min: null, monto_max: null, reglas: '' });
  const palabras: string[] = Array.isArray(r.sugeridas) ? r.sugeridas : [];
  const negativas: string[] = (Array.isArray(r.negativas) ? r.negativas : []).filter((k: string) => !palabras.includes(k));
  for (const [keyword, negativa] of [...palabras.map(k => [k, 0] as const), ...negativas.map(k => [k, 1] as const)])
    await pool.query('INSERT INTO palabras_clave (usuario_id, cliente_id, keyword, es_negativa) VALUES (?, ?, ?, ?)', [admin.id, clienteId, keyword, negativa]);

  // Primeras alertas con lo que ya está en la caché: sin gastar consultas a Mercado Público ni IA. Si falla, el barrido las genera después.
  let alertas = 0;
  try { alertas = (await actualizarRadarDeCliente(clienteId)).alertasNuevas; }
  catch (e) { console.error('[armar-plataforma] radar', clienteId, String(e).slice(0, 200)); }

  const armado: ArmadoAutomatico = { fecha: ahoraChileSQL(), palabras, negativas, alertas };
  await pool.query('UPDATE cliente_evaluacion SET resultado = ? WHERE cliente_id = ?', [JSON.stringify({ ...r, armado }), clienteId]);
  return { hecho: true, armado };
}
