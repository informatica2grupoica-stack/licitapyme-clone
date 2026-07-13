// app/api/negocios/asignaciones/route.ts
// Devuelve, para una lista de códigos, a QUÉ perfil está asignada cada licitación (si lo está).
// Lo usa el buscador (ResultsGrid) para mostrar "Asignada a X" en vez de "Asignar".
// Una licitación siempre tiene, como máximo, UN perfil activo (ver POST /api/negocios).
// Body: { codigos: string[] }
// Respuesta: { success, asignaciones: { [codigo]: { asignado_a, asignado_nombre } } }
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';

export async function POST(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  let body: any;
  try { body = await request.json(); } catch { body = {}; }
  const codigos = Array.from(new Set(
    Array.isArray(body?.codigos) ? body.codigos.filter((c: unknown): c is string => typeof c === 'string' && c.trim() !== '') : []
  )).slice(0, 500);

  if (codigos.length === 0) return NextResponse.json({ success: true, asignaciones: {} });

  try {
    const [rows] = await pool.query(
      `SELECT n.licitacion_codigo, n.asignado_a,
              u.nombre AS asignado_nombre, u.email AS asignado_email
       FROM negocios n JOIN usuarios u ON u.id = n.asignado_a
       WHERE n.activo = TRUE AND n.licitacion_codigo IN (?)`,
      [codigos],
    ) as any[];

    const asignaciones: Record<string, { asignado_a: number; asignado_nombre: string | null }> = {};
    for (const r of rows as any[]) {
      // Ante datos legados con más de una fila activa, gana la última leída (todas apuntan al
      // mismo perfil tras el saneamiento; el POST ya garantiza unicidad hacia adelante).
      asignaciones[r.licitacion_codigo] = {
        asignado_a: r.asignado_a,
        asignado_nombre: r.asignado_nombre || r.asignado_email || null,
      };
    }
    return NextResponse.json({ success: true, asignaciones });
  } catch (error) {
    console.error('Error asignaciones:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
