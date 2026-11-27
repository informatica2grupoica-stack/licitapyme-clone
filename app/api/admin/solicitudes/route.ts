// app/api/admin/solicitudes/route.ts
// Solicitudes de alta que llegan de /registro. Solo el superusuario y los admin de Grupo ICA (igual que /api/admin/clientes).
//   GET  → lista (pendientes primero) y cuántas hay pendientes.
//   POST { accion: 'aprobar', id, plan?, modulos?, maxUsuarios?, venceAt? } → crea la empresa y su admin; devuelve UNA vez el enlace para que cree su clave (y una clave temporal de respaldo).
//   POST { accion: 'rechazar', id, motivo? }
import { NextRequest, NextResponse } from 'next/server';
import { exigirAdminLicitank } from '@/app/lib/admin-licitank';
import { ErrorAlta } from '@/app/lib/crear-empresa-cliente';
import { listarSolicitudes, aprobarSolicitud, rechazarSolicitud, contarPendientes } from '@/app/lib/solicitud-alta';
import { mensajeSeguro } from '@/app/lib/errores-api';
import pool from '@/app/lib/db';
import { crearEnlaceBienvenida } from '@/app/lib/enlace-clave';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const g = await exigirAdminLicitank(req);
  if (g.error) return g.error;
  try {
    return NextResponse.json({ success: true, pendientes: await contarPendientes(), solicitudes: await listarSolicitudes() });
  } catch (e) {
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudieron leer las solicitudes.') }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const g = await exigirAdminLicitank(req);
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({} as any));
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Falta la solicitud' }, { status: 400 });
  try {
    if (b.accion === 'rechazar') {
      await rechazarSolicitud(id, g.u!.id, String(b.motivo || ''));
      return NextResponse.json({ success: true });
    }
    if (b.accion === 'aprobar') {
      const r = await aprobarSolicitud(id, g.u!.id, { plan: b.plan, modulos: b.modulos, maxUsuarios: b.maxUsuarios, venceAt: b.venceAt || null });
      // El enlace para que cree su clave. Si fallara, queda la clave temporal (la empresa ya está creada).
      let enlace: string | null = null;
      try {
        const [rows] = await pool.query('SELECT id FROM usuarios WHERE email = ? AND cliente_id = ? LIMIT 1', [r.email, r.clienteId]);
        const uid = (rows as Array<{ id: number }>)[0]?.id;
        if (uid) enlace = await crearEnlaceBienvenida(uid);
      } catch (e) { console.error('[solicitudes] enlace de bienvenida:', String(e).slice(0, 150)); }
      return NextResponse.json({ success: true, ...r, enlace });
    }
    return NextResponse.json({ error: 'Acción no válida' }, { status: 400 });
  } catch (e) {
    if (e instanceof ErrorAlta) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo completar la operación.') }, { status: 500 });
  }
}
