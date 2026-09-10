// app/api/logistica/fleteros/sugerencia/route.ts
// §13.5 — "el sistema propone el mejor fletero, o todas las alternativas ordenadas, sin que nadie
// busque." GET ?zona=Coyhaique&urgente=1
import { NextRequest, NextResponse } from 'next/server';
import { permisosDeUsuario } from '@/app/lib/api-auth';
import { sugerirFleteros } from '@/app/lib/compras-logistica';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function GET(request: NextRequest) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const p = await permisosDeUsuario(userId, rol);
  if (rol !== 'admin' && !p.compras && !p.aprobar_comercial) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

  const zona = request.nextUrl.searchParams.get('zona') || '';
  const urgente = request.nextUrl.searchParams.get('urgente') === '1';
  if (!zona.trim()) return NextResponse.json({ error: 'Falta la zona de entrega.' }, { status: 400 });

  try {
    const sugerencias = await sugerirFleteros(zona, urgente);
    return NextResponse.json({ success: true, sugerencias });
  } catch (error) {
    console.error('[logistica/fleteros/sugerencia][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo calcular la sugerencia.' }, { status: 500 });
  }
}
