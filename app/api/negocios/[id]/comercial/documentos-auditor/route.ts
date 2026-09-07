// app/api/negocios/[id]/comercial/documentos-auditor/route.ts
// GET → URLs de todos los documentos que YA se enviaron al Auditor Técnico de este negocio
// (checklist_comercial_documentos, sin importar a qué punto del checklist quedaron pegados).
//
// Existe para "Documentos y Bases" (DocumentosSection.tsx): pedido explícito del usuario
// (7-sep-2026), "los que yo quiero de color verde son los de documentos mp... cuando ya los
// mando al auditor" — un documento se pinta verde comparando su URL contra esta lista, EN VIVO,
// sin guardar ninguna marca aparte en documentos_cache (si el punto del checklist se borra o el
// documento se reemplaza, la próxima consulta ya refleja el estado real).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';
import { cargarNegocio } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id');
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(parseInt(userId), rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });

    const [rows] = await pool.query(
      `SELECT DISTINCT url FROM checklist_comercial_documentos WHERE negocio_id = ?`,
      [negocio.id],
    ) as any;
    const urls = (rows as Array<{ url: string }>).map(r => r.url).filter(Boolean);

    return NextResponse.json({ success: true, urls });
  } catch (error) {
    console.error('[comercial/documentos-auditor][GET]', String(error));
    // Tabla puede no existir todavía — no romper la pantalla de Documentos por esto.
    return NextResponse.json({ success: true, urls: [] });
  }
}
