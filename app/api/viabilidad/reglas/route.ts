// app/api/viabilidad/reglas/route.ts
// Pantalla de reglas aprendidas de viabilidad (spec v4.0, P12). SOLO "CA" (permiso `reglas_ia`,
// que un admin no tiene por serlo). Vive fuera de /api/admin porque CA puede no ser admin.
//   GET   → todas las reglas (activas e inactivas) con su origen y veces usadas.
//   PATCH → { id, activa } activa/desactiva (desactivar deja la regla en el historial);
//           { id, regla } aprueba una regla `sin_destilar` con el texto corregido por CA.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser, esCA } from '@/app/lib/api-auth';
import { listarTodasLasReglas, cambiarEstadoRegla, aprobarReglaSinDestilar } from '@/app/lib/viabilidad-feedback';
import { registrarActividad } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function autorizar(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u) return { res: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  if (!(await esCA(u.id))) return { res: NextResponse.json({ error: 'Solo CA puede ver las reglas de la IA.' }, { status: 403 }) };
  return { u };
}

export async function GET(req: NextRequest) {
  const a = await autorizar(req); if (a.res) return a.res;
  try { return NextResponse.json({ success: true, reglas: await listarTodasLasReglas() }); }
  catch (e) { console.error('[viabilidad/reglas:GET]', String(e)); return NextResponse.json({ error: 'No se pudieron leer las reglas.' }, { status: 500 }); }
}

export async function PATCH(req: NextRequest) {
  const a = await autorizar(req); if (a.res) return a.res;
  let body: any; try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  try {
    if (typeof body.regla === 'string') {
      if (body.regla.trim().length < 8) return NextResponse.json({ error: 'Escribe la regla completa.' }, { status: 400 });
      await aprobarReglaSinDestilar(id, body.regla);
    } else if (typeof body.activa === 'boolean') {
      await cambiarEstadoRegla(id, body.activa, a.u!.id);
    } else return NextResponse.json({ error: 'Nada que cambiar.' }, { status: 400 });
    registrarActividad({
      usuarioId: a.u!.id, accion: 'feedback_viabilidad', entidadId: String(id),
      descripcion: typeof body.regla === 'string' ? `Aprobó la regla ${id} de la IA` : `${body.activa ? 'Activó' : 'Desactivó'} la regla ${id} de la IA`,
      metadata: { feedback_id: id },
    });
    return NextResponse.json({ success: true, reglas: await listarTodasLasReglas() });
  } catch (e) { console.error('[viabilidad/reglas:PATCH]', String(e)); return NextResponse.json({ error: 'No se pudo actualizar la regla.' }, { status: 500 }); }
}
