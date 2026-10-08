// app/api/compras/[negocioId]/fichas/route.ts
// FICHAS TÉCNICAS EN COMPRAS (paso «3 · Fichas técnicas» de Costeo y auditoría). Ver app/lib/compras-fichas.ts.
//   GET                → panel: por producto sus proveedores, fichas y resultado contra las bases; fichas sin asignar; con error.
//   GET ?proyecto=1    → documentos del proyecto que se pueden traer como fichas (los que sube Compras).
//   POST multipart     → { file }: sube UNA ficha y la rutea sola (producto + proveedor). El cliente las sube de a una (con progreso).
//   POST json          → { accion: 'procesar_url', url, nombre } | 'asignar' | 'proveedor' | 'comparar'
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarCompras } from '@/app/api/compras/[negocioId]/route';
import { subirDocumentoR2 } from '@/app/lib/r2';
import {
  panelFichas, procesarFicha, asignarProductoDeFicha, cambiarProveedorDeOpcion, compararProducto, filaDeProductoCompra, quitarOpcionDeCompras, olvidarDocumentoDeCompras, complementarRequisito,
} from '@/app/lib/compras-fichas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Formatos que el Lector sabe leer: PDF, imágenes (OCR), Word, Excel y texto plano.
const EXTENSIONES = /\.(pdf|png|jpe?g|webp|docx?|xlsx?|txt|md|csv|tsv)$/i;

// ¿Parece una ficha técnica por su nombre? Los anexos, cotizaciones, comprobantes y planillas del proyecto NO se ofrecen como fichas.
const NO_ES_FICHA = /anexo|comprobante|cotiz|presupuesto|proforma|factura|\bfact\b|^inv[.\s_-]|costeo|propuesta|declaraci[oó]n|\bbases\b|\bacta\b|resoluci[oó]n|garant[ií]a|boleta|orden.de.compra|\boc\b|env[ií]o|contrato|merged|^ficha[ _-]?t[eé]cnica\s*\.pdf$|\.xlsx?$/i;
const PARECE_FICHA = /ficha|datasheet|data.?sheet|especificaci|cat[aá]logo|catalogo|manual|\bspec|brochure|hoja.t[eé]cnica|^\d{1,2}[_\- ]\D/i;
export const parecefichaPorNombre = (nombre: string) => !NO_ES_FICHA.test(nombre) && PARECE_FICHA.test(nombre);

type Params = { params: Promise<{ negocioId: string }> };

async function contexto(request: NextRequest, params: Params['params']) {
  const userId = request.headers.get('x-user-id') ? parseInt(request.headers.get('x-user-id')!) : null;
  const rol = request.headers.get('x-user-rol');
  const nombre = request.headers.get('x-user-nombre') || 'Usuario';
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const id = parseInt((await params).negocioId);
  const asignacion = await obtenerAsignacion(id);
  if (!asignacion) return { error: NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 }) };
  if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA))) return { error: NextResponse.json({ error: 'Sin acceso.' }, { status: 403 }) };
  return { id, codigo: asignacion.licitacionCodigo, actor: { id: userId, nombre } };
}

export async function GET(request: NextRequest, { params }: Params) {
  const c = await contexto(request, params);
  if ('error' in c) return c.error;
  try {
    if (request.nextUrl.searchParams.get('proyecto')) {
      const [rows] = await pool.query(
        `SELECT documento_nombre AS nombre, documento_url_local AS url FROM documentos_cache
          WHERE licitacion_codigo = ? AND categoria = 'DOCUMENTOS_PROPIOS' AND documento_url_local IS NOT NULL
            AND (documento_nombre LIKE '%.pdf' OR documento_nombre LIKE '%.png' OR documento_nombre LIKE '%.jpg' OR documento_nombre LIKE '%.jpeg')
          ORDER BY id DESC LIMIT 200`, [c.codigo]) as any;
      // «Ya leída» = ya pasó por ESTE panel (no por el Auditor).
      const [marcas] = await pool.query(`SELECT detalle FROM auditor_evento WHERE negocio_id = ? AND tipo = 'ficha_compras'`, [c.id]) as any;
      const ids = (marcas as any[]).map(m => Number(m.detalle)).filter(n => Number.isFinite(n) && n > 0);
      const [leidos] = ids.length
        ? await pool.query(`SELECT DISTINCT documento_url FROM auditor_extraccion WHERE id IN (?) AND error IS NULL`, [ids]) as any
        : [[]] as any;
      const yaLeidos = new Set((leidos as any[]).map(r => r.documento_url));
      return NextResponse.json({ success: true, documentos: (rows as any[]).map(r => ({ nombre: r.nombre, url: r.url, yaLeido: yaLeidos.has(r.url), parece: parecefichaPorNombre(String(r.nombre)) })) });
    }
    return NextResponse.json({ success: true, panel: await panelFichas(c.id, c.codigo) });
  } catch (e: any) {
    console.error('[compras/fichas][GET]', String(e));
    return NextResponse.json({ error: e?.message || 'No se pudieron cargar las fichas.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const c = await contexto(request, params);
  if ('error' in c) return c.error;
  try {
    if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file') as File | null;
      if (!file) return NextResponse.json({ error: 'Falta el archivo.' }, { status: 400 });
      if (!EXTENSIONES.test(file.name)) return NextResponse.json({ error: 'Formato no soportado. Sube PDF, imagen (PNG/JPG), Word, Excel o texto (TXT).' }, { status: 400 });
      const url = await subirDocumentoR2(`compras/${c.codigo}/fichas`, file.name, Buffer.from(await file.arrayBuffer()), file.type);
      return NextResponse.json({ success: true, resultado: await procesarFicha({ negocioId: c.id, url, nombre: file.name, actor: c.actor }) });
    }
    const body = await request.json();
    switch (body.accion) {
      case 'procesar_url': {
        if (!body.url || !body.nombre) return NextResponse.json({ error: 'Falta el documento.' }, { status: 400 });
        return NextResponse.json({ success: true, resultado: await procesarFicha({ negocioId: c.id, url: String(body.url), nombre: String(body.nombre), actor: c.actor }) });
      }
      case 'texto': {
        // Ficha pegada como texto (p. ej. copiada de la web del fabricante): se guarda como .txt y se procesa igual.
        const texto = String(body.texto || '').trim();
        if (texto.length < 40) return NextResponse.json({ error: 'El texto es muy corto para ser una ficha técnica.' }, { status: 400 });
        const base = String(body.nombre || 'ficha-pegada').replace(/[^\w\- áéíóúñÁÉÍÓÚÑ.]/g, '').trim().slice(0, 80) || 'ficha-pegada';
        const nombre = /\.txt$/i.test(base) ? base : `${base}.txt`;
        const url = await subirDocumentoR2(`compras/${c.codigo}/fichas`, nombre, Buffer.from(texto, 'utf8'), 'text/plain');
        return NextResponse.json({ success: true, resultado: await procesarFicha({ negocioId: c.id, url, nombre, actor: c.actor }) });
      }
      case 'asignar': {
        const filaId = await filaDeProductoCompra(c.id, Number(body.productoCompraId));
        if (!filaId) return NextResponse.json({ error: 'Ese producto no tiene línea en el Costeo.' }, { status: 400 });
        const r = await asignarProductoDeFicha({ negocioId: c.id, extraccionId: Number(body.extraccionId), productoIdx: Number(body.productoIdx), filaId, proveedor: body.proveedor || null, actor: c.actor });
        return r.ok ? NextResponse.json({ success: true, resultado: r }) : NextResponse.json({ error: r.error || 'No se pudo asignar.' }, { status: 400 });
      }
      case 'complementar': {
        const resultado = body.resultado === 'CUMPLE' || body.resultado === 'NO_CUMPLE' ? body.resultado : null;
        await complementarRequisito({ negocioId: c.id, opcionId: Number(body.opcionId), n: Number(body.n), resultado, dato: String(body.dato || ''), fuente: String(body.fuente || ''), actor: c.actor });
        return NextResponse.json({ success: true });
      }
      case 'quitar_modelo': {
        await quitarOpcionDeCompras(c.id, Number(body.opcionId));
        return NextResponse.json({ success: true });
      }
      case 'olvidar_documento': {
        await olvidarDocumentoDeCompras(c.id, Number(body.extraccionId));
        return NextResponse.json({ success: true });
      }
      case 'proveedor': {
        await cambiarProveedorDeOpcion(c.id, Number(body.opcionId), body.proveedor ? String(body.proveedor) : null);
        return NextResponse.json({ success: true });
      }
      case 'comparar': {
        const r = await compararProducto({ negocioId: c.id, licitacionCodigo: c.codigo, productoCompraId: Number(body.productoCompraId), actor: c.actor });
        return NextResponse.json({ success: true, resultado: r });
      }
      default:
        return NextResponse.json({ error: 'Acción desconocida.' }, { status: 400 });
    }
  } catch (e: any) {
    console.error('[compras/fichas][POST]', String(e));
    return NextResponse.json({ error: e?.message || 'No se pudo completar la acción.' }, { status: 400 });
  }
}
