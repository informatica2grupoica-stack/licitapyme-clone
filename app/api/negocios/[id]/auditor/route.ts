// app/api/negocios/[id]/auditor/route.ts
// AUDITOR unificado de la licitación (pestaña "Compra" del ítem Auditor): opciones por línea, lectura de
// las cotizaciones de Documentos con el Lector (Prompt 6), verificación por código y firma → aprobación.
// Lógica en app/lib/auditor-opciones.ts. Mismo acceso que el Auditor de Compra: admin o permiso
// `auditor_compra` (ver app/lib/auditor-acceso.ts). Aprobar exige ser EM (admin o `aprobar_comercial`).
//
//   GET  → panel: líneas del costeo con sus opciones (respaldos + verificación), las cotizaciones de
//          Documentos y el mensaje único por proveedor.
//   POST → { accion, ... }: leer_documento · releer_documento · emparejar_documento · asignar_producto · cambiar_via ·
//          crear_opcion · agregar_ficha · verificar_mercado · verificar_costo_ia · justificar_ahorro · posicion_precio · verificar_tecnico (compara la línea de la opción) · confirmar_celda · agregar_link · no_ofertar · reofertar · agregar/estimar/anular/restaurar_costo_asociado · descartar · restaurar · firmar · quitar_firma · solicitar_aprobacion · aprobar · rechazar
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { invalidarEnVuelo } from '@/app/lib/en-vuelo';
import { contextoAuditor } from '@/app/lib/auditor-acceso';
import {
  armarPanelAuditorCompartido, cargarEstadoCosteo, leerDocumentoYCrearOpciones, crearOpcionesDesdeExtraccion, asignarProductoALinea, cambiarVia, descartarOpcion, restaurarOpcion, moverOpcionALinea,
  firmarOpcion, quitarFirma, solicitarAprobacion, resolverAprobacion, agregarLinkALinea, sugerirLineasDelNegocio, ignorarProductoSinLinea, crearOpcionManual, agregarFichaAOpcion, corregirCostoOpcion, quitarCorreccionCosto, buscarFichaEnLink, traerFichaDeLink, verificarMercadoDeOpcion, justificarAhorroDeOpcion, verificarCostoIADeOpcion, releerDocumento,
  verificarTecnicoDeOpcion, confirmarCeldaTecnica, respaldarCeldaTecnica,
} from '@/app/lib/auditor-opciones';
import { generarPosicionAuditor, ultimaPosicion } from '@/app/lib/auditor-posicion';
import { presupuestoNeto } from '@/app/lib/auditor-compras';
import {
  marcarNoOfertada, reofertarLinea, agregarCostoAsociado, estimarCostoAsociado, anularCostoAsociado, restaurarCostoAsociado,
} from '@/app/lib/auditor-lineas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const c = await contextoAuditor(request, params);
  if (c instanceof NextResponse) return c;
  try {
    const [panel, posicion, estadoCosteo] = await Promise.all([armarPanelAuditorCompartido(c.negocio.id, c.negocio.licitacion_codigo), ultimaPosicion(c.negocio.id).catch(() => null), cargarEstadoCosteo(c.negocio.id)]);
    const pres = estadoCosteo ? await presupuestoNeto(c.negocio.id, estadoCosteo).catch(() => null) : null;
    return NextResponse.json({ success: true, ...panel, posicion, presupuesto: pres ? { neto: pres.neto, fuente: pres.fuente } : null });
  } catch (e) {
    console.error('[auditor][GET]', String(e));
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const c = await contextoAuditor(request, params);
  if (c instanceof NextResponse) return c;
  const { negocio, actor, perm } = c;
  const body = await request.json().catch(() => ({}));
  const accion = String(body.accion || '');
  const opcionId = Number(body.opcionId);

  invalidarEnVuelo(negocio.id);
  try {
    switch (accion) {
      case 'leer_documento': {
        const url = String(body.url || '');
        // Solo se leen documentos que de verdad están en la caja de cotizaciones de ESTA licitación.
        const [rows] = await pool.query(
          `SELECT documento_nombre FROM documentos_cache WHERE licitacion_codigo = ? AND subcategoria = 'cotizaciones' AND documento_url_local = ? LIMIT 1`,
          [negocio.licitacion_codigo, url]) as any;
        if (!(rows as any[]).length) return NextResponse.json({ error: 'Ese documento no es una cotización de esta licitación.' }, { status: 404 });
        const r = await leerDocumentoYCrearOpciones(negocio.id, url, (rows as any[])[0].documento_nombre, actor);
        return NextResponse.json({ ...r, success: !r.error });
      }
      case 'releer_documento': {
        // Re-análisis de UNA cotización (botón «Volver a leer»): OCR doble y rehace el emparejamiento sin perder el historial.
        const url = String(body.url || '');
        const [rows] = await pool.query(
          `SELECT documento_nombre FROM documentos_cache WHERE licitacion_codigo = ? AND subcategoria = 'cotizaciones' AND documento_url_local = ? LIMIT 1`,
          [negocio.licitacion_codigo, url]) as any;
        if (!(rows as any[]).length) return NextResponse.json({ error: 'Ese documento no es una cotización de esta licitación.' }, { status: 404 });
        const r = await releerDocumento(negocio.id, url, (rows as any[])[0].documento_nombre, actor);
        return NextResponse.json({ ...r, success: !r.error });
      }
      case 'emparejar_documento': {
        // Re-aplica el emparejamiento sobre una extracción YA leída (sin volver a llamar a la IA).
        const r = await crearOpcionesDesdeExtraccion(negocio.id, Number(body.extraccionId), actor);
        return NextResponse.json({ success: true, ...r });
      }
      case 'asignar_producto': {
        const id = await asignarProductoALinea(negocio.id, Number(body.extraccionId), Number(body.productoIdx), String(body.filaId || ''), actor);
        return NextResponse.json({ success: true, opcionId: id });
      }
      case 'sugerir_lineas': {
        const r = await sugerirLineasDelNegocio(negocio.id, actor);
        return NextResponse.json({ success: true, ...r });
      }
      case 'ignorar_producto':
        await ignorarProductoSinLinea(negocio.id, Number(body.extraccionId), Number(body.productoIdx), body.ignorado !== false, actor); break;
      case 'cambiar_via':
        if (body.via !== 'liviana' && body.via !== 'completa') return NextResponse.json({ error: 'Vía inválida' }, { status: 400 });
        await cambiarVia(negocio.id, opcionId, body.via); break;
      case 'descartar': await descartarOpcion(negocio.id, opcionId, String(body.motivo || '')); break;
      case 'restaurar': await restaurarOpcion(negocio.id, opcionId); break;
      case 'mover_linea': await moverOpcionALinea(negocio.id, opcionId, String(body.filaId || ''), actor); break;
      case 'firmar': await firmarOpcion(negocio.id, negocio.licitacion_codigo, opcionId, actor, perm.esEM); break;
      case 'quitar_firma': await quitarFirma(negocio.id, opcionId); break;
      case 'solicitar_aprobacion': {
        const r = await solicitarAprobacion(negocio.id, negocio.licitacion_codigo, opcionId, actor);
        return NextResponse.json({ success: true, cambios: r.cambios });
      }
      case 'no_ofertar': await marcarNoOfertada(negocio.id, String(body.filaId || ''), String(body.motivo || ''), actor); break;
      case 'reofertar': await reofertarLinea(negocio.id, String(body.filaId || ''), actor); break;
      case 'agregar_costo_asociado': {
        const materia = String(body.materia || '').trim();
        if (!materia) return NextResponse.json({ error: 'Indica la materia del costo (capacitación, instalación, despacho…).' }, { status: 400 });
        const id = await agregarCostoAsociado(negocio.id, {
          filaId: body.filaId ? String(body.filaId) : null, materia, exigeBaseLiteral: body.exigeBaseLiteral ? String(body.exigeBaseLiteral) : null,
          fuenteBases: body.fuenteBases ? String(body.fuenteBases) : null, cuantificacion: body.cuantificacion ? String(body.cuantificacion) : null,
          montoEstimado: body.montoEstimado != null && body.montoEstimado !== '' ? Number(body.montoEstimado) : null, origen: 'manual',
        }, actor);
        return NextResponse.json({ success: true, id });
      }
      case 'estimar_costo_asociado':
        await estimarCostoAsociado(negocio.id, Number(body.id), body.monto === null || body.monto === '' || body.monto === undefined ? null : Number(body.monto), actor); break;
      case 'anular_costo_asociado': await anularCostoAsociado(negocio.id, Number(body.id), String(body.comentario || ''), actor); break;
      case 'restaurar_costo_asociado': await restaurarCostoAsociado(negocio.id, Number(body.id), actor); break;
      case 'verificar_tecnico': {
        const r = await verificarTecnicoDeOpcion(negocio.id, negocio.licitacion_codigo, opcionId, actor, body.solo === true);
        return NextResponse.json({ success: true, ...r });
      }
      case 'posicion_precio': {
        const p = await generarPosicionAuditor(negocio.id, negocio.licitacion_codigo, actor);
        return NextResponse.json({ success: true, posicion: p });
      }
      case 'verificar_costo_ia': {
        const r = await verificarCostoIADeOpcion(negocio.id, negocio.licitacion_codigo, opcionId, actor);
        return NextResponse.json({ success: !r.error, error: r.error, alertas: r.resultado?.alertas.length ?? 0, ayuda: !!r.resultado?.ayuda, descartados: r.resultado?.descartados.length ?? 0 });
      }
      case 'verificar_mercado': {
        const m = await verificarMercadoDeOpcion(negocio.id, opcionId, actor);
        return NextResponse.json({ success: true, referencias: m.referencias.length, descartadas: m.descartadas.length, error: m.error });
      }
      case 'justificar_ahorro':
        await justificarAhorroDeOpcion(negocio.id, opcionId, String(body.texto || ''), actor); break;
      case 'confirmar_celda':
        // El asistente cierra un ❓ con un clic (comparador técnico v3.0): sin respaldo, queda quién y cuándo.
        await confirmarCeldaTecnica(negocio.id, opcionId, Number(body.n), body.confirmada !== false, actor, String(body.motivo || ''), perm.esEM); break;
      case 'respaldar_celda':
        // El asistente adjunta un documento o imagen a un requisito (no lo cierra: lo revisa el EM con el «ojo»).
        await respaldarCeldaTecnica(negocio.id, opcionId, Number(body.n), String(body.url || ''), String(body.nombre || 'respaldo'), String(body.nota || ''), actor, body.quitar === true); break;
      case 'crear_opcion': {
        // Opción SIN link ni cotización (el producto no está en la web): línea + marca/modelo. Después se le sube la ficha técnica.
        const id = await crearOpcionManual(negocio.id, String(body.filaId || ''), {
          marca: body.marca ? String(body.marca) : null, modelo: body.modelo ? String(body.modelo) : null,
          sku: body.sku ? String(body.sku) : null, proveedor: body.proveedor ? String(body.proveedor) : null,
        }, actor);
        return NextResponse.json({ success: true, opcionId: id });
      }
      case 'agregar_ficha': {
        // Ficha técnica (PDF/imagen) subida a la caja «Fichas técnicas» de Documentos Propios de ESTA licitación.
        const url = String(body.url || '');
        const [rows] = await pool.query(
          `SELECT documento_nombre FROM documentos_cache WHERE licitacion_codigo = ? AND subcategoria = 'fichas_tecnicas' AND documento_url_local = ? LIMIT 1`,
          [negocio.licitacion_codigo, url]) as any;
        if (!(rows as any[]).length) return NextResponse.json({ error: 'Ese documento no es una ficha técnica de esta licitación.' }, { status: 404 });
        const r = await agregarFichaAOpcion({
          negocioId: negocio.id, opcionId: Number.isFinite(opcionId) ? opcionId : null, filaId: body.filaId ? String(body.filaId) : null,
          url, nombre: (rows as any[])[0].documento_nombre,
          productoIdx: body.productoIdx != null && body.productoIdx !== '' ? Number(body.productoIdx) : null, forzar: body.forzar === true, actor,
        });
        return NextResponse.json({ ...r, success: r.estado !== 'error' });
      }
      case 'buscar_ficha_link': {
        // Solo MIRA la página del link y lista las fichas que ofrece: no descarga nada.
        const r = await buscarFichaEnLink(negocio.id, opcionId);
        return NextResponse.json({ success: true, ...r });
      }
      case 'traer_ficha_link': {
        // Descarga la ficha que la persona aceptó en pantalla (solo una de las que la búsqueda ofreció).
        const r = await traerFichaDeLink(negocio.id, opcionId, String(body.url || ''), actor);
        return NextResponse.json({ ...r, success: r.estado !== 'error' });
      }
      case 'corregir_costo':
        // Precio y/o IVA fijado a mano, con motivo obligatorio (queda quién y cuándo; se puede deshacer).
        await corregirCostoOpcion(negocio.id, opcionId, { precio: body.precio != null && body.precio !== '' ? Number(body.precio) : null, iva: body.iva ? String(body.iva) : null, motivo: String(body.motivo || '') }, actor); break;
      case 'quitar_correccion_costo': await quitarCorreccionCosto(negocio.id, opcionId, actor); break;
      case 'agregar_link': {
        const r = await agregarLinkALinea(negocio.id, String(body.filaId || ''), String(body.url || ''), actor);
        return NextResponse.json({ success: true, ...r });
      }
      case 'aprobar':
      case 'rechazar':
        if (!perm.esEM) return NextResponse.json({ error: 'Aprobar o rechazar requiere ser EM (jefe de ventas o admin).' }, { status: 403 });
        await resolverAprobacion(negocio.id, opcionId, accion, body.comentario ? String(body.comentario) : null, actor); break;
      default:
        return NextResponse.json({ error: `Acción desconocida: ${accion}` }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[auditor][POST]', accion, msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  } finally {
    invalidarEnVuelo(negocio.id);
  }
}
