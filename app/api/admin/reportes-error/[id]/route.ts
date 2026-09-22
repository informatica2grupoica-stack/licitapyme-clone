// app/api/admin/reportes-error/[id]/route.ts
// PATCH — el admin cambia el estado de un reporte. Resolverlo EXIGE escribir cómo se solucionó;
// al resolver o descartar se le avisa por campana a quien lo reportó.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { registrarEvento } from '@/app/lib/historial';
import { ahoraChileSQL } from '@/app/lib/tz';
import { publicarCambio } from '@/app/lib/sse-bus';

const ESTADOS = ['abierto', 'en_revision', 'resuelto', 'descartado'];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const u = await getAuthedUser(req);
  if (u?.rol !== 'admin') return NextResponse.json({ error: 'Sin permisos de administrador' }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 });

  try {
    const body = await req.json();
    const estado = String(body.estado || '');
    const solucion = String(body.solucion ?? '').trim();
    if (!ESTADOS.includes(estado)) return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
    if ((estado === 'resuelto' || estado === 'descartado') && solucion.length < 10) {
      return NextResponse.json({ error: estado === 'resuelto'
        ? 'Escribe cómo se solucionó (mínimo 10 caracteres)'
        : 'Escribe por qué se descarta (mínimo 10 caracteres)' }, { status: 400 });
    }

    const [[rep]] = await pool.query(`SELECT usuario_id, usuario_nombre, titulo FROM reportes_error WHERE id = ?`, [id]) as any;
    if (!rep) return NextResponse.json({ error: 'Reporte no encontrado' }, { status: 404 });

    const cierra = estado === 'resuelto' || estado === 'descartado';
    const ahora = ahoraChileSQL();
    const nombre = u.nombre || u.email;
    await pool.query(
      `UPDATE reportes_error
         SET estado = ?, solucion = ?, resuelto_por = ?, resuelto_por_nombre = ?, resuelto_at = ?, updated_at = ?
       WHERE id = ?`,
      [estado, solucion || null, cierra ? u.id : null, cierra ? nombre : null, cierra ? ahora : null, ahora, id],
    );

    publicarCambio('reportes_error');   // badge del sidebar y la bandeja del otro admin

    const avisado = cierra && rep.usuario_id !== u.id;
    if (avisado) {
      await registrarEvento({
        tipo: 'REPORTE_ERROR_CERRADO',
        usuarioId: rep.usuario_id, usuarioNombre: rep.usuario_nombre,
        actorId: u.id, actorNombre: nombre,
        mensaje: estado === 'resuelto'
          ? `✅ Tu reporte "${rep.titulo}" fue solucionado: ${solucion}`
          : `Tu reporte "${rep.titulo}" fue descartado: ${solucion}`,
        metadata: { reporteId: id },
      });
    }
    return NextResponse.json({ success: true, avisado });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
