// app/api/compras/cerradas/route.ts
// Menú «Compras cerradas» (10-nov-2026): los negocios que salieron de Compras — OC cancelada por el organismo,
// entregadas / no realizadas (marca histórica) y pre-compras sin adjudicar —, del cliente de la sesión.
// Solo lectura; «Reabrir» usa DELETE /api/compras/[negocioId]/cierre-legado (jefe de ventas).
import { NextRequest, NextResponse } from 'next/server';
import { permisosCrudosDeUsuario, clienteIdOrNull } from '@/app/lib/api-auth';
import { mensajeSeguro } from '@/app/lib/errores-api';
import { listarComprasCerradas } from '@/app/lib/compras-oc-cancelada';
import { obumaDeCerradas } from '@/app/lib/compras-obuma-cierre';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const userId = parseInt(request.headers.get('x-user-id') || '');
  if (!Number.isFinite(userId)) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const p = await permisosCrudosDeUsuario(userId);
  if (!(p.compras_todo || p.compras || p.aprobar_comercial || p.compras_administracion || p.compras_bodega || p.compras_ver || p.compras_auditor))
    return NextResponse.json({ error: 'Sin acceso a Compras.' }, { status: 403 });
  const clienteId = await clienteIdOrNull(request);
  if (!clienteId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    const cerradas = await listarComprasCerradas(clienteId);
    const obuma = await obumaDeCerradas(cerradas.map(c => ({ negocioId: c.negocioId, licitacionCodigo: c.licitacionCodigo })));
    return NextResponse.json({ success: true, cerradas, obuma, puedeReabrir: !!(p.compras_todo || p.aprobar_comercial) });
  } catch (e) {
    console.error('[compras/cerradas][GET]', String(e));
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudieron cargar las compras cerradas.') }, { status: 500 });
  }
}
