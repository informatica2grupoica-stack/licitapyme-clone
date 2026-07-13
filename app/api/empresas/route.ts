// app/api/empresas/route.ts
// Empresas con las que se postula.
//   GET  → lista de empresas activas (cualquier usuario autenticado; se usa en el
//          selector al marcar una licitación como Postulada).
//   POST → crea una empresa (solo admin).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';

function getUser(req: NextRequest) {
  const id  = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

// Campos editables de una empresa (los mismos en POST y PATCH).
const CAMPOS = [
  'razon_social', 'rut', 'direccion', 'region', 'giro', 'tipo_persona_juridica',
  'fecha_sociedad', 'representante_nombre', 'representante_rut', 'representante_cargo',
  'email1', 'telefono1', 'email2', 'telefono2',
  'banco_tipo_cuenta', 'banco_numero', 'banco_nombre', 'banco_email',
] as const;

export async function GET(request: NextRequest) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    try { await pool.query('SELECT 1 FROM empresas LIMIT 1'); }
    catch { return NextResponse.json({ success: true, empresas: [], _migrationPending: true }); }

    const [rows] = await pool.query(
      `SELECT * FROM empresas WHERE activo = TRUE ORDER BY razon_social ASC`
    );
    return NextResponse.json({ success: true, empresas: rows });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Solo el admin puede crear empresas' }, { status: 403 });

  try {
    const body = await request.json();
    const razon = String(body.razon_social || '').trim();
    const rut   = String(body.rut || '').trim();
    if (!razon || !rut)
      return NextResponse.json({ error: 'Razón social y RUT son obligatorios' }, { status: 400 });

    const valores = CAMPOS.map(c => {
      const v = body[c];
      return v === undefined || v === null || v === '' ? null : String(v).trim();
    });

    const [result] = await pool.query(
      `INSERT INTO empresas (${CAMPOS.join(', ')}) VALUES (${CAMPOS.map(() => '?').join(', ')})`,
      valores
    );
    return NextResponse.json({ success: true, id: (result as any).insertId });
  } catch (error: any) {
    if (String(error).toLowerCase().includes('duplicate'))
      return NextResponse.json({ error: 'Ya existe una empresa con ese RUT' }, { status: 409 });
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
