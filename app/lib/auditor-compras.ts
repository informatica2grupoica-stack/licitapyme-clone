// app/lib/auditor-compras.ts
// AUDITOR DE COMPRAS · VERIFICADOR DE COTIZACIONES (PROMPT 5 v1.2) — orquestación.
// Une los pasos del SISTEMA (captura de links, dólar, historial del proveedor, búsqueda de referencias,
// mercado público; ver auditor-compras-captura.ts y auditor-compras-datos.ts), las 3 llamadas al modelo
// (L1 línea, L2 triangulación, L3 lectura del resumen) y el CÓDIGO que calcula, bloquea y decide
// (auditor-compras-core.ts). El modelo es GLM-4.7 (decisión del usuario, 25-sep-2026).
//
// Qué se audita: cada línea de la TABLA_DE_COSTEO (negocio_costeo_editor). El costo "costeado" de una línea
// es el REAL que cargó Compras si existe; si no, el estimado por el asistente (valor con IVA ÷ 1,19).
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { registrarEvento } from '@/app/lib/historial';
import { crearChatIA } from '@/app/lib/gemini';
import { parseJsonIA } from '@/app/lib/json-ia';
import { MARGEN_VENTA_DEFECTO, type EstadoCosteoEditor } from '@/app/lib/costeo-editor';
import { obtenerEstadoReloj } from '@/app/lib/compras-reloj';
import { construirResumenEjecutivoCompras } from '@/app/lib/compras';
import { capturarLinks, type CapturaGuardada } from '@/app/lib/auditor-compras-captura';
import { dolarDelDia, historialProveedorMP, buscarReferencias, preciosMercadoPublico, type CandidataBusqueda, type HistorialProveedorMP } from '@/app/lib/auditor-compras-datos';
import * as P from '@/app/lib/auditor-compras-prompts';
import {
  PARAMS, aplicarGuardarrailes, calcularPosicionPrecio, calcularSistemaLinea, cambiosEntreAuditorias, derivarLinea, lineasDelCosteo,
  margenProyecto, mensajesPorProveedor, tokensDeProducto,
  type Habilitacion, type LineaCosteo, type LineaDerivada, type LineaGuardada, type PosicionPrecio, type SalidaModelo, type PrecioMercadoPublico,
} from '@/app/lib/auditor-compras-core';

const MODELO = 'glm-4.7';
const MAX_TEXTO_LINK = 6_000;
const MAX_TEXTO_COT = 5_000;

// ── Lectura del costeo ────────────────────────────────────────────────────────────────────────────
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

async function licitacionDeNegocio(negocioId: number): Promise<string | null> {
  const [rows] = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  return (rows as any[])[0]?.licitacion_codigo ?? null;
}

// ── Contexto por línea: técnico, licitación, cotizaciones, histórico ─────────────────────────────
interface ProductoTecnico { estado: 'aprobado' | 'pendiente' | 'no_existe'; marca: string; modelo: string; accesorios: string[]; titulo: string }

async function productoTecnico(negocioId: number, lineaReal: number | null): Promise<ProductoTecnico> {
  const vacio: ProductoTecnico = { estado: 'no_existe', marca: '', modelo: '', accesorios: [], titulo: '' };
  if (lineaReal == null) return vacio;
  try {
    const [rows] = await pool.query(
      `SELECT i.id, i.estado, i.titulo, lpo.marca, lpo.modelo
         FROM checklist_comercial i LEFT JOIN linea_producto_ofertado lpo ON lpo.item_id = i.id
        WHERE i.negocio_id = ? AND i.tipo = 'linea_tecnica' AND i.linea_numero = ? ORDER BY lpo.producto_index LIMIT 4`,
      [negocioId, lineaReal],
    ) as any;
    const rs = rows as any[];
    if (rs.length === 0) return vacio;
    const marcas = [...new Set(rs.map(r => r.marca).filter(Boolean))].join(' / ');
    const modelos = [...new Set(rs.map(r => r.modelo).filter(Boolean))].join(' / ');
    const [acc] = await pool.query(
      `SELECT c.descripcion FROM checklist_comercial_caracteristicas c WHERE c.item_id = ? AND c.veredicto = 'CUMPLE_CON_COMPLEMENTO' LIMIT 12`, [rs[0].id],
    ) as any;
    const aprobado = String(rs[0].estado).toUpperCase() === 'APROBADO' && !!modelos;
    return { estado: modelos || marcas ? (aprobado ? 'aprobado' : 'pendiente') : 'no_existe', marca: marcas, modelo: modelos, accesorios: (acc as any[]).map(a => String(a.descripcion)), titulo: String(rs[0].titulo || '') };
  } catch (e) { console.warn('[auditor-compras] producto técnico:', String(e).slice(0, 120)); return vacio; }
}

async function lineaDeLaLicitacion(licitacionCodigo: string | null, lineaReal: number | null): Promise<{ producto: string; cantidad: number | null; unidad: string | null } | null> {
  if (!licitacionCodigo) return null;
  const [adj] = await pool.query(`SELECT lineas FROM adjudicacion_cache WHERE licitacion_codigo = ? LIMIT 1`, [licitacionCodigo]) as any;
  try {
    const lineas = JSON.parse((adj as any[])[0]?.lineas || '[]');
    const l = Array.isArray(lineas) ? lineas.find((x: any) => lineaReal != null && Number(x.correlativo) === lineaReal) || (lineas.length === 1 ? lineas[0] : null) : null;
    return l ? { producto: [l.producto, l.descripcion].filter(Boolean).join(' — '), cantidad: l.cantidad ?? null, unidad: l.unidad ?? null } : null;
  } catch { return null; }
}

interface CotizacionRespaldo { id: number; proveedor: string; rut: string | null; fecha: string; vigencia: string | null; moneda: string; precioUnitario: number | null; plazoTexto: string | null; plazoDias: number | null; incluyeFlete: boolean | null; texto: string; origen: string }

async function cotizacionesDeLaLinea(negocioId: number, l: LineaCosteo): Promise<CotizacionRespaldo[]> {
  try {
    const [prods] = await pool.query(`SELECT id, correlativo, descripcion FROM compras_producto WHERE negocio_id = ?`, [negocioId]) as any;
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80);
    const p = (prods as any[]).find(x => l.lineaReal != null && x.correlativo === l.lineaReal && (prods as any[]).filter(y => y.correlativo === l.lineaReal).length === 1)
      ?? (prods as any[]).find(x => norm(String(x.descripcion)) === norm(l.detalle));
    if (!p) return [];
    const [rows] = await pool.query(
      `SELECT c.id, c.proveedor_nombre, c.proveedor_rut, c.origen, c.descripcion_libre, c.texto_documento, c.moneda, c.plazo_entrega_texto, c.plazo_entrega_dias,
              c.incluye_flete, DATE_FORMAT(c.tomada_at, '%Y-%m-%d') AS tomada, DATE_FORMAT(c.vigencia_at, '%Y-%m-%d') AS vigencia, i.precio_unitario
         FROM compras_cotizacion c JOIN compras_cotizacion_item i ON i.cotizacion_id = c.id
        WHERE c.negocio_id = ? AND i.producto_id = ? ORDER BY c.tomada_at DESC LIMIT 3`,
      [negocioId, p.id],
    ) as any;
    return (rows as any[]).map(r => ({
      id: r.id, proveedor: r.proveedor_nombre, rut: r.proveedor_rut, fecha: r.tomada, vigencia: r.vigencia, moneda: r.moneda || 'CLP',
      precioUnitario: r.precio_unitario != null ? Number(r.precio_unitario) : null, plazoTexto: r.plazo_entrega_texto, plazoDias: r.plazo_entrega_dias,
      incluyeFlete: r.incluye_flete == null ? null : !!r.incluye_flete, origen: r.origen,
      texto: [r.texto_documento, r.descripcion_libre].filter(Boolean).join('\n\n').slice(0, MAX_TEXTO_COT),
    }));
  } catch (e) { console.warn('[auditor-compras] cotizaciones:', String(e).slice(0, 120)); return []; }
}

/** HISTORICO_INTERNO: compras reales nuestras (Obuma) del mismo producto — solo si el SKU calza de forma exacta. */
async function historicoInterno(l: LineaCosteo): Promise<Array<{ id: number; nombre: string; precio: number; fecha: string | null; folio: string | null }>> {
  const sku = l.sku.trim();
  if (sku.length < 4) return [];
  try {
    const [rows] = await pool.query(
      `SELECT it.id, it.producto_nombre, it.precio_unitario, DATE_FORMAT(o.fecha, '%Y-%m-%d') AS fecha, o.folio
         FROM compras_historial_oc_item it JOIN compras_historial_oc o ON o.id = it.historial_oc_id
        WHERE it.producto_nombre LIKE ? AND it.precio_unitario IS NOT NULL ORDER BY o.fecha DESC LIMIT 3`,
      [`%${sku}%`],
    ) as any;
    return (rows as any[]).map(r => ({ id: r.id, nombre: r.producto_nombre, precio: Number(r.precio_unitario), fecha: r.fecha, folio: r.folio }));
  } catch { return []; }
}

// ── Modelo (GLM-4.7) ──────────────────────────────────────────────────────────────────────────────
async function llamarModelo(system: string, user: string, maxTokens: number): Promise<any> {
  let ultimo = '';
  for (let intento = 1; intento <= 2; intento++) {
    const completion: any = await crearChatIA({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0, stream: false, max_tokens: maxTokens, response_format: { type: 'json_object' },
    }, { timeoutMs: 240_000, modeloPreferido: MODELO, soloGlm: true });
    const contenido = String(completion.choices?.[0]?.message?.content ?? '');
    const parsed = parseJsonIA(contenido);
    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) return parsed;
    ultimo = `finish=${completion.choices?.[0]?.finish_reason} largo=${contenido.length}`;
    console.warn(`[auditor-compras] intento ${intento}: respuesta no interpretable (${ultimo})`);
  }
  throw new Error(`el modelo no devolvió una respuesta interpretable (2 intentos; ${ultimo})`);
}

const ADENDA = `

=== ADENDA DE IMPLEMENTACIÓN (del sistema; complementa el formato de la PARTE X) ===
- Responde SOLO con el JSON de la PARTE X, sin markdown ni texto alrededor.
- El sistema te entrega los respaldos ya LEÍDOS (texto de cada link capturado en vivo y texto de cada cotización) con un id: "R1".."R3" para los links, "COT<n>" para cotizaciones, "HIS<n>" para compras históricas. Usa esos ids en "respaldos[].id" y en "id_respaldo". Cita SOLO texto que esté en esos respaldos: el sistema verifica cada precio contra el texto y descarta lo que no encuentre.
- CAMPOS EXTRA que el sistema necesita (el sistema hace las cuentas; tú solo los extraes):
  · verificaciones.V2_unidad.factor_unidades: número. Cuántas unidades DE LA LICITACIÓN trae el precio del respaldo (1 si el precio es por la unidad pedida; 10 si es una caja de 10 y se pide la unidad). null si no puedes determinarlo.
  · verificaciones.V5_costos_ocultos[].monto_neto_clp_total: número o null. Monto NETO en CLP de ese cargo para TODA la cantidad a comprar (no por unidad), solo si el respaldo lo dice.
  · verificaciones.V8_plazo.plazo_proveedor_dias: número o null (los días tal como los dice el proveedor; el sistema convierte hábiles a corridos).
  · verificaciones.V10c_comparador[]: para CADA opción del ASISTENTE (cada link y cada cotización con precio legible, origen "asistente") entrega además: precio (número TAL CUAL está en el respaldo, sin convertir), iva ("incluido"|"neto"|"no_declarado"), moneda, factor_unidades, despacho_monto_neto_clp_total, id_respaldo, cita. Las opciones del auditor las arma el sistema desde las referencias válidas: NO las repitas.
  · verificaciones.V10_referencias.referencias[]: para cada CANDIDATA de búsqueda que sea el MISMO producto (mismo modelo/SKU del fabricante), devuelve su url EXACTA tal como te la doy, y factor_unidades. El precio de las referencias lo pone el sistema.
  · verificaciones.V9_proveedor_mp: el sistema lo completa con el historial real; tú solo llena el objeto vacío.
- "ruta": "B" solo si el respaldo es una proforma de un proveedor extranjero (precio en USD o similar); si no, "A".
- Si una sección no aplica o no pudiste leerla, usa los valores vacíos/estados "no informa"/"NO_VERIFICABLE" y decláralo en "no_pude_leer". Nunca rellenes.`;

function sistemaL1(): string {
  return [P.PARTE_I, P.PARTE_III, P.PARTE_IV, P.PARTE_V, P.PARTE_VI, P.PARTE_VII, P.PARTE_VIII, 'FORMATO DE SALIDA (PARTE X):\n' + P.PARTE_X, 'AUTOCHEQUEO FINAL (PARTE XII):\n' + P.PARTE_XII].join('\n\n') + ADENDA;
}

const fmt = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('es-CL')}`);

// ── L1 · Auditoría de UNA línea ───────────────────────────────────────────────────────────────────
export interface OpcionesAuditoria { actor?: { id: number; nombre: string | null } | null; pasada?: 'linea' | 'final' }

interface EntradaLinea {
  linea: LineaCosteo; licitacion: Awaited<ReturnType<typeof lineaDeLaLicitacion>>; tecnico: ProductoTecnico;
  capturas: CapturaGuardada[]; cotizaciones: CotizacionRespaldo[]; historico: Awaited<ReturnType<typeof historicoInterno>>;
  dolar: Awaited<ReturnType<typeof dolarDelDia>>; historiales: Record<string, HistorialProveedorMP | null>;
  candidatas: CandidataBusqueda[]; consulta: string; errorBusqueda?: string; reloj: { diasRestantes: number | null; fechaLimite: string | null };
  hoyISO: string;
}

function construirUsuarioL1(e: EntradaLinea): string {
  const l = e.linea;
  const partes: string[] = [];
  partes.push(`FECHA DE HOY (auditoría): ${e.hoyISO}`);
  partes.push(`A) LÍNEA DEL COSTEO registrada por el asistente:\n- ítem ${l.item} · hoja "${l.grupo}" · línea real ${l.lineaReal ?? 'n/d'}\n- detalle: ${l.detalle}\n- unidad de medida: ${l.unidad || 'n/d'} · SKU del proveedor: ${l.sku || 'n/d'} · cantidad: ${l.cantidad ?? 'n/d'}\n- valor con IVA (referencia del asistente): ${fmt(l.valorConIva)} · costo unitario neto estimado: ${fmt(l.costoEstimadoNeto)} · costo unitario neto REAL cargado por Compras: ${fmt(l.costoRealUnitario)}\n- costo unitario neto que hoy está costeado (lo que se audita): ${fmt(l.costoRegistradoNeto)}\n- costo total neto costeado: ${l.costoRegistradoNeto != null && l.cantidad != null ? fmt(l.costoRegistradoNeto * l.cantidad) : '—'}\n- ruta: ${e.cotizaciones.some(c => c.moneda !== 'CLP') ? 'B (importación): el sistema detectó cotización(es) en moneda extranjera (' + [...new Set(e.cotizaciones.filter(c => c.moneda !== 'CLP').map(c => c.moneda))].join(', ') + '); aplica la PARTE V y llena ruta_b' : '(decídela tú con la PARTE V)'}${l.esGastoExtra ? '\n- OJO: es un GASTO EXTRA agregado por Compras (no se vende), solo se audita su respaldo.' : ''}`);
  partes.push(`B) LÍNEA DE LA LICITACIÓN (publicada por el organismo): ${e.licitacion ? `${e.licitacion.producto} — cantidad ${e.licitacion.cantidad ?? 'n/d'} ${e.licitacion.unidad ?? ''}` : 'no disponible (sin acta/línea cacheada)'}`);
  partes.push(`C) PRODUCTO DEL AUDITOR TÉCNICO: estado=${e.tecnico.estado}${e.tecnico.marca || e.tecnico.modelo ? ` · marca=${e.tecnico.marca || 'n/d'} · modelo=${e.tecnico.modelo || 'n/d'}` : ''}${e.tecnico.titulo ? ` · línea técnica "${e.tecnico.titulo}"` : ''}\n   ACCESORIOS (CUMPLE CON COMPLEMENTO) que deben estar cotizados: ${e.tecnico.accesorios.length ? e.tecnico.accesorios.join('; ') : 'ninguno'}`);
  const rs: string[] = [];
  e.capturas.forEach((c, i) => {
    rs.push(`--- RESPALDO R${i + 1} · tipo LINK_WEB · url ${c.url}${c.urlFinal && c.urlFinal !== c.url ? ` (URL final: ${c.urlFinal})` : ''} · captura_id C${c.id} · capturada ${c.capturadoAt} · estado detectado por el sistema: ${c.estado} (HTTP ${c.httpStatus ?? 'sin respuesta'})${c.error ? ` · error: ${c.error}` : ''}\nTEXTO CAPTURADO:\n${c.texto.slice(0, MAX_TEXTO_LINK) || '(vacío: la página no entregó texto)'}`);
  });
  for (const c of e.cotizaciones) {
    rs.push(`--- RESPALDO COT${c.id} · tipo ${c.origen === 'pdf' || c.origen === 'imagen' ? 'COTIZACION_FORMAL' : 'RESPALDO_INFORMAL'} (origen cargado: ${c.origen}) · proveedor "${c.proveedor}" RUT ${c.rut || 'n/d'} · tomada ${c.fecha} · vigencia declarada ${c.vigencia || 'no declara'} · moneda ${c.moneda} · precio unitario asignado a este producto ${fmt(c.precioUnitario)} · plazo ${c.plazoTexto || (c.plazoDias != null ? `${c.plazoDias} días` : 'n/d')} · flete incluido: ${c.incluyeFlete == null ? 'n/d' : c.incluyeFlete ? 'sí' : 'no'}\nTEXTO:\n${c.texto || '(sin texto legible)'}`);
  }
  for (const h of e.historico) rs.push(`--- RESPALDO HIS${h.id} · tipo HISTORICO_INTERNO · compra nuestra (Obuma) folio ${h.folio || 'n/d'} · fecha ${h.fecha || 'n/d'} · producto "${h.nombre}" · precio unitario ${fmt(h.precio)} (según la OC de compra; IVA no declarado en el dato)`);
  partes.push(`D/E) RESPALDOS CARGADOS Y CAPTURAS DEL SISTEMA (${e.capturas.length} link(s), ${e.cotizaciones.length} cotización(es), ${e.historico.length} histórico(s)):\n${rs.join('\n\n') || '(no hay ningún respaldo cargado: SIN_RESPALDO)'}`);
  partes.push(`F) DATOS DE CONTEXTO:\n- dólar observado BCCh del día: ${e.dolar.observado ?? 'no disponible'} · usado (+$10): ${e.dolar.usado ?? 'no disponible'} (${e.dolar.fecha ?? 'sin fecha'})\n- días que quedan para entregar al cliente: ${e.reloj.diasRestantes ?? 'no definido'}${e.reloj.fechaLimite ? ` (límite ${e.reloj.fechaLimite})` : ''} · logística interna estimada desde Talagante: ${PARAMS.logisticaInternaDias} días`);
  const g = Object.entries(e.historiales).filter(([, v]) => v);
  partes.push(`G) HISTORIAL EN MERCADOPÚBLICO del proveedor (calculado por el sistema; V9 lo completa el sistema):\n${g.length ? g.map(([rut, v]) => `- RUT ${rut}: ${v!.venteAlEstado ? `VENDE AL ESTADO (${v!.nLicitaciones} adjudicaciones y ${v!.nOrdenesCompra} OC en la base; rubros: ${v!.rubros.join(', ') || 'n/d'})` : 'sin registros en la base'}. ${v!.limitacion}`).join('\n') : '(sin RUT de proveedor identificable en las cotizaciones)'}`);
  partes.push(`H) REFERENCIAS DE MERCADO — consulta ejecutada: "${e.consulta}"\n${e.candidatas.length ? e.candidatas.map((c, i) => `${i + 1}. tienda ${c.tienda} · título "${c.nombre}" · precio ${fmt(c.precio)} (con IVA) · url ${c.url}`).join('\n') : `(la búsqueda no devolvió páginas${e.errorBusqueda ? `: ${e.errorBusqueda}` : ''})`}`);
  partes.push('I) HOJA AUDITORÍA del costeo: no disponible en este módulo; para V11 usa los datos que traigan los respaldos y lista los que falten (marca, modelo, procedencia, razón social, RUT, dirección, vendedor, teléfono, correo, plazo).');
  partes.push('Audita esta línea con TODAS las verificaciones y devuelve el JSON.');
  return partes.join('\n\n');
}

function respaldoVacio(l: LineaCosteo): SalidaModelo {
  return {
    linea: l.item, ruta: 'A', respaldos: [], origen_dato: 'DECLARADO',
    verificaciones: { V1_identidad: { estado: 'PENDIENTE_CRUCE_TECNICO' }, V6_stock: { estado: 'no_informa' }, V10_referencias: { sin_referencias: true, referencias: [] } },
    ayuda: {
      diagnostico: `El costo de "${l.detalle.slice(0, 80)}" (${fmt(l.costoRegistradoNeto)} neto por unidad) no tiene ningún respaldo cargado.`,
      causa_probable: 'No se pegó el link del producto ni se subió una cotización.',
      pregunta_proveedor: '', accion_concreta: 'Pega el Link 1 del producto donde se cotizó, o sube la cotización formal del proveedor a la pestaña de cotizaciones.',
      datos_para_impacto: '',
    },
  };
}

export async function auditarLinea(negocioId: number, filaId: string, opts: OpcionesAuditoria = {}): Promise<LineaGuardada> {
  const estado = await cargarEstadoCosteo(negocioId);
  if (!estado) throw new Error('Este negocio no tiene costeo cargado.');
  const linea = lineasDelCosteo(estado).find(l => l.id === filaId);
  if (!linea) throw new Error('No encontré esa línea en el costeo (¿se borró?).');
  const hoyISO = ahoraChileSQL().slice(0, 10);
  const licitacionCodigo = await licitacionDeNegocio(negocioId);

  const [previoRows] = await pool.query(`SELECT resultado_json FROM compras_auditor_costeo_linea WHERE negocio_id = ? AND fila_id = ? LIMIT 1`, [negocioId, filaId]) as any;
  let previo: LineaGuardada | null = null; try { previo = (previoRows as any[])[0]?.resultado_json ? JSON.parse((previoRows as any[])[0].resultado_json) : null; } catch { /* auditoría anterior ilegible: se ignora */ }

  // Pasos del SISTEMA en paralelo: links (S1), dólar (S2), cotizaciones/histórico/técnico/licitación/reloj.
  const [capturas, dolar, cotizaciones, historico, tecnico, licitacion, reloj] = await Promise.all([
    capturarLinks(negocioId, filaId, linea.links),
    dolarDelDia(),
    cotizacionesDeLaLinea(negocioId, linea),
    historicoInterno(linea),
    productoTecnico(negocioId, linea.lineaReal),
    lineaDeLaLicitacion(licitacionCodigo, linea.lineaReal),
    obtenerEstadoReloj(negocioId).catch(() => null),
  ]);

  const sinNada = capturas.length === 0 && cotizaciones.length === 0 && historico.length === 0;
  let salida: SalidaModelo; let avisos: string[] = []; let precioNoVerificado = false;
  let candidatas: CandidataBusqueda[] = []; let historiales: Record<string, HistorialProveedorMP | null> = {};
  let mp: PrecioMercadoPublico | null = null; let modeloUsado = MODELO;

  const tokens = tokensDeProducto(linea.detalle, linea.sku, tecnico.marca, tecnico.modelo,
    ...capturas.flatMap(c => [...c.texto.matchAll(/sku="([^"]+)"/g)].map(m => m[1])));

  if (sinNada) {
    salida = respaldoVacio(linea); modeloUsado = 'sin-modelo';
    mp = await preciosMercadoPublico(tokens).catch(() => null);
  } else {
    // S3 (RUT de las cotizaciones), S4 (búsqueda), S5 (mercado público) en paralelo.
    const ruts = [...new Set(cotizaciones.map(c => c.rut).filter((r): r is string => !!r))];
    const consulta = [tecnico.marca, tecnico.modelo].filter(Boolean).join(' ') || [linea.detalle.slice(0, 90), linea.sku].filter(Boolean).join(' ');
    const [hist, busq, mpDatos] = await Promise.all([
      Promise.all(ruts.map(async r => [r, await historialProveedorMP(r).catch(() => null)] as const)),
      buscarReferencias(consulta),
      preciosMercadoPublico(tokens).catch(() => null),
    ]);
    historiales = Object.fromEntries(hist); candidatas = busq.candidatas; mp = mpDatos;
    const entrada: EntradaLinea = { linea, licitacion, tecnico, capturas, cotizaciones, historico, dolar, historiales, candidatas, consulta: busq.consulta, errorBusqueda: busq.error, reloj: { diasRestantes: reloj?.diasRestantes ?? null, fechaLimite: reloj?.fechaLimiteVigente ?? null }, hoyISO };
    salida = (await llamarModelo(sistemaL1(), construirUsuarioL1(entrada), 12_000)) as SalidaModelo;

    const corpus = { porRespaldo: {} as Record<string, string>, texto: [...capturas.map(c => c.texto), ...cotizaciones.map(c => c.texto), ...historico.map(h => `${h.nombre} ${h.precio}`)].join('\n\n') };
    const g = aplicarGuardarrailes(salida, corpus, { tokensProducto: tokens, candidatasBusqueda: candidatas.map(c => ({ url: c.url, nombre: c.nombre, precio: c.precio, tienda: c.tienda })) });
    salida = g.salida; avisos = g.avisos;
    // Una cotización en moneda extranjera es una importación: la ruta la fija el sistema, no el modelo.
    if (cotizaciones.some(c => c.moneda !== 'CLP') && salida.ruta !== 'B') { salida.ruta = 'B'; avisos.push('Ruta B forzada por el sistema: hay cotización en moneda extranjera.'); }
    if (salida.ruta === 'B' && salida.ruta_b && !salida.ruta_b.moneda) { const m = cotizaciones.find(c => c.moneda !== 'CLP')?.moneda; if (m) salida.ruta_b.moneda = m; } precioNoVerificado = g.precioNoVerificado;

    // Lo que el sistema sabe con certeza pisa lo que el modelo diga: estado del link, referencias con precio real y V9.
    salida.respaldos = (salida.respaldos || []).map(r => {
      const cap = capturas.find((c, i) => r.id === `R${i + 1}` || r.captura_id === `C${c.id}` || r.archivo_o_url === c.url);
      return cap ? { ...r, tipo: 'LINK_WEB', estado_link: cap.estado, archivo_o_url: cap.url, captura_id: `C${cap.id}`, legibilidad: cap.texto.length < 150 ? 'nula' : r.legibilidad } : r;
    });
    const v = (salida.verificaciones ||= {});
    for (const ref of v.V10_referencias?.referencias || []) { ref.iva = 'incluido'; ref.factor_unidades = ref.factor_unidades ?? 1; }
    const hs = Object.values(historiales).filter((h): h is HistorialProveedorMP => !!h);
    v.V9_proveedor_mp = {
      vende_al_estado: hs.some(h => h.venteAlEstado), alerta_competidor: hs.some(h => h.venteAlEstado),
      evidencia: hs.filter(h => h.venteAlEstado).map(h => `RUT ${h.rut}: ${h.nLicitaciones} adjudicación(es) y ${h.nOrdenesCompra} OC en la base; rubros: ${h.rubros.join(', ') || 'n/d'}. ${h.limitacion}`).join(' ') || (ruts.length ? 'Sin registros del proveedor en la base de MercadoPública de Licitank (muestra, no el universo).' : 'Sin RUT de proveedor identificable en los respaldos.'),
      precios_adjudicados: hs.flatMap(h => h.ejemplos.filter(x => x.monto).map(x => ({ precio: x.monto as number, fecha: x.fecha || '', organismo: '', oc: x.licitacion }))).slice(0, 6),
    };
  }

  let sistema = calcularSistemaLinea(linea, salida, {
    dolar, guardarrailes: avisos, precioNoVerificado, diasDisponibles: reloj?.diasRestantes ?? null, precioMercadoPublico: mp, hoyISO,
    fechaHistorico: historico[0]?.fecha ?? null,
  });

  // V10-b lo decide el SISTEMA (dispersión sobre la mediana): si no hay dispersión, lo que el modelo haya marcado no vale.
  if (!sistema.dispersion?.activa && salida.verificaciones?.V10b_discordancia) salida.verificaciones.V10b_discordancia = { activa: false };

  // L2 · triangulación cuando los precios del MISMO producto se separan de la mediana (V10-b).
  if (!sinNada && sistema.dispersion?.activa) {
    try {
      const adic = await buscarReferencias(`${tokens.slice(0, 2).join(' ')} ${linea.detalle.split(/\s+/).slice(0, 4).join(' ')} precio`);
      const nuevas = adic.candidatas.filter(c => !candidatas.some(x => x.url === c.url) && (tokens.length === 0 || tokens.some(k => c.nombre.toLowerCase().replace(/[^a-z0-9]/g, '').includes(k)))).slice(0, 4);
      const sysL2 = `${P.PARTE_I}\n\nAhora aplica SOLO la verificación V10-b (triangulación de precios discordantes):\n${P.PARTE_IV.slice(P.PARTE_IV.indexOf('V10-b'), P.PARTE_IV.indexOf('V10-c'))}\nResponde SOLO JSON: {"activa":true,"fuente_discordante":"","es_la_del_asistente":false,"causa_probable":"sitio_no_oficial|moneda|pagina_extranjera|unidad_empaque|version|repuesto_o_arriendo|indeterminada","evidencia":""}. Si no puedes determinarlo, causa_probable="indeterminada" y dilo en evidencia.`;
      const userL2 = `Producto: ${linea.detalle} (SKU/modelo: ${tokens.join(', ') || 'n/d'})\nPrecios netos puestos en bodega del MISMO producto (mediana ${fmt(sistema.dispersion.mediana)}):\n${sistema.comparador.filter(o => o.costo_bodega != null).map(o => `- ${o.opcion} (${o.origen}): ${fmt(o.costo_bodega)} — ${o.url || o.id_respaldo || ''}`).join('\n')}\nReferencias ADICIONALES encontradas:\n${nuevas.map(c => `- ${c.tienda} "${c.nombre}" ${fmt(c.precio)} (con IVA) ${c.url}`).join('\n') || '(ninguna)'}`;
      const l2: any = await llamarModelo(sysL2, userL2, 3_000);
      const v = (salida.verificaciones ||= {});
      v.V10b_discordancia = { activa: true, fuente_discordante: String(l2.fuente_discordante || ''), es_la_del_asistente: !!l2.es_la_del_asistente, causa_probable: String(l2.causa_probable || 'indeterminada'), evidencia: String(l2.evidencia || ''), referencias_adicionales: nuevas.map(c => ({ proveedor: c.tienda, precio: c.precio ?? 0, url: c.url })) };
      if (!l2.es_la_del_asistente && l2.fuente_discordante && v.V10_referencias?.referencias) {
        const antes = v.V10_referencias.referencias.length;
        v.V10_referencias.referencias = v.V10_referencias.referencias.filter(r => !(r.url && String(l2.fuente_discordante).includes(r.url)) && !(r.proveedor && String(l2.fuente_discordante).toLowerCase().includes(String(r.proveedor).toLowerCase())));
        if (v.V10_referencias.referencias.length < antes) (v.V10_referencias.descartadas_no_mismo_producto ||= []).push({ url: String(l2.fuente_discordante), motivo: `Precio discordante descartado tras triangular: ${l2.causa_probable}` });
      }
      sistema = calcularSistemaLinea(linea, salida, { dolar, guardarrailes: avisos, precioNoVerificado, diasDisponibles: reloj?.diasRestantes ?? null, precioMercadoPublico: mp, hoyISO, fechaHistorico: historico[0]?.fecha ?? null });
      if (!sistema.dispersion?.activa) { /* al sacar el discordante deja de haber dispersión */ }
      (v.V10b_discordancia as any).activa = true;
    } catch (e) { console.warn('[auditor-compras] L2 falló:', String(e).slice(0, 160)); avisos.push('La triangulación de precios discordantes (V10-b) no se pudo completar: revisa a mano las fuentes que se separan de la mediana.'); }
  }

  const guardada: LineaGuardada = {
    fila: { id: linea.id, item: linea.item, lineaReal: linea.lineaReal, detalle: linea.detalle, unidad: linea.unidad, sku: linea.sku, cantidad: linea.cantidad, grupo: linea.grupo },
    auditadoAt: ahoraChileSQL(), modeloIA: modeloUsado, pasada: opts.pasada || 'linea', modelo: salida, sistema,
    capturas: capturas.map(c => ({ id: c.id, url: c.url, estado: c.estado, capturadoAt: c.capturadoAt, hayImagen: !!c.imagen })),
  };
  guardada.cambiosVsAnterior = cambiosEntreAuditorias(previo, guardada);

  // Persistencia (conserva la justificación ya dada; la habilitación se anula si el costo verificado sube).
  if (previo?.sistema.verificadoNeto != null && sistema.verificadoNeto != null && sistema.verificadoNeto > previo.sistema.verificadoNeto) {
    await pool.query(`UPDATE compras_auditor_costeo_linea SET habilitado_por=NULL, habilitado_por_nombre=NULL, habilitado_nivel=NULL, habilitado_motivo=NULL, habilitado_at=NULL WHERE negocio_id = ? AND fila_id = ?`, [negocioId, filaId]).catch(() => {});
    guardada.cambiosVsAnterior = [...(guardada.cambiosVsAnterior || []), 'La habilitación anterior se anuló porque el costo verificado subió.'];
  }
  const derivadaTmp = derivarLinea(linea, guardada, { margen: null, justificacionAhorro: null, habilitacion: null, hoyISO, esGastoExtra: linea.esGastoExtra });
  await pool.query(
    `INSERT INTO compras_auditor_costeo_linea (negocio_id, fila_id, veredicto, n_bloqueos, n_alertas, costo_verificado_neto, resultado_json, modelo, pasada, generado_at, generado_por, generado_por_nombre)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE veredicto=VALUES(veredicto), n_bloqueos=VALUES(n_bloqueos), n_alertas=VALUES(n_alertas), costo_verificado_neto=VALUES(costo_verificado_neto),
       resultado_json=VALUES(resultado_json), modelo=VALUES(modelo), pasada=VALUES(pasada), generado_at=VALUES(generado_at), generado_por=VALUES(generado_por), generado_por_nombre=VALUES(generado_por_nombre)`,
    [negocioId, filaId, derivadaTmp.veredicto, derivadaTmp.bloqueos.length, derivadaTmp.alertas.length, sistema.verificadoNeto, JSON.stringify(guardada), modeloUsado, guardada.pasada, guardada.auditadoAt, opts.actor?.id ?? null, opts.actor?.nombre ?? null],
  );
  await registrarEvento({
    tipo: 'COMPRAS_COSTEO_AUDITADO', licitacionCodigo, actorId: opts.actor?.id, actorNombre: opts.actor?.nombre,
    mensaje: `Auditor de Compras revisó la línea ${linea.item} ("${linea.detalle.slice(0, 60)}"): ${derivadaTmp.veredicto.replace(/_/g, ' ')}.`,
    metadata: { negocio_id: negocioId, fila_id: filaId, veredicto: derivadaTmp.veredicto, pasada: guardada.pasada },
  }).catch(() => {});
  await recalcularProyecto(negocioId).catch(e => console.warn('[auditor-compras] recalcular proyecto:', String(e).slice(0, 150)));
  return guardada;
}

/** Corre el auditor de una línea sin bloquear a quien llama (disparo continuo: al agregar o cambiar un link o un costo). */
const enCurso = new Set<string>();
export function auditarLineaEnSegundoPlano(negocioId: number, filaId: string, actor?: { id: number; nombre: string | null } | null): void {
  const k = `${negocioId}:${filaId}`;
  if (enCurso.has(k)) return;
  enCurso.add(k);
  auditarLinea(negocioId, filaId, { actor }).catch(e => console.error(`[auditor-compras] falló en segundo plano (${k}):`, String(e).slice(0, 200))).finally(() => enCurso.delete(k));
}
// Lotes ("auditar todo" y pasada final) en segundo plano: una auditoría por línea son 1-3 minutos con el modelo.
const lotes = new Map<number, { tipo: 'todo' | 'final'; total: number; hechas: number; error: string | null }>();
export function estadoLote(negocioId: number) { return lotes.get(negocioId) ?? null; }
export function iniciarLoteEnSegundoPlano(negocioId: number, tipo: 'todo' | 'final', actor?: { id: number; nombre: string | null } | null): boolean {
  if (lotes.get(negocioId) && lotes.get(negocioId)!.hechas < lotes.get(negocioId)!.total) return false;
  lotes.set(negocioId, { tipo, total: 0, hechas: 0, error: null });
  (async () => {
    const estado = await cargarEstadoCosteo(negocioId);
    if (!estado) throw new Error('Este negocio no tiene costeo cargado.');
    const ls = lineasDelCosteo(estado).filter(l => (l.ofertamos && !l.esGastoExtra) || l.links.length > 0);
    const lote = lotes.get(negocioId)!; lote.total = ls.length + (tipo === 'final' ? 1 : 0);
    if (tipo === 'final') {
      await pasadaFinal(negocioId, actor, () => { lote.hechas++; });
      lote.hechas = lote.total;
    } else {
      for (const l of ls) { try { await auditarLinea(negocioId, l.id, { actor }); } catch (e) { console.error('[auditor-compras] lote:', String(e).slice(0, 160)); } lote.hechas++; }
      await generarLecturaPosicion(negocioId).catch(() => {});
    }
  })().catch(e => { const l = lotes.get(negocioId); if (l) { l.error = String((e as Error).message || e).slice(0, 200); l.hechas = l.total; } console.error('[auditor-compras] lote falló:', String(e).slice(0, 200)); });
  return true;
}

/** Disparo continuo (PROMPT 5, 0.2): cuando se agrega o cambia un link, un costo real o el valor de una línea, se
 *  audita ESA línea. Solo si Compras ya está abierto para el negocio (lo verifica quien llama). Tope de 8 por guardado. */
export function auditarFilasCambiadasEnSegundoPlano(negocioId: number, antes: EstadoCosteoEditor | null, despues: EstadoCosteoEditor, actor?: { id: number; nombre: string | null } | null): number {
  const firma = (f: any) => [f.costoRealUnitario ?? '', f.valorConIva ?? '', f.cantidad ?? '', f.link1 || '', f.link2 || '', f.link3 || '', f.skuProveedor || ''].join('|');
  const previas = new Map<string, string>();
  for (const g of antes?.grupos || []) for (const f of g.filas || []) previas.set(f.id, firma(f));
  const cambiadas: string[] = [];
  for (const g of despues.grupos || []) {
    if (g.ofertamos === false) continue;
    for (const f of g.filas || []) if ((f.link1 || f.link2 || f.link3) && previas.get(f.id) !== firma(f)) cambiadas.push(f.id);
  }
  cambiadas.slice(0, 8).forEach(id => auditarLineaEnSegundoPlano(negocioId, id, actor));
  return Math.min(cambiadas.length, 8);
}

export function lineasAuditandoAhora(negocioId: number): string[] {
  return [...enCurso].filter(k => k.startsWith(`${negocioId}:`)).map(k => k.split(':')[1]);
}

// ── Proyecto: veredictos derivados + posición de precio (C2/C3) ───────────────────────────────────
export interface LineaPanel {
  linea: LineaCosteo; guardada: LineaGuardada | null; derivada: LineaDerivada | null;
  justificacionAhorro: string | null; justificacionPor: string | null; habilitacion: Habilitacion | null; auditando: boolean;
}
export interface PanelAuditorCompras {
  negocioId: number; hayCostea: boolean; lineas: LineaPanel[];
  margen: ReturnType<typeof margenProyecto> | null; posicion: PosicionPrecio | null;
  mensajesProveedor: ReturnType<typeof mensajesPorProveedor>;
  resumen: { total: number; verificadas: number; conAlertas: number; bloqueadas: number; sinAuditar: number; pendientes: number; pasaAnexosOk: boolean };
  pasadaFinal: { at: string; pasa: boolean; bloqueadas: number; cambios: Array<{ item: number; detalle: string; cambios: string[] }> } | null;
  parametros: typeof PARAMS; migracionAplicada: boolean;
  lote: { tipo: 'todo' | 'final'; total: number; hechas: number; error: string | null } | null;
}

async function filasGuardadas(negocioId: number) {
  const [rows] = await pool.query(
    `SELECT fila_id, resultado_json, justificacion_ahorro, justificacion_por_nombre, habilitado_nivel, habilitado_por_nombre, habilitado_motivo,
            DATE_FORMAT(habilitado_at, '%Y-%m-%d %H:%i') AS habilitado_at
       FROM compras_auditor_costeo_linea WHERE negocio_id = ?`, [negocioId]) as any;
  const m = new Map<string, any>();
  for (const r of rows as any[]) { let g: LineaGuardada | null = null; try { g = JSON.parse(r.resultado_json); } catch { /* fila ilegible */ } m.set(r.fila_id, { ...r, guardada: g }); }
  return m;
}

async function presupuestoNeto(negocioId: number, estado: EstadoCosteoEditor): Promise<{ neto: number | null; nivel: 'linea' | 'proyecto' | null; fuente: string }> {
  const grupos = estado.grupos.filter(g => g.ofertamos !== false);
  const conPres = grupos.filter(g => g.presupuestoNeto != null && g.presupuestoNeto > 0);
  if (grupos.length > 0 && conPres.length === grupos.length) return { neto: Math.round(conPres.reduce((s, g) => s + (g.presupuestoNeto as number), 0)), nivel: 'linea', fuente: 'Presupuesto por línea del costeo (bases de la licitación)' };
  try {
    const cod = await licitacionDeNegocio(negocioId);
    if (cod) { const r = await construirResumenEjecutivoCompras(negocioId, cod); if (r.presupuestoProyecto) return { neto: Math.round(r.presupuestoProyecto), nivel: 'proyecto', fuente: 'Presupuesto del proyecto (Resumen Ejecutivo: bases o ficha de MercadoPública, neto)' }; }
  } catch { /* sin presupuesto: se declara */ }
  return { neto: null, nivel: null, fuente: 'No hay presupuesto informado' };
}

/** Recalcula, por código, el margen acumulado y el veredicto de cada línea (las alzas se acumulan: una línea
 *  puede pasar a bloqueada porque otra subió), la posición de precio y persiste el resumen. Sin llamar al modelo. */
export async function recalcularProyecto(negocioId: number, opts: { lectura?: string | null } = {}): Promise<PanelAuditorCompras> {
  const panel = await armarPanel(negocioId, opts.lectura);
  for (const lp of panel.lineas) {
    if (!lp.derivada) continue;
    await pool.query(`UPDATE compras_auditor_costeo_linea SET veredicto = ?, n_bloqueos = ?, n_alertas = ? WHERE negocio_id = ? AND fila_id = ?`,
      [lp.derivada.veredicto, lp.derivada.bloqueos.length, lp.derivada.alertas.length, negocioId, lp.linea.id]);
  }
  if (panel.posicion) {
    await pool.query(
      `INSERT INTO compras_auditor_costeo_proyecto (negocio_id, resultado_json, updated_at) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE resultado_json = VALUES(resultado_json), updated_at = VALUES(updated_at)`,
      [negocioId, JSON.stringify({ posicion_precio: panel.posicion, margen: panel.margen }), ahoraChileSQL()]);
  }
  return panel;
}

export async function armarPanel(negocioId: number, lecturaNueva?: string | null): Promise<PanelAuditorCompras> {
  const estado = await cargarEstadoCosteo(negocioId);
  const parametros = PARAMS;
  if (!estado) return { negocioId, hayCostea: false, lineas: [], margen: null, posicion: null, mensajesProveedor: [], resumen: { total: 0, verificadas: 0, conAlertas: 0, bloqueadas: 0, sinAuditar: 0, pendientes: 0, pasaAnexosOk: false }, pasadaFinal: null, parametros, migracionAplicada: true, lote: null };
  const lineas = lineasDelCosteo(estado);
  let guardadas: Map<string, any>;
  try { guardadas = await filasGuardadas(negocioId); } catch { return { negocioId, hayCostea: true, lineas: lineas.map(l => ({ linea: l, guardada: null, derivada: null, justificacionAhorro: null, justificacionPor: null, habilitacion: null, auditando: false })), margen: null, posicion: null, mensajesProveedor: [], resumen: { total: lineas.length, verificadas: 0, conAlertas: 0, bloqueadas: 0, sinAuditar: lineas.length, pendientes: 0, pasaAnexosOk: false }, pasadaFinal: null, parametros, migracionAplicada: false, lote: null }; }

  const verificados: Record<string, number | undefined> = {};
  for (const l of lineas) { const g = guardadas.get(l.id)?.guardada; if (g?.sistema.verificadoNeto != null) verificados[l.id] = g.sistema.verificadoNeto; }
  const margen = margenProyecto(lineas, verificados);
  const hoyISO = ahoraChileSQL().slice(0, 10);
  const auditando = new Set(lineasAuditandoAhora(negocioId));

  const panelLineas: LineaPanel[] = lineas.map(l => {
    const r = guardadas.get(l.id);
    const g: LineaGuardada | null = r?.guardada ?? null;
    const hab: Habilitacion | null = r?.habilitado_nivel ? { nivel: r.habilitado_nivel, porNombre: r.habilitado_por_nombre, motivo: r.habilitado_motivo || '', at: r.habilitado_at } : null;
    const derivada = g ? derivarLinea(l, g, { margen, justificacionAhorro: r?.justificacion_ahorro ?? null, habilitacion: hab, hoyISO, esGastoExtra: l.esGastoExtra }) : null;
    return { linea: l, guardada: g, derivada, justificacionAhorro: r?.justificacion_ahorro ?? null, justificacionPor: r?.justificacion_por_nombre ?? null, habilitacion: hab, auditando: auditando.has(l.id) };
  });

  const auditadas = Object.fromEntries(panelLineas.filter(p => p.guardada).map(p => [p.linea.id, p.guardada as LineaGuardada]));
  const pres = await presupuestoNeto(negocioId, estado);
  const posicion = calcularPosicionPrecio(lineas, auditadas, pres);

  const [proy] = await pool.query(`SELECT resultado_json, pasada_final_json FROM compras_auditor_costeo_proyecto WHERE negocio_id = ? LIMIT 1`, [negocioId]).catch(() => [[]] as any) as any;
  let lecturaPrevia = ''; let pasadaFinal: PanelAuditorCompras['pasadaFinal'] = null;
  try { lecturaPrevia = JSON.parse((proy as any[])[0]?.resultado_json || '{}')?.posicion_precio?.lectura || ''; } catch { /* sin lectura previa */ }
  try { pasadaFinal = (proy as any[])[0]?.pasada_final_json ? JSON.parse((proy as any[])[0].pasada_final_json) : null; } catch { /* sin pasada */ }
  posicion.lectura = lecturaNueva ?? lecturaPrevia;

  const evaluables = panelLineas.filter(p => !p.linea.esGastoExtra || p.guardada);
  const auditadasN = evaluables.filter(p => p.derivada);
  const resumen = {
    total: evaluables.length,
    verificadas: auditadasN.filter(p => p.derivada!.veredicto === 'VERIFICADO').length,
    conAlertas: auditadasN.filter(p => ['VERIFICADO_CON_ALERTAS', 'PENDIENTE_CRUCE_TECNICO', 'REQUIERE_HABILITACION'].includes(p.derivada!.veredicto) && p.derivada!.pasaAnexosOk).length,
    bloqueadas: auditadasN.filter(p => !p.derivada!.pasaAnexosOk).length,
    sinAuditar: evaluables.length - auditadasN.length,
    pendientes: auditadasN.filter(p => p.derivada!.veredicto === 'PENDIENTE_CRUCE_TECNICO').length,
    pasaAnexosOk: auditadasN.length === evaluables.length && auditadasN.every(p => p.derivada!.pasaAnexosOk),
  };
  const mensajesProveedor = mensajesPorProveedor(panelLineas.filter(p => p.guardada && p.derivada).map(p => ({ linea: p.guardada!, derivada: p.derivada! })));
  return { negocioId, hayCostea: true, lineas: panelLineas, margen, posicion, mensajesProveedor, resumen, pasadaFinal, parametros, migracionAplicada: true, lote: estadoLote(negocioId) };
}

// ── L3 · lectura del resumen ──────────────────────────────────────────────────────────────────────
export async function generarLecturaPosicion(negocioId: number): Promise<PanelAuditorCompras> {
  const panel = await armarPanel(negocioId);
  if (!panel.posicion) return panel;
  const { lectura: _l, ...datos } = panel.posicion; void _l;
  const sys = `${P.PARTE_I}\n\n${P.PARTE_IX}\n\nTu tarea ahora es SOLO la lectura L3: redacta en lenguaje simple (máximo 8 líneas) la lectura de este resumen ya calculado por el sistema. Declara la solidez de cada nivel (cuántos datos, de qué fechas, si es el mismo producto o comparable), marca los comparables como "dato débil", no calcules ni recomiendes un precio exacto. Responde SOLO JSON: {"lectura":"..."}`;
  const out = await llamarModelo(sys, `RESUMEN CALCULADO POR EL SISTEMA (JSON):\n${JSON.stringify(datos)}\nParámetros: margen mínimo ${PARAMS.margenMinimo}%, mínimo de OC para dato sólido ${PARAMS.minDatosMercadoPublico}.
OJO: costo_verificado.lineas_pendientes es la cantidad de líneas cuyo costo NO está verificado; el monto usa el costo costeado para esas líneas. Si hay pendientes, di que el costo NO está verificado del todo (no digas que lo está).`, 2_500);
  const lectura = String(out.lectura || '').trim();
  return recalcularProyecto(negocioId, { lectura: lectura || null });
}

// ── Pasada final (P-1: la ejecuta el SISTEMA al solicitar el paso a ANEXOS OK) ────────────────────
export async function pasadaFinal(negocioId: number, actor?: { id: number; nombre: string | null } | null, alAvanzar?: () => void): Promise<NonNullable<PanelAuditorCompras['pasadaFinal']>> {
  const estado = await cargarEstadoCosteo(negocioId);
  if (!estado) throw new Error('Este negocio no tiene costeo cargado.');
  const lineas = lineasDelCosteo(estado).filter(l => l.ofertamos && !l.esGastoExtra || l.links.length > 0);
  const cambios: Array<{ item: number; detalle: string; cambios: string[] }> = [];
  for (const l of lineas) {
    try {
      const g = await auditarLinea(negocioId, l.id, { actor, pasada: 'final' });
      if (g.cambiosVsAnterior?.length) cambios.push({ item: l.item, detalle: l.detalle.slice(0, 80), cambios: g.cambiosVsAnterior });
    } catch (e) { cambios.push({ item: l.item, detalle: l.detalle.slice(0, 80), cambios: [`No se pudo re-auditar: ${String((e as Error).message || e).slice(0, 120)}`] }); }
    alAvanzar?.();
  }
  let panel = await generarLecturaPosicion(negocioId).catch(() => armarPanel(negocioId));
  panel = await armarPanel(negocioId, panel.posicion?.lectura);
  const res = { at: ahoraChileSQL(), pasa: panel.resumen.pasaAnexosOk, bloqueadas: panel.resumen.bloqueadas, cambios };
  await pool.query(
    `INSERT INTO compras_auditor_costeo_proyecto (negocio_id, pasada_final_json, pasada_final_at, updated_at) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE pasada_final_json = VALUES(pasada_final_json), pasada_final_at = VALUES(pasada_final_at), updated_at = VALUES(updated_at)`,
    [negocioId, JSON.stringify(res), res.at, res.at]);
  return res;
}

// ── Justificación (V10) y habilitación (EM / CA) ──────────────────────────────────────────────────
export async function registrarJustificacionAhorro(negocioId: number, filaId: string, texto: string, actor: { id: number; nombre: string | null }): Promise<void> {
  if (texto.trim().length < 15) throw new Error('Explica el motivo (mínimo 15 caracteres): queda registrado a tu nombre.');
  const [r] = await pool.query(`UPDATE compras_auditor_costeo_linea SET justificacion_ahorro = ?, justificacion_por_nombre = ?, justificacion_at = ? WHERE negocio_id = ? AND fila_id = ?`,
    [texto.trim().slice(0, 2000), actor.nombre, ahoraChileSQL(), negocioId, filaId]) as any;
  if (!(r as any).affectedRows) throw new Error('Esta línea todavía no fue auditada: audítala primero.');
  await registrarEvento({ tipo: 'COMPRAS_COSTEO_JUSTIFICACION', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId: actor.id, actorNombre: actor.nombre,
    mensaje: `${actor.nombre || 'Un usuario'} justificó por qué no se usó la opción más barata en una línea del costeo: ${texto.trim().slice(0, 300)}`, metadata: { negocio_id: negocioId, fila_id: filaId } }).catch(() => {});
  await recalcularProyecto(negocioId);
}

/** EM habilita respaldos informales/históricos; CA (admin) tiene potestad total sobre cualquier línea (P-5). */
export async function registrarHabilitacion(negocioId: number, filaId: string, nivel: 'EM' | 'CA' | null, motivo: string, actor: { id: number; nombre: string | null }): Promise<void> {
  if (nivel == null) {
    await pool.query(`UPDATE compras_auditor_costeo_linea SET habilitado_por=NULL, habilitado_por_nombre=NULL, habilitado_nivel=NULL, habilitado_motivo=NULL, habilitado_at=NULL WHERE negocio_id = ? AND fila_id = ?`, [negocioId, filaId]);
  } else {
    if (motivo.trim().length < 15) throw new Error('Explica el motivo de la habilitación (mínimo 15 caracteres).');
    const [r] = await pool.query(`UPDATE compras_auditor_costeo_linea SET habilitado_por=?, habilitado_por_nombre=?, habilitado_nivel=?, habilitado_motivo=?, habilitado_at=? WHERE negocio_id = ? AND fila_id = ?`,
      [actor.id, actor.nombre, nivel, motivo.trim().slice(0, 2000), ahoraChileSQL(), negocioId, filaId]) as any;
    if (!(r as any).affectedRows) throw new Error('Esta línea todavía no fue auditada: audítala primero.');
  }
  await registrarEvento({ tipo: nivel ? 'COMPRAS_COSTEO_HABILITADO' : 'COMPRAS_COSTEO_HABILITACION_QUITADA', licitacionCodigo: await licitacionDeNegocio(negocioId), actorId: actor.id, actorNombre: actor.nombre,
    mensaje: nivel ? `${actor.nombre || 'Un usuario'} (${nivel}) habilitó una línea del costeo. Motivo: ${motivo.trim()}` : `${actor.nombre || 'Un usuario'} quitó la habilitación de una línea del costeo.`,
    metadata: { negocio_id: negocioId, fila_id: filaId, nivel } }).catch(() => {});
  await recalcularProyecto(negocioId);
}
