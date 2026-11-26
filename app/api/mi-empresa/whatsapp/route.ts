// app/api/mi-empresa/whatsapp/route.ts — Número de WhatsApp PROPIO de la empresa-cliente (multiempresa): cada empresa vincula SU celular por QR
// (instancia «emisor-c<id>» en Evolution) y los avisos de sus negocios salen desde ahí, solo a su equipo. Grupo ICA usa /admin/whatsapp.
//   GET    → estado de la conexión, número vinculado y resumen de envíos
//   POST   → genera el QR (como «Dispositivo vinculado» en WhatsApp); una vez cada 20 segundos
//   PUT    → manda un mensaje de prueba al celular del propio admin (el de Mi perfil)
//   DELETE → desvincula el número
// Solo el admin de la empresa; la empresa sale de la sesión.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { adminDeCliente } from '@/app/lib/admin-empresa';
import { cerrarSesion, conectarInstancia, enviarTexto, estadoInstancia, instanciaEmisor, numeroVinculado, whatsappConfigurado, WhatsappError } from '@/app/lib/whatsapp';
import { resumenCola } from '@/app/lib/whatsapp-avisos';
import { reservarQr } from '@/app/lib/whatsapp-empresa';
import { normalizarTelefono } from '@/app/lib/perfil-datos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIN_ACCESO = 'Solo el admin de la empresa puede administrar su WhatsApp';
const errorWa = (e: unknown) => e instanceof WhatsappError
  ? NextResponse.json({ error: e.message }, { status: e.status === 503 ? 503 : 502 })
  : NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });

export async function GET(req: NextRequest) {
  const g = await adminDeCliente(req, SIN_ACCESO); if (g.error) return g.error;
  if (!whatsappConfigurado()) return NextResponse.json({ configurado: false });
  const inst = instanciaEmisor(g.u.clienteId);
  try {
    const estado = await estadoInstancia(inst);
    const r = await resumenCola(g.u.clienteId).catch(() => null);
    const [[eq]] = await pool.query(
      `SELECT COUNT(*) AS activos, SUM(telefono IS NOT NULL AND telefono <> '') AS con_telefono FROM usuarios WHERE cliente_id = ? AND activo = TRUE`, [g.u.clienteId]) as any;
    return NextResponse.json({
      configurado: true, estado, numero: estado === 'open' ? await numeroVinculado(inst) : null,
      resumen: r ? { pendientes: r.pendientes, errores: r.errores, enviadosHoy: r.enviadosHoy, topeDiario: r.topeDiario } : null,
      equipo: { activos: Number(eq.activos) || 0, conTelefono: Number(eq.con_telefono) || 0 },
    });
  } catch (e) { return errorWa(e); }
}

export async function POST(req: NextRequest) {
  const g = await adminDeCliente(req, SIN_ACCESO); if (g.error) return g.error;
  try {
    const inst = instanciaEmisor(g.u.clienteId);
    if (await estadoInstancia(inst) === 'open') return NextResponse.json({ estado: 'open', qr: null, codigo: null });
    const espera = reservarQr(g.u.clienteId);
    if (espera > 0) return NextResponse.json({ error: `Espera ${espera} segundos antes de pedir otro código QR.` }, { status: 429 });
    return NextResponse.json({ estado: 'connecting', ...(await conectarInstancia(inst)) });
  } catch (e) { return errorWa(e); }
}

export async function PUT(req: NextRequest) {
  const g = await adminDeCliente(req, SIN_ACCESO); if (g.error) return g.error;
  const [rows] = await pool.query('SELECT telefono FROM usuarios WHERE id = ? AND cliente_id = ? LIMIT 1', [g.u.id, g.u.clienteId]) as any[];
  const tel = normalizarTelefono((rows as any[])[0]?.telefono ?? '');
  if (!tel) return NextResponse.json({ error: 'Tu perfil no tiene un celular válido: agrégalo en Mi perfil' }, { status: 400 });
  try {
    await enviarTexto(instanciaEmisor(g.u.clienteId), tel, '✅ *Licitank · Prueba de avisos*\n\nSi ves este mensaje, el WhatsApp de tu empresa está conectado y funcionando.');
    return NextResponse.json({ success: true });
  } catch (e) { return errorWa(e); }
}

export async function DELETE(req: NextRequest) {
  const g = await adminDeCliente(req, SIN_ACCESO); if (g.error) return g.error;
  try { await cerrarSesion(instanciaEmisor(g.u.clienteId)); return NextResponse.json({ success: true }); }
  catch (e) { return errorWa(e); }
}
