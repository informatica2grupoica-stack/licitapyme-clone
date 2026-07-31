// app/api/anexos/analizar/route.ts
// GET /api/anexos/analizar?codigo=&documentoId=&empresaId=
// SOLO LECTURA: analiza el anexo y devuelve qué se completaría solo y qué le falta a un
// humano. No modifica ni sube nada — se puede llamar tantas veces como haga falta (se llama
// al abrir la pantalla de relleno).
import { NextRequest, NextResponse } from 'next/server';
import { puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { cargarDocumentoYEmpresa, obtenerItemsCosteoParaAnexo } from '@/app/lib/anexos-datos';
import { analizarAnexoParaUI } from '@/app/lib/anexos-rellenar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const codigo = searchParams.get('codigo');
  const documentoId = searchParams.get('documentoId');
  const empresaId = searchParams.get('empresaId');

  if (!codigo || !documentoId || !empresaId) {
    return NextResponse.json({ error: 'Faltan parámetros: codigo, documentoId, empresaId' }, { status: 400 });
  }
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  // El creador de anexos queda restringido a admin por ahora (pedido explícito, jul-2026)
  // mientras se decide quiénes más lo van a usar — reforzado acá, no solo ocultando el botón.
  if (!(await esAdmin(request))) {
    return NextResponse.json({ error: 'El creador de anexos está disponible solo para administradores por ahora' }, { status: 403 });
  }

  try {
    const [{ bufferOriginal, nombreOriginal, empresa }, itemsCosteo] = await Promise.all([
      cargarDocumentoYEmpresa(codigo, documentoId, empresaId),
      obtenerItemsCosteoParaAnexo(codigo),
    ]);
    const analisis = await analizarAnexoParaUI(bufferOriginal, empresa, itemsCosteo);
    return NextResponse.json({ success: true, nombre: nombreOriginal, ...analisis });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 400 });
  }
}
