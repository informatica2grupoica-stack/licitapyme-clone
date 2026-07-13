// app/api/postuladas/aperturas/route.ts
// Refresco de APERTURAS en segundo plano para el apartado Postuladas.
//
// La carga de la página (/api/postuladas/estado) lee SOLO la tabla → instantánea. Este endpoint
// se llama DESPUÉS de pintar, sin bloquear: rasca el portal de MP (IP chilena) para las postuladas
// que aún no tienen resultado y devuelve el mapa de aperturas actualizado, que la página fusiona.
// Así siempre se detectan las aperturadas aunque el cron de 2h todavía no haya corrido, y la
// página nunca se queda "pegada" esperando al portal.
//
// Requiere IP chilena (WAF de MP), igual que la descarga de documentos. Si corre fuera de Chile,
// degrada a lo que haya en la tabla (que llena el cron del VPS).

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { tienePermiso } from '@/app/lib/api-auth';
import { refrescarAperturas } from '@/app/lib/detectar-aperturas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null };
}

export async function GET(request: NextRequest) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    // Mismo alcance por rol que /api/postuladas/estado.
    const verOtros = await tienePermiso(request, 'ver_otros_negocios').catch(() => false);
    const where = verOtros
      ? `n.activo = TRUE AND n.estado_pipeline = 'POSTULADA'`
      : `n.activo = TRUE AND n.estado_pipeline = 'POSTULADA' AND n.asignado_a = ?`;
    const [rows] = await pool.query(
      `SELECT DISTINCT n.licitacion_codigo AS codigo FROM negocios n WHERE ${where}`,
      verOtros ? [] : [userId],
    ) as any[];
    const codigos = (rows as any[]).map(r => r.codigo).filter(Boolean) as string[];
    if (codigos.length === 0) return NextResponse.json({ aperturas: {} });

    // Rasca el portal para las pendientes (bounded). refrescarAperturas ya lee la tabla,
    // solo consulta el portal para las no-aperturadas verificadas hace rato y persiste lo nuevo.
    const mapa = await refrescarAperturas(codigos, { maxDetectar: 20, presupuestoMs: 45_000 })
      .catch(() => new Map<string, boolean>());

    const aperturas: Record<string, boolean> = {};
    for (const c of codigos) aperturas[c] = !!mapa.get(c);
    return NextResponse.json({ aperturas });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
