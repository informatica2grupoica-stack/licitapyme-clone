// app/api/postuladas/ofertas/route.ts
// Frente F.2 — ofertas de la competencia de UNA licitación, para la UI.
//
// GET  ?codigo=XXXX  → lo que ya está en la base (instantáneo, no toca el portal).
// POST { codigo }    → fuerza la lectura del portal ahora (IP chilena). Admin, porque es una
//                      operación cara contra MP y no debe poder dispararla cualquiera en bucle.
//
// El guard de lectura es puedeVerLicitacion: quién puede ver la licitación puede ver contra
// quién compitió. No se inventa un permiso nuevo para algo que ya tiene dueño definido.

import { NextRequest, NextResponse } from 'next/server';
import { puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { obtenerAperturaVista, leerYGuardarOfertas } from '@/app/lib/ofertas-competencia';
import { publicarCambio } from '@/app/lib/sse-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const codigo = req.nextUrl.searchParams.get('codigo')?.trim();
  if (!codigo) return NextResponse.json({ error: 'Falta el código de licitación' }, { status: 400 });
  if (!(await puedeVerLicitacion(req, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  try {
    return NextResponse.json(await obtenerAperturaVista(codigo));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await esAdmin(req))) {
    return NextResponse.json({ error: 'Solo un administrador puede forzar la lectura de la apertura' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({} as any));
  const codigo = String(body.codigo || '').trim();
  if (!codigo) return NextResponse.json({ error: 'Falta el código de licitación' }, { status: 400 });

  try {
    const r = await leerYGuardarOfertas(codigo);
    if (!r.ok) {
      // No es un 500: el portal está caído o bloqueó la IP, y eso hay que decirlo tal cual
      // en vez de mostrar "error desconocido".
      return NextResponse.json({
        ok: false,
        error: 'No se pudo entrar a la apertura en Mercado Público (portal caído, o esta instancia no tiene IP chilena). Se reintentará automáticamente.',
        diagnostico: r.diagnostico,
      }, { status: 502 });
    }
    publicarCambio('apertura');
    const { ok: _ok, ...datos } = r;   // `ok` lo fija la respuesta, no el resultado interno
    return NextResponse.json({ ok: true, ...datos, vista: await obtenerAperturaVista(codigo) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
