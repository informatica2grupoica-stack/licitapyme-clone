// POST /api/mi-empresa/configuracion/proponer { descripcion } → arma o sugiere la configuración desde lo que la empresa cuenta que vende.
// Solo el admin de una empresa-cliente; la empresa sale de la sesión. Gasta IA de esa empresa: tope de intentos por día.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { adminDeCliente } from '@/app/lib/admin-empresa';
import { mensajeSeguro } from '@/app/lib/errores-api';
import { proponerDesdeDescripcion } from '@/app/lib/propuesta-descripcion';
import { validarDescripcion, MAX_PROPUESTAS_POR_DIA } from '@/app/lib/propuesta-descripcion-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const g = await adminDeCliente(req, 'Solo el admin de la empresa puede configurarla');
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));
  const v = validarDescripcion(b.descripcion);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    const [[ev]] = await pool.query("SELECT COUNT(*) AS n FROM cliente_evaluacion WHERE cliente_id = ? AND estado IN ('PENDIENTE', 'EN_CURSO')", [g.u.clienteId]) as any;
    if (Number(ev?.n)) return NextResponse.json({ error: 'Todavía estamos revisando tus ventas en Mercado Público. Espera a que termine.' }, { status: 409 });
    const [[uso]] = await pool.query("SELECT COUNT(*) AS n FROM clientes_bitacora WHERE cliente_id = ? AND accion = 'proponer_descripcion' AND created_at > NOW() - INTERVAL 1 DAY", [g.u.clienteId]) as any;
    if (Number(uso?.n) >= MAX_PROPUESTAS_POR_DIA) return NextResponse.json({ error: `Ya pediste ${MAX_PROPUESTAS_POR_DIA} propuestas hoy. Puedes completar el resto a mano.` }, { status: 429 });
    // El turno se anota ANTES de gastar: dos clics seguidos no pasan el tope.
    await pool.query("INSERT INTO clientes_bitacora (cliente_id, usuario_id, accion, detalle) VALUES (?, ?, 'proponer_descripcion', ?)", [g.u.clienteId, g.u.id, JSON.stringify({ largo: v.texto.length })]);
    const r = await proponerDesdeDescripcion(g.u.clienteId, v.texto);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ success: true, armada: r.armada });
  } catch (e) {
    return NextResponse.json({ error: mensajeSeguro(e, 'No pudimos preparar la propuesta. Inténtalo de nuevo en unos minutos.') }, { status: 500 });
  }
}
