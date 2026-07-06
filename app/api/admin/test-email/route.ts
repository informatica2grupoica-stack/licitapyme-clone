// app/api/admin/test-email/route.ts
// Solo admin. GET → verifica la conexión SMTP. POST → envía un correo de prueba al
// propio admin para confirmar que el SMTP de Bluehost quedó bien configurado.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/app/lib/api-auth';
import { verificarSMTP, enviarCorreoAsignacion, enviarDigestRadar } from '@/app/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u || u.rol !== 'admin') return NextResponse.json({ error: 'Solo admin' }, { status: 403 });
  const r = await verificarSMTP();
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}

export async function POST(request: NextRequest) {
  const u = await getAuthedUser(request);
  if (!u || u.rol !== 'admin') return NextResponse.json({ error: 'Solo admin' }, { status: 403 });
  if (!u.email) return NextResponse.json({ error: 'Tu usuario no tiene email' }, { status: 400 });

  // body { tipo?: 'asignacion' | 'digest' } — default 'asignacion'
  const { tipo = 'asignacion' } = await request.json().catch(() => ({}));

  const enviado = tipo === 'digest'
    ? await enviarDigestRadar({
        to: u.email, nombre: u.nombre, totalNuevas: 3,
        licitaciones: [
          { codigo: 'PRUEBA-1-LE26', nombre: 'Adquisición de maquinaria de aseo industrial', organismo: 'Municipalidad de Ejemplo', monto: 45_000_000, cierre: null, keyword: 'maquinaria aseo' },
          { codigo: 'PRUEBA-2-LR26', nombre: 'Equipamiento de barrido y lavado de calles', organismo: 'Servicio de Ejemplo', monto: 88_000_000, cierre: null, keyword: 'barredora' },
          { codigo: 'PRUEBA-3-LE26', nombre: 'Suministro de equipos hidrolavadores', organismo: 'Hospital de Ejemplo', monto: 12_000_000, cierre: null, keyword: 'hidrolavadora' },
        ],
      })
    : await enviarCorreoAsignacion({
        to: u.email, nombre: u.nombre, codigo: 'PRUEBA-1-LE26',
        licitacionNombre: 'Correo de prueba — configuración SMTP correcta',
        organismo: 'ICA Licitaciones', monto: 25_000_000, cierre: null,
        actorNombre: 'El sistema',
      });
  return NextResponse.json(
    enviado ? { ok: true, mensaje: `Correo de prueba (${tipo}) enviado a ${u.email}` }
            : { ok: false, error: 'No se pudo enviar (revisa SMTP_* en .env.local y la consola del servidor)' },
    { status: enviado ? 200 : 500 },
  );
}
