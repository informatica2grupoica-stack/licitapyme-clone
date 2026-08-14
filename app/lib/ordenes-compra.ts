// app/lib/ordenes-compra.ts
// Órdenes de compra de Mercado Público: detección, guardado y aviso.
//
// EL PROBLEMA QUE RESUELVE ESTE MÓDULO. La API de OC (api.mercadopublico.cl/servicios/v1/publico/
// ordenesdecompra.json) NO tiene una consulta "dame la orden de compra de la licitación X". Solo
// ofrece tres cosas, y ninguna sirve sola:
//   · listado de UN día: ~16.000 órdenes de todo Chile, con { Codigo, Nombre, CodigoEstado } y
//     NADA más — ni proveedor ni licitación de origen (verificado contra la API real);
//   · listado por CodigoProveedor: barato y exacto, pero pide el código INTERNO del portal
//     (probado: con el RUT en cualquier formato devuelve 0 resultados) que nadie tiene a mano;
//   · detalle por código de orden: ahí sí viene todo (CodigoLicitacion, montos, comprador, ítems).
//
// La bisagra está en el NOMBRE de la orden, que casi siempre trae el código de la licitación que la
// originó ("ORDEN DE COMPRA DESDE 2446-134-LE26"). Barriendo el listado diario y cruzando ese texto
// contra las licitaciones que ya ofertamos aparecen las nuestras sin configurar absolutamente nada.
// Medido sobre la base real: 10 órdenes nuestras encontradas en 25 días de listados.
//
// Y una vez encontrada la primera, su detalle trae `Proveedor.Codigo` — que se guarda en la ficha
// de la empresa y a partir de ahí permite la consulta directa, mucho más barata. Las dos vías
// conviven: la directa es la rápida, el barrido es la que no depende de configurar nada.
//
// EL LISTADO DIARIO ES DE MOVIMIENTOS, NO DE CREACIONES: una misma orden reaparece el día que
// cambia de estado. Por eso se guarda el estado anterior — es lo que permite avisar "la OC pasó a
// Aceptada" en vez de repetir la misma notificación todos los días.
import pool from '@/app/lib/db';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { publicar } from '@/app/lib/sse-bus';
import { enviarAvisoOrdenesCompra } from '@/app/lib/email';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { ahoraChileSQL } from '@/app/lib/tz';
import { MP_UA, fetchMPConReintentos } from '@/app/lib/mp-adjuntos';
import type { OrdenCompraAPI } from '@/app/types/mercado-publico.types';

// Códigos de estado de la API (documentación de ChileCompra). Se guardan los dos: el código es
// estable, el texto es el que muestra la pantalla.
export const ESTADOS_OC: Record<number, string> = {
  4: 'Enviada a proveedor',
  5: 'En proceso',
  6: 'Aceptada',
  9: 'Cancelada',
  12: 'Recepción conforme',
  13: 'Pendiente de recepcionar',
  14: 'Recepcionada parcialmente',
  15: 'Recepción conforme incompleta',
};

// Etapas en las que YA ofertamos: son las únicas licitaciones que pueden generar una orden a
// nuestro nombre. Se incluye PERDIDA a propósito — si aparece una OC de una licitación que dimos
// por perdida, eso es exactamente lo que hay que saber cuanto antes, no algo que filtrar.
const ETAPAS_CON_OFERTA = ['POSTULADA', 'POSIBLE_ADJ', 'ADJUDICADA', 'PERDIDA'];

// Cuántos días hacia atrás barre el cron. 3 cubre el fin de semana y un día caído sin re-descargar
// medio mes: como el upsert es idempotente, repetir días ya vistos no genera avisos duplicados.
const DIAS_BARRIDO_POR_DEFECTO = 3;

// Pausa entre llamadas: la API responde `Código 10500 — peticiones simultáneas` si se la aprieta.
// Todo este módulo va en serie a propósito; es un cron, no hay nadie esperando.
const PAUSA_MS = 1_200;
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

// ¿El texto menciona ESTE código de licitación? No sirve un `includes` pelado: "2008-4-LE26" es
// substring de "12008-4-LE26", que es otra licitación de otro organismo. Se exige que el carácter
// anterior no sea parte del código (dígito o guion) y lo mismo por el lado derecho.
export function mencionaCodigo(texto: string, codigo: string): boolean {
  const t = String(texto || '').toUpperCase();
  const c = String(codigo || '').toUpperCase();
  if (!t || !c) return false;
  let desde = 0;
  for (;;) {
    const i = t.indexOf(c, desde);
    if (i < 0) return false;
    const antes = i > 0 ? t[i - 1] : '';
    const despues = t[i + c.length] || '';
    if (!/[0-9-]/.test(antes) && !/[0-9A-Z-]/.test(despues)) return true;
    desde = i + 1;
  }
}

// RUT comparable: sin puntos, guiones ni espacios, en mayúsculas ("76.902.659-2" → "769026592").
// Se compara así y no como string crudo porque la ficha lo guarda con puntos y la API lo devuelve
// con puntos y guion, pero no siempre igual (a veces sin dígito verificador en el nombre corto).
export function rutNormalizado(v: unknown): string {
  return String(v || '').replace(/[^0-9kK]/g, '').toUpperCase();
}

interface EmpresaNuestra { id: number; razon_social: string | null; rut: string | null }

async function empresasNuestras(): Promise<EmpresaNuestra[]> {
  const [rows] = await pool.query(
    `SELECT id, razon_social, rut FROM empresas WHERE activo = TRUE`,
  ) as any[];
  return rows as EmpresaNuestra[];
}

export interface NegocioOfertado {
  licitacion_codigo: string;
  licitacion_nombre: string | null;
  empresa_id: number | null;
  asignado_a: number | null;
}

// Exportada: la reusa app/lib/obuma-compras.ts (mismo criterio de "qué licitaciones son nuestras"
// para el cruce por texto libre contra las compras de Obuma — una sola definición de la verdad).
export async function licitacionesOfertadas(): Promise<Map<string, NegocioOfertado>> {
  const ph = ETAPAS_CON_OFERTA.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT licitacion_codigo, licitacion_nombre, empresa_id, asignado_a
       FROM negocios
      WHERE activo = TRUE AND estado_pipeline IN (${ph})`,
    ETAPAS_CON_OFERTA,
  ) as any[];
  const mapa = new Map<string, NegocioOfertado>();
  for (const r of rows as NegocioOfertado[]) {
    if (r.licitacion_codigo) mapa.set(String(r.licitacion_codigo).toUpperCase(), r);
  }
  return mapa;
}

/** Fecha "DD-MM-YYYY hh:mm:ss" de la API → DATETIME de MySQL. null si no parsea. */
function fechaMySQL(v: unknown): string | null {
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface ResumenSync {
  diasBarridos: number;
  candidatas: number;
  nuevas: number;
  cambiosEstado: number;
  deTerceros: number;      // órdenes de la misma licitación pero de otro proveedor (no avisan)
  eventos: number;
  correos: number;
  codigosProveedorDescubiertos: number;
}

/**
 * Busca órdenes de compra nuevas o con cambio de estado, las guarda y avisa.
 * Pensado para el cron diario. Es idempotente: correrlo dos veces no duplica avisos.
 */
export async function sincronizarOrdenesCompra(
  { dias = DIAS_BARRIDO_POR_DEFECTO, avisar = true }: { dias?: number; avisar?: boolean } = {},
): Promise<ResumenSync> {
  const resumen: ResumenSync = {
    diasBarridos: 0, candidatas: 0, nuevas: 0, cambiosEstado: 0, deTerceros: 0,
    eventos: 0, correos: 0, codigosProveedorDescubiertos: 0,
  };
  const nuestras = await licitacionesOfertadas();
  if (nuestras.size === 0) {
    console.log('[ordenes-compra] no hay licitaciones ofertadas — nada que buscar');
    return resumen;
  }
  const cli = getMercadoPublicoClient();
  const codigos = [...nuestras.keys()];
  // Nuestros RUT, para saber si una orden encontrada es NUESTRA o del competidor que ganó esa misma
  // licitación (ver el comentario de es_nuestra en la migración 64). Sin esta comprobación, una
  // licitación perdida nos "regalaba" la orden del ganador como si fuera una venta propia.
  const empresasPorRut = new Map<string, EmpresaNuestra>();
  for (const e of await empresasNuestras()) {
    const r = rutNormalizado(e.rut);
    if (r) empresasPorRut.set(r, e);
  }

  // ── 1. Candidatas ────────────────────────────────────────────────────────────────────────
  // `codigoEstadoVisto` guarda el estado que traía el listado, para no pedir el detalle de una
  // orden que ya tenemos guardada en ese mismo estado (que es el caso normal día a día).
  const candidatas = new Map<string, number | null>();

  // 1a) Vía directa por proveedor: solo para las empresas que ya tienen su código descubierto.
  const [empresas] = await pool.query(
    `SELECT id, razon_social, mp_codigo_proveedor FROM empresas WHERE activo = TRUE AND mp_codigo_proveedor IS NOT NULL`,
  ) as any[];
  for (const e of empresas as any[]) {
    for (let i = 0; i < dias; i++) {
      const fecha = new Date(Date.now() - i * 86_400_000);
      try {
        const lista = await cli.listarOrdenesCompraPorProveedor(String(e.mp_codigo_proveedor), fecha);
        for (const oc of lista) if (oc?.Codigo) candidatas.set(oc.Codigo, num(oc.CodigoEstado));
      } catch (err) {
        console.warn(`[ordenes-compra] proveedor ${e.mp_codigo_proveedor} día -${i} falló:`, String(err).slice(0, 120));
      }
      await dormir(PAUSA_MS);
    }
  }

  // 1b) Barrido del listado diario, cruzando por el nombre. Es la vía que funciona sin haber
  //     configurado nada, y la única que encuentra la PRIMERA orden de una empresa nueva.
  for (let i = 0; i < dias; i++) {
    const fecha = new Date(Date.now() - i * 86_400_000);
    try {
      const lista = await cli.listarOrdenesCompraDelDia(fecha);
      resumen.diasBarridos++;
      for (const oc of lista) {
        if (!oc?.Codigo || !oc?.Nombre) continue;
        if (!codigos.some(c => mencionaCodigo(oc.Nombre!, c))) continue;
        candidatas.set(oc.Codigo, num(oc.CodigoEstado));
      }
    } catch (err) {
      console.warn(`[ordenes-compra] listado del día -${i} falló:`, String(err).slice(0, 120));
    }
    await dormir(PAUSA_MS);
  }
  resumen.candidatas = candidatas.size;
  if (candidatas.size === 0) return resumen;

  // ── 2. ¿Cuáles hay que traer? ────────────────────────────────────────────────────────────
  // Solo las que no tenemos o las que cambiaron de estado — el detalle es una llamada por orden.
  const cods = [...candidatas.keys()];
  const ph = cods.map(() => '?').join(',');
  const [yaRows] = await pool.query(
    `SELECT codigo, codigo_estado FROM ordenes_compra WHERE codigo IN (${ph})`, cods,
  ) as any[];
  const yaGuardadas = new Map<string, number | null>(
    (yaRows as any[]).map(r => [String(r.codigo), r.codigo_estado == null ? null : Number(r.codigo_estado)]),
  );

  const aTraer: Array<{ codigo: string; esNueva: boolean; estadoAnterior: number | null }> = [];
  for (const [codigo, estadoNuevo] of candidatas) {
    if (!yaGuardadas.has(codigo)) { aTraer.push({ codigo, esNueva: true, estadoAnterior: null }); continue; }
    const anterior = yaGuardadas.get(codigo) ?? null;
    if (estadoNuevo != null && anterior !== estadoNuevo) aTraer.push({ codigo, esNueva: false, estadoAnterior: anterior });
  }
  if (aTraer.length === 0) return resumen;

  // ── 3. Detalle + guardado ────────────────────────────────────────────────────────────────
  const avisos: Array<{ oc: OrdenCompraAPI; negocio: NegocioOfertado; esNueva: boolean; estadoAnterior: number | null }> = [];
  const proveedoresDescubiertos = new Map<number, string>();

  for (const { codigo, esNueva, estadoAnterior } of aTraer) {
    const oc = await cli.obtenerOrdenCompra(codigo);
    await dormir(PAUSA_MS);
    if (!oc) continue;

    // La licitación de origen: primero el campo propio del detalle; si viene vacío (pasa en tratos
    // directos y en algunos organismos), se cae al nombre, que es como se encontró la orden.
    const desdeCampo = String(oc.CodigoLicitacion || '').trim().toUpperCase();
    const desdeNombre = codigos.find(c => mencionaCodigo(oc.Nombre || '', c)) || null;
    const licitacionCodigo = (desdeCampo && nuestras.has(desdeCampo) ? desdeCampo : desdeNombre) || desdeCampo || null;
    const negocio = licitacionCodigo ? nuestras.get(licitacionCodigo) : undefined;

    // ¿ES NUESTRA? Lo decide el RUT del proveedor de la orden, NUNCA la licitación: encontramos
    // esta orden porque menciona una licitación que ofertamos, pero si la perdimos, la orden es del
    // competidor que ganó. `empresa_id` sale de acá y no del negocio, para que jamás se cuelgue una
    // venta ajena de una empresa nuestra.
    const empresa = empresasPorRut.get(rutNormalizado(oc.Proveedor?.RutSucursal));
    const esNuestra = !!empresa;

    await guardarOrdenCompra(oc, licitacionCodigo, empresa?.id ?? null, esNuestra);
    if (esNueva) resumen.nuevas++; else resumen.cambiosEstado++;
    if (!esNuestra) { resumen.deTerceros++; continue; }   // se guarda como contexto, pero no avisa

    // Código interno del proveedor: se descubre una sola vez por empresa y desbloquea la consulta
    // directa (una llamada al día en vez de barrer 16.000 órdenes). Solo desde una orden ya
    // confirmada como nuestra por RUT — si no, terminábamos guardando el código del competidor.
    const codProv = String(oc.Proveedor?.Codigo || '').trim();
    if (codProv && empresa) proveedoresDescubiertos.set(empresa.id, codProv);

    if (negocio) avisos.push({ oc, negocio, esNueva, estadoAnterior });
  }

  for (const [empresaId, codProv] of proveedoresDescubiertos) {
    try {
      const [r] = await pool.query(
        `UPDATE empresas SET mp_codigo_proveedor = ? WHERE id = ? AND (mp_codigo_proveedor IS NULL OR mp_codigo_proveedor = '')`,
        [codProv, empresaId],
      ) as any[];
      if ((r as any).affectedRows) {
        resumen.codigosProveedorDescubiertos++;
        console.log(`[ordenes-compra] empresa ${empresaId}: código de proveedor MP descubierto = ${codProv}`);
      }
    } catch (e) { console.warn('[ordenes-compra] no se pudo guardar el código de proveedor:', String(e).slice(0, 120)); }
  }

  // ── 4. Avisos ────────────────────────────────────────────────────────────────────────────
  // `avisar: false` es para el backfill histórico: sin esto, cargar meses de OC ya conocidas hace
  // rato dispararía una campana y un correo por cada una, como si fueran noticia.
  if (avisar) {
    const { eventos, correos } = await avisarOrdenes(avisos);
    resumen.eventos = eventos;
    resumen.correos = correos;
  }

  // ── 5. PDF ───────────────────────────────────────────────────────────────────────────────
  // Best-effort: si falla (WAF, portal caído) no revienta la sincronización — se reintenta el
  // día siguiente, igual que el resto de lo que toca el portal público de MP.
  try {
    await descargarPdfsPendientes(10);
  } catch (e) {
    console.warn('[ordenes-compra] descarga de PDFs pendientes falló:', String(e).slice(0, 150));
  }

  return resumen;
}

async function guardarOrdenCompra(
  oc: OrdenCompraAPI, licitacionCodigo: string | null, empresaId: number | null, esNuestra: boolean,
): Promise<void> {
  const estadoTexto = (oc as any).Estado || ESTADOS_OC[Number(oc.CodigoEstado)] || null;
  await pool.query(
    `INSERT INTO ordenes_compra
       (codigo, nombre, licitacion_codigo, empresa_id, codigo_estado, estado, codigo_tipo, tipo,
        fecha_creacion, fecha_envio, fecha_aceptacion, fecha_cancelacion,
        moneda, total_neto, impuestos, total,
        comprador_organismo, comprador_unidad, comprador_rut, comprador_contacto, comprador_mail,
        proveedor_codigo, proveedor_nombre, proveedor_rut, items_json, raw_json, es_nuestra)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       nombre = VALUES(nombre),
       -- licitacion_codigo/empresa_id solo se rellenan si venían vacíos: un valor ya resuelto no se
       -- pisa con un null de una respuesta incompleta.
       licitacion_codigo = COALESCE(licitacion_codigo, VALUES(licitacion_codigo)),
       empresa_id = COALESCE(empresa_id, VALUES(empresa_id)),
       codigo_estado = VALUES(codigo_estado), estado = VALUES(estado),
       codigo_tipo = VALUES(codigo_tipo), tipo = VALUES(tipo),
       fecha_creacion = VALUES(fecha_creacion), fecha_envio = VALUES(fecha_envio),
       fecha_aceptacion = VALUES(fecha_aceptacion), fecha_cancelacion = VALUES(fecha_cancelacion),
       moneda = VALUES(moneda), total_neto = VALUES(total_neto),
       impuestos = VALUES(impuestos), total = VALUES(total),
       comprador_organismo = VALUES(comprador_organismo), comprador_unidad = VALUES(comprador_unidad),
       comprador_rut = VALUES(comprador_rut), comprador_contacto = VALUES(comprador_contacto),
       comprador_mail = VALUES(comprador_mail),
       proveedor_codigo = VALUES(proveedor_codigo), proveedor_nombre = VALUES(proveedor_nombre),
       proveedor_rut = VALUES(proveedor_rut),
       items_json = VALUES(items_json), raw_json = VALUES(raw_json),
       es_nuestra = VALUES(es_nuestra)`,
    [
      oc.Codigo, (oc.Nombre || '').slice(0, 600), licitacionCodigo, empresaId,
      num(oc.CodigoEstado), estadoTexto, oc.CodigoTipo || null, oc.Tipo || null,
      fechaMySQL(oc.Fechas?.FechaCreacion), fechaMySQL(oc.Fechas?.FechaEnvio),
      fechaMySQL(oc.Fechas?.FechaAceptacion), fechaMySQL(oc.Fechas?.FechaCancelacion),
      oc.TipoMoneda || null, num(oc.TotalNeto), num(oc.Impuestos), num(oc.Total),
      oc.Comprador?.NombreOrganismo || null, oc.Comprador?.NombreUnidad || null,
      oc.Comprador?.RutUnidad || null, oc.Comprador?.NombreContacto || null, oc.Comprador?.MailContacto || null,
      oc.Proveedor?.Codigo || null, oc.Proveedor?.Nombre || null, oc.Proveedor?.RutSucursal || null,
      oc.Items?.Listado ? JSON.stringify(oc.Items.Listado) : null,
      JSON.stringify(oc), esNuestra ? 1 : 0,
    ],
  );
}

// ── PDF de la orden ──────────────────────────────────────────────────────────────────────
// Verificado en vivo (4-ago-2026): la ficha DetailsPurchaseOrder.aspx trae el botón "Descargar
// PDF" como <input type=image onclick="open('PDFReport.aspx?qs=TOKEN', ...)">. Tanto la ficha
// como PDFReport.aspx?qs=TOKEN responden 200 con un fetch plano, sin cookies ni sesión previa —
// a diferencia de los anexos de oferta / acta, que exigen postback + __VIEWSTATE + IP chilena.
// Por eso NO se reusa mp-descarga-orquestador.ts: esto es dos fetch directos.
const RE_TOKEN_PDF = /imgPDF[\s\S]{0,400}?PDFReport\.aspx\?qs=([^'"&]+)/;

/** Descarga el PDF de UNA orden de compra desde Mercado Público y lo sube a R2. */
export async function descargarPdfOrdenCompra(
  codigoOC: string, licitacionCodigo: string | null,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const urlFicha = `https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=${encodeURIComponent(codigoOC)}`;
    const resFicha = await fetchMPConReintentos(urlFicha, {
      headers: { 'User-Agent': MP_UA, 'Accept': 'text/html,*/*;q=0.8' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resFicha.ok) return { ok: false, error: `ficha HTTP ${resFicha.status}` };
    const html = await resFicha.text();
    const token = html.match(RE_TOKEN_PDF)?.[1];
    if (!token) return { ok: false, error: 'sin botón de PDF en la ficha' };

    const urlPdf = `https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/PDFReport.aspx?qs=${token}`;
    const resPdf = await fetchMPConReintentos(urlPdf, {
      headers: { 'User-Agent': MP_UA, 'Referer': urlFicha },
      signal: AbortSignal.timeout(30_000),
    });
    if (!resPdf.ok) return { ok: false, error: `PDFReport HTTP ${resPdf.status}` };
    const buffer = Buffer.from(await resPdf.arrayBuffer());
    if (buffer.length < 500) return { ok: false, error: 'respuesta demasiado chica para ser un PDF' };

    const url = await subirDocumentoR2(licitacionCodigo || codigoOC, `OC_${codigoOC}.pdf`, buffer, 'application/pdf');
    await pool.query(
      `UPDATE ordenes_compra SET pdf_url = ?, pdf_descargado_at = ?, pdf_error = NULL WHERE codigo = ?`,
      [url, ahoraChileSQL(), codigoOC],
    );
    return { ok: true, url };
  } catch (e: any) {
    const error = String(e?.message || e).slice(0, 300);
    await pool.query(`UPDATE ordenes_compra SET pdf_error = ? WHERE codigo = ?`, [error, codigoOC]).catch(() => {});
    return { ok: false, error };
  }
}

/** PDF de todas las OC nuestras que todavía no lo tienen. Pensado para el cron diario. */
export async function descargarPdfsPendientes(max = 20): Promise<{ ok: number; fallidos: number }> {
  const stats = { ok: 0, fallidos: 0 };
  const [rows] = await pool.query(
    `SELECT codigo, licitacion_codigo FROM ordenes_compra
      WHERE es_nuestra = 1 AND pdf_url IS NULL
      ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(max, 50))}`,
  ) as any[];
  for (const r of rows as any[]) {
    const res = await descargarPdfOrdenCompra(String(r.codigo), r.licitacion_codigo ? String(r.licitacion_codigo) : null);
    if (res.ok) stats.ok++; else stats.fallidos++;
    await dormir(600);
  }
  return stats;
}

// ── Campana + correo ───────────────────────────────────────────────────────────────────────
// Mismo patrón que cierres-proximos.ts: evento en historial_eventos (que además empuja el SSE a la
// campana) para el perfil asignado y para cada admin, y un correo por destinatario. El kill-switch
// ALERTAS_EMAIL=false es compartido con el resto de las alertas.
async function avisarOrdenes(
  avisos: Array<{ oc: OrdenCompraAPI; negocio: NegocioOfertado; esNueva: boolean; estadoAnterior: number | null }>,
): Promise<{ eventos: number; correos: number }> {
  if (avisos.length === 0) return { eventos: 0, correos: 0 };
  let eventos = 0;
  let correos = 0;

  try {
    const [arows] = await pool.query(
      `SELECT id, nombre, email FROM usuarios WHERE rol = 'admin' AND activo = TRUE`,
    ) as any[];
    const admins = arows as Array<{ id: number; nombre: string | null; email: string | null }>;
    const adminIds = new Set(admins.map(a => Number(a.id)));

    // Perfiles asignados que no son admin (los admin ya reciben todo).
    const idsAsignados = [...new Set(avisos.map(a => a.negocio.asignado_a).filter((x): x is number => !!x && !adminIds.has(x)))];
    const perfiles = new Map<number, { nombre: string | null; email: string | null }>();
    if (idsAsignados.length) {
      const ph = idsAsignados.map(() => '?').join(',');
      const [urows] = await pool.query(
        `SELECT id, nombre, email FROM usuarios WHERE id IN (${ph}) AND activo = TRUE`, idsAsignados,
      ) as any[];
      for (const u of urows as any[]) perfiles.set(Number(u.id), { nombre: u.nombre, email: u.email });
    }

    const mensajeDe = (a: typeof avisos[number]) => {
      const estado = ESTADOS_OC[Number(a.oc.CodigoEstado)] || (a.oc as any).Estado || 'sin estado';
      const nom = a.negocio.licitacion_nombre || a.negocio.licitacion_codigo;
      return a.esNueva
        ? `Orden de compra emitida ${a.oc.Codigo} (${estado}): ${nom}`
        : `La orden de compra ${a.oc.Codigo} pasó a "${estado}": ${nom}`;
    };

    // Un evento por (aviso × destinatario). El INSERT va en un solo lote: el cron tiene presupuesto
    // ajustado y la base (Bluehost) tiene latencia alta.
    type Plano = { uid: number; nombre: string | null; a: typeof avisos[number]; msg: string };
    const planos: Plano[] = [];
    const porDestinatario = new Map<number, { nombre: string | null; email: string | null; esAdmin: boolean; items: typeof avisos }>();
    const push = (uid: number, nombre: string | null, email: string | null, esAdmin: boolean, a: typeof avisos[number]) => {
      planos.push({ uid, nombre, a, msg: mensajeDe(a) });
      let g = porDestinatario.get(uid);
      if (!g) { g = { nombre, email, esAdmin, items: [] }; porDestinatario.set(uid, g); }
      g.items.push(a);
    };
    for (const a of avisos) {
      const uid = a.negocio.asignado_a;
      if (uid && !adminIds.has(uid) && perfiles.has(uid)) {
        const p = perfiles.get(uid)!;
        push(uid, p.nombre, p.email, false, a);
      }
      for (const ad of admins) push(Number(ad.id), ad.nombre, ad.email, true, a);
    }
    if (planos.length === 0) return { eventos: 0, correos: 0 };

    const values: unknown[] = [];
    for (const p of planos) {
      values.push(
        'ORDEN_COMPRA', p.a.negocio.licitacion_codigo, p.a.negocio.licitacion_nombre, p.uid, p.nombre,
        null, null, p.msg,
        JSON.stringify({
          orden: p.a.oc.Codigo, estado: p.a.oc.CodigoEstado, total: p.a.oc.Total,
          nueva: p.a.esNueva, estadoAnterior: p.a.estadoAnterior,
        }),
        ahoraChileSQL(),
      );
    }
    // created_at EXPLÍCITO en hora de pared de Chile (mismo bug de siempre: el DEFAULT
    // CURRENT_TIMESTAMP lo pone el servidor MySQL de Bluehost, UTC-6, 2h atrás de Chile).
    const ph = planos.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',');
    const [ins] = await pool.query(
      `INSERT INTO historial_eventos
         (tipo, licitacion_codigo, licitacion_nombre, usuario_id, usuario_nombre, actor_id, actor_nombre, mensaje, metadata, created_at)
       VALUES ${ph}`,
      values,
    ) as any[];
    eventos = planos.length;

    // SSE: al que tenga la app abierta le llega al toque, sin recargar.
    const baseId = (ins as any).insertId || 0;   // MySQL devuelve el id del PRIMER registro del lote
    planos.forEach((p, i) => {
      publicar(p.uid, {
        id: baseId ? baseId + i : undefined, tipo: 'ORDEN_COMPRA', mensaje: p.msg,
        licitacion_codigo: p.a.negocio.licitacion_codigo, leido: false, created_at: new Date().toISOString(),
      });
    });

    if (process.env.ALERTAS_EMAIL !== 'false') {
      for (const [, g] of porDestinatario) {
        if (!g.email) continue;
        const enviado = await enviarAvisoOrdenesCompra({
          to: g.email, nombre: g.nombre, esAdmin: g.esAdmin,
          ordenes: g.items.map(a => ({
            codigo: a.oc.Codigo,
            licitacionCodigo: a.negocio.licitacion_codigo,
            licitacionNombre: a.negocio.licitacion_nombre,
            organismo: a.oc.Comprador?.NombreOrganismo || null,
            estado: ESTADOS_OC[Number(a.oc.CodigoEstado)] || (a.oc as any).Estado || null,
            total: num(a.oc.Total),
            esNueva: a.esNueva,
          })),
        });
        if (enviado) correos++;
      }
    }
  } catch (e) {
    console.error('[ordenes-compra] avisos fallaron (no crítico):', String(e));
  }
  return { eventos, correos };
}

// ── Lectura para la pantalla ───────────────────────────────────────────────────────────────
export interface OrdenCompraFila {
  codigo: string;
  // false = la orden es de la misma licitación pero de OTRO proveedor (el competidor que ganó).
  // Se muestra aparte, como contexto: nunca mezclada con nuestras ventas.
  esNuestra: boolean;
  proveedorNombre: string | null;
  nombre: string | null;
  estado: string | null;
  codigoEstado: number | null;
  tipo: string | null;
  fechaEnvio: string | null;
  fechaCreacion: string | null;
  fechaAceptacion: string | null;
  moneda: string | null;
  totalNeto: number | null;
  total: number | null;
  compradorOrganismo: string | null;
  compradorUnidad: string | null;
  compradorContacto: string | null;
  compradorMail: string | null;
  items: Array<{ descripcion: string; cantidad: number | null; precioNeto: number | null; total: number | null }>;
  url: string;
  pdfUrl: string | null;
}

export interface OrdenCompraListaFila extends OrdenCompraFila {
  licitacionCodigo: string | null;
  licitacionNombre: string | null;
  empresaId: number | null;
  empresaNombre: string | null;
}

export interface ListadoOrdenesFiltro {
  desde?: string;             // 'YYYY-MM-DD'
  hasta?: string;              // 'YYYY-MM-DD'
  empresaId?: number;
  codigoEstado?: number;
  q?: string;                  // busca en código, nombre, organismo, proveedor, licitación e ítems
  incluirTerceros?: boolean;   // por defecto solo es_nuestra = 1
  limit?: number;
  offset?: number;
}

/**
 * Lista transversal de órdenes de compra (de TODAS las empresas) para la pantalla de gestión,
 * con filtros. A diferencia de ordenesDeLicitacion (una licitación puntual), acá se pagina y se
 * trae el nombre de la licitación / empresa por JOIN, para no repetir esa resolución en el cliente.
 */
export async function listarOrdenesCompra(
  filtro: ListadoOrdenesFiltro = {},
): Promise<{ ordenes: OrdenCompraListaFila[]; total: number; sumaTotal: number }> {
  const cond: string[] = [];
  const params: unknown[] = [];

  if (!filtro.incluirTerceros) cond.push('oc.es_nuestra = 1');
  if (filtro.empresaId) { cond.push('oc.empresa_id = ?'); params.push(filtro.empresaId); }
  if (filtro.codigoEstado != null) { cond.push('oc.codigo_estado = ?'); params.push(filtro.codigoEstado); }
  if (filtro.desde) { cond.push('COALESCE(oc.fecha_envio, oc.fecha_creacion) >= ?'); params.push(`${filtro.desde} 00:00:00`); }
  if (filtro.hasta) { cond.push('COALESCE(oc.fecha_envio, oc.fecha_creacion) <= ?'); params.push(`${filtro.hasta} 23:59:59`); }
  if (filtro.q && filtro.q.trim()) {
    const like = `%${filtro.q.trim()}%`;
    cond.push(`(oc.codigo LIKE ? OR oc.nombre LIKE ? OR oc.comprador_organismo LIKE ?
                 OR oc.proveedor_nombre LIKE ? OR oc.licitacion_codigo LIKE ? OR oc.items_json LIKE ?)`);
    params.push(like, like, like, like, like, like);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const [totalRows] = await pool.query(
    `SELECT COUNT(*) AS total, SUM(oc.total) AS suma FROM ordenes_compra oc ${where}`, params,
  ) as any[];
  const total = Number((totalRows as any[])[0]?.total || 0);
  const sumaTotal = Number((totalRows as any[])[0]?.suma || 0);

  const limit = Math.min(100, Math.max(1, filtro.limit ?? 30));
  const offset = Math.max(0, filtro.offset ?? 0);

  const [rows] = await pool.query(
    `SELECT oc.codigo, oc.nombre, oc.estado, oc.codigo_estado, oc.tipo,
            oc.fecha_creacion, oc.fecha_envio, oc.fecha_aceptacion,
            oc.moneda, oc.total_neto, oc.total,
            oc.comprador_organismo, oc.comprador_unidad, oc.comprador_contacto, oc.comprador_mail,
            oc.items_json, oc.es_nuestra, oc.proveedor_nombre, oc.pdf_url,
            oc.licitacion_codigo, oc.empresa_id,
            n.licitacion_nombre, emp.razon_social AS empresa_nombre
       FROM ordenes_compra oc
       LEFT JOIN negocios n ON n.licitacion_codigo = oc.licitacion_codigo AND n.activo = TRUE
       LEFT JOIN empresas emp ON emp.id = oc.empresa_id
       ${where}
      ORDER BY COALESCE(oc.fecha_envio, oc.fecha_creacion) DESC, oc.codigo DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ) as any[];

  const ordenes: OrdenCompraListaFila[] = (rows as any[]).map(r => {
    let items: any[] = [];
    try { items = r.items_json ? JSON.parse(r.items_json) : []; } catch { items = []; }
    return {
      codigo: r.codigo,
      esNuestra: !!r.es_nuestra,
      proveedorNombre: r.proveedor_nombre,
      nombre: r.nombre,
      estado: r.estado || ESTADOS_OC[Number(r.codigo_estado)] || null,
      codigoEstado: r.codigo_estado == null ? null : Number(r.codigo_estado),
      tipo: r.tipo,
      fechaCreacion: r.fecha_creacion ? new Date(r.fecha_creacion).toISOString() : null,
      fechaEnvio: r.fecha_envio ? new Date(r.fecha_envio).toISOString() : null,
      fechaAceptacion: r.fecha_aceptacion ? new Date(r.fecha_aceptacion).toISOString() : null,
      moneda: r.moneda,
      totalNeto: r.total_neto == null ? null : Number(r.total_neto),
      total: r.total == null ? null : Number(r.total),
      compradorOrganismo: r.comprador_organismo,
      compradorUnidad: r.comprador_unidad,
      compradorContacto: r.comprador_contacto,
      compradorMail: r.comprador_mail,
      items: (Array.isArray(items) ? items : []).map((it: any) => ({
        descripcion: String(it?.EspecificacionComprador || it?.EspecificacionProveedor || it?.Categoria || '').slice(0, 400),
        cantidad: num(it?.Cantidad),
        precioNeto: num(it?.PrecioNeto),
        total: num(it?.Total),
      })),
      url: `https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=${encodeURIComponent(r.codigo)}`,
      pdfUrl: r.pdf_url || null,
      licitacionCodigo: r.licitacion_codigo || null,
      licitacionNombre: r.licitacion_nombre || null,
      empresaId: r.empresa_id == null ? null : Number(r.empresa_id),
      empresaNombre: r.empresa_nombre || null,
    };
  });

  return { ordenes, total, sumaTotal };
}

/** Las órdenes de compra de UNA licitación, listas para la sección "Resultado". */
export async function ordenesDeLicitacion(codigo: string): Promise<OrdenCompraFila[]> {
  const [rows] = await pool.query(
    `SELECT codigo, nombre, estado, codigo_estado, tipo, fecha_creacion, fecha_envio, fecha_aceptacion,
            moneda, total_neto, total, comprador_organismo, comprador_unidad, comprador_contacto,
            comprador_mail, items_json, es_nuestra, proveedor_nombre, pdf_url
       FROM ordenes_compra
      WHERE licitacion_codigo = ?
      ORDER BY es_nuestra DESC, COALESCE(fecha_envio, fecha_creacion) DESC, codigo DESC`,
    [codigo],
  ) as any[];

  return (rows as any[]).map(r => {
    let items: any[] = [];
    try { items = r.items_json ? JSON.parse(r.items_json) : []; } catch { items = []; }
    return {
      codigo: r.codigo,
      esNuestra: !!r.es_nuestra,
      proveedorNombre: r.proveedor_nombre,
      nombre: r.nombre,
      estado: r.estado || ESTADOS_OC[Number(r.codigo_estado)] || null,
      codigoEstado: r.codigo_estado == null ? null : Number(r.codigo_estado),
      tipo: r.tipo,
      fechaCreacion: r.fecha_creacion ? new Date(r.fecha_creacion).toISOString() : null,
      fechaEnvio: r.fecha_envio ? new Date(r.fecha_envio).toISOString() : null,
      fechaAceptacion: r.fecha_aceptacion ? new Date(r.fecha_aceptacion).toISOString() : null,
      moneda: r.moneda,
      totalNeto: r.total_neto == null ? null : Number(r.total_neto),
      total: r.total == null ? null : Number(r.total),
      compradorOrganismo: r.comprador_organismo,
      compradorUnidad: r.comprador_unidad,
      compradorContacto: r.comprador_contacto,
      compradorMail: r.comprador_mail,
      items: (Array.isArray(items) ? items : []).map((it: any) => ({
        descripcion: String(it?.EspecificacionComprador || it?.EspecificacionProveedor || it?.Categoria || '').slice(0, 400),
        cantidad: num(it?.Cantidad),
        precioNeto: num(it?.PrecioNeto),
        total: num(it?.Total),
      })),
      // Ficha pública de la orden en Mercado Público (la misma que abre el portal).
      url: `https://www.mercadopublico.cl/PurchaseOrder/Modules/PO/DetailsPurchaseOrder.aspx?codigoOC=${encodeURIComponent(r.codigo)}`,
      pdfUrl: r.pdf_url || null,
    };
  });
}

// ── Órdenes de compra como EXPERIENCIA acreditable (14-ago-2026, pedido explícito del usuario,
// instructivo interno "Presentacion_Creacion_Anexos_FINAL_CON_EJEMPLOS.pdf" punto 8) ────────────
// Los anexos de "Experiencia del Oferente" piden una tabla con contratos/OC anteriores (fecha,
// N° OC, cliente/mandante, descripción del objeto, monto) — antes el Anexo Creator no tenía ninguna
// conexión con esta base de OC ya cruzada por RUT/nombre (ver la cabecera de este archivo), así que
// esa tabla quedaba siempre en blanco pese a que la data real ya existe acá.
//
// Filtro de estado — regla explícita del instructivo: SOLO cuentan las OC en "Aceptada" (código 6)
// o "Recepción conforme" (código 12). Una OC "Enviada a proveedor" o "En proceso" todavía puede
// caerse o rechazarse, no es evidencia firme de experiencia cumplida — y "Cancelada" obviamente
// tampoco. Se deja afuera "Recepción conforme incompleta" (código 15) a propósito: el instructivo
// nombra los dos estados exactos, no una entrega parcial.
const ESTADOS_ACREDITAN_EXPERIENCIA = [6, 12];

export interface OcExperiencia {
  codigo: string;
  fecha: string | null;       // ISO — la más confiable disponible (aceptación > envío > creación)
  cliente: string | null;     // organismo comprador (el "mandante" que pide el instructivo)
  descripcion: string;        // nombre de la OC — lo más parecido a "objeto de la contratación" que trae el registro
  monto: number | null;
  moneda: string | null;
}

/**
 * OC reales de ESTA empresa que acreditan experiencia (estado Aceptada/Recepción conforme),
 * más recientes primero. Se usan como candidatos para la tabla de "Experiencia del Oferente" de
 * los anexos — NUNCA se auto-confirman solas: la IA (ver resolverExperienciaDesdeOrdenesCompra en
 * anexos-ia-motor.ts) todavía tiene que juzgar si describen la experiencia que ESTA licitación
 * puntual pide, y el resultado queda marcado `via: 'ordenes_compra'` en la UI para que un humano
 * confirme la pertinencia antes de presentar — mismo criterio de cautela que pide el instructivo
 * ("no basta con que exista una OC; debe ser pertinente a la experiencia que se está acreditando").
 */
export async function ocsParaExperiencia(empresaId: number, limite = 15): Promise<OcExperiencia[]> {
  const ph = ESTADOS_ACREDITAN_EXPERIENCIA.map(() => '?').join(',');
  const [rows] = await pool.query(
    `SELECT codigo, nombre, comprador_organismo, moneda, total,
            COALESCE(fecha_aceptacion, fecha_envio, fecha_creacion) AS fecha
       FROM ordenes_compra
      WHERE empresa_id = ? AND es_nuestra = 1 AND codigo_estado IN (${ph})
      ORDER BY COALESCE(fecha_aceptacion, fecha_envio, fecha_creacion) DESC
      LIMIT ?`,
    [empresaId, ...ESTADOS_ACREDITAN_EXPERIENCIA, limite],
  ) as any[];
  return (rows as any[]).map(r => ({
    codigo: r.codigo,
    fecha: r.fecha ? new Date(r.fecha).toISOString() : null,
    cliente: r.comprador_organismo || null,
    descripcion: r.nombre || '',
    monto: r.total == null ? null : Number(r.total),
    moneda: r.moneda || null,
  }));
}
