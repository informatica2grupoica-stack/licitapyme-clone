// app/api/perfil/modo-principiante/route.ts
// Frente C.1 — autoservicio: CUALQUIER usuario autenticado puede apagar (o prender) su PROPIO
// modo principiante. No requiere admin: es el botón "Ver análisis completo" / "graduarse" de
// la vista resumida de viabilidad. El admin también puede fijarlo por perfil desde
// /admin/usuarios (app/api/admin/usuarios/route.ts) — ambos caminos escriben la misma columna.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/app/lib/api-auth';
import pool from '@/app/lib/db';

export async function PATCH(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { modoPrincipiante } = await request.json();
  if (typeof modoPrincipiante !== 'boolean') {
    return NextResponse.json({ error: 'modoPrincipiante debe ser boolean' }, { status: 400 });
  }

  try {
    await pool.query('UPDATE usuarios SET modo_principiante = ? WHERE id = ?', [modoPrincipiante, u.id]);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e?.code === 'ER_BAD_FIELD_ERROR') {
      return NextResponse.json({ error: 'Falta la migración 56 (usuarios.modo_principiante)' }, { status: 503 });
    }
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
