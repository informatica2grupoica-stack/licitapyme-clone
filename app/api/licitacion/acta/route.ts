// app/api/licitacion/acta/route.ts
// Anexos de la adjudicación (acta de evaluación, resolución, declaraciones juradas).
//
// GET  ?codigo=XXXX            → lo ya guardado (instantáneo, no toca el portal).
// POST { codigo }              → lee el acta en Mercado Público ahora (IP chilena).
// POST { codigo, descargar }   → baja a R2 los anexos pendientes.
//
// Guard de lectura: puedeVerLicitacion — quien puede ver la licitación puede ver su acta.
// Escritura (leer del portal / descargar): admin, porque pega contra MP y no debe poder
// dispararlo cualquiera en bucle.

import { NextRequest, NextResponse } from 'next/server';
import { puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { obtenerActaVista, leerYGuardarActa, descargarActaDocumentos } from '@/app/lib/acta-adjudicacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET(req: NextRequest) {
  const codigo = req.nextUrl.searchParams.get('codigo')?.trim();
  if (!codigo) return NextResponse.json({ error: 'Falta el código de licitación' }, { status: 400 });
  if (!(await puedeVerLicitacion(req, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  try {
    return NextResponse.json(await obtenerActaVista(codigo));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await esAdmin(req))) {
    return NextResponse.json({ error: 'Solo un administrador puede traer los documentos del acta' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({} as any));
  const codigo = String(body.codigo || '').trim();
  if (!codigo) return NextResponse.json({ error: 'Falta el código de licitación' }, { status: 400 });

  try {
    if (body.descargar) {
      const r = await descargarActaDocumentos(codigo);
      return NextResponse.json({ ok: true, ...r, vista: await obtenerActaVista(codigo) });
    }

    const r = await leerYGuardarActa(codigo);
    if (!r.ok) {
      // No es un 500: o la licitación aún no tiene acta publicada, o el portal no respondió.
      // Decirlo tal cual evita que el usuario crea que el sistema está roto.
      return NextResponse.json({
        ok: false,
        error: 'No se pudo abrir el acta en Mercado Público. Puede que aún no esté publicada, o que esta instancia no tenga IP chilena.',
      }, { status: 502 });
    }
    const { ok: _ok, ...datos } = r;   // `ok` lo fija la respuesta, no el resultado interno
    return NextResponse.json({ ok: true, ...datos, vista: await obtenerActaVista(codigo) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
