// app/api/perfil/foto/route.ts
// Foto de perfil. Se guarda en usuarios.foto como data URL JPEG (el cliente la reduce a
// ~256 px antes de subirla, ver app/perfil/page.tsx), así no depende de disco en el servidor.
//   GET    ?id=N  → imagen del usuario N (cualquier usuario autenticado: se ve en listas y avatares)
//   PUT    { dataUrl } → cambia MI foto      DELETE → quita MI foto
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/app/lib/api-auth';
import pool from '@/app/lib/db';

const MAX_DATA_URL = 150_000; // ~110 KB de imagen: de sobra para un JPEG de 256 px
const FALTA_MIGRACION = { error: 'Falta la migración 125: ejecuta  node scripts/aplicar-migration-125.mjs' };

export async function GET(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const id = parseInt(new URL(request.url).searchParams.get('id') || '', 10);
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
  try {
    const [rows] = await pool.query('SELECT foto FROM usuarios WHERE id = ? LIMIT 1', [id]);
    const m = String((rows as any[])[0]?.foto ?? '').match(/^data:(image\/jpeg);base64,(.+)$/);
    if (!m) return new NextResponse(null, { status: 404 });
    return new NextResponse(Buffer.from(m[2], 'base64'), {
      headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=300' },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}

export async function PUT(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { dataUrl } = await request.json();
  if (typeof dataUrl !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
    return NextResponse.json({ error: 'La foto debe ser una imagen JPEG' }, { status: 400 });
  }
  if (dataUrl.length > MAX_DATA_URL) return NextResponse.json({ error: 'La foto es demasiado pesada' }, { status: 413 });
  try {
    await pool.query('UPDATE usuarios SET foto = ? WHERE id = ?', [dataUrl, u.id]);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e?.code === 'ER_BAD_FIELD_ERROR') return NextResponse.json(FALTA_MIGRACION, { status: 503 });
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    await pool.query('UPDATE usuarios SET foto = NULL WHERE id = ?', [u.id]);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e?.code === 'ER_BAD_FIELD_ERROR') return NextResponse.json(FALTA_MIGRACION, { status: 503 });
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
