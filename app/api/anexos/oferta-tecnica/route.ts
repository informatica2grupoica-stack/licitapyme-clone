// POST /api/anexos/oferta-tecnica { codigo, documentoId }
// Completa un anexo técnico EN BLANCO del organismo («ANEXO TÉCNICO 3 · OFERTA TÉCNICA») con nuestra ficha técnica
// armada desde el Auditor (ver auditor-ficha-propia.ts). Queda en Documentos › Anexos Técnicos como ANEXO_<nombre>.docx (Word, para editarlo).
// Mismo acceso que generar un anexo: ver la licitación y tener el permiso «Anexos».
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion, tienePermiso } from '@/app/lib/api-auth';
import { yaCongelado } from '@/app/lib/congelamiento';
import { generarOfertaTecnicaDeAnexo } from '@/app/lib/auditor-ficha-propia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const codigo = String(body?.codigo || '');
  const documentoId = String(body?.documentoId || '');
  if (!codigo || !documentoId) return NextResponse.json({ error: 'Faltan parámetros: codigo, documentoId' }, { status: 400 });
  if (!(await puedeVerLicitacion(request, codigo))) return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  if (!(await tienePermiso(request, 'anexos')))
    return NextResponse.json({ error: 'Generar anexos requiere ser administrador o tener el permiso "Anexos".' }, { status: 403 });

  try {
    const [rows] = await pool.query(`SELECT id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE ORDER BY id DESC LIMIT 1`, [codigo]) as any;
    const negocio = (rows as any[])[0];
    if (!negocio) return NextResponse.json({ error: 'Esta licitación no tiene un negocio con Auditor.' }, { status: 404 });
    if (await yaCongelado(negocio.id, usuario.rol))
      return NextResponse.json({ error: 'Este negocio ya se postuló: ya no se pueden generar más anexos.' }, { status: 409 });
    const r = await generarOfertaTecnicaDeAnexo(negocio.id, codigo, documentoId, usuario.id);
    return NextResponse.json({ success: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'No se pudo generar la oferta técnica' }, { status: 400 });
  }
}
