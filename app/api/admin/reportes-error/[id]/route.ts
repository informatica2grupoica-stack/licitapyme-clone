// app/api/admin/reportes-error/[id]/route.ts
// PATCH — el admin cambia el estado de un reporte. Resolverlo EXIGE escribir cómo se solucionó;
// en cada cambio de estado se le avisa por campana a quien lo reportó. `solucion_visible`
// (migration-124) decide si ese perfil ve el TEXTO de la solución o si queda solo para los admin
// (a veces es información interna): el aviso le llega igual, solo que sin el texto.
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
    const visible = body.solucion_visible !== false;   // por defecto visible, como antes
    if (!ESTADOS.includes(estado)) return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
    if ((estado === 'resuelto' || estado === 'descartado') && solucion.length < 10) {
      return NextResponse.json({ error: estado === 'resuelto'
        ? 'Escribe cómo se solucionó (mínimo 10 caracteres)'
        : 'Escribe por qué se descarta (mínimo 10 caracteres)' }, { status: 400 });
    }

    const [[rep]] = await pool.query(`SELECT usuario_id, usuario_nombre, titulo, estado FROM reportes_error WHERE id = ?`, [id]) as any;
    if (!rep) return NextResponse.json({ error: 'Reporte no encontrado' }, { status: 404 });

    const cierra = estado === 'resuelto' || estado === 'descartado';
    const ahora = ahoraChileSQL();
    const nombre = u.nombre || u.email;
    await pool.query(
      `UPDATE reportes_error
         SET estado = ?, solucion = ?, solucion_visible = ?, resuelto_por = ?, resuelto_por_nombre = ?, resuelto_at = ?, updated_at = ?
       WHERE id = ?`,
      [estado, solucion || null, visible ? 1 : 0, cierra ? u.id : null, cierra ? nombre : null, cierra ? ahora : null, ahora, id],
    );

    publicarCambio('reportes_error');   // badge del sidebar y la bandeja del otro admin

    // Aviso al que lo reportó en CADA cambio de estado (en revisión, resuelto, descartado,
    // reabierto). Con la solución privada, el aviso dice el estado pero no el texto.
    const avisado = estado !== rep.estado && rep.usuario_id !== u.id;
    if (avisado) {
      const detalle = visible && solucion ? `: ${solucion}` : '.';
      const mensaje = {
        abierto: `Tu reporte "${rep.titulo}" fue reabierto${detalle}`,
        en_revision: `🔎 Tu reporte "${rep.titulo}" está en revisión${detalle}`,
        resuelto: `✅ Tu reporte "${rep.titulo}" fue solucionado${detalle}`,
        descartado: `Tu reporte "${rep.titulo}" fue descartado${detalle}`,
      }[estado as 'abierto' | 'en_revision' | 'resuelto' | 'descartado'];
      await registrarEvento({
        tipo: cierra ? 'REPORTE_ERROR_CERRADO' : 'REPORTE_ERROR_ESTADO',
        usuarioId: rep.usuario_id, usuarioNombre: rep.usuario_nombre,
        actorId: u.id, actorNombre: nombre,
        mensaje,
        metadata: { reporteId: id, estado },
      });
    }
    return NextResponse.json({ success: true, avisado });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
