// app/api/compras/[negocioId]/reparto/route.ts
// Proceso administrativo post-aprobación (spec §11) — el módulo solo registra el estado de hitos
// que EJECUTA OBUMA, nunca los dispara.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { obtenerReparto, marcarHitoReparto, marcarHitoNoAplica, listarRespaldosHito, type HitoReparto } from '@/app/lib/compras-reparto';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { permisosCrudosDeUsuario } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { parsearMontoCL } from '@/app/lib/numeros';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

// §11 es el perfil "administración (pagos y facturación)" de §2.2: puede operar ESTE checklist
// entero aunque no sea el encargado de compras/entrega del negocio. Deliberadamente NO incluye
// `compras_bodega` — bodega solo toca la verificación dentro de EntregaCard, no esto.
async function puedeOperarReparto(userId: number, rol: string | null, asignadoA: number | null): Promise<boolean> {
  if (await puedeOperarCompras(userId, rol, asignadoA)) return true;
  // permisosCrudosDeUsuario (no permisosDeUsuario): `compras_administracion` tampoco se auto-otorga
  // por ser admin, mismo criterio del resto del módulo (10-sep-2026).
  const p = await permisosCrudosDeUsuario(userId);
  return !!p.compras_administracion;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarReparto(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const [reparto, respaldos] = await Promise.all([obtenerReparto(id), listarRespaldosHito(id)]);
    return NextResponse.json({ success: true, reparto, respaldos });
  } catch (error) {
    console.error('[compras/reparto][GET]', String(error));
    return NextResponse.json({ error: 'No se pudo cargar el proceso administrativo.' }, { status: 500 });
  }
}

const HITOS: HitoReparto[] = ['ocEmitida', 'pagoRegistrado', 'anticipoPagado', 'facturaCompraRegistrada', 'carpetaProyectoCreada', 'provisionFondos'];

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarReparto(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const contentType = request.headers.get('content-type') || '';
    let hito: HitoReparto; let activo: boolean; let noAplica: boolean; let nota: string | undefined;
    let ocNumero: any, ocMonto: any, anticipoMonto: any, carpetaProyectoId: any, provisionFondosMonto: any, cuentaOrigen: any;
    let archivoUrl: string | null = null; let archivoNombre: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      // Respaldo con archivo (pedido explícito, 14-sep-2026) — mismo patrón que cotizaciones/route.ts.
      const form = await request.formData();
      hito = String(form.get('hito') || '') as HitoReparto;
      activo = form.get('activo') === 'true';
      noAplica = form.get('noAplica') === 'true';
      nota = (form.get('nota') as string) || undefined;
      ocNumero = form.get('ocNumero'); ocMonto = form.get('ocMonto'); anticipoMonto = form.get('anticipoMonto');
      carpetaProyectoId = form.get('carpetaProyectoId'); provisionFondosMonto = form.get('provisionFondosMonto');
      cuentaOrigen = form.get('cuentaOrigen');
      const file = form.get('file') as File | null;
      if (file && file.size > 0) {
        const buffer = Buffer.from(await file.arrayBuffer());
        archivoUrl = await subirDocumentoR2(`compras/${asignacion.licitacionCodigo}/reparto`, file.name, buffer, file.type);
        archivoNombre = file.name;
      }
    } else {
      const body = await request.json();
      hito = body.hito as HitoReparto;
      activo = !!body.activo; noAplica = !!body.noAplica; nota = body.nota;
      ocNumero = body.ocNumero; ocMonto = body.ocMonto; anticipoMonto = body.anticipoMonto;
      carpetaProyectoId = body.carpetaProyectoId; provisionFondosMonto = body.provisionFondosMonto; cuentaOrigen = body.cuentaOrigen;
    }
    if (!HITOS.includes(hito)) return NextResponse.json({ error: 'Hito desconocido.' }, { status: 400 });

    if (noAplica) {
      await marcarHitoNoAplica(id, hito, nota || '', userId, nombre);
    } else {
      await marcarHitoReparto(id, hito, {
        activo, nota, archivoUrl, archivoNombre,
        // Igual que ocNumero: `undefined` (campo ni siquiera venía en la petición) significa "no
        // tocar" — distinto de "" o null, que sí limpian el monto a propósito. Si esto pasara
        // `null` cuando en realidad nadie tocó el monto, cada blur de otro campo (ej. "N° de OC")
        // lo pisaría a null en silencio.
        ocNumero, ocMonto: (ocMonto === undefined || ocMonto === null) ? undefined : parsearMontoCL(ocMonto),
        anticipoMonto, carpetaProyectoId, provisionFondosMonto, cuentaOrigen,
      }, userId, nombre);
    }

    const [reparto, respaldos] = await Promise.all([obtenerReparto(id), listarRespaldosHito(id)]);
    return NextResponse.json({ success: true, reparto, respaldos });
  } catch (error: any) {
    console.error('[compras/reparto][PATCH]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo actualizar.' }, { status: 400 });
  }
}
