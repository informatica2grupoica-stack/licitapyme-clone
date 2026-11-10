// app/api/mi-empresa/integraciones/route.ts — Cuentas externas propias de la empresa-cliente (multiempresa, Etapa 2).
//   GET    → qué tiene configurado (solo la pista, nunca el secreto).
//   PUT    → { tipo: 'mp_ticket', ticket } | { tipo: 'correo', host, port, secure, user, pass, from } — se prueba antes de guardar.
//   DELETE → ?tipo=mp_ticket|correo — vuelve a lo compartido (ticket con tope del plan; correo: no se envía a su nombre).
// Solo el admin de la empresa. Grupo ICA usa las cuentas del .env del servidor (no aplica).
import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/app/lib/api-auth';
import { CLIENTE_ICA } from '@/app/lib/tenant';
import { guardarIntegracion, borrarIntegracion, resumenIntegraciones, probarTicketMp, crearTransporteSmtp, type TipoIntegracion, type CorreoSmtp } from '@/app/lib/integraciones-cliente';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function adminDeCliente(req: NextRequest) {
  const u = await getAuthedUser(req);
  if (!u?.clienteId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  if (u.clienteId === CLIENTE_ICA) return { error: NextResponse.json({ error: 'Grupo ICA usa las cuentas del servidor' }, { status: 400 }) };
  if (u.rol !== 'admin') return { error: NextResponse.json({ error: 'Solo el admin de la empresa puede ver o cambiar sus cuentas' }, { status: 403 }) };
  return { u: { ...u, clienteId: u.clienteId } };
}

export async function GET(req: NextRequest) {
  const g = await adminDeCliente(req);
  if (g.error) return g.error;
  return NextResponse.json({ success: true, integraciones: await resumenIntegraciones(g.u.clienteId) });
}

export async function PUT(req: NextRequest) {
  const g = await adminDeCliente(req);
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));
  const texto = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
  try {
    if (b.tipo === 'mp_ticket') {
      const ticket = texto(b.ticket, 80).toUpperCase();
      if (!/^[A-Z0-9-]{20,80}$/.test(ticket)) return NextResponse.json({ error: 'El ticket no tiene el formato de Mercado Público (letras, números y guiones).' }, { status: 400 });
      const prueba = await probarTicketMp(ticket);
      if (!prueba.ok) return NextResponse.json({ error: prueba.aviso }, { status: 400 });
      await guardarIntegracion(g.u.clienteId, 'mp_ticket', { ticket }, `••••${ticket.slice(-4)}`, g.u.id);
      return NextResponse.json({ success: true, aviso: prueba.aviso ?? null });
    }
    if (b.tipo === 'correo') {
      const c: CorreoSmtp = {
        host: texto(b.host, 120), port: Math.round(Number(b.port) || 587), secure: b.secure === true || Number(b.port) === 465,
        user: texto(b.user, 160), pass: String(b.pass ?? ''), from: texto(b.from, 200),
      };
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(c.host) || !c.user || !c.pass || c.port < 1 || c.port > 65535)
        return NextResponse.json({ error: 'Faltan datos del correo: servidor, puerto, usuario y clave.' }, { status: 400 });
      if (/[\r\n]/.test(c.from) || /[\r\n]/.test(c.user)) return NextResponse.json({ error: 'Remitente no válido' }, { status: 400 });
      const t = crearTransporteSmtp(c);
      try {
        await Promise.race([t.verify(), new Promise((_, rej) => setTimeout(() => rej(new Error('el servidor no respondió en 15 s')), 15_000))]);
      } catch (e) {
        return NextResponse.json({ error: `No se pudo entrar a esa cuenta de correo: ${String((e as Error)?.message ?? e).slice(0, 160)}` }, { status: 400 });
      } finally { t.close(); }
      await guardarIntegracion(g.u.clienteId, 'correo', c, `${c.host} · ${c.user}`, g.u.id);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Tipo no válido' }, { status: 400 });
  } catch (e) {
    // Sin INTEGRACIONES_CLAVE en el servidor, cifrar() lanza un mensaje que se puede mostrar.
    const msg = String((e as Error)?.message ?? e);
    console.error('[mi-empresa/integraciones]', msg.slice(0, 200));
    return NextResponse.json({ error: /INTEGRACIONES_CLAVE/.test(msg) ? msg : 'No se pudo guardar. Inténtalo de nuevo.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const g = await adminDeCliente(req);
  if (g.error) return g.error;
  const tipo = req.nextUrl.searchParams.get('tipo') as TipoIntegracion | null;
  if (tipo !== 'mp_ticket' && tipo !== 'correo') return NextResponse.json({ error: 'Tipo no válido' }, { status: 400 });
  await borrarIntegracion(g.u.clienteId, tipo);
  return NextResponse.json({ success: true });
}
