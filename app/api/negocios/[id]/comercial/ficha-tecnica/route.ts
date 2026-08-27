// app/api/negocios/[id]/comercial/ficha-tecnica/route.ts
// Genera NUESTRA ficha técnica: el documento que presentamos, armado desde las exigencias que el
// Auditor ya tiene clasificadas por línea. Ver app/lib/ficha-tecnica.ts para el porqué.
//
//   POST { lineas?: number[] } → arma el PDF, lo sube a R2 y devuelve su URL.
//
// Se sube a R2 en vez de devolver el binario porque así el visor inline y la descarga con nombre
// real funcionan igual que con el resto de los documentos del negocio (el `download` de un <a> no
// aplica cross-origin: el nombre lo tiene que poner el Content-Disposition del propio objeto).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';
import { publicarCambio } from '@/app/lib/sse-bus';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { generarInformePdf } from '@/app/lib/generar-informe';
import { leerLineasOfertadas } from '@/app/lib/lineas-oferta';
import { cargarNegocio, nombreDe, leerInforme } from '../route';
import { lineasTecnicasDelInforme, productosCrudosDeLinea } from '@/app/lib/auditor-tecnico-core';
import { leerProductosDeLinea } from '@/app/lib/producto-ofertado-db';
import {
  construirFichaTecnicaHtml, especificacionesSinCompletar,
  type LineaFicha, type EspecificacionFicha, type EmpresaFicha, type ProductoOfertadoLinea,
} from '@/app/lib/ficha-tecnica';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Descarga una imagen de R2 y la devuelve como data: URI.
 *
 * generarInformePdf carga el HTML con setContent y SIN recursos externos, así que un
 * `<img src="https://…">` no se resolvería (o dependería de que chromium alcance la red desde el
 * contenedor, que es justo la clase de fallo silencioso que deja el PDF sin logo y sin avisar).
 * Si la imagen no se puede bajar se devuelve null y el documento sale sin ella: mejor una ficha
 * sin logo que ninguna ficha.
 */
async function comoDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 4_000_000) return null;   // un logo de 4 MB es un error de carga
    const tipo = r.headers.get('content-type') || 'image/png';
    if (!tipo.startsWith('image/')) return null;
    return `data:${tipo};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

export async function POST(request: NextRequest, { params }: Params) {
  const userId = request.headers.get('x-user-id') ? Number(request.headers.get('x-user-id')) : null;
  const rol = request.headers.get('x-user-rol');
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const negocio = await cargarNegocio(id);
    if (!negocio) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });
    if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
    if (!negocio.empresa_id)
      return NextResponse.json({ error: 'Primero elige con qué empresa se postula: la ficha lleva sus datos, logo y firma.' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const pedidas: number[] = Array.isArray(body?.lineas)
      ? body.lineas.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
      : [];

    // Qué líneas entran: las que pidió el usuario; si no pidió, las que se ofertan; si tampoco hay
    // decisión, todas. Mismo criterio fail-open del resto del módulo.
    const ofertadas = await leerLineasOfertadas(negocio.id);
    const filtro = pedidas.length ? pedidas : (ofertadas || []);

    const [itemRows] = await pool.query(
      `SELECT id, linea_numero, titulo FROM checklist_comercial
        WHERE negocio_id = ? AND tipo = 'linea_tecnica' AND (ofertamos IS NULL OR ofertamos = 1)
          ${filtro.length ? 'AND linea_numero IN (?)' : ''}
        ORDER BY linea_numero`,
      filtro.length ? [negocio.id, filtro] : [negocio.id],
    ) as any;
    const items = itemRows as Array<{ id: number; linea_numero: number | null; titulo: string }>;
    if (!items.length)
      return NextResponse.json({ error: 'No hay líneas técnicas para incluir en la ficha.' }, { status: 400 });

    // Las especificaciones, de una sola consulta para todas las líneas.
    const [carRows] = await pool.query(
      `SELECT item_id, descripcion, tipo, valor_requerido_texto, valor_requerido_numero,
              valor_requerido_numero_max, unidad_requerida, valor_ofertado_texto,
              valor_ofertado_numero, unidad_ofertada_original
         FROM checklist_comercial_caracteristicas
        WHERE negocio_id = ? AND item_id IN (?)
        ORDER BY item_id, orden, id`,
      [negocio.id, items.map(i => i.id)],
    ) as any;
    const porItem = new Map<number, EspecificacionFicha[]>();
    for (const r of carRows as any[]) {
      if (!porItem.has(r.item_id)) porItem.set(r.item_id, []);
      porItem.get(r.item_id)!.push({
        descripcion: String(r.descripcion || ''),
        tipo: r.tipo ?? null,
        valorRequeridoTexto: r.valor_requerido_texto ?? null,
        valorRequeridoNumero: r.valor_requerido_numero == null ? null : Number(r.valor_requerido_numero),
        valorRequeridoNumeroMax: r.valor_requerido_numero_max == null ? null : Number(r.valor_requerido_numero_max),
        unidadRequerida: r.unidad_requerida ?? null,
        valorOfertadoTexto: r.valor_ofertado_texto ?? null,
        valorOfertadoNumero: r.valor_ofertado_numero == null ? null : Number(r.valor_ofertado_numero),
        unidadOfertada: r.unidad_ofertada_original ?? null,
      });
    }

    // Cantidad/unidad por línea: del checklist comercial (el precio de esa línea las trae).
    const [cantRows] = await pool.query(
      `SELECT linea_numero, descripcion FROM checklist_comercial
        WHERE negocio_id = ? AND tipo = 'precio' AND linea_numero IS NOT NULL`,
      [negocio.id],
    ) as any;
    const descPorLinea = new Map<number, string>(
      (cantRows as any[]).map(r => [Number(r.linea_numero), String(r.descripcion || '')]),
    );

    // RESPALDO: las exigencias del INFORME cuando la línea todavía no tiene características
    // clasificadas en BD.
    //
    // BUG REAL (26-ago-2026, 1057922-23-LE26): la ficha leía SOLO
    // checklist_comercial_caracteristicas, y esa tabla se llena recién cuando alguien aprieta
    // "Validar línea" o corre la comparación masiva (sincronizar() no gasta IA en el GET, a
    // propósito). En un negocio donde todavía nadie validó nada, la ficha salía con el producto y
    // NINGUNA especificación — justo el documento que se quería tener ANTES de cargar la ficha del
    // proveedor, o sea el caso normal de uso.
    //
    // Las exigencias ya están en el informe (`lineasTecnicasDelInforme` → `caracteristicas`),
    // solo que como texto suelto sin clasificar en PISO/TECHO/EXACTO/RANGO. Para la ficha alcanza:
    // la columna es texto y se transcribe tal cual, una fila por especificación.
    const informeFicha = await leerInforme(negocio.licitacion_codigo);
    const delInforme = new Map<number, string[]>();
    if (informeFicha) {
      for (const l of lineasTecnicasDelInforme(informeFicha)) delInforme.set(l.linea, l.caracteristicas);
    }

    // Marca/modelo/fabricante/foto por PRODUCTO de cada línea (producto-ofertado.ts / migración
    // 79, 82) — una línea normal trae un solo producto; una línea-paquete (caso real
    // 2446-240-LE26: "Hidrolavadora H300" + "Vacuolavadora DB51 Dimer" en la misma línea de
    // precio) trae varios, cada uno con su propia identidad.
    const productosPorItem = new Map<number, ProductoOfertadoLinea[]>();
    await Promise.all(items.map(async i => {
      const nombres = i.linea_numero != null && informeFicha
        ? productosCrudosDeLinea(informeFicha, i.linea_numero).map(p => p.nombre)
        : [];
      const productos = await leerProductosDeLinea(i.id, nombres).catch(() => []);
      productosPorItem.set(i.id, await Promise.all(productos.map(async ({ nombre, ofertado }) => ({
        nombre,
        marca: ofertado?.marca ?? null, modelo: ofertado?.modelo ?? null, fabricante: ofertado?.fabricante ?? null,
        paisFabricacion: ofertado?.paisFabricacion ?? null, anioFabricacion: ofertado?.anioFabricacion ?? null,
        garantiaMeses: ofertado?.garantiaMeses ?? null, confirmado: ofertado?.confirmadoPor != null,
        imagenDataUri: await comoDataUri(ofertado?.imagenUrl ?? null), imagenConfirmada: ofertado?.imagenConfirmada ?? false,
      }))));
    }));

    const lineas: LineaFicha[] = items.map(i => {
      const desc = i.linea_numero != null ? descPorLinea.get(i.linea_numero) || '' : '';
      const m = /Cantidad:\s*([\d.,]+)\s*(\S+)?/i.exec(desc);
      const guardadas = porItem.get(i.id) || [];
      const especificaciones = guardadas.length
        ? guardadas
        : (i.linea_numero != null ? delInforme.get(i.linea_numero) || [] : []).map(texto => ({
            // El texto del informe ES la exigencia completa; no se parte ni se reinterpreta.
            descripcion: texto, tipo: null,
            valorRequeridoTexto: null, valorRequeridoNumero: null, valorRequeridoNumeroMax: null,
            unidadRequerida: null, valorOfertadoTexto: null, valorOfertadoNumero: null,
            unidadOfertada: null,
          } as EspecificacionFicha));
      return {
        linea: i.linea_numero,
        titulo: String(i.titulo).replace(/^L[íi]nea\s+\d+\s*[—–-]\s*/i, '').trim(),
        cantidad: m ? Number(String(m[1]).replace(/\./g, '').replace(',', '.')) || null : null,
        unidad: m?.[2] || null,
        especificaciones,
        productosOfertados: productosPorItem.get(i.id) ?? [],
      };
    });

    const [empRows] = await pool.query(
      `SELECT razon_social, rut, giro, direccion, email1, telefono1, representante_nombre,
              representante_rut, representante_cargo, logo_url, firma_url, timbre_url
         FROM empresas WHERE id = ? LIMIT 1`,
      [negocio.empresa_id],
    ) as any;
    const emp = (empRows as any[])[0];
    if (!emp) return NextResponse.json({ error: 'No se encontró la empresa del negocio.' }, { status: 400 });

    const [logoDataUri, firmaDataUri, timbreDataUri] = await Promise.all([
      comoDataUri(emp.logo_url), comoDataUri(emp.firma_url), comoDataUri(emp.timbre_url),
    ]);

    const empresa: EmpresaFicha = {
      razonSocial: String(emp.razon_social || ''),
      rut: emp.rut ?? null, giro: emp.giro ?? null, direccion: emp.direccion ?? null,
      email: emp.email1 ?? null, telefono: emp.telefono1 ?? null,
      representanteNombre: emp.representante_nombre ?? null,
      representanteRut: emp.representante_rut ?? null,
      representanteCargo: emp.representante_cargo ?? null,
      logoDataUri, firmaDataUri, timbreDataUri,
    };

    const generadoPor = request.headers.get('x-user-nombre') || (await nombreDe(userId)) || null;
    const html = construirFichaTecnicaHtml({
      licitacionCodigo: negocio.licitacion_codigo,
      licitacionNombre: negocio.licitacion_nombre ?? null,
      organismo: negocio.licitacion_organismo ?? null,
      empresa, lineas, generadoPor,
      fechaTexto: new Date().toLocaleDateString('es-CL', {
        timeZone: 'America/Santiago', day: '2-digit', month: 'long', year: 'numeric',
      }),
    });

    const pdf = await generarInformePdf(html);
    const nombre = `FICHA_TECNICA_${negocio.licitacion_codigo}.pdf`;
    const url = await subirDocumentoR2(negocio.licitacion_codigo, nombre, pdf, 'application/pdf');

    publicarCambio('checklist_comercial');
    return NextResponse.json({
      success: true, url, nombre,
      lineas: lineas.length,
      // Se devuelve para que la pantalla avise ANTES de presentar: una casilla en blanco es una
      // casilla que hay que completar a mano, no un detalle estético.
      sinCompletar: especificacionesSinCompletar(lineas),
    });
  } catch (e: any) {
    console.error('[ficha-tecnica]', String(e));
    return NextResponse.json({ error: e?.message || 'No se pudo generar la ficha' }, { status: 500 });
  }
}
