// app/api/mi-empresa/configuracion/route.ts — Configuración inicial de una empresa-cliente.
//   GET  → ¿falta configurar? + sugerencias de la evaluación por RUT (la arranca si nunca se hizo) + lo que ya tiene.
//   POST → guarda el perfil y las palabras clave que el admin eligió, y marca la configuración como hecha.
// Solo empresas-cliente (no Grupo ICA). Leer: cualquier usuario de la empresa; guardar: su admin.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { CLIENTE_ICA } from '@/app/lib/tenant';
import { leerPerfil, guardarPerfil } from '@/app/lib/cliente-viabilidad';
import { encolarEvaluacion, leerEvaluacion } from '@/app/lib/evaluar-empresa-rut';
import { palabrasASacar } from '@/app/lib/armar-plataforma-core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId || u.clienteId === CLIENTE_ICA) return NextResponse.json({ success: true, aplica: false });
  let ev = await leerEvaluacion(u.clienteId);
  if (!ev && u.rol === 'admin' && (await encolarEvaluacion(u.clienteId)).ok) ev = await leerEvaluacion(u.clienteId); // a la cola (sobrevive a un deploy)
  const [kw] = await pool.query('SELECT keyword, es_negativa FROM palabras_clave WHERE cliente_id = ? ORDER BY id', [u.clienteId]);
  return NextResponse.json({
    success: true, aplica: true, pendiente: !ev?.aplicado_at,
    evaluacion: ev ? { estado: ev.estado, progreso: ev.progreso, resultado: ev.resultado } : null,
    perfil: await leerPerfil(u.clienteId), palabras: kw,
  });
}

export async function POST(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId || u.clienteId === CLIENTE_ICA) return NextResponse.json({ error: 'No aplica' }, { status: 400 });
  if (u.rol !== 'admin') return NextResponse.json({ error: 'Solo el admin de la empresa puede configurarla' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const lista = (v: unknown) => [...new Set((Array.isArray(v) ? v : []).map(x => String(x).toLowerCase().trim()).filter(x => x.length >= 2 && x.length <= 60))].slice(0, 150);
  if (b.perfil) await guardarPerfil(u.clienteId, b.perfil);
  // Primera confirmación de una plataforma armada sola: lo que el sistema puso y la persona desmarcó, se quita.
  const previa = await leerEvaluacion(u.clienteId);
  if (!previa?.aplicado_at && previa?.resultado?.armado && Array.isArray(b.palabras) && Array.isArray(b.negativas))
    for (const s of palabrasASacar(previa.resultado.armado, lista(b.palabras), lista(b.negativas)))
      await pool.query('DELETE FROM palabras_clave WHERE keyword = ? AND es_negativa = ? AND cliente_id = ?', [s.keyword, s.negativa, u.clienteId]);
  let agregadas = 0;
  for (const [kw, neg] of [...lista(b.palabras).map(k => [k, 0] as const), ...lista(b.negativas).map(k => [k, 1] as const)]) {
    const [dup] = await pool.query('SELECT 1 FROM palabras_clave WHERE keyword = ? AND cliente_id = ? LIMIT 1', [kw, u.clienteId]);
    if ((dup as unknown[]).length) continue;
    await pool.query('INSERT INTO palabras_clave (usuario_id, cliente_id, keyword, es_negativa) VALUES (?, ?, ?, ?)', [u.id, u.clienteId, kw, neg]);
    agregadas++;
  }
  await pool.query(
    `INSERT INTO cliente_evaluacion (cliente_id, estado, progreso, aplicado_at) VALUES (?, 'SIN_RUT', 'Configurada sin evaluación', NOW())
     ON DUPLICATE KEY UPDATE aplicado_at = NOW()`, [u.clienteId]);
  return NextResponse.json({ success: true, agregadas });
}
