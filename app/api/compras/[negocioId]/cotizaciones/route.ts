// app/api/compras/[negocioId]/cotizaciones/route.ts
// Bandeja de carga de cotizaciones del Auditor de Compras (spec §8.2-§8.4): "todos los formatos
// posibles. PDF, imagen, captura de WhatsApp, texto pegado, correo, registro manual de llamada."
// Sin límite de proveedores (§8.2). POST admite multipart (con archivo) o JSON (registro manual
// sin archivo, ej. cotización telefónica).
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion, cambiarSubestadoProducto } from '@/app/lib/compras';
import { listarAuditoriasNegocio, costeadoPorProducto } from '@/app/lib/compras-auditoria-cotizacion';
import { registrarCotizacion, listarCotizaciones, type DatosCotizacion, type OrigenCotizacion } from '@/app/lib/compras-auditor';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { extraerDatosCotizacionDeDocumento } from '@/app/lib/compras-cotizacion-ocr';
import { parsearMontoCL } from '@/app/lib/numeros';
import { fusionarDirectasDelNegocio } from '@/app/lib/compras-directas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  const nombre = req.headers.get('x-user-nombre');
  return { id: id ? parseInt(id) : null, rol, nombre };
}

const ORIGENES: OrigenCotizacion[] = ['pdf', 'imagen', 'whatsapp', 'texto', 'correo', 'llamada', 'directa'];

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

    const [cotizaciones, auditorias, costeado] = await Promise.all([listarCotizaciones(id), listarAuditoriasNegocio(id).catch(() => []), costeadoPorProducto(id).catch(() => ({}))]);
    return NextResponse.json({ success: true, cotizaciones, auditorias, costeado });
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
        descuentoPct: parsearMontoCL(form.get('descuentoPct') as string),
        plazoEntregaTexto: (form.get('plazoEntregaTexto') as string) || null,
        plazoEntregaDias: form.get('plazoEntregaDias') ? Number(form.get('plazoEntregaDias')) : null,
        incluyeFlete: form.get('incluyeFlete') == null ? null : form.get('incluyeFlete') === 'true',
        ivaIncluido: form.get('ivaIncluido') === 'true' ? true : null,
        vigenciaAt: (form.get('vigenciaAt') as string) || null,
        fleteMonto: parsearMontoCL(form.get('fleteMonto') as string),
        despachoModalidad: (form.get('despachoModalidad') as string) || null,
        fleteCondicion: (form.get('fleteCondicion') as string) || null,
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
        // Un fallo pasajero del proveedor de IA (429, timeout) dejaba la cotización sin leer; se reintenta una vez antes de rendirse.
        let extraido = await extraerDatosCotizacionDeDocumento(archivoUrl, buffer, file!.type).catch(() => null);
        if (!extraido) {
          await new Promise(r => setTimeout(r, 4000));
          extraido = await extraerDatosCotizacionDeDocumento(archivoUrl, buffer, file!.type).catch(() => null);
        }
        if (extraido) {
          if (!datos.proveedorNombre && !datos.proveedorId && extraido.proveedorNombre) datos.proveedorNombre = extraido.proveedorNombre;
          if (!datos.proveedorRut && extraido.proveedorRut) datos.proveedorRut = extraido.proveedorRut;
          // El IVA incluido solo se descuenta de precios que vienen del DOCUMENTO: lo tipeado a mano no se toca.
          if (datos.precioUnitario == null && extraido.precioUnitario != null) { datos.precioUnitario = extraido.precioUnitario; if (extraido.ivaIncluido) datos.ivaIncluido = true; }
          if (datos.precioTotal == null && extraido.precioTotal != null) { datos.precioTotal = extraido.precioTotal; if (extraido.ivaIncluido) datos.ivaIncluido = true; }
          if (!datos.vigenciaAt && extraido.vigenciaAt) datos.vigenciaAt = extraido.vigenciaAt;
          if (datos.incluyeFlete == null && extraido.incluyeFlete != null && datos.fleteMonto == null && extraido.fleteMonto == null) datos.incluyeFlete = extraido.incluyeFlete;
          if (datos.descuentoPct == null && extraido.descuentoPct != null) datos.descuentoPct = extraido.descuentoPct;
          if (datos.fleteMonto == null && extraido.fleteMonto != null) datos.fleteMonto = extraido.fleteMonto;
          if (!datos.moneda && extraido.moneda) {
            // La IA devuelve la moneda en texto libre ("DOLAR", "USD", "EURO", "pesos chilenos"...)
            // — se normaliza a los códigos que el sistema sabe convertir (app/lib/tipo-cambio.ts).
            // BUG REAL (15-sep-2026, cotización de un proveedor italiano): esto solo reconocía
            // USD/dólar y forzaba cualquier otra moneda a CLP — una cotización en euros se guardaba
            // como si fuera pesos chilenos, sin convertir nada.
            const m = extraido.moneda.toUpperCase();
            datos.moneda = m.includes('USD') || m.includes('DOLAR') || m.includes('DÓLAR') ? 'USD'
              : m.includes('EUR') || m.includes('€') ? 'EUR'
              : 'CLP';
          }
          if (!datos.plazoEntregaTexto && extraido.plazoEntregaTexto) datos.plazoEntregaTexto = extraido.plazoEntregaTexto;
          if (!datos.direccionBodega && extraido.direccionBodega) datos.direccionBodega = extraido.direccionBodega;
          if (!datos.notas && extraido.notasAdicionales?.length) datos.notas = extraido.notasAdicionales.join(' · ');
          // Cotizaciones de VARIOS ítems (§8.6-§8.8): sin esto, un PDF de 30 líneas solo dejaba
          // "el producto principal" — el resto quedaba sin homologar porque homologarCotizacionIA
          // lee `descripcionLibre`, y esa quedaba vacía si el usuario no la retipeaba a mano.
          if (!datos.descripcionLibre && extraido.textoCompleto) datos.descripcionLibre = extraido.textoCompleto;
          if (extraido.avisosLectura?.length) datos.notas = [datos.notas, `Lectura: ${extraido.avisosLectura.join(' ')}`].filter(Boolean).join(' · ');
        }
      }
    } else {
      const body = await request.json();
      datos = { ...body, origen: ORIGENES.includes(body.origen) ? body.origen : 'llamada' };
      if (Array.isArray(body.items)) datos.itemsManual = body.items;
    }

    // Subir un archivo NUNCA debe perderlo: si la lectura no encontró al proveedor, se guarda igual con un nombre provisorio
    // (el del archivo) y un aviso en las notas, para completarlo a mano. Antes respondía 400 y la cotización desaparecía.
    if (!datos.proveedorNombre && !datos.proveedorId && datos.archivoNombre) {
      datos.proveedorNombre = `(por completar) ${datos.archivoNombre.replace(/\.[a-z0-9]{2,4}$/i, '')}`.slice(0, 120);
      datos.notas = [datos.notas, 'No se pudo leer el proveedor del documento: complétalo con «Editar datos».'].filter(Boolean).join(' · ');
    }
    if (!datos.proveedorNombre && !datos.proveedorId) return NextResponse.json({ error: 'Falta el proveedor.' }, { status: 400 });
    if (!datos.proveedorNombre) datos.proveedorNombre = '(proveedor del catálogo)'; // se sobreescribe con la ficha real en registrarCotizacion

    let cotizacionId = await registrarCotizacion(id, datos, userId, nombre);
    // Compras directas del mismo proveedor (mismo RUT o nombre) van en UNA sola cotización/columna de la matriz.
    if (datos.origen === 'directa') cotizacionId = (await fusionarDirectasDelNegocio(id).catch(() => new Map<number, number>())).get(cotizacionId) ?? cotizacionId;
    // Una compra directa es una decisión ya tomada (ferretería, retail): el producto pasa solo de «Cotizando» a «Comprado».
    // En la pantalla de «Tu compra» queda preseleccionado ese proveedor (ver AuditorComprasCard). Si hubo que corregirlo, se
    // cambia a mano en el estado del producto.
    if (datos.origen === 'directa' && Array.isArray(datos.itemsManual)) {
      for (const it of datos.itemsManual) {
        await cambiarSubestadoProducto(Number(it.productoId), 'COMPRADO').catch(e => console.warn('[compras/cotizaciones] compra directa: no se pudo marcar Comprado:', String(e).slice(0, 120)));
      }
    }
    return NextResponse.json({ success: true, id: cotizacionId });
  } catch (error: any) {
    console.error('[compras/cotizaciones][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo registrar la cotización.' }, { status: 500 });
  }
}
