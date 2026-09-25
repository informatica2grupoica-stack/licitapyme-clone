// app/api/compras/[negocioId]/auditor-costeo/captura/[id]/route.ts
// Imagen de una captura fechada de un link (la evidencia visual que guarda el Auditor de Compras).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeVerCompras } from '@/app/api/compras/[negocioId]/route';
import { imagenDeCaptura } from '@/app/lib/auditor-compras-captura';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string; id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const uid = request.headers.get('x-user-id');
  if (!uid) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId, id } = await params;
  const negId = parseInt(negocioId);
  const asignacion = await obtenerAsignacion(negId);
  if (!asignacion) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 });
  if (!(await puedeVerCompras(parseInt(uid), request.headers.get('x-user-rol'), asignacion.asignadoA))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
  const img = await imagenDeCaptura(parseInt(id), negId);
  if (!img) return NextResponse.json({ error: 'Esta captura no tiene imagen (solo se guardó el texto).' }, { status: 404 });
  return new NextResponse(new Uint8Array(img), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
}
