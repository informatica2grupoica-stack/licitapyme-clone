// app/api/compras/[negocioId]/del-auditor/route.ts
// PESTAÑA «REVISADO DEL AUDITOR» (Costeo y auditoría). Ver app/lib/compras-del-auditor.ts.
//   GET  → por producto: las cotizaciones y fichas técnicas que el asistente ya cargó y revisó en el Auditor. Solo lectura.
//   POST → { accion: 'cotizacion' | 'ficha', clave, confirmar? } pasa UNO de esos documentos a Compras (cotización o ficha del producto).
//          409 { confirmar: true } si la compra ya está aprobada y falta que la persona lo confirme.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { conBitacoraCompras } from '@/app/lib/compras-bitacora';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarPreAprobacion, puedeVerPreAprobacion } from '@/app/api/compras/[negocioId]/route';
import { panelDelAuditor, usarCotizacionDelAuditor, usarFichaDelAuditor, ConfirmarCompraAprobada } from '@/app/lib/compras-del-auditor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Params = { params: Promise<{ negocioId: string }> };

async function contexto(request: NextRequest, params: Params['params'], lectura: boolean) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  const nombre = request.headers.get('x-user-nombre') || 'Usuario';
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt((await params).negocioId);
  if (!Number.isFinite(id)) return { error: NextResponse.json({ error: 'negocioId inválido' }, { status: 400 }) };
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  if (!(await (lectura ? puedeVerPreAprobacion : puedeOperarPreAprobacion)(userId, rol, asignacion.asignadoA, asignacion.coencargados))) return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { id, codigo: asignacion.licitacionCodigo, actor: { id: userId, nombre } };
}

export async function GET(request: NextRequest, { params }: Params) {
  const c = await contexto(request, params, true);
  if ('error' in c) return c.error;
  try {
    return NextResponse.json({ success: true, panel: await panelDelAuditor(c.id, c.codigo) });
  } catch (e: any) {
    console.error('[compras/del-auditor][GET]', String(e));
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo cargar lo revisado en el Auditor.') }, { status: 500 });
  }
}

async function __POST(request: NextRequest, { params }: Params) {
  const c = await contexto(request, params, false);
  if ('error' in c) return c.error;
  try {
    const body = await request.json().catch(() => ({}));
    const clave = String(body.clave || '');
    if (!/^[cf]:\d+$/.test(clave)) return NextResponse.json({ error: 'Falta el documento.' }, { status: 400 });
    if (body.accion === 'cotizacion') {
      const r = await usarCotizacionDelAuditor({ negocioId: c.id, licitacionCodigo: c.codigo, clave, actor: c.actor, confirmarCompraAprobada: body.confirmar === true });
      return NextResponse.json({ success: true, resultado: r });
    }
    if (body.accion === 'ficha') {
      const r = await usarFichaDelAuditor({ negocioId: c.id, licitacionCodigo: c.codigo, clave, actor: c.actor });
      return NextResponse.json({ success: true, resultado: r });
    }
    return NextResponse.json({ error: 'Acción desconocida.' }, { status: 400 });
  } catch (e: any) {
    if (e instanceof ConfirmarCompraAprobada) return NextResponse.json({ error: e.message, confirmar: true }, { status: 409 });
    console.error('[compras/del-auditor][POST]', String(e));
    return NextResponse.json({ error: mensajeSeguro(e, 'No se pudo pasar el documento a Compras.') }, { status: 400 });
  }
}

export const POST = conBitacoraCompras(__POST, 'POST');
