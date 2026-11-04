// app/api/admin/whatsapp/estado/route.ts — número emisor de los avisos por WhatsApp (solo admin; proxy.ts ya bloquea /api/admin).
//   GET    → estado de la conexión + resumen de la cola
//   POST   → genera el QR para vincular el número emisor (mismo flujo que "Dispositivo vinculado" en WhatsApp)
//   PUT    → { prueba: true } manda un mensaje de prueba al celular del propio admin
//   DELETE → desvincula el número
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { cerrarSesion, conectarInstancia, enviarTexto, estadoInstancia, instanciaEmisor, numeroVinculado, whatsappConfigurado, WhatsappError } from '@/app/lib/whatsapp';
import { drenarCola, resumenCola } from '@/app/lib/whatsapp-avisos';
import { normalizarTelefono } from '@/app/lib/perfil-datos';

async function admin(req: NextRequest) {
  const u = await getAuthedUser(req);
  return u && u.rol === 'admin' && u.clienteId ? u : null;
}
const NO = () => NextResponse.json({ error: 'Sin permisos de administrador' }, { status: 403 });
const errorWa = (e: unknown) => e instanceof WhatsappError
  ? NextResponse.json({ error: e.message }, { status: e.status === 503 ? 503 : 502 })
  : NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });

export async function GET(req: NextRequest) {
  const u = await admin(req); if (!u) return NO();
  if (!whatsappConfigurado()) return NextResponse.json({ configurado: false });
  const inst = instanciaEmisor(u.clienteId!);
  try {
    const estado = await estadoInstancia(inst);
    const resumen = await resumenCola(u.clienteId!).catch(() => null); // sin la migración 178 sigue mostrando la conexión
    return NextResponse.json({ configurado: true, estado, numero: estado === 'open' ? await numeroVinculado(inst) : null, resumen, migracion: resumen !== null });
  } catch (e) { return errorWa(e); }
}

export async function POST(req: NextRequest) {
  const u = await admin(req); if (!u) return NO();
  try {
    const inst = instanciaEmisor(u.clienteId!);
    if (await estadoInstancia(inst) === 'open') return NextResponse.json({ estado: 'open', qr: null, codigo: null });
    return NextResponse.json({ estado: 'connecting', ...(await conectarInstancia(inst)) });
  } catch (e) { return errorWa(e); }
}

export async function PUT(req: NextRequest) {
  const u = await admin(req); if (!u) return NO();
  const [rows] = await pool.query('SELECT telefono, nombre FROM usuarios WHERE id = ? LIMIT 1', [u.id]) as any[];
  const tel = normalizarTelefono((rows as any[])[0]?.telefono ?? '');
  if (!tel) return NextResponse.json({ error: 'Tu perfil no tiene un celular válido: agrégalo en Mi perfil' }, { status: 400 });
  try {
    await enviarTexto(instanciaEmisor(u.clienteId!), tel, '✅ *Licitank · Prueba de avisos*\n\nSi ves este mensaje, tu número emisor de WhatsApp está conectado y funcionando.');
    return NextResponse.json({ success: true });
  } catch (e) { return errorWa(e); }
}

export async function DELETE(req: NextRequest) {
  const u = await admin(req); if (!u) return NO();
  try { await cerrarSesion(instanciaEmisor(u.clienteId!)); return NextResponse.json({ success: true }); }
  catch (e) { return errorWa(e); }
}

/** Reintento manual de los pendientes (botón en la pantalla). */
export async function PATCH(req: NextRequest) {
  const u = await admin(req); if (!u) return NO();
  return NextResponse.json(await drenarCola());
}
