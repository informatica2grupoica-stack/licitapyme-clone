// app/api/mi-empresa/exportar/route.ts
// GET → descarga un JSON con TODOS los datos de la empresa de quien pide (Ley 21.719: acceso y portabilidad).
// Solo el admin de una empresa-cliente; la empresa sale de la sesión. Sin contraseñas, tokens ni credenciales. Una exportación cada 10 minutos.
import { NextRequest, NextResponse } from 'next/server';
import { adminDeCliente } from '@/app/lib/admin-empresa';
import { exportarDatosPropios, ExportacionReciente } from '@/app/lib/exportar-propio';
import { mensajeSeguro } from '@/app/lib/errores-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const g = await adminDeCliente(req, 'Solo el admin de la empresa puede exportar sus datos');
  if (g.error) return g.error;
  try {
    const datos = await exportarDatosPropios(g.u.clienteId, g.u.id);
    return new NextResponse(JSON.stringify(datos, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="licitank-mis-datos-${new Date().toISOString().slice(0, 10)}.json"`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof ExportacionReciente) return NextResponse.json({ error: e.message }, { status: 429 });
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo preparar la exportación.') }, { status: 500 });
  }
}
