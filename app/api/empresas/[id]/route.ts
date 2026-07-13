// app/api/empresas/[id]/route.ts
// Detalle de una empresa: GET, PATCH (editar) y DELETE (desactivar). Mutaciones solo admin.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

function getUser(req: NextRequest) {
  const id  = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

const CAMPOS = [
  'razon_social', 'rut', 'direccion', 'region', 'giro', 'tipo_persona_juridica',
  'fecha_sociedad', 'representante_nombre', 'representante_rut', 'representante_cargo',
  'email1', 'telefono1', 'email2', 'telefono2',
  'banco_tipo_cuenta', 'banco_numero', 'banco_nombre', 'banco_email',
] as const;

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;
  try {
    const [rows] = await pool.query(`SELECT * FROM empresas WHERE id = ?`, [id]) as any;
    if (!(rows as any[]).length) return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
    return NextResponse.json({ success: true, empresa: (rows as any[])[0] });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Solo el admin puede editar empresas' }, { status: 403 });
  const { id } = await params;

  try {
    const body = await request.json();
    // Solo actualiza los campos presentes en el body.
    const sets: string[] = [];
    const vals: any[] = [];
    for (const c of CAMPOS) {
      if (c in body) {
        sets.push(`${c} = ?`);
        const v = body[c];
        vals.push(v === undefined || v === null || v === '' ? null : String(v).trim());
      }
    }
    if (!sets.length) return NextResponse.json({ error: 'Sin cambios' }, { status: 400 });

    // Validación mínima si vienen los obligatorios.
    if ('razon_social' in body && !String(body.razon_social || '').trim())
      return NextResponse.json({ error: 'La razón social no puede quedar vacía' }, { status: 400 });
    if ('rut' in body && !String(body.rut || '').trim())
      return NextResponse.json({ error: 'El RUT no puede quedar vacío' }, { status: 400 });

    vals.push(id);
    await pool.query(`UPDATE empresas SET ${sets.join(', ')} WHERE id = ?`, vals);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (String(error).toLowerCase().includes('duplicate'))
      return NextResponse.json({ error: 'Ya existe una empresa con ese RUT' }, { status: 409 });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Solo el admin puede eliminar empresas' }, { status: 403 });
  const { id } = await params;
  try {
    // Baja lógica: no se borra (mantiene la referencia en negocios ya postulados).
    await pool.query(`UPDATE empresas SET activo = FALSE WHERE id = ?`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
