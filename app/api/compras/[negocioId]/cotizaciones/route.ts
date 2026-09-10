// app/api/compras/[negocioId]/cotizaciones/route.ts
// Bandeja de carga de cotizaciones del Auditor de Compras (spec §8.2-§8.4): "todos los formatos
// posibles. PDF, imagen, captura de WhatsApp, texto pegado, correo, registro manual de llamada."
// Sin límite de proveedores (§8.2). POST admite multipart (con archivo) o JSON (registro manual
// sin archivo, ej. cotización telefónica).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { registrarCotizacion, listarCotizaciones, type DatosCotizacion, type OrigenCotizacion } from '@/app/lib/compras-auditor';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { extraerDatosCotizacionDeDocumento } from '@/app/lib/compras-cotizacion-ocr';
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

const ORIGENES: OrigenCotizacion[] = ['pdf', 'imagen', 'whatsapp', 'texto', 'correo', 'llamada'];

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const cotizaciones = await listarCotizaciones(id);
    return NextResponse.json({ success: true, cotizaciones });
  } catch (error) {
    console.error('[compras/cotizaciones][GET]', String(error));
    return NextResponse.json({ error: 'No se pudieron cargar las cotizaciones.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const contentType = request.headers.get('content-type') || '';
    let datos: DatosCotizacion;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file') as File | null;
      let archivoUrl: string | null = null, archivoNombre: string | null = null, buffer: Buffer | null = null;
      if (file) {
        buffer = Buffer.from(await file.arrayBuffer());
        archivoUrl = await subirDocumentoR2(`compras/${asignacion.licitacionCodigo}`, file.name, buffer, file.type);
        archivoNombre = file.name;
      }
      const origen = String(form.get('origen') || 'texto') as OrigenCotizacion;
      datos = {
        proveedorNombre: String(form.get('proveedorNombre') || '').trim(),
        proveedorRut: (form.get('proveedorRut') as string) || null,
        proveedorId: form.get('proveedorId') ? Number(form.get('proveedorId')) : null,
        origen: ORIGENES.includes(origen) ? origen : 'texto',
        descripcionLibre: (form.get('descripcionLibre') as string) || null,
        // Formato chileno ("6.745.621", con puntos de miles) — Number() directo sobre eso da NaN,
        // que después revienta la consulta SQL (ver app/lib/numeros.ts). parsearMontoCL entiende
        // el formato y nunca devuelve NaN.
        precioUnitario: parsearMontoCL(form.get('precioUnitario') as string),
        precioTotal: parsearMontoCL(form.get('precioTotal') as string),
        plazoEntregaTexto: (form.get('plazoEntregaTexto') as string) || null,
        plazoEntregaDias: form.get('plazoEntregaDias') ? Number(form.get('plazoEntregaDias')) : null,
        incluyeFlete: form.get('incluyeFlete') == null ? null : form.get('incluyeFlete') === 'true',
        direccionBodega: (form.get('direccionBodega') as string) || null,
        archivoUrl, archivoNombre,
        notas: (form.get('notas') as string) || null,
      };

      // Multi-ítem al crear (§8.7): el checklist de productos del formulario viaja como JSON en un
      // solo campo de FormData. Si viene mal formado, se ignora y sigue el flujo de precio único.
      const itemsRaw = form.get('items') as string | null;
      if (itemsRaw) {
        try {
          const parsed = JSON.parse(itemsRaw);
          if (Array.isArray(parsed)) datos.itemsManual = parsed;
        } catch { /* payload de items mal formado — se ignora */ }
      }

      // §8.2 — lee el documento y PROPONE lo que el usuario dejó vacío. Nunca pisa lo tipeado a
      // mano (mismo criterio que "la ficha del catálogo manda" en registrarCotizacion) y, si el
      // OCR/IA no extrae nada con certeza, no cambia nada (extraerDatosCotizacionDeDocumento
      // devuelve null en ese caso — no inventa).
      if (buffer && archivoUrl) {
        const extraido = await extraerDatosCotizacionDeDocumento(archivoUrl, buffer, file!.type).catch(() => null);
        if (extraido) {
          if (!datos.proveedorNombre && !datos.proveedorId && extraido.proveedorNombre) datos.proveedorNombre = extraido.proveedorNombre;
          if (!datos.proveedorRut && extraido.proveedorRut) datos.proveedorRut = extraido.proveedorRut;
          if (datos.precioUnitario == null && extraido.precioUnitario != null) datos.precioUnitario = extraido.precioUnitario;
          if (datos.precioTotal == null && extraido.precioTotal != null) datos.precioTotal = extraido.precioTotal;
          if (!datos.moneda && extraido.moneda) {
            // La IA devuelve la moneda en texto libre ("DOLAR", "USD", "pesos chilenos"...) —
            // se normaliza a los únicos dos códigos que el sistema resuelve (§ tipo de cambio).
            const m = extraido.moneda.toUpperCase();
            datos.moneda = m.includes('USD') || m.includes('DOLAR') || m.includes('DÓLAR') ? 'USD' : 'CLP';
          }
          if (!datos.plazoEntregaTexto && extraido.plazoEntregaTexto) datos.plazoEntregaTexto = extraido.plazoEntregaTexto;
          if (!datos.direccionBodega && extraido.direccionBodega) datos.direccionBodega = extraido.direccionBodega;
          if (!datos.notas && extraido.notas) datos.notas = extraido.notas;
          // Cotizaciones de VARIOS ítems (§8.6-§8.8): sin esto, un PDF de 30 líneas solo dejaba
          // "el producto principal" — el resto quedaba sin homologar porque homologarCotizacionIA
          // lee `descripcionLibre`, y esa quedaba vacía si el usuario no la retipeaba a mano.
          if (!datos.descripcionLibre && extraido.textoCompleto) datos.descripcionLibre = extraido.textoCompleto;
        }
      }
    } else {
      const body = await request.json();
      datos = { ...body, origen: ORIGENES.includes(body.origen) ? body.origen : 'llamada' };
      if (Array.isArray(body.items)) datos.itemsManual = body.items;
    }

    if (!datos.proveedorNombre && !datos.proveedorId) return NextResponse.json({ error: 'Falta el proveedor.' }, { status: 400 });
    if (!datos.proveedorNombre) datos.proveedorNombre = '(proveedor del catálogo)'; // se sobreescribe con la ficha real en registrarCotizacion

    const cotizacionId = await registrarCotizacion(id, datos, userId, nombre);
    return NextResponse.json({ success: true, id: cotizacionId });
  } catch (error: any) {
    console.error('[compras/cotizaciones][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo registrar la cotización.' }, { status: 500 });
  }
}
