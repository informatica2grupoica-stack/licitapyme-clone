// app/lib/auditor-opciones.ts
// AUDITOR unificado de la licitación — capa de datos de la OPCIÓN (línea del costeo + producto +
// proveedor), sus respaldos (con historial), la lectura de las cotizaciones de Documentos con el Lector,
// el panel por línea con la verificación calculada por código y el ciclo firma → aprobación.
// Spec: docs/ESPECIFICACION_AUDITOR_v1.md §4 (opción), §5 (vías), §11 (firma y aprobación).
// Tablas: migration-131/132 (auditor_opcion, auditor_respaldo, auditor_extraccion, auditor_evento).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { lineasDelCosteo, type LineaCosteo, type MargenProyecto } from '@/app/lib/auditor-compras-core';
import { MARGEN_VENTA_DEFECTO, type EstadoCosteoEditor } from '@/app/lib/costeo-editor';
import { leerYGuardarDocumento, leerYGuardarPaginaWeb, extraccionPorId, extraccionesPorIds, type ExtraccionGuardada, type SalidaLector } from '@/app/lib/auditor-lector';
import { visitarLinks, normalizarUrl } from '@/app/lib/auditor-compras-captura';
import { createHash } from 'node:crypto';
import { mensajesUnificadosPorProveedor, type MensajeProveedor } from '@/app/lib/auditor-proveedor';
import {
  ultimasVerificaciones, habilitacionesYDeclaraciones, estadoTecnicoDe, verificarTecnicoOpcion, segundaPasadaTecnica, contarRequisitosPorLinea,
} from '@/app/lib/auditor-tecnico-v2';
import type { ResultadoTecnico } from '@/app/lib/auditor-tecnico-v2-core';
import { ultimosMercados, opcionesConJustificacion, verificarMercadoOpcion, justificarAhorro } from '@/app/lib/auditor-mercado';
import { evaluarMercado, aplicarEvaluacion, type ReferenciaMercado, type ReferenciaDescartada, type CompetidorMP, type FuenteComparador } from '@/app/lib/auditor-mercado-core';
import type { PrecioMercadoPublico } from '@/app/lib/auditor-compras-core';
import { ultimasCostoIA, verificarCostoIAOpcion } from '@/app/lib/auditor-costo-ia';
import type { AyudaCosto } from '@/app/lib/auditor-costo-ia-core';
import { estadosDeLineas, lineasQueExigenViaCompleta, listarCostosAsociados, totalCostosAsociados, type CostoAsociadoDTO } from '@/app/lib/auditor-lineas';
import {
  normalizarProductos, normalizarExtraccion, emparejarProductos, coincidenciaIdentidad, emparejarProductoReleido, verificarOpcion, margenProyectoConOpciones, evaluarAvance, type ResultadoAvance,
  type ProductoNormalizado, type ResultadoVerificacion, type Emparejamiento,
} from '@/app/lib/auditor-opciones-core';

export type EstadoOpcion = 'tanteo' | 'formalizada' | 'verificada' | 'definitiva' | 'en_aprobacion' | 'aprobada' | 'descartada';
export interface Actor { id: number; nombre: string }

export interface RespaldoDTO {
  id: number; tipo: string; documentoUrl: string | null; documentoNombre: string | null; url: string | null;
  precioDeclarado: number | null; precioIva: string; vigente: boolean; sostieneCosto: boolean;
  cargadoAt: string; cargadoPorNombre: string | null; extraccionId: number | null; productoIdx: number | null;
}
export interface OpcionDTO {
  id: number; filaId: string; marca: string | null; modelo: string | null; version: string | null; sku: string | null;
  proveedorRazonSocial: string | null; proveedorRut: string | null;
  via: 'liviana' | 'completa'; estado: EstadoOpcion; motivoDescarte: string | null;
  firmadaPorNombre: string | null; firmadaAt: string | null; creadoAt: string;
  respaldos: RespaldoDTO[];
  producto: ProductoNormalizado | null;
  verificacion: ResultadoVerificacion | null;
  /** Lo que el Lector extrajo del proveedor y del documento que sostiene el costo (para el mensaje y OBUMA). */
  proveedorDatos: SalidaLector['proveedor'] | null;
  documentoInfo: { numero: string | null; fechaEmision: string | null; tipo: string | null } | null;
  /** Capturas fechadas de los links de la opción (la más reciente primero) y estado de la última del respaldo que sostiene el costo. */
  capturas: CapturaDTO[];
  estadoLink: string | null;
  /** Verificación técnica (Prompt 4 v2.0) de la opción, calculada por código sobre la última corrida. */
  tecnico: TecnicoDTO;
  /** Mercado (Prompt 5 V9/V10/V10-b/V10-c): referencias del MISMO producto, competidor y mercado público. null = todavía no se buscó. */
  mercado: MercadoDTO | null;
  costoIA: CostoIADTO | null;
}
/** Verificador de costo con IA (Prompt 5 v2.0): hallazgos con cita verificada (ya sumados a las alertas de la opción) y la ayuda de cinco campos. */
export interface CostoIADTO { creadoAt: string; error: string | null; ayuda: AyudaCosto | null; descartados: string[]; noPudeLeer: Array<{ que: string; donde: string }>; alertas: number }
export interface MercadoDTO {
  creadoAt: string; consulta: string; error: string | null;
  referencias: ReferenciaMercado[]; descartadas: ReferenciaDescartada[]; competidor: CompetidorMP | null; mercadoPublico: PrecioMercadoPublico | null;
  comparador: FuenteComparador[]; medianaReferencias: number | null; dispersionActiva: boolean; ahorroMaximoPct: number | null; justificada: boolean;
}
export interface TecnicoDTO {
  estado: ResultadoTecnico['estado'] | 'NO_CORRIDO' | 'SIN_REQUISITOS' | 'NO_APLICA';
  corridoAt: string | null; error: string | null; segundaPasadaAt: string | null; requisitosTotal: number;
  resultado: ResultadoTecnico | null;
}
export interface CapturaDTO { id: number; respaldoId: number | null; url: string; estado: string; titulo: string | null; capturadoAt: string; hayImagen: boolean }
export interface LineaAuditorDTO {
  filaId: string; item: number; lineaReal: number | null; detalle: string; unidad: string; cantidad: number | null;
  costeadoNeto: number | null; precioVentaUnitario: number | null; links: string[];
  opciones: OpcionDTO[]; opcionDefinitivaId: number | null;
  noOfertada: boolean; motivoNoOfertada: string | null;
  /** La criticidad heredada de las bases obliga a la vía completa (no se puede elegir la liviana). */
  exigeViaCompleta: boolean;
}
export interface DocumentoCotizacionDTO {
  documentoId: number; nombre: string; url: string; extraccionId: number | null; leido: boolean; error: string | null;
  proveedor: string | null; rut: string | null; fechaEmision: string | null; formalidad: string | null;
  productos: Array<{ idx: number; nombre: string; precio: number | null; iva: string; cantidad: number | null; esCargo: boolean; opcionId: number | null; filaId: string | null }>;
}
export interface PanelAuditorDTO {
  lineas: LineaAuditorDTO[];
  documentos: DocumentoCotizacionDTO[];
  margen: MargenProyecto | null;
  mensajes: MensajeProveedor[];
  linksPendientes: Array<{ filaId: string; item: number; url: string }>;
  costosAsociados: CostoAsociadoDTO[];
  totalCostosAsociados: number;
  avance: ResultadoAvance;
  resumen: { lineas: number; conOpcion: number; definitivas: number; aprobadas: number; bloqueadas: number };
  sinCosteo: boolean;
  /** Última posición de precio calculada (la agrega el GET; no forma parte de armarPanelAuditor para no crear un ciclo de módulos). */
  posicion?: import('@/app/lib/auditor-posicion').PosicionGuardadaDTO | null;
}

// ── Utilidades ───────────────────────────────────────────────────────────────────────────────────
const s = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));
const fechaS = (v: unknown) => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);

async function evento(negocioId: number, opcionId: number, tipo: string, emisor: string, detalle: string | null) {
  await pool.query(
    `INSERT INTO auditor_evento (negocio_id, opcion_id, tipo, emisor, detalle, creado_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [negocioId, opcionId, tipo, emisor, detalle, ahoraChileSQL()]).catch(e => console.warn('[auditor-opciones] evento:', String(e).slice(0, 120)));
}

/** Costeo guardado del negocio (mismo criterio que el Auditor de Compra manual; se lee aquí para no
 *  depender del módulo Compras). */
export async function cargarEstadoCosteo(negocioId: number): Promise<EstadoCosteoEditor | null> {
  const [rows] = await pool.query(`SELECT modalidad, datos_json FROM negocio_costeo_editor WHERE negocio_id = ? LIMIT 1`, [negocioId]) as any;
  const row = (rows as any[])[0];
  if (!row) return null;
  try {
    const datos = typeof row.datos_json === 'string' ? JSON.parse(row.datos_json) : row.datos_json;
    const grupos = (datos?.grupos || []).map((g: any) => ({ ...g, ofertamos: g.ofertamos !== false }));
    return { modalidad: row.modalidad, margenVenta: Number(datos?.margenVenta) || MARGEN_VENTA_DEFECTO, grupos };
  } catch { return null; }
}

/** Líneas del costeo que se auditan: las de productos que se ofertan (sin gastos extra de Compras). */
export function lineasAuditables(estado: EstadoCosteoEditor | null): LineaCosteo[] {
  if (!estado) return [];
  return lineasDelCosteo(estado).filter(l => !l.esGastoExtra && l.ofertamos && l.cantidad != null);
}

async function cargarExtracciones(ids: number[]): Promise<Map<number, ExtraccionGuardada | null>> {
  const todas = await extraccionesPorIds(ids);
  return new Map([...todas].map(([id, v]) => [id, v.data]));
}

// ── Panel ────────────────────────────────────────────────────────────────────────────────────────
export async function armarPanelAuditor(negocioId: number, licitacionCodigo: string): Promise<PanelAuditorDTO> {
  const hoyISO = ahoraChileSQL().slice(0, 10);
  // Todas las lecturas son independientes: van EN PARALELO (la base es remota; una a una el panel tardaba segundos).
  const [estado, estadosLinea, verifTec, habTec, reqPorLinea, exigenCompleta, costosAsociados, mercados, justificadas, costosIA, opRes, reRes, caRes] = await Promise.all([
    cargarEstadoCosteo(negocioId), estadosDeLineas(negocioId), ultimasVerificaciones(negocioId), habilitacionesYDeclaraciones(negocioId),
    contarRequisitosPorLinea(negocioId, licitacionCodigo), lineasQueExigenViaCompleta(negocioId), listarCostosAsociados(negocioId),
    ultimosMercados(negocioId), opcionesConJustificacion(negocioId), ultimasCostoIA(negocioId),
    pool.query(`SELECT * FROM auditor_opcion WHERE negocio_id = ? ORDER BY id`, [negocioId]) as Promise<any>,
    pool.query(`SELECT * FROM auditor_respaldo WHERE negocio_id = ? ORDER BY id`, [negocioId]) as Promise<any>,
    pool.query(`SELECT id, opcion_id, respaldo_id, url, estado_link, titulo, capturado_at, (imagen IS NOT NULL) AS hay_imagen FROM auditor_captura WHERE negocio_id = ? ORDER BY id DESC`, [negocioId]) as Promise<any>,
  ]);
  const [opRows] = opRes, [reRows] = reRes, [caRows] = caRes;
  const lineas = lineasAuditables(estado);
  const totalAsociados = totalCostosAsociados(costosAsociados);
  // Una línea NO OFERTADA sale del margen y de las verificaciones (sigue en el histórico).
  const lineasVivas = lineas.filter(l => !estadosLinea.get(l.id)?.noOfertada);

  const capturasPorOpcion = new Map<number, CapturaDTO[]>();
  for (const c of caRows as any[]) if (c.opcion_id != null)
    (capturasPorOpcion.get(c.opcion_id) || capturasPorOpcion.set(c.opcion_id, []).get(c.opcion_id)!).push({
      id: c.id, respaldoId: c.respaldo_id, url: c.url, estado: c.estado_link, titulo: s(c.titulo), capturadoAt: fechaS(c.capturado_at) || '', hayImagen: !!c.hay_imagen });
  const extIds = (reRows as any[]).map(r => r.extraccion_id).filter((x: any) => x != null);
  const ext = await cargarExtracciones(extIds);

  const respaldosPorOpcion = new Map<number, any[]>();
  for (const r of reRows as any[]) (respaldosPorOpcion.get(r.opcion_id) || respaldosPorOpcion.set(r.opcion_id, []).get(r.opcion_id)!).push(r);

  const opcionesPorFila = new Map<string, OpcionDTO[]>();
  for (const o of opRows as any[]) {
    const linea = lineas.find(l => l.id === o.fila_id);
    const respaldosRaw = respaldosPorOpcion.get(o.id) || [];
    const respaldos: RespaldoDTO[] = respaldosRaw.map(r => ({
      id: r.id, tipo: r.tipo, documentoUrl: s(r.documento_url), documentoNombre: s(r.documento_nombre), url: s(r.url),
      precioDeclarado: num(r.precio_declarado), precioIva: r.precio_iva, vigente: !!r.vigente, sostieneCosto: !!r.sostiene_costo,
      cargadoAt: fechaS(r.cargado_at) || '', cargadoPorNombre: s(r.cargado_por_nombre), extraccionId: r.extraccion_id, productoIdx: r.producto_idx,
    }));
    // El respaldo que sostiene el costo: el marcado; si no, el más reciente vigente.
    // Una ficha técnica NO sostiene un costo (no trae precio): solo cuenta como respaldo de costo lo que puede tenerlo.
    const vigentesDeCosto = respaldosRaw.filter(r => r.vigente && r.tipo !== 'ficha_tecnica').reverse();
    const sostiene = vigentesDeCosto.find(r => r.sostiene_costo) || vigentesDeCosto[0] || null;
    const data = sostiene?.extraccion_id != null ? ext.get(sostiene.extraccion_id) ?? null : null;
    const producto = data && sostiene?.producto_idx != null ? normalizarExtraccion(data)[sostiene.producto_idx] ?? null : null;
    const capturas = capturasPorOpcion.get(o.id) || [];
    const capSostiene = sostiene?.tipo === 'link_web' ? capturas.find(c => c.respaldoId === sostiene.id) ?? null : null;
    const docBase = data?.salida.documento ?? null;
    const verificacion = linea && o.estado !== 'descartada'
      ? verificarOpcion({
        linea, lineasProyecto: lineasVivas, producto, costosAsociadosNeto: totalAsociados,
        documento: sostiene?.tipo === 'link_web' ? { ...(docBase || {}), tipo: 'link_web' } : docBase,
        proveedor: data?.salida.proveedor ?? null,
        opcion: { marca: o.marca, modelo: o.modelo }, hoyISO,
        estadoLink: (capSostiene?.estado as any) ?? null, capturadoAt: capSostiene?.capturadoAt ?? null,
      })
      : null;

    const est = estadoTecnicoDe(verifTec.get(o.id), habTec.get(o.id));
    const reqTotal = linea?.lineaReal != null ? (reqPorLinea.get(linea.lineaReal) ?? 0) : 0;
    const tecnico: TecnicoDTO = {
      estado: o.via === 'liviana' ? 'NO_APLICA' : reqTotal === 0 && !est.resultado ? 'SIN_REQUISITOS' : est.resultado ? est.resultado.estado : 'NO_CORRIDO',
      corridoAt: est.corridoAt, error: est.error, segundaPasadaAt: est.segundaPasadaAt, requisitosTotal: reqTotal, resultado: est.resultado,
    };
    // Mercado (V9 competidor, V10 referencia más barata ≥ 5% sin justificar, V10-b dispersión): si ya se buscó, suma sus bloqueos y alertas.
    const m = mercados.get(o.id) ?? null;
    let mercado: MercadoDTO | null = null;
    if (m) {
      const nombreOp = [o.marca, o.modelo].filter(Boolean).join(' ') || 'la opción';
      const ev = evaluarMercado(m, verificacion?.costoNetoUnitario ?? null, nombreOp, justificadas.has(o.id));
      if (verificacion) { const nv = aplicarEvaluacion(verificacion, ev); verificacion.bloqueos = nv.bloqueos; verificacion.alertas = nv.alertas; verificacion.veredicto = nv.veredicto; }
      mercado = {
        creadoAt: m.creadoAt, consulta: m.consulta, error: m.error, referencias: m.referencias, descartadas: m.descartadas, competidor: m.competidor, mercadoPublico: m.mercadoPublico,
        comparador: ev.comparador, medianaReferencias: ev.medianaReferencias, dispersionActiva: ev.dispersion.activa, ahorroMaximoPct: ev.ahorroMaximoPct, justificada: justificadas.has(o.id),
      };
    }
    // Verificador de costo con IA: solo suma ALERTAS (con cita literal ya verificada); jamás un bloqueo ni el veredicto.
    const ci = costosIA.get(o.id) ?? null;
    let costoIA: CostoIADTO | null = null;
    if (ci) {
      if (verificacion && ci.resultado?.alertas.length) { const nv = aplicarEvaluacion(verificacion, { bloqueos: [], alertas: ci.resultado.alertas }); verificacion.alertas = nv.alertas; verificacion.veredicto = nv.veredicto; }
      costoIA = { creadoAt: ci.creadoAt, error: ci.error, ayuda: ci.resultado?.ayuda ?? null, descartados: ci.resultado?.descartados ?? [], noPudeLeer: ci.resultado?.noPudeLeer ?? [], alertas: ci.resultado?.alertas.length ?? 0 };
    }
    // Accesorio o documento de tercero que el verificador técnico exige y nadie costeó = costo oculto (Prompt 5 V1/V5).
    if (verificacion && est.resultado) for (const e of est.resultado.eventos) if (e.tipo === 'complemento_requerido' && e.costeado === false)
      verificacion.alertas.push({ codigo: 'V5', nivel: 'rojo', mensaje: `El verificador técnico exige un complemento que no está costeado: ${e.detalle}. Suma al costo real de compra.`, accion: 'corregir_costeo' });

    let estadoOp: EstadoOpcion = o.estado;
    // Transiciones automáticas (solo entre tanteo/formalizada/verificada): el resto las decide una persona.
    if (verificacion && ['tanteo', 'formalizada', 'verificada'].includes(estadoOp)) {
      const formal = respaldosRaw.some(r => r.vigente && ['cotizacion_formal', 'proforma_importacion'].includes(r.tipo));
      const ok = verificacion.veredicto === 'VERIFICADO' || verificacion.veredicto === 'VERIFICADO_CON_ALERTAS';
      const nuevo: EstadoOpcion = ok ? 'verificada' : formal ? 'formalizada' : 'tanteo';
      if (nuevo !== estadoOp) {
        await pool.query(`UPDATE auditor_opcion SET estado = ?, actualizado_at = ? WHERE id = ?`, [nuevo, ahoraChileSQL(), o.id]);
        estadoOp = nuevo;
      }
    }

    const dto: OpcionDTO = {
      id: o.id, filaId: o.fila_id, marca: s(o.marca), modelo: s(o.modelo), version: s(o.version_producto), sku: s(o.sku_proveedor),
      proveedorRazonSocial: s(o.proveedor_razon_social), proveedorRut: s(o.proveedor_rut),
      via: o.via, estado: estadoOp, motivoDescarte: s(o.motivo_descarte),
      firmadaPorNombre: s(o.firmada_por_nombre), firmadaAt: fechaS(o.firmada_at), creadoAt: fechaS(o.creado_at) || '',
      respaldos, producto, verificacion,
      proveedorDatos: data?.salida.proveedor ?? null,
      documentoInfo: data ? { numero: data.salida.documento?.numero || null, fechaEmision: data.salida.documento?.fecha_emision || null, tipo: data.salida.documento?.tipo || null } : null,
      capturas, estadoLink: capSostiene?.estado ?? null, tecnico, mercado, costoIA,
    };
    (opcionesPorFila.get(o.fila_id) || opcionesPorFila.set(o.fila_id, []).get(o.fila_id)!).push(dto);
  }

  const lineasDTO: LineaAuditorDTO[] = lineas.map(l => {
    const opciones = opcionesPorFila.get(l.id) || [];
    const def = opciones.find(o => ['definitiva', 'en_aprobacion', 'aprobada'].includes(o.estado));
    return {
      filaId: l.id, item: l.item, lineaReal: l.lineaReal, detalle: l.detalle, unidad: l.unidad, cantidad: l.cantidad,
      costeadoNeto: l.costoRegistradoNeto, precioVentaUnitario: l.precioVentaUnitario, links: l.links,
      opciones, opcionDefinitivaId: def?.id ?? null,
      noOfertada: !!estadosLinea.get(l.id)?.noOfertada, motivoNoOfertada: estadosLinea.get(l.id)?.motivo ?? null,
      exigeViaCompleta: l.lineaReal != null && exigenCompleta.has(l.lineaReal),
    };
  });

  const documentos = await armarDocumentos(negocioId, licitacionCodigo, opcionesPorFila);
  const margen = margenProyectoConOpciones(lineasVivas, lineasDTO.filter(l => !l.noOfertada).flatMap(l => l.opciones
    .filter(o => ['definitiva', 'en_aprobacion', 'aprobada'].includes(o.estado) && o.verificacion?.costoNetoUnitario != null)
    .map(o => ({ filaId: l.filaId, neto: o.verificacion!.costoNetoUnitario as number }))), totalAsociados);
  const avance = evaluarAvance({
    modalidad: estado?.modalidad ?? null,
    lineas: lineasDTO.map(l => ({ filaId: l.filaId, item: l.item, noOfertada: l.noOfertada, tieneAprobada: l.opciones.some(o => o.estado === 'aprobada') })),
  });

  const activas = lineasDTO.flatMap(l => l.opciones.filter(o => o.estado !== 'descartada'));
  return {
    lineas: lineasDTO, documentos, margen, sinCosteo: !estado, mensajes: mensajesUnificadosPorProveedor(lineasDTO), linksPendientes: await linksPendientesDelCosteo(negocioId, lineas),
    costosAsociados, totalCostosAsociados: totalAsociados, avance,
    resumen: {
      lineas: lineasDTO.length,
      conOpcion: lineasDTO.filter(l => l.opciones.some(o => o.estado !== 'descartada')).length,
      definitivas: activas.filter(o => o.estado === 'definitiva' || o.estado === 'en_aprobacion').length,
      aprobadas: activas.filter(o => o.estado === 'aprobada').length,
      bloqueadas: activas.filter(o => o.verificacion?.bloqueos.length).length,
    },
  };
}

async function armarDocumentos(negocioId: number, codigo: string, opcionesPorFila: Map<string, OpcionDTO[]>): Promise<DocumentoCotizacionDTO[]> {
  const [docs] = await pool.query(
    `SELECT id, documento_nombre, documento_url_local FROM documentos_cache
     WHERE licitacion_codigo = ? AND subcategoria = 'cotizaciones' AND documento_url_local IS NOT NULL ORDER BY created_at ASC`, [codigo]) as any;
  const [exts] = await pool.query(
    `SELECT id, documento_url, error FROM auditor_extraccion WHERE negocio_id = ? AND documento_url IS NOT NULL ORDER BY id DESC`, [negocioId]) as any;
  const ultimaPorUrl = new Map<string, any>();
  for (const e of exts as any[]) if (!ultimaPorUrl.has(e.documento_url)) ultimaPorUrl.set(e.documento_url, e);

  const opcionPorProducto = new Map<string, { opcionId: number; filaId: string }>(); // `${extraccionId}:${idx}`
  for (const [filaId, ops] of opcionesPorFila) for (const o of ops) if (o.estado !== 'descartada') for (const r of o.respaldos)
    if (r.vigente && r.extraccionId != null && r.productoIdx != null) opcionPorProducto.set(`${r.extraccionId}:${r.productoIdx}`, { opcionId: o.id, filaId });

  const cargadas = await extraccionesPorIds([...ultimaPorUrl.values()].filter(e => !e.error).map(e => e.id));
  const out: DocumentoCotizacionDTO[] = [];
  for (const d of docs as any[]) {
    const e = ultimaPorUrl.get(d.documento_url_local) || null;
    const base: DocumentoCotizacionDTO = {
      documentoId: d.id, nombre: d.documento_nombre, url: d.documento_url_local, extraccionId: e?.id ?? null,
      leido: !!e && !e.error, error: e?.error ?? null, proveedor: null, rut: null, fechaEmision: null, formalidad: null, productos: [],
    };
    if (e && !e.error) {
      const data = cargadas.get(e.id)?.data ?? null;
      if (data) {
        base.proveedor = data.salida.proveedor?.razon_social?.valor || data.salida.proveedor?.nombre_fantasia?.valor || null;
        base.rut = data.salida.proveedor?.rut?.valor || null;
        base.fechaEmision = data.salida.documento?.fecha_emision || null;
        base.formalidad = data.salida.documento?.formalidad || null;
        base.productos = normalizarExtraccion(data).map(p => {
          const enlace = opcionPorProducto.get(`${e.id}:${p.idx}`);
          return { idx: p.idx, nombre: p.nombre, precio: p.precio, iva: p.iva, cantidad: p.cantidadCotizada, esCargo: p.esCargo, opcionId: enlace?.opcionId ?? null, filaId: enlace?.filaId ?? null };
        });
      }
    }
    out.push(base);
  }
  return out;
}

// ── Crear opciones desde una extracción ──────────────────────────────────────────────────────────
const hostDe = (url: string) => { try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { return ''; } };

async function crearOpcionDesdeProducto(params: {
  negocioId: number; filaId: string; extraccionId: number; productoIdx: number;
  data: ExtraccionGuardada; documentoUrl: string; documentoNombre: string; actor: Actor;
  /** Si el respaldo es un LINK: la captura fechada que lo sostiene (el respaldo guarda la URL, no un documento). */
  link?: { capturaId: number };
}): Promise<{ opcionId: number; respaldoId: number }> {
  const { negocioId, filaId, extraccionId, productoIdx, data, documentoUrl, documentoNombre, actor, link } = params;
  const ahora = ahoraChileSQL();
  const prod = normalizarExtraccion(data)[productoIdx];
  const prov = data.salida.proveedor || {};
  const formal = data.salida.documento?.formalidad !== 'informal';
  const tipoDoc = data.salida.documento?.tipo;
  const tipo = link ? 'link_web' : tipoDoc === 'proforma_importacion' ? 'proforma_importacion' : formal ? 'cotizacion_formal' : 'respaldo_informal';
  // Columnas de ubicación del respaldo: un link guarda la URL; un documento guarda documento_url + nombre.
  const colUrl = link ? documentoUrl : null, colDoc = link ? null : documentoUrl;
  const claveUrl = link ? 'url' : 'documento_url';

  // ¿Ya hay una opción de ESTE proveedor y ESTE producto en la línea? Entonces el documento es un respaldo
  // más de esa opción (el costo evoluciona: nunca se duplica la opción ni se pisa el respaldo anterior).
  const rut = (prov.rut?.valor || '').trim(), razon = (prov.razon_social?.valor || prov.nombre_fantasia?.valor || (link ? hostDe(documentoUrl) : '') || '').trim();
  const [existentes] = await pool.query(
    `SELECT id, marca, modelo, sku_proveedor, proveedor_rut, proveedor_razon_social FROM auditor_opcion WHERE negocio_id = ? AND fila_id = ? AND estado <> 'descartada'`, [negocioId, filaId]) as any;
  const mismo = (existentes as any[]).find(o => {
    const mismoProveedor = (rut && o.proveedor_rut && rut === o.proveedor_rut) || (razon && o.proveedor_razon_social && razon.toLowerCase() === String(o.proveedor_razon_social).toLowerCase());
    const mismoProducto = (prod.modelo && o.modelo && prod.modelo.toLowerCase() === String(o.modelo).toLowerCase())
      || (prod.sku && o.sku_proveedor && prod.sku.toLowerCase() === String(o.sku_proveedor).toLowerCase())
      || (!prod.modelo && !o.modelo && (prod.marca || '').toLowerCase() === String(o.marca || '').toLowerCase());
    return mismoProveedor && mismoProducto;
  });
  const insertarRespaldo = async (opcionId: number): Promise<number> => {
    const [r] = await pool.query(
      `INSERT INTO auditor_respaldo (opcion_id, negocio_id, tipo, url, documento_url, documento_nombre, precio_declarado, precio_iva, vigente, sostiene_costo,
         origen, cargado_por, cargado_por_nombre, cargado_at, extraccion_id, producto_idx)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'lector', ?, ?, ?, ?, ?)`,
      [opcionId, negocioId, tipo, colUrl, colDoc, documentoNombre, prod.precio, prod.iva, actor.id, actor.nombre, ahora, extraccionId, productoIdx]) as any;
    const respaldoId = r.insertId as number;
    if (link) await pool.query(`UPDATE auditor_captura SET opcion_id = ?, respaldo_id = ? WHERE id = ?`, [opcionId, respaldoId, link.capturaId]);
    return respaldoId;
  };

  if (mismo) {
    const [yaEsta] = await pool.query(`SELECT id FROM auditor_respaldo WHERE opcion_id = ? AND ${claveUrl} = ? AND extraccion_id = ?`, [mismo.id, documentoUrl, extraccionId]) as any;
    if ((yaEsta as any[]).length) return { opcionId: mismo.id, respaldoId: (yaEsta as any[])[0].id };   // el mismo documento ya es respaldo de esta opción
    await pool.query(`UPDATE auditor_respaldo SET sostiene_costo = 0 WHERE opcion_id = ?`, [mismo.id]);
    const respaldoId = await insertarRespaldo(mismo.id);
    await evento(negocioId, mismo.id, 'documento_nuevo', 'lector', `${documentoNombre} · respaldo nuevo de la misma opción`);
    return { opcionId: mismo.id, respaldoId };
  }

  const [ins] = await pool.query(
    `INSERT INTO auditor_opcion (negocio_id, fila_id, marca, modelo, version_producto, sku_proveedor, proveedor_razon_social, proveedor_rut,
       via, estado, origen, creado_por, creado_por_nombre, creado_at, actualizado_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completa', ?, ?, ?, ?, ?, ?)`,
    [negocioId, filaId, prod.marca || null, prod.modelo || null, prod.version || null, prod.sku || null,
      razon || null, prov.rut?.valor || null,
      tipo === 'respaldo_informal' || tipo === 'link_web' ? 'tanteo' : 'formalizada', link ? 'link' : 'lector', actor.id, actor.nombre, ahora, ahora]) as any;
  const opcionId = ins.insertId as number;
  const respaldoId = await insertarRespaldo(opcionId);
  await pool.query(`UPDATE auditor_extraccion SET opcion_id = ?, respaldo_id = ? WHERE id = ? AND opcion_id IS NULL`, [opcionId, respaldoId, extraccionId]).catch(() => { /* la extracción puede servir a varias opciones */ });
  await evento(negocioId, opcionId, 'documento_nuevo', link ? 'sistema' : 'lector', `${documentoNombre} · producto ${productoIdx + 1}`);
  return { opcionId, respaldoId };
}

/** Empareja los productos de una extracción con las líneas del costeo y crea una opción por cada match que
 *  todavía no tiene opción. Devuelve lo creado y lo que quedó sin emparejar (para asignar a mano). */
export async function crearOpcionesDesdeExtraccion(negocioId: number, extraccionId: number, actor: Actor): Promise<{ creadas: Array<Emparejamiento & { opcionId: number }>; sinEmparejar: number[] }> {
  const ex = await extraccionPorId(extraccionId);
  if (!ex?.data || !ex.documentoUrl) throw new Error('La extracción no existe o no se pudo leer.');
  const lineas = lineasAuditables(await cargarEstadoCosteo(negocioId));
  const productos = normalizarExtraccion(ex.data).filter(p => p.precio != null);
  const [ya] = await pool.query(`SELECT r.producto_idx FROM auditor_respaldo r JOIN auditor_opcion o ON o.id = r.opcion_id WHERE r.extraccion_id = ? AND r.vigente = 1 AND o.estado <> 'descartada'`, [extraccionId]) as any;
  const yaAsignados = new Set((ya as any[]).map(r => r.producto_idx));
  const { asignaciones, sinEmparejar } = emparejarProductos(productos.filter(p => !yaAsignados.has(p.idx)), lineas);
  const creadas: Array<Emparejamiento & { opcionId: number }> = [];
  for (const a of asignaciones) {
    const { opcionId } = await crearOpcionDesdeProducto({ negocioId, filaId: a.filaId, extraccionId, productoIdx: a.productoIdx, data: ex.data, documentoUrl: ex.documentoUrl, documentoNombre: ex.documentoNombre || 'documento', actor });
    creadas.push({ ...a, opcionId });
  }
  return { creadas, sinEmparejar };
}

/** Asignación manual: este producto de la cotización es una opción de esta línea. */
export async function asignarProductoALinea(negocioId: number, extraccionId: number, productoIdx: number, filaId: string, actor: Actor): Promise<number> {
  const ex = await extraccionPorId(extraccionId);
  if (!ex?.data || !ex.documentoUrl) throw new Error('La extracción no existe o no se pudo leer.');
  const lineas = lineasAuditables(await cargarEstadoCosteo(negocioId));
  if (!lineas.some(l => l.id === filaId)) throw new Error('Esa línea no existe en el Costeo de este negocio.');
  if (!normalizarExtraccion(ex.data)[productoIdx]) throw new Error('Ese producto no existe en la extracción.');
  const [ya] = await pool.query(`SELECT r.id FROM auditor_respaldo r JOIN auditor_opcion o ON o.id = r.opcion_id WHERE r.extraccion_id = ? AND r.producto_idx = ? AND r.vigente = 1 AND o.estado <> 'descartada'`, [extraccionId, productoIdx]) as any;
  if ((ya as any[]).length) throw new Error('Ese producto ya está asignado a una opción: cámbiale la línea o quítalo primero.');
  return (await crearOpcionDesdeProducto({ negocioId, filaId, extraccionId, productoIdx, data: ex.data, documentoUrl: ex.documentoUrl, documentoNombre: ex.documentoNombre || 'documento', actor })).opcionId;
}

/** Lee un documento de Documentos con el Lector y crea las opciones que se puedan emparejar. */
export async function leerDocumentoYCrearOpciones(negocioId: number, url: string, nombre: string, actor: Actor) {
  // Un documento ya leído con éxito no se vuelve a leer (el Lector lee UNA sola vez): solo se re-aplica el emparejamiento.
  const [previas] = await pool.query(
    `SELECT id FROM auditor_extraccion WHERE negocio_id = ? AND documento_url = ? AND error IS NULL ORDER BY id DESC LIMIT 1`, [negocioId, url]) as any;
  if ((previas as any[]).length) {
    const id = (previas as any[])[0].id as number;
    return { extraccionId: id, error: null, yaLeida: true, ...(await crearOpcionesDesdeExtraccion(negocioId, id, actor)) };
  }
  const lectura = await leerYGuardarDocumento({ negocioId, url, nombre, modo: 'comercial' });
  if (lectura.error) return { extraccionId: lectura.id, error: lectura.error, yaLeida: false, creadas: [] as Array<Emparejamiento & { opcionId: number }>, sinEmparejar: [] as number[] };
  const r = await crearOpcionesDesdeExtraccion(negocioId, lectura.id, actor);
  return { extraccionId: lectura.id, error: null, yaLeida: false, ...r };
}

export interface ResultadoReanalisis { error: string | null; extraccionId: number | null; actualizadas: number; sinEquivalente: number; creadas: number; sinEmparejar: number; metodo: string | null }

/** RE-ANÁLISIS de UNA cotización (botón «Volver a leer»): la lee de nuevo con los dos OCR juntos, sin tocar la lectura anterior (queda en el historial).
 *  Los respaldos de opciones que salían de la lectura vieja pasan a la nueva cuando el producto se reconoce (el respaldo viejo queda NO vigente, con su precio,
 *  y nace uno nuevo: el costo no se sobrescribe). Lo que no tiene equivalente en la lectura nueva queda como estaba pero sin vigencia, para que se vea. */
export async function releerDocumento(negocioId: number, url: string, nombre: string, actor: Actor): Promise<ResultadoReanalisis> {
  const vacio = { extraccionId: null, actualizadas: 0, sinEquivalente: 0, creadas: 0, sinEmparejar: 0, metodo: null as string | null };
  const [viejas] = await pool.query(`SELECT id FROM auditor_extraccion WHERE negocio_id = ? AND documento_url = ? AND error IS NULL`, [negocioId, url]) as any;
  const idsViejos = (viejas as any[]).map(r => r.id as number);
  const lectura = await leerYGuardarDocumento({ negocioId, url, nombre, modo: 'comercial', combinarOCR: true });
  if (lectura.error) return { ...vacio, error: lectura.error };
  const nueva = await extraccionPorId(lectura.id);
  if (!nueva?.data) return { ...vacio, error: 'La lectura nueva quedó vacía.' };
  const nuevos = normalizarExtraccion(nueva.data);
  let actualizadas = 0, sinEquivalente = 0;

  if (idsViejos.length) {
    const viejasData = await extraccionesPorIds(idsViejos);
    const [resp] = await pool.query(`SELECT * FROM auditor_respaldo WHERE extraccion_id IN (?) AND vigente = 1`, [idsViejos]) as any;
    const ahora = ahoraChileSQL();
    for (const r of resp as any[]) {
      const viejo = viejasData.get(r.extraccion_id)?.data ? normalizarExtraccion(viejasData.get(r.extraccion_id)!.data!)[r.producto_idx] : null;
      const idxNuevo = viejo ? emparejarProductoReleido(viejo, nuevos) : null;
      await pool.query(`UPDATE auditor_respaldo SET vigente = 0, sostiene_costo = 0 WHERE id = ?`, [r.id]);   // el viejo se conserva con su precio: historial
      if (idxNuevo == null) { sinEquivalente++; await evento(negocioId, r.opcion_id, 'documento_nuevo', 'lector', `Re-análisis de ${nombre}: el producto ya no aparece en la lectura nueva; el respaldo anterior quedó sin vigencia.`); continue; }
      const p = nuevos[idxNuevo];
      await pool.query(
        `INSERT INTO auditor_respaldo (opcion_id, negocio_id, tipo, url, documento_url, documento_nombre, precio_declarado, precio_iva, vigente, sostiene_costo,
           origen, cargado_por, cargado_por_nombre, cargado_at, extraccion_id, producto_idx)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'lector', ?, ?, ?, ?, ?)`,
        [r.opcion_id, negocioId, r.tipo, r.url, r.documento_url, r.documento_nombre, p.precio, p.iva, r.sostiene_costo, actor.id, actor.nombre, ahora, lectura.id, idxNuevo]);
      actualizadas++;
      const antes = num(r.precio_declarado);
      await evento(negocioId, r.opcion_id, 'documento_nuevo', 'lector', `Re-análisis de ${nombre}: ${p.nombre} pasó de ${antes != null ? '$' + Math.round(antes).toLocaleString('es-CL') : 'sin precio'} a ${p.precio != null ? '$' + Math.round(p.precio).toLocaleString('es-CL') : 'sin precio'}.`);
    }
  }
  const r = await crearOpcionesDesdeExtraccion(negocioId, lectura.id, actor);
  return { error: null, extraccionId: lectura.id, actualizadas, sinEquivalente, creadas: r.creadas.length, sinEmparejar: r.sinEmparejar.length, metodo: nueva.data.metodoTexto };
}

// ── Ciclo de vida: vía, descarte, firma, aprobación ──────────────────────────────────────────────
async function opcionDe(negocioId: number, opcionId: number): Promise<any> {
  const [rows] = await pool.query(`SELECT * FROM auditor_opcion WHERE id = ? AND negocio_id = ?`, [opcionId, negocioId]) as any;
  const o = (rows as any[])[0];
  if (!o) throw new Error('La opción no existe en este negocio.');
  return o;
}

export async function cambiarVia(negocioId: number, opcionId: number, via: 'liviana' | 'completa'): Promise<void> {
  const o = await opcionDe(negocioId, opcionId);
  if (o.via === via) return;
  // Regla obligatoria (spec §5): una línea con exigencias que pueden dejarnos fuera exige la vía completa.
  if (via === 'liviana') {
    const linea = lineasAuditables(await cargarEstadoCosteo(negocioId)).find(l => l.id === o.fila_id);
    if (linea?.lineaReal != null && (await lineasQueExigenViaCompleta(negocioId)).has(linea.lineaReal))
      throw new Error('Esta línea tiene exigencias que pueden dejarnos fuera: requiere verificación completa.');
  }
  await pool.query(`UPDATE auditor_opcion SET via = ?, actualizado_at = ? WHERE id = ?`, [via, ahoraChileSQL(), opcionId]);
}

export async function descartarOpcion(negocioId: number, opcionId: number, motivo: string): Promise<void> {
  if (!motivo.trim()) throw new Error('Indica el motivo del descarte.');
  const o = await opcionDe(negocioId, opcionId);
  if (o.estado === 'aprobada') throw new Error('Una opción aprobada no se descarta: pide rechazarla primero.');
  await pool.query(`UPDATE auditor_opcion SET estado = 'descartada', motivo_descarte = ?, actualizado_at = ? WHERE id = ?`, [motivo.trim().slice(0, 480), ahoraChileSQL(), opcionId]);
  await evento(negocioId, opcionId, 'descartada', 'asistente', motivo.trim().slice(0, 480));
}

/** Cambia una opción a OTRA línea del costeo (cuando el documento o el link quedó en la línea equivocada). Solo si aún no se firmó:
 *  la verificación técnica guardada era contra los requisitos de la línea anterior, así que se retira; la de costo se recalcula sola. */
export async function moverOpcionALinea(negocioId: number, opcionId: number, filaId: string, actor: Actor): Promise<void> {
  const o = await opcionDe(negocioId, opcionId);
  if (['definitiva', 'en_aprobacion', 'aprobada'].includes(o.estado)) throw new Error('Esta opción ya se firmó: quita la firma antes de moverla de línea.');
  if (o.fila_id === filaId) return;
  const destino = lineasAuditables(await cargarEstadoCosteo(negocioId)).find(l => l.id === filaId);
  if (!destino) throw new Error('La línea de destino no existe en el Costeo.');
  const nuevoEstado = o.estado === 'descartada' ? 'descartada' : (['link', 'manual', 'ficha'].includes(o.origen) ? 'tanteo' : 'formalizada');
  await pool.query(`UPDATE auditor_opcion SET fila_id = ?, estado = ?, actualizado_at = ? WHERE id = ?`, [filaId, nuevoEstado, ahoraChileSQL(), opcionId]);
  const [del] = await pool.query(`DELETE FROM auditor_verificacion_tecnica WHERE opcion_id = ?`, [opcionId]) as any;
  await evento(negocioId, opcionId, 'movida_de_linea', actor.nombre ? 'asistente' : 'sistema',
    `De la línea ${o.fila_id} a "${destino.detalle.split(' - ')[0]}" (${filaId}) por ${actor.nombre}. Se retiraron ${del?.affectedRows ?? 0} verificación(es) técnica(s) hechas contra la línea anterior.`);
}

export async function restaurarOpcion(negocioId: number, opcionId: number): Promise<void> {
  const o = await opcionDe(negocioId, opcionId);
  if (o.estado !== 'descartada') return;
  await pool.query(`UPDATE auditor_opcion SET estado = 'tanteo', motivo_descarte = NULL, actualizado_at = ? WHERE id = ?`, [ahoraChileSQL(), opcionId]);
}

/** Estado calculado hoy de la opción (para validar firma sin depender de que el panel esté al día). */
export async function verificacionActual(negocioId: number, licitacionCodigo: string, opcionId: number): Promise<OpcionDTO> {
  const panel = await armarPanelAuditor(negocioId, licitacionCodigo);
  for (const l of panel.lineas) { const o = l.opciones.find(x => x.id === opcionId); if (o) return o; }
  throw new Error('La opción no está en el panel (¿su línea ya no existe en el Costeo?).');
}

export async function firmarOpcion(negocioId: number, licitacionCodigo: string, opcionId: number, actor: Actor, esEM: boolean): Promise<void> {
  const o = await opcionDe(negocioId, opcionId);
  if (o.estado === 'descartada') throw new Error('La opción está descartada.');
  if (['definitiva', 'en_aprobacion', 'aprobada'].includes(o.estado)) throw new Error('La opción ya está firmada.');
  const [otras] = await pool.query(`SELECT id FROM auditor_opcion WHERE negocio_id = ? AND fila_id = ? AND id <> ? AND estado IN ('definitiva','en_aprobacion','aprobada')`, [negocioId, o.fila_id, opcionId]) as any;
  if ((otras as any[]).length) throw new Error('Esta línea ya tiene otra opción definitiva: quítale la firma primero.');
  const actual = await verificacionActual(negocioId, licitacionCodigo, opcionId);
  const v = actual.verificacion;
  if (!v) throw new Error('La opción no tiene verificación.');
  if (v.bloqueos.length) throw new Error(`No se puede firmar con bloqueos abiertos: ${v.bloqueos.map(b => b.codigo).join(', ')}.`);
  const t = actual.tecnico;
  if (t.estado === 'NO_CORRIDO') throw new Error('La verificación técnica todavía no corrió sobre esta opción: córrela antes de firmar (o pásala a vía liviana si la línea lo permite).');
  if (t.resultado && t.resultado.bloqueos.length) throw new Error(`No se puede firmar con bloqueos técnicos abiertos: ${t.resultado.bloqueos.slice(0, 4).map(b => `ítem ${b.item}`).join(', ')}${t.resultado.bloqueos.length > 4 ? '…' : ''}.`);
  if (v.requiereHabilitacion && !esEM) throw new Error('El respaldo es informal: la firma requiere habilitación del EM (jefe de ventas o admin).');
  await pool.query(`UPDATE auditor_opcion SET estado = 'definitiva', firmada_por = ?, firmada_por_nombre = ?, firmada_at = ?, actualizado_at = ? WHERE id = ?`,
    [actor.id, actor.nombre, ahoraChileSQL(), ahoraChileSQL(), opcionId]);
  await evento(negocioId, opcionId, 'firmada', 'asistente', `Firmada por ${actor.nombre}`);
}

export async function quitarFirma(negocioId: number, opcionId: number): Promise<void> {
  const o = await opcionDe(negocioId, opcionId);
  if (o.estado === 'aprobada') throw new Error('La opción está aprobada: pide rechazarla primero.');
  if (!['definitiva', 'en_aprobacion'].includes(o.estado)) return;
  await pool.query(`UPDATE auditor_opcion SET estado = 'verificada', firmada_por = NULL, firmada_por_nombre = NULL, firmada_at = NULL, actualizado_at = ? WHERE id = ?`, [ahoraChileSQL(), opcionId]);
  await evento(negocioId, opcionId, 'firma_retirada', 'asistente', null);
}

/** Pasada final: revalida la opción con la verificación de hoy y, sin bloqueos, la pasa a EN APROBACIÓN. */
export async function solicitarAprobacion(negocioId: number, licitacionCodigo: string, opcionId: number, actor: Actor): Promise<{ cambios: string[] }> {
  const o = await opcionDe(negocioId, opcionId);
  if (o.estado !== 'definitiva') throw new Error('Solo se solicita aprobación de una opción definitiva (firmada).');
  // PASADA FINAL automática (spec §11.2): revisita el link que sostiene el costo y compara contra la captura anterior.
  const cambios = await revisitarLinkDeOpcion(negocioId, opcionId, actor);
  // Segunda pasada de rojos (Prompt 4 v2.0 Parte IX): relee los documentos ORIGINALES y reconfirma cada 🔴 declarado CUMPLE.
  let l2: { revisados: number; rectificados: number } | null = null;
  try { l2 = await segundaPasadaTecnica({ negocioId, opcionId, actor }); } catch (e) { cambios.push(`No se pudo completar la segunda pasada técnica: ${e instanceof Error ? e.message : String(e)}`); }
  if (l2?.rectificados) cambios.push(`La segunda pasada rectificó ${l2.rectificados} de ${l2.revisados} ítems críticos.`);
  const actual = await verificacionActual(negocioId, licitacionCodigo, opcionId);
  const v = actual.verificacion;
  const bloqTec = actual.tecnico.resultado?.bloqueos ?? [];
  if (!v || v.bloqueos.length || bloqTec.length)
    throw new Error(`La pasada final encontró bloqueos: ${[...(v?.bloqueos || []).map(b => `${b.codigo} — ${b.mensaje}`), ...bloqTec.slice(0, 3).map(b => `${b.codigo} ítem ${b.item}`)].join(' | ') || 'sin verificación'}${cambios.length ? ` · ${cambios.join(' ')}` : ''}`);
  await pool.query(`UPDATE auditor_opcion SET estado = 'en_aprobacion', actualizado_at = ? WHERE id = ?`, [ahoraChileSQL(), opcionId]);
  await evento(negocioId, opcionId, 'aprobacion_solicitada', 'asistente', cambios.join(' ') || null);
  return { cambios };
}

export async function resolverAprobacion(negocioId: number, opcionId: number, decision: 'aprobar' | 'rechazar', comentario: string | null, actor: Actor): Promise<void> {
  const o = await opcionDe(negocioId, opcionId);
  if (o.estado !== 'en_aprobacion') throw new Error('La opción no está en aprobación.');
  if (decision === 'rechazar') {
    if (!comentario?.trim()) throw new Error('El rechazo requiere un comentario.');
    await pool.query(`UPDATE auditor_opcion SET estado = 'verificada', firmada_por = NULL, firmada_por_nombre = NULL, firmada_at = NULL, actualizado_at = ? WHERE id = ?`, [ahoraChileSQL(), opcionId]);
    await evento(negocioId, opcionId, 'rechazada', 'em', `${actor.nombre}: ${comentario.trim().slice(0, 400)}`);
    return;
  }
  await pool.query(`UPDATE auditor_opcion SET estado = 'aprobada', actualizado_at = ? WHERE id = ?`, [ahoraChileSQL(), opcionId]);
  await evento(negocioId, opcionId, 'aprobada', 'em', `Aprobada por ${actor.nombre}${comentario?.trim() ? `: ${comentario.trim().slice(0, 400)}` : ''}`);
}

// ── Opción manual y ficha técnica ────────────────────────────────────────────────────────────────
/** Crea una opción SIN link ni cotización (el producto no está en la web): línea + marca/modelo (+ proveedor si se sabe).
 *  Sirve de base para subirle después la ficha técnica y compararla contra las bases. */
export async function crearOpcionManual(negocioId: number, filaId: string,
  d: { marca?: string | null; modelo?: string | null; sku?: string | null; proveedor?: string | null }, actor: Actor): Promise<number> {
  const lineas = lineasAuditables(await cargarEstadoCosteo(negocioId));
  if (!lineas.some(l => l.id === filaId)) throw new Error('Esa línea no existe en el Costeo de este negocio.');
  const marca = (d.marca || '').trim().slice(0, 120), modelo = (d.modelo || '').trim().slice(0, 160);
  const sku = (d.sku || '').trim().slice(0, 120), proveedor = (d.proveedor || '').trim().slice(0, 200);
  if (!marca && !modelo) throw new Error('Indica al menos la marca o el modelo del producto.');
  const [existentes] = await pool.query(
    `SELECT id, marca, modelo, proveedor_razon_social FROM auditor_opcion WHERE negocio_id = ? AND fila_id = ? AND estado <> 'descartada'`, [negocioId, filaId]) as any;
  const igual = (existentes as any[]).find(o => coincidenciaIdentidad({ marca: o.marca, modelo: o.modelo }, { marca, modelo }) === 'coincide'
    && (o.proveedor_razon_social || '').trim().toLowerCase() === proveedor.toLowerCase());
  if (igual) return igual.id;
  const ahora = ahoraChileSQL();
  const [ins] = await pool.query(
    `INSERT INTO auditor_opcion (negocio_id, fila_id, marca, modelo, sku_proveedor, proveedor_razon_social, via, estado, origen, creado_por, creado_por_nombre, creado_at, actualizado_at)
     VALUES (?, ?, ?, ?, ?, ?, 'completa', 'tanteo', 'manual', ?, ?, ?, ?)`,
    [negocioId, filaId, marca || null, modelo || null, sku || null, proveedor || null, actor.id, actor.nombre, ahora, ahora]) as any;
  await evento(negocioId, ins.insertId, 'opcion_creada', 'asistente', `Opción manual creada por ${actor.nombre}`);
  return ins.insertId as number;
}

export type ResultadoFicha =
  | { estado: 'agregada'; opcionId: number; opcionCreada: boolean; avisos: string[] }
  | { estado: 'elegir_producto'; extraccionId: number; opcionId: number | null; productos: Array<{ idx: number; nombre: string }>; motivo: string }
  | { estado: 'producto_distinto'; extraccionId: number; opcionId: number; productoIdx: number; marca: string; modelo: string }
  | { estado: 'error'; error: string };

/** Sube una FICHA TÉCNICA (PDF o imagen) a una opción — o a una línea, y entonces la opción nace de la ficha —. El Lector la lee en modo
 *  COMPLETO (todas las características) y queda como respaldo `ficha_tecnica` (origen FICHA para el verificador técnico). Una ficha no
 *  trae precio, así que nunca sostiene el costo. Antes de aceptarla se confirma que corresponde al producto de la opción (Prompt 4 v2.0
 *  Parte III): otro modelo → evento `producto_cambiado` y NO se usa contra la opción; catálogo con varios modelos → hay que elegir. */
export async function agregarFichaAOpcion(params: {
  negocioId: number; opcionId?: number | null; filaId?: string | null; url: string; nombre: string;
  productoIdx?: number | null; forzar?: boolean; actor: Actor;
}): Promise<ResultadoFicha> {
  const { negocioId, url, nombre, actor, forzar = false } = params;
  let opcion: any = null, filaId = params.filaId || null;
  if (params.opcionId) { opcion = await opcionDe(negocioId, params.opcionId); filaId = opcion.fila_id; }
  if (!filaId) return { estado: 'error', error: 'Indica la opción o la línea a la que pertenece la ficha.' };
  if (opcion?.estado === 'descartada') return { estado: 'error', error: 'La opción está descartada: restáurala antes de subirle una ficha.' };
  if (opcion && ['en_aprobacion', 'aprobada'].includes(opcion.estado)) return { estado: 'error', error: 'La opción ya está en aprobación: pide rechazarla antes de cambiar sus documentos.' };
  if (!lineasAuditables(await cargarEstadoCosteo(negocioId)).some(l => l.id === filaId)) return { estado: 'error', error: 'Esa línea no existe en el Costeo de este negocio.' };

  // El Lector lee UNA sola vez cada documento.
  const [previas] = await pool.query(`SELECT id FROM auditor_extraccion WHERE negocio_id = ? AND documento_url = ? AND error IS NULL AND modo = 'completo' ORDER BY id DESC LIMIT 1`, [negocioId, url]) as any;
  let extraccionId: number;
  if ((previas as any[]).length) extraccionId = (previas as any[])[0].id;
  else {
    const lectura = await leerYGuardarDocumento({ negocioId, url, nombre, modo: 'completo' });
    if (lectura.error) return { estado: 'error', error: `No se pudo leer la ficha: ${lectura.error}` };
    extraccionId = lectura.id;
  }
  const ex = await extraccionPorId(extraccionId);
  if (!ex?.data) return { estado: 'error', error: 'La ficha se leyó, pero la extracción quedó vacía.' };
  const productos = normalizarExtraccion(ex.data).filter(p => !p.esCargo);
  if (productos.length === 0) return { estado: 'error', error: 'No se encontró ningún producto en la ficha (¿es un documento legible?).' };

  const idOpcion = { marca: opcion?.marca, modelo: opcion?.modelo, sku: opcion?.sku_proveedor };
  let elegido = params.productoIdx != null ? productos.find(p => p.idx === params.productoIdx) : undefined;
  if (params.productoIdx != null && !elegido) return { estado: 'error', error: 'Ese producto no está en la ficha.' };
  if (!elegido) {
    if (opcion) {
      const coinciden = productos.filter(p => coincidenciaIdentidad(idOpcion, p) === 'coincide');
      if (coinciden.length === 1) elegido = coinciden[0];
      else if (coinciden.length > 1) return { estado: 'elegir_producto', extraccionId, opcionId: opcion.id, productos: coinciden.map(p => ({ idx: p.idx, nombre: p.nombre })), motivo: 'Hay más de un producto que calza con la opción: elige el que corresponde.' };
      else if (productos.length === 1) {
        const c = coincidenciaIdentidad(idOpcion, productos[0]);
        if (c === 'distinto' && !forzar) {
          await evento(negocioId, opcion.id, 'producto_cambiado', 'sistema', `La ficha "${nombre}" es de ${productos[0].marca} ${productos[0].modelo}; la opción es ${opcion.marca || ''} ${opcion.modelo || ''}. No se usó contra la opción.`);
          return { estado: 'producto_distinto', extraccionId, opcionId: opcion.id, productoIdx: productos[0].idx, marca: productos[0].marca, modelo: productos[0].modelo };
        }
        elegido = productos[0];
      } else return { estado: 'elegir_producto', extraccionId, opcionId: opcion.id, productos: productos.map(p => ({ idx: p.idx, nombre: p.nombre })), motivo: 'El documento trae varios modelos y ninguno calza con la opción: elige la columna que corresponde (o sube la ficha del modelo correcto).' };
    } else if (productos.length === 1) elegido = productos[0];
    else return { estado: 'elegir_producto', extraccionId, opcionId: null, productos: productos.map(p => ({ idx: p.idx, nombre: p.nombre })), motivo: 'El documento trae varios modelos: elige para cuál es esta opción.' };
  }

  const avisos: string[] = [];
  let opcionCreada = false;
  if (!opcion) {
    // Sin opción de partida: si la línea ya tiene una del mismo producto, la ficha se suma a esa; si no, nace la opción de la ficha.
    const [existentes] = await pool.query(`SELECT * FROM auditor_opcion WHERE negocio_id = ? AND fila_id = ? AND estado NOT IN ('descartada','en_aprobacion','aprobada')`, [negocioId, filaId]) as any;
    opcion = (existentes as any[]).find(o => coincidenciaIdentidad({ marca: o.marca, modelo: o.modelo, sku: o.sku_proveedor }, elegido!) === 'coincide') || null;
    if (!opcion) {
      if (!elegido.marca && !elegido.modelo) return { estado: 'error', error: 'La ficha no dice la marca ni el modelo del producto: crea la opción a mano (marca y modelo) y súbela ahí.' };
      const id = await crearOpcionManual(negocioId, filaId, { marca: elegido.marca, modelo: elegido.modelo, sku: elegido.sku }, actor);
      await pool.query(`UPDATE auditor_opcion SET origen = 'ficha', version_producto = ? WHERE id = ?`, [elegido.version || null, id]);
      opcion = await opcionDe(negocioId, id);
      opcionCreada = true;
    }
  } else if (coincidenciaIdentidad(idOpcion, elegido) === 'sin_dato' && (idOpcion.marca || idOpcion.modelo)) {
    avisos.push('La ficha no identifica claramente el modelo: se usó porque nada la contradice. Revisa que sea la del producto.');
  }

  const [ya] = await pool.query(`SELECT id FROM auditor_respaldo WHERE opcion_id = ? AND documento_url = ? AND producto_idx = ?`, [opcion.id, url, elegido.idx]) as any;
  if (!(ya as any[]).length) {
    const ahora = ahoraChileSQL();
    const [r] = await pool.query(
      `INSERT INTO auditor_respaldo (opcion_id, negocio_id, tipo, url, documento_url, documento_nombre, precio_declarado, precio_iva, vigente, sostiene_costo,
         origen, cargado_por, cargado_por_nombre, cargado_at, extraccion_id, producto_idx)
       VALUES (?, ?, 'ficha_tecnica', NULL, ?, ?, NULL, 'no_declarado', 1, 0, 'ficha', ?, ?, ?, ?, ?)`,
      [opcion.id, negocioId, url, nombre.slice(0, 300), actor.id, actor.nombre, ahora, extraccionId, elegido.idx]) as any;
    await pool.query(`UPDATE auditor_extraccion SET opcion_id = ?, respaldo_id = ? WHERE id = ? AND opcion_id IS NULL`, [opcion.id, r.insertId, extraccionId]).catch(() => { /* la extracción puede servir a varias opciones */ });
    // Lo que la opción no traía (manual sin modelo, por ejemplo) se completa desde la ficha; nunca se pisa lo que ya tenía.
    await pool.query(
      `UPDATE auditor_opcion SET marca = COALESCE(NULLIF(marca, ''), ?), modelo = COALESCE(NULLIF(modelo, ''), ?), version_producto = COALESCE(NULLIF(version_producto, ''), ?),
         sku_proveedor = COALESCE(NULLIF(sku_proveedor, ''), ?), actualizado_at = ? WHERE id = ?`,
      [elegido.marca || null, elegido.modelo || null, elegido.version || null, elegido.sku || null, ahoraChileSQL(), opcion.id]);
    await evento(negocioId, opcion.id, 'documento_nuevo', 'lector', `Ficha técnica: ${nombre}`);
  }
  return { estado: 'agregada', opcionId: opcion.id, opcionCreada, avisos };
}

// ── Links: captura fechada → Lector → opción en TANTEO ───────────────────────────────────────────
async function guardarCaptura(negocioId: number, cap: Awaited<ReturnType<typeof visitarLinks>>[number], origen: 'alta' | 'pasada_final'): Promise<number> {
  const hash = createHash('sha256').update(cap.texto || '').digest('hex');
  const [r] = await pool.query(
    `INSERT INTO auditor_captura (negocio_id, url, url_final, estado_link, http_status, titulo, texto, hash_texto, imagen, metodo, origen, capturado_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [negocioId, cap.url.slice(0, 1000), cap.urlFinal ? cap.urlFinal.slice(0, 1000) : null, cap.estado, cap.httpStatus, (cap.titulo || '').slice(0, 400),
      cap.texto, hash, cap.imagen, cap.metodo, origen, cap.capturadoAt]) as any;
  return r.insertId as number;
}

/** Opción cuyo link no se pudo leer (caído, redirige, sin texto): queda registrada igual — eso también es evidencia —
 *  y la verificación la marca SIN RESPALDO con su ruta de salida. */
async function crearOpcionSinLectura(negocioId: number, filaId: string, url: string, titulo: string, capturaId: number, actor: Actor): Promise<number> {
  const ahora = ahoraChileSQL();
  const [ins] = await pool.query(
    `INSERT INTO auditor_opcion (negocio_id, fila_id, proveedor_razon_social, via, estado, origen, creado_por, creado_por_nombre, creado_at, actualizado_at)
     VALUES (?, ?, ?, 'completa', 'tanteo', 'link', ?, ?, ?, ?)`, [negocioId, filaId, hostDe(url) || null, actor.id, actor.nombre, ahora, ahora]) as any;
  const opcionId = ins.insertId as number;
  const [r] = await pool.query(
    `INSERT INTO auditor_respaldo (opcion_id, negocio_id, tipo, url, documento_nombre, precio_iva, vigente, sostiene_costo, origen, cargado_por, cargado_por_nombre, cargado_at)
     VALUES (?, ?, 'link_web', ?, ?, 'no_declarado', 1, 1, 'sistema', ?, ?, ?)`, [opcionId, negocioId, url, titulo.slice(0, 300) || null, actor.id, actor.nombre, ahora]) as any;
  await pool.query(`UPDATE auditor_captura SET opcion_id = ?, respaldo_id = ? WHERE id = ?`, [opcionId, r.insertId, capturaId]);
  await evento(negocioId, opcionId, 'documento_nuevo', 'sistema', `Link ${hostDe(url)} sin lectura`);
  return opcionId;
}

/** El asistente registra un link de tanteo en una línea. El SISTEMA visita la página y guarda la captura fechada; el Lector
 *  extrae precio, IVA, marca, modelo y especificaciones (el modelo no navega); se crea la opción en TANTEO. */
export async function agregarLinkALinea(negocioId: number, filaId: string, urlEntrada: string, actor: Actor): Promise<{ opcionId: number | null; estadoLink: string; error: string | null }> {
  const lineas = lineasAuditables(await cargarEstadoCosteo(negocioId));
  if (!lineas.some(l => l.id === filaId)) throw new Error('Esa línea no existe en el Costeo de este negocio.');
  const url = normalizarUrl(urlEntrada);
  try { new URL(url); } catch { throw new Error('El link no es una dirección válida.'); }
  // Un mismo link no se registra dos veces en la misma línea.
  const [ya] = await pool.query(
    `SELECT o.id FROM auditor_opcion o JOIN auditor_respaldo r ON r.opcion_id = o.id WHERE o.negocio_id = ? AND o.fila_id = ? AND o.estado <> 'descartada' AND r.url = ? LIMIT 1`, [negocioId, filaId, url]) as any;
  if ((ya as any[]).length) return { opcionId: (ya as any[])[0].id, estadoLink: 'ya_registrado', error: null };

  const [cap] = await visitarLinks([url]);
  const capturaId = await guardarCaptura(negocioId, cap, 'alta');
  if (cap.estado === 'caido' || cap.estado === 'redirige' || cap.estado === 'login') {
    const opcionId = await crearOpcionSinLectura(negocioId, filaId, url, cap.titulo, capturaId, actor);
    return { opcionId, estadoLink: cap.estado, error: null };
  }
  const lectura = await leerYGuardarPaginaWeb({ negocioId, url, titulo: cap.titulo, texto: cap.texto, modo: 'completo' });
  const ex = lectura.error ? null : await extraccionPorId(lectura.id);
  const productos = ex?.data ? normalizarExtraccion(ex.data) : [];
  const idxPrincipal = Math.max(0, (ex?.data?.salida.productos || []).findIndex(p => p.es_producto_principal));
  if (!ex?.data || ex.data.salida.documento?.es_listado_web || !productos[idxPrincipal] || productos[idxPrincipal].precio == null) {
    const opcionId = await crearOpcionSinLectura(negocioId, filaId, url, cap.titulo, capturaId, actor);
    return { opcionId, estadoLink: cap.estado, error: lectura.error || (ex?.data?.salida.documento?.es_listado_web ? 'La página es un listado, no la ficha de un producto.' : 'No se encontró un precio legible en la página.') };
  }
  const { opcionId } = await crearOpcionDesdeProducto({
    negocioId, filaId, extraccionId: lectura.id, productoIdx: idxPrincipal, data: ex.data, documentoUrl: url,
    documentoNombre: cap.titulo || hostDe(url), actor, link: { capturaId },
  });
  return { opcionId, estadoLink: cap.estado, error: null };
}

/** Links del Costeo (link1..link3 de cada fila) que todavía no son una opción: lo que "Traer links del costeo" registra. */
export async function linksPendientesDelCosteo(negocioId: number, lineasYa?: LineaCosteo[]): Promise<Array<{ filaId: string; item: number; url: string }>> {
  const lineas = lineasYa ?? lineasAuditables(await cargarEstadoCosteo(negocioId));
  const [regs] = await pool.query(
    `SELECT o.fila_id, r.url FROM auditor_opcion o JOIN auditor_respaldo r ON r.opcion_id = o.id WHERE o.negocio_id = ? AND r.url IS NOT NULL`, [negocioId]) as any;
  const usados = new Set((regs as any[]).map(r => `${r.fila_id}|${r.url}`));
  const out: Array<{ filaId: string; item: number; url: string }> = [];
  for (const l of lineas) for (const raw of l.links) {
    const url = normalizarUrl(raw);
    if (!usados.has(`${l.id}|${url}`)) out.push({ filaId: l.id, item: l.item, url });
  }
  return out;
}

/** Pasada final (Prompt 5 §0.2): vuelve a visitar el link que sostiene el costo, guarda una captura nueva, la lee y compara
 *  contra la anterior. Si el precio o el IVA cambiaron nace un respaldo nuevo (el costo no se sobrescribe); si no, la captura
 *  nueva queda ligada al respaldo vigente. Devuelve lo que cambió, en lenguaje simple. */
export async function revisitarLinkDeOpcion(negocioId: number, opcionId: number, actor: Actor): Promise<string[]> {
  await opcionDe(negocioId, opcionId);
  const [rs] = await pool.query(
    `SELECT * FROM auditor_respaldo WHERE opcion_id = ? AND tipo = 'link_web' AND vigente = 1 AND sostiene_costo = 1 ORDER BY id DESC LIMIT 1`, [opcionId]) as any;
  const r = (rs as any[])[0];
  if (!r?.url) return [];
  const [cap] = await visitarLinks([r.url]);
  const capturaId = await guardarCaptura(negocioId, cap, 'pasada_final');
  await pool.query(`UPDATE auditor_captura SET opcion_id = ?, respaldo_id = ? WHERE id = ?`, [opcionId, r.id, capturaId]);
  const cambios: string[] = [];
  if (cap.estado === 'caido' || cap.estado === 'redirige' || cap.estado === 'login') {
    cambios.push(`El link ya no sirve: ${{ caido: 'no carga', redirige: 'redirige a otro producto', login: 'pide iniciar sesión' }[cap.estado]}.`);
    return cambios;
  }
  const lectura = await leerYGuardarPaginaWeb({ negocioId, url: r.url, titulo: cap.titulo, texto: cap.texto, modo: 'completo', opcionId, respaldoId: r.id });
  if (lectura.error) { cambios.push(`No se pudo releer el link: ${lectura.error}`); return cambios; }
  const ex = await extraccionPorId(lectura.id);
  const productos = ex?.data ? normalizarExtraccion(ex.data) : [];
  const nuevo = productos[Math.max(0, (ex?.data?.salida.productos || []).findIndex(p => p.es_producto_principal))];
  if (!ex?.data || !nuevo || nuevo.precio == null) { cambios.push('La página se cargó pero ya no muestra un precio legible.'); return cambios; }
  const anterior = num(r.precio_declarado);
  if ((anterior != null && nuevo.precio !== anterior) || r.precio_iva !== nuevo.iva) {
    cambios.push(`El precio del link cambió: antes ${anterior != null ? '$' + Math.round(anterior).toLocaleString('es-CL') : 'sin precio'}, hoy $${Math.round(nuevo.precio).toLocaleString('es-CL')}.`);
    await pool.query(`UPDATE auditor_respaldo SET sostiene_costo = 0 WHERE opcion_id = ?`, [opcionId]);
    const [ins] = await pool.query(
      `INSERT INTO auditor_respaldo (opcion_id, negocio_id, tipo, url, documento_nombre, precio_declarado, precio_iva, vigente, sostiene_costo, origen, cargado_por, cargado_por_nombre, cargado_at, extraccion_id, producto_idx)
       VALUES (?, ?, 'link_web', ?, ?, ?, ?, 1, 1, 'pasada_final', ?, ?, ?, ?, ?)`,
      [opcionId, negocioId, r.url, cap.titulo.slice(0, 300) || null, nuevo.precio, nuevo.iva, actor.id, actor.nombre, ahoraChileSQL(), lectura.id, nuevo.idx]) as any;
    await pool.query(`UPDATE auditor_captura SET respaldo_id = ? WHERE id = ?`, [ins.insertId, capturaId]);
    await evento(negocioId, opcionId, 'precio_cambio', 'sistema', cambios[cambios.length - 1]);
  }
  if (nuevo.stock && /sin\s+stock|agotad/i.test(nuevo.stock)) cambios.push(`El link dice "${nuevo.stock}": valida el stock con el proveedor.`);
  return cambios;
}

export async function imagenDeCapturaAuditor(negocioId: number, capturaId: number): Promise<Buffer | null> {
  const [rows] = await pool.query(`SELECT imagen FROM auditor_captura WHERE id = ? AND negocio_id = ? LIMIT 1`, [capturaId, negocioId]) as any;
  return (rows as any[])[0]?.imagen ?? null;
}


// ── Mercado: buscar referencias del MISMO producto y justificar el ahorro no usado ───────────────
export async function verificarMercadoDeOpcion(negocioId: number, opcionId: number, actor: Actor) {
  await opcionDe(negocioId, opcionId);
  return verificarMercadoOpcion({ negocioId, opcionId, actor });
}
export async function justificarAhorroDeOpcion(negocioId: number, opcionId: number, texto: string, actor: Actor): Promise<void> {
  await opcionDe(negocioId, opcionId);
  await justificarAhorro(negocioId, opcionId, texto, actor);
}

/** Corre el verificador de costo con IA (Prompt 5 v2.0) sobre UNA opción, con lo que el código ya calculó como contexto. */
export async function verificarCostoIADeOpcion(negocioId: number, licitacionCodigo: string, opcionId: number, actor: Actor) {
  const o = await opcionDe(negocioId, opcionId);
  const panel = await armarPanelAuditor(negocioId, licitacionCodigo);
  const linea = panel.lineas.find(l => l.filaId === o.fila_id), dto = linea?.opciones.find(x => x.id === opcionId);
  if (!linea || !dto) throw new Error('La opción no está en el panel (¿su línea ya no existe en el Costeo?).');
  return verificarCostoIAOpcion({
    negocioId, opcionId, actor: { id: actor.id },
    linea: { detalle: linea.detalle, unidad: linea.unidad, cantidad: linea.cantidad, costeadoNeto: linea.costeadoNeto },
    opcion: { marca: dto.marca, modelo: dto.modelo, proveedor: dto.proveedorRazonSocial, veredicto: dto.verificacion?.veredicto ?? 'SIN_RESPALDO' },
    alertasCodigo: dto.verificacion?.alertas ?? [], bloqueosCodigo: dto.verificacion?.bloqueos ?? [],
  });
}

// ── Verificación técnica: acciones ───────────────────────────────────────────────────────────────
/** Corre el verificador técnico (L1) sobre UNA opción y ejecuta sus eventos (costos asociados, descarte por ruta insalvable…). */
export async function verificarTecnicoDeOpcion(negocioId: number, licitacionCodigo: string, opcionId: number, actor: Actor) {
  const o = await opcionDe(negocioId, opcionId);
  const linea = lineasAuditables(await cargarEstadoCosteo(negocioId)).find(l => l.id === o.fila_id);
  if (!linea) throw new Error('La línea de esta opción ya no existe en el Costeo.');
  return verificarTecnicoOpcion({
    negocioId, licitacionCodigo, opcionId, actor, lineaReal: linea.lineaReal, nombreLinea: linea.detalle.split(' - ')[0] || linea.detalle, cantidad: linea.cantidad, unidad: linea.unidad,
  });
}

/** El Encargado de Mercado Público habilita un dato cuya fuente no es una ficha formal (FICHA_WEB en un 🔴, informal, declarado). */
export async function habilitarItemTecnico(negocioId: number, opcionId: number, n: number, habilitado: boolean, actor: Actor): Promise<void> {
  await opcionDe(negocioId, opcionId);
  await pool.query(`INSERT INTO auditor_evento (negocio_id, opcion_id, tipo, emisor, detalle, creado_at) VALUES (?, ?, 'habilitacion_tecnica', 'em', ?, ?)`,
    [negocioId, opcionId, JSON.stringify({ n, habilitado, por: actor.nombre }), ahoraChileSQL()]);
}

/** El asistente declara un ítem que la ficha no puede probar (cualitativo o que la ficha calla). SIEMPRE con respaldo adjunto: sin respaldo no cuenta. */
export async function declararItemTecnico(negocioId: number, opcionId: number, n: number, texto: string, respaldo: string, actor: Actor): Promise<void> {
  await opcionDe(negocioId, opcionId);
  if (!texto.trim()) throw new Error('Escribe la declaración.');
  if (!respaldo.trim()) throw new Error('Una declaración exige un respaldo adjunto (documento, foto o captura): sin respaldo no se acepta.');
  await pool.query(`INSERT INTO auditor_evento (negocio_id, opcion_id, tipo, emisor, detalle, creado_at) VALUES (?, ?, 'declaracion_tecnica', 'asistente', ?, ?)`,
    [negocioId, opcionId, JSON.stringify({ n, texto: texto.trim().slice(0, 600), respaldo: respaldo.trim().slice(0, 500), por: actor.nombre }), ahoraChileSQL()]);
}
