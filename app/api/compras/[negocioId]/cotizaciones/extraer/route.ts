// app/api/compras/[negocioId]/cotizaciones/extraer/route.ts
// LECTURA DEL DOCUMENTO ANTES DE GUARDAR (pedido explícito del usuario, 11-sep-2026): la extracción
// (spec §8.2) ya existía, pero solo corría en silencio dentro de POST /cotizaciones al apretar
// "Guardar" — el encargado nunca veía qué se leyó hasta que la cotización ya estaba guardada. Este
// endpoint sube el archivo y extrae los campos de una vez, apenas se elige el archivo en pantalla,
// para que el formulario se autocomplete y la persona pueda revisar/corregir ANTES de confirmar —
// mismo criterio que el preview de costo en Aprobaciones/SKU. No crea ninguna cotización.
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { extraerDatosCotizacionDeDocumento } from '@/app/lib/compras-cotizacion-ocr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { negocioId } = await params;
  const id = parseInt(negocioId);

  try {
    const asignacion = await obtenerAsignacion(id);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA)))
      return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });

    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Falta el archivo.' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const archivoUrl = await subirDocumentoR2(`compras/${asignacion.licitacionCodigo}`, file.name, buffer, file.type);

    const extraido = await extraerDatosCotizacionDeDocumento(archivoUrl, buffer, file.type).catch(() => null);
    return NextResponse.json({ success: true, archivoUrl, archivoNombre: file.name, extraido });
  } catch (error: any) {
    console.error('[compras/cotizaciones/extraer][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo leer el documento.' }, { status: 500 });
  }
}
