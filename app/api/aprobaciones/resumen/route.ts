// app/api/aprobaciones/resumen/route.ts
// Endpoint liviano para el badge del sidebar y el popup de aviso — mismo cálculo que
// GET /api/aprobaciones, pero solo el conteo, para no traer el detalle completo en cada
// polling/reconexión SSE.
import { NextRequest, NextResponse } from 'next/server';
import { esAsesor } from '@/app/api/negocios/[id]/comercial/route';
import { construirBandeja } from '@/app/api/aprobaciones/route';

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
  if (!(await esAsesor(userId, rol))) return NextResponse.json({ success: true, totalPendientes: 0 });

  try {
    const { totalPendientes } = await construirBandeja();
    return NextResponse.json({ success: true, totalPendientes });
  } catch (error) {
    console.error('[aprobaciones/resumen][GET]', String(error));
    return NextResponse.json({ success: true, totalPendientes: 0 });
  }
}
