// app/api/registro/route.ts
// POST /api/registro { razonSocial, rut, contactoNombre, contactoEmail, contactoTelefono?, mensaje?, web }
// PÚBLICO (sin sesión): deja una solicitud de alta PENDIENTE; no crea cuentas ni gasta Mercado Público ni IA. Un admin de LICITANK la aprueba
// en /admin/solicitudes. Siempre responde igual haya o no una empresa con ese RUT/correo (no se puede usar para averiguar quién es cliente).
import { NextRequest, NextResponse } from 'next/server';
import { ipDeRequest } from '@/app/lib/login-rate-limit';
import { registrarSolicitud, MENSAJE_RECIBIDA } from '@/app/lib/solicitud-alta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Cuerpo chico: un formulario de texto nunca pasa de unos pocos KB.
  const largo = Number(req.headers.get('content-length') || 0);
  if (largo > 10_000) return NextResponse.json({ error: 'La solicitud es demasiado grande.' }, { status: 413 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 }); }

  const r = await registrarSolicitud(body, ipDeRequest(req));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ success: true, mensaje: MENSAJE_RECIBIDA });
}
