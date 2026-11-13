// app/api/compras/[negocioId]/guia-despacho-obuma/route.ts
// SOLO negocios de Inversiones Claro (la única empresa con Obuma). GET = OC del negocio que sirven de base para la guía.
// POST {folioOc, preciosManual?, datos?, enviar?, permitirRepetida?}: arma el BORRADOR (productos de la OC de Obuma, precios de VENTA
// del costeo, cliente de la OC de Mercado Público, bodega, transporte) y el JSON exacto que iría a Obuma. Con enviar=true lo crea de verdad
// en Obuma (ventasIntegracionExternas.create.json, tipo 52 → se emite al SII), salvo OBUMA_SIMULAR=1.
import { mensajeSeguro } from '@/app/lib/errores-api';
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarReparto } from '@/app/api/compras/[negocioId]/reparto/route';
import {
  armarGuiaDesdeOcObuma, armarDocumentoGuia, crearGuiaDespachoObuma, datosSugeridosGuia, guiasDelNegocio, negocioEsDeClaro, ocsParaGuia, type DatosGuia,
} from '@/app/lib/compras-guia-despacho-obuma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

async function acceso(request: NextRequest, negocioId: string) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt(negocioId);
  if (!Number.isFinite(id)) return { error: NextResponse.json({ error: 'negocioId inválido' }, { status: 400 }) };
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  if (!(await puedeOperarReparto(userId, request.headers.get('x-user-rol'), asignacion.asignadoA, asignacion.coencargados)))
    return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  if (!(await negocioEsDeClaro(id))) return { error: NextResponse.json({ error: 'Las guías de despacho solo están disponibles para Inversiones Claro.' }, { status: 403 }) };
  return { id, userId };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    // ?guias=1 → guías ya emitidas en Obuma para este negocio, con PDF y estado SII (consulta aparte: es la más lenta).
    if (request.nextUrl.searchParams.get('guias') === '1') return NextResponse.json({ success: true, guias: await guiasDelNegocio(a.id) });
    return NextResponse.json({ success: true, ocs: await ocsParaGuia(a.id), simulando: process.env.OBUMA_SIMULAR === '1' });
  } catch (error) {
    console.error('[compras/guia-despacho-obuma][GET]', String(error));
    return NextResponse.json({ error: mensajeSeguro(error, 'No se pudieron cargar las órdenes de compra.') }, { status: 500 });
  }
}

const texto = (v: unknown) => (v == null ? '' : String(v)).slice(0, 300);

/** Datos del borrador que llegan del navegador: solo los campos conocidos, como texto/número. */
function leerDatos(b: any): DatosGuia | null {
  if (!b || typeof b !== 'object') return null;
  return {
    clienteRut: texto(b.clienteRut), clienteRazonSocial: texto(b.clienteRazonSocial), clienteGiro: texto(b.clienteGiro),
    clienteDireccion: texto(b.clienteDireccion), clienteComuna: texto(b.clienteComuna), clienteRegion: texto(b.clienteRegion),
    clienteEmail: texto(b.clienteEmail), clienteTelefono: texto(b.clienteTelefono), clienteContacto: texto(b.clienteContacto),
    direccionDespacho: texto(b.direccionDespacho), bodegaCodigo: texto(b.bodegaCodigo),
    tipoTraslado: [1, 2, 3, 4, 5, 6, 7].includes(Number(b.tipoTraslado)) ? Number(b.tipoTraslado) : 1,
    tipoDespacho: [1, 2, 3].includes(Number(b.tipoDespacho)) ? Number(b.tipoDespacho) : 2,
    choferRut: texto(b.choferRut), choferNombre: texto(b.choferNombre), patente: texto(b.patente),
    rebajarStock: b.rebajarStock === true, observacion: texto(b.observacion),
  };
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const a = await acceso(request, (await params).negocioId);
    if ('error' in a) return a.error;
    const body = await request.json().catch(() => ({}));
    const preciosManual = body?.preciosManual && typeof body.preciosManual === 'object' ? body.preciosManual : {};
    const guia = await armarGuiaDesdeOcObuma(a.id, String(body?.folioOc || ''), preciosManual);
    const sugeridos = await datosSugeridosGuia(a.id);
    const datos = leerDatos(body?.datos) ?? sugeridos.datos;
    const { doc, faltan, clienteEnObuma } = await armarDocumentoGuia(a.id, guia, datos);

    let envio = null;
    if (body?.enviar === true) {
      if (faltan.length) return NextResponse.json({ error: `Falta: ${faltan.join(', ')}.` }, { status: 400 });
      envio = await crearGuiaDespachoObuma(doc, body?.permitirRepetida === true);
      console.warn(`[compras/guia-despacho-obuma] guía ${envio.simulada ? 'SIMULADA' : 'CREADA'} folio=${envio.folio} negocio=${a.id} oc=${guia.folioOc} usuario=${a.userId}`);
    }
    return NextResponse.json({ success: true, guia, datos, bodegas: sugeridos.bodegas, avisos: sugeridos.avisos, doc, faltan, clienteEnObuma, envio });
  } catch (error: any) {
    console.error('[compras/guia-despacho-obuma][POST]', String(error));
    const repetida = String(error?.message || '').startsWith('REPETIDA: ');
    return NextResponse.json(
      { error: repetida ? String(error.message).slice(10) : mensajeSeguro(error, 'No se pudo armar la guía de despacho.'), repetida },
      { status: repetida ? 409 : 500 },
    );
  }
}
