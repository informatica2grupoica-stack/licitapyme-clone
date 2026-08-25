// app/lib/ofertas-competencia.ts
// Frente F.2 — orquestación: leer la apertura, persistir ofertas y anexos, bajar los archivos de
// cada oferente y avisar al perfil.
//
// SEPARACIÓN A PROPÓSITO (misma disciplina que la descarga de bases):
//   detectar (mp-ofertas) → persistir (acá) → descargar binarios (acá, con presupuesto).
// Una descarga que falla no borra el hallazgo: la fila queda con `error` y se reintenta.
//
// Requiere IP CHILENA (WAF de MP) → cron del VPS, nunca Vercel.

import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { subirDocumentoR2, mimeDeNombre } from '@/app/lib/r2';
import { ahoraChileSQL } from '@/app/lib/tz';
import {
  leerOfertasApertura, descargarDocumentoOferta, descargarAnexoPorPostback, normalizarRut,
  ROTULO_CATEGORIA, type OfertaLeida, type DocumentoOferta, type CategoriaAnexo,
} from '@/app/lib/mp-ofertas';
import { idsEquivalentes } from '@/app/lib/pipeline';

// IDs (vigente + legados) que cuentan como "postulada" — ver misma nota en detectar-aperturas.ts.
const ESTADOS_POSTULADA = idsEquivalentes('POSTULADA');
const IN_POSTULADA = ESTADOS_POSTULADA.map(() => '?').join(', ');

const CONCURRENCIA     = 2;        // la apertura es más pesada que la ficha: sé gentil con MP
const PRESUPUESTO_MS   = 260_000;  // margen bajo maxDuration=300
// El freno real de la descarga es el TIEMPO, no el conteo: desde que se recorren todas las
// páginas de la grilla, una licitación puede tener 200 anexos y bajarlos de a 20 la dejaba
// semanas atrás. El tope alto lo acota el presupuesto de abajo.
const MAX_DOCS_CORRIDA = 60;
const PRESUPUESTO_DESCARGA_MS = 100_000;   // cabe en el maxDuration=120 de la ruta de la UI

// ── RUTs propios: para marcar cuál de las ofertas es la NUESTRA ───────────────
let cacheRuts: { ruts: Set<string>; at: number } | null = null;

async function rutsPropios(): Promise<Set<string>> {
  if (cacheRuts && Date.now() - cacheRuts.at < 10 * 60_000) return cacheRuts.ruts;
  const ruts = new Set<string>();
  try {
    const [rows] = await pool.query(`SELECT rut FROM empresas WHERE activo = 1`) as any;
    for (const r of rows as any[]) {
      const n = normalizarRut(String(r.rut || ''));
      if (n) ruts.add(n);
    }
  } catch (e) {
    // No enmudecer: sin esto TODAS las ofertas se marcan como ajenas y la comparación
    // "mi oferta vs. el resto" queda muda sin explicación.
    console.error('[ofertas] no se pudieron leer los RUT propios:', String(e).slice(0, 200));
  }
  cacheRuts = { ruts, at: Date.now() };
  return ruts;
}

// ── Persistencia ─────────────────────────────────────────────────────────────

async function guardarOfertas(codigo: string, ofertas: OfertaLeida[]): Promise<number> {
  if (ofertas.length === 0) return 0;
  const propios = await rutsPropios();
  let n = 0;
  for (const o of ofertas) {
    try {
      await pool.query(
        `INSERT INTO oferta_competencia
           (licitacion_codigo, proveedor_rut, proveedor_nombre, nombre_oferta, estado,
            linea_numero, linea_descripcion, monto, moneda, es_nuestra, fuente, leida_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           proveedor_nombre  = VALUES(proveedor_nombre),
           nombre_oferta     = COALESCE(VALUES(nombre_oferta), nombre_oferta),
           estado            = COALESCE(VALUES(estado), estado),
           linea_descripcion = COALESCE(VALUES(linea_descripcion), linea_descripcion),
           -- El monto NO se pisa con NULL: la apertura técnica (sin montos) se lee antes que la
           -- económica, y sobrescribir borraría el precio ya capturado.
           monto             = COALESCE(VALUES(monto), monto),
           moneda            = COALESCE(VALUES(moneda), moneda),
           es_nuestra        = VALUES(es_nuestra),
           fuente            = VALUES(fuente)`,
        [codigo, o.proveedorRut, o.proveedorNombre, o.nombreOferta, o.estado,
         o.lineaNumero, o.lineaDescripcion, o.monto, o.moneda,
         propios.has(o.proveedorRut) ? 1 : 0, o.fuente, ahoraChileSQL()],
      );
      n++;
    } catch (e) {
      console.error(`[ofertas] ${codigo}/${o.proveedorRut} no se guardó:`, String(e).slice(0, 200));
    }
  }
  return n;
}

async function guardarDocumentos(codigo: string, docs: DocumentoOferta[]): Promise<number> {
  let n = 0;
  for (const d of docs) {
    try {
      await pool.query(
        // La clave única es (licitación, proveedor, categoría, nombre): el `enc` de la URL cambia
        // entre lecturas, así que la URL se ACTUALIZA en cada pasada en vez de duplicar la fila.
        `INSERT INTO oferta_competencia_documento
           (licitacion_codigo, proveedor_rut, categoria, nombre, tipo_mp, descripcion, tamano_kb,
            url_contenedor, url_mp, pagina_grilla, detectado_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           tipo_mp        = COALESCE(VALUES(tipo_mp), tipo_mp),
           descripcion    = COALESCE(VALUES(descripcion), descripcion),
           tamano_kb      = COALESCE(VALUES(tamano_kb), tamano_kb),
           url_contenedor = VALUES(url_contenedor),
           url_mp         = VALUES(url_mp),
           -- La página se re-escribe siempre: si MP reordena la grilla, el número viejo apuntaría
           -- al archivo equivocado (ver migration-77).
           pagina_grilla  = VALUES(pagina_grilla)`,
        [codigo, d.proveedorRut, d.categoria, d.nombre, d.tipoMp, d.descripcion, d.tamanoKb,
         d.urlContenedor, d.url, d.pagina || 1, ahoraChileSQL()],
      );
      n++;
    } catch (e) {
      console.error(`[ofertas] doc de ${codigo} no se registró:`, String(e).slice(0, 200));
    }
  }
  return n;
}

/**
 * `truncada` = la lectura se cortó por tope o presupuesto. En ese caso NO se estampa
 * ofertas_leidas_en: el poller solo toma las que tienen esa fecha en NULL, así que darla por
 * leída congelaría para siempre una apertura a la que le faltan oferentes o anexos. El contador
 * de intentos (< 6) es el que evita que reintente en bucle.
 */
async function marcarLectura(
  codigo: string, encontradas: number, diagnostico: string, truncada = false,
): Promise<void> {
  try {
    await pool.query(
      `UPDATE licitacion_apertura
          SET ofertas_leidas_en   = ${truncada ? 'NULL' : '?'},
              ofertas_encontradas = ?,
              ofertas_intentos    = ofertas_intentos + 1,
              ofertas_diagnostico = ?
        WHERE licitacion_codigo = ?`,
      truncada
        ? [encontradas, diagnostico, codigo]
        : [ahoraChileSQL(), encontradas, diagnostico, codigo],
    );
  } catch (e) {
    console.error(`[ofertas] no se pudo marcar la lectura de ${codigo}:`, String(e).slice(0, 200));
  }
}

async function marcarIntentoFallido(codigo: string, motivo: string): Promise<void> {
  try {
    await pool.query(
      `UPDATE licitacion_apertura
          SET ofertas_intentos = ofertas_intentos + 1, ofertas_diagnostico = ?
        WHERE licitacion_codigo = ?`,
      [motivo.slice(0, 400), codigo],
    );
  } catch { /* la fila puede no existir aún */ }
}

// ── Aviso al perfil ──────────────────────────────────────────────────────────

async function avisarOfertasLeidas(codigo: string, cuantas: number): Promise<void> {
  if (cuantas === 0) return;
  try {
    const [rows] = await pool.query(
      `SELECT n.asignado_a, n.licitacion_nombre, u.nombre AS usuario_nombre
         FROM negocios n JOIN usuarios u ON u.id = n.asignado_a AND u.activo = TRUE
        WHERE n.activo = TRUE AND n.estado_pipeline IN (${IN_POSTULADA}) AND n.licitacion_codigo = ?`,
      [...ESTADOS_POSTULADA, codigo],
    ) as any;
    for (const r of rows as any[]) {
      await registrarEvento({
        tipo: 'APERTURA',
        licitacionCodigo: codigo, licitacionNombre: r.licitacion_nombre,
        usuarioId: r.asignado_a, usuarioNombre: r.usuario_nombre,
        actorId: null, actorNombre: 'Mercado Público',
        mensaje: `🔍 Ofertas de la apertura disponibles: ${cuantas} competidor(es) en ${r.licitacion_nombre || codigo}`,
        metadata: { licitacion_codigo: codigo, ofertas: cuantas },
      });
    }
  } catch (e) {
    console.error(`[ofertas] aviso de ${codigo} falló:`, String(e).slice(0, 200));
  }
}

// ── Lectura de UNA licitación ────────────────────────────────────────────────

export interface ResultadoLectura {
  codigo: string;
  ofertas: number;
  documentos: number;
  diagnostico: string;
  ok: boolean;
}

export async function leerYGuardarOfertas(codigo: string): Promise<ResultadoLectura> {
  const lectura = await leerOfertasApertura(codigo);
  if (!lectura) {
    await marcarIntentoFallido(codigo, 'no se pudo entrar al portal (WAF/timeout/MP caído)');
    return { codigo, ofertas: 0, documentos: 0, ok: false, diagnostico: 'portal ilegible' };
  }

  const guardadas = await guardarOfertas(codigo, lectura.ofertas);
  const docs = await guardarDocumentos(codigo, lectura.documentos);
  await marcarLectura(codigo, guardadas, lectura.diagnostico, lectura.truncada);

  // La apertura nos incluye a NOSOTROS. Lo que cuenta como competencia es el resto: avisar
  // "1 competidor" cuando ese uno somos nosotros sería mentirle al usuario.
  const propios = await rutsPropios();
  const competidores = new Set(
    lectura.ofertas.filter(o => !propios.has(o.proveedorRut)).map(o => o.proveedorRut),
  ).size;
  await avisarOfertasLeidas(codigo, competidores);

  return { codigo, ofertas: guardadas, documentos: docs, ok: true, diagnostico: lectura.diagnostico };
}

// ── Poller del cron ──────────────────────────────────────────────────────────

export async function contarPendientesOfertas(): Promise<number> {
  try {
    const [rows] = await pool.query(
      // COLLATE obligatorio: negocios es general_ci y licitacion_apertura unicode_ci. Sin él,
      // "Illegal mix of collations" → el catch devolvía 0 y el cron creía estar al día.
      `SELECT COUNT(DISTINCT la.licitacion_codigo) AS n
         FROM licitacion_apertura la
         JOIN negocios n
           ON n.licitacion_codigo COLLATE utf8mb4_unicode_ci = la.licitacion_codigo
          AND n.activo = TRUE AND n.estado_pipeline IN (${IN_POSTULADA})
        WHERE la.aperturada = 1
          AND la.ofertas_leidas_en IS NULL
          AND la.ofertas_intentos < 6`,
      ESTADOS_POSTULADA,
    ) as any;
    return Number((rows as any[])[0]?.n) || 0;
  } catch (e) {
    console.error('[ofertas] contarPendientes falló:', String(e).slice(0, 200));
    return 0;
  }
}

export async function procesarOfertasPendientes(lote = 10): Promise<{
  leidas: number; ofertas: number; documentos: number; errores: number;
}> {
  const stats = { leidas: 0, ofertas: 0, documentos: 0, errores: 0 };
  const inicio = Date.now();

  let codigos: string[] = [];
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT la.licitacion_codigo AS codigo, la.detectada_en
         FROM licitacion_apertura la
         JOIN negocios n
           ON n.licitacion_codigo COLLATE utf8mb4_unicode_ci = la.licitacion_codigo
          AND n.activo = TRUE AND n.estado_pipeline IN (${IN_POSTULADA})
        WHERE la.aperturada = 1
          AND la.ofertas_leidas_en IS NULL
          AND la.ofertas_intentos < 6
        ORDER BY la.detectada_en DESC
        LIMIT ${Math.max(1, Math.min(lote, 50))}`,
      ESTADOS_POSTULADA,
    ) as any;
    codigos = (rows as any[]).map(r => String(r.codigo));
  } catch (e) {
    console.error('[ofertas] carga inicial falló:', String(e).slice(0, 300));
    return stats;
  }
  if (codigos.length === 0) return stats;

  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, codigos.length) }, async () => {
    while (i < codigos.length) {
      const codigo = codigos[i++];
      if (Date.now() - inicio > PRESUPUESTO_MS) return;
      try {
        const r = await leerYGuardarOfertas(codigo);
        if (!r.ok) { stats.errores++; continue; }
        stats.leidas++;
        stats.ofertas += r.ofertas;
        stats.documentos += r.documentos;
      } catch (e) {
        stats.errores++;
        console.error(`[ofertas] "${codigo}" falló:`, String(e).slice(0, 300));
      }
    }
  }));
  return stats;
}

// ── Descarga de los binarios ─────────────────────────────────────────────────

/**
 * Baja a R2 los anexos de oferta que aún no tienen copia propia.
 *
 * Los `enc=` del portal son EFÍMEROS: por eso se RE-LEE la apertura de la licitación antes de
 * bajar sus archivos, y el link se resuelve por (proveedor, categoría, nombre) contra la lectura
 * fresca. Reusar la URL guardada funciona solo si la fila es reciente.
 */
export async function descargarDocumentosOferta(
  max = MAX_DOCS_CORRIDA,
  filtro: { codigo?: string; rut?: string } = {},
): Promise<{ descargados: number; fallidos: number }> {
  const stats = { descargados: 0, fallidos: 0 };
  const inicio = Date.now();
  let filas: any[] = [];
  try {
    // El filtro permite que la UI baje AHORA los anexos del oferente que se está mirando, sin
    // esperar la pasada horaria del cron: quien abre la competencia quiere leerla ya.
    const where: string[] = [`descargado_at IS NULL`, `(error IS NULL OR error NOT LIKE 'definitivo:%')`];
    const params: any[] = [];
    if (filtro.codigo) { where.push('licitacion_codigo = ?'); params.push(filtro.codigo); }
    if (filtro.rut)    { where.push('proveedor_rut = ?');     params.push(filtro.rut); }

    const [rows] = await pool.query(
      `SELECT id, licitacion_codigo, proveedor_rut, categoria, nombre, url_mp, url_contenedor,
              pagina_grilla
         FROM oferta_competencia_documento
        WHERE ${where.join(' AND ')}
        ORDER BY detectado_at ASC
        LIMIT ${Math.max(1, Math.min(max, 100))}`,
      params,
    ) as any;
    filas = rows as any[];
  } catch (e) {
    console.error('[ofertas] no se pudo listar documentos pendientes:', String(e).slice(0, 200));
    return stats;
  }
  if (filas.length === 0) return stats;

  // Agrupar por licitación: una sola sesión del portal sirve para todos sus archivos.
  const porCodigo = new Map<string, any[]>();
  for (const f of filas) {
    const k = String(f.licitacion_codigo);
    porCodigo.set(k, [...(porCodigo.get(k) || []), f]);
  }

  for (const [codigo, docs] of porCodigo) {
    if (Date.now() - inicio > PRESUPUESTO_DESCARGA_MS) break;   // lo que quede sigue pendiente
    const lectura = await leerOfertasApertura(codigo);
    if (!lectura) { stats.fallidos += docs.length; continue; }
    const vigentes = new Map(
      lectura.documentos.map(d => [`${d.proveedorRut}|${d.categoria}|${d.nombre}`, d]),
    );

    for (const d of docs) {
      if (Date.now() - inicio > PRESUPUESTO_DESCARGA_MS) break;
      const clave = `${d.proveedor_rut}|${d.categoria}|${d.nombre}`;
      const fresco = vigentes.get(clave);
      const url = fresco?.url || String(d.url_mp || '');
      const contenedor = fresco?.urlContenedor || String(d.url_contenedor || '');
      // La página manda desde la lectura FRESCA; la guardada es el respaldo (1 en las filas
      // anteriores a migration-77). Apretar el botón sin estar en la página correcta baja el
      // archivo homólogo de la primera página, no el que se pidió.
      const pagina = fresco?.pagina || Number(d.pagina_grilla) || 1;

      // Dos mecanismos de descarga según cómo el portal exponga el archivo:
      //  · `postback:<control>` → ImageButton de ASP.NET: POST del formulario de la página
      //    contenedora con __VIEWSTATE fresco (es el caso normal en los anexos de oferta).
      //  · URL directa → GET de toda la vida.
      const bin = url.startsWith('postback:')
        ? (contenedor
            ? await descargarAnexoPorPostback(contenedor, url.slice('postback:'.length), lectura.cookies, lectura.referer, pagina)
            : null)
        : url ? await descargarDocumentoOferta(url, lectura.cookies, lectura.referer) : null;
      if (!bin) {
        stats.fallidos++;
        await pool.query(`UPDATE oferta_competencia_documento SET error = ? WHERE id = ?`,
          [url ? 'link expirado o bloqueado por el portal' : 'MP no expone un link directo (postback)', d.id],
        ).catch(() => {});
        continue;
      }
      try {
        const nombre = String(d.nombre).replace(/[\\/:*?"<>|]/g, '_').slice(0, 180) || 'oferta';
        const urlR2 = await subirDocumentoR2(
          `${codigo}/ofertas/${String(d.proveedor_rut || 'sin-rut')}`, nombre, bin.buffer,
          bin.contentType === 'application/octet-stream' ? mimeDeNombre(nombre, bin.contentType) : bin.contentType,
        );
        await pool.query(
          `UPDATE oferta_competencia_documento
              SET url_r2 = ?, bytes = ?, content_type = ?, descargado_at = ?, error = NULL
            WHERE id = ?`,
          [urlR2, bin.buffer.length, bin.contentType, ahoraChileSQL(), d.id],
        );
        stats.descargados++;
      } catch (e) {
        stats.fallidos++;
        console.error(`[ofertas] subida a R2 de ${codigo}/${d.nombre} falló:`, String(e).slice(0, 200));
        await pool.query(`UPDATE oferta_competencia_documento SET error = ? WHERE id = ?`,
          [String(e).slice(0, 300), d.id]).catch(() => {});
      }
    }
  }
  return stats;
}

// ── Lectura para la UI ───────────────────────────────────────────────────────

export interface DocumentoVista {
  id: number;
  nombre: string;
  descripcion: string | null;
  tipoMp: string | null;
  tamanoKb: number | null;
  url: string | null;          // copia propia en R2 (null = aún no descargado)
  error: string | null;
}

export interface CategoriaVista {
  categoria: CategoriaAnexo;
  rotulo: string;
  documentos: DocumentoVista[];
}

export interface OferenteVista {
  proveedorRut: string;
  proveedorNombre: string;
  nombreOferta: string | null;
  estado: string | null;
  monto: number | null;
  moneda: string | null;
  esNuestra: boolean;
  lineas: { lineaNumero: number; lineaDescripcion: string | null; monto: number | null }[];
  categorias: CategoriaVista[];
  totalDocumentos: number;
  documentosDescargados: number;
  /** El monto está fuera de escala respecto del resto (ver `montoAnomalo` más abajo). */
  montoAnomalo: boolean;
}

export interface AperturaVista {
  codigo: string;
  aperturada: boolean;
  leidaEn: string | null;
  diagnostico: string | null;
  oferentes: OferenteVista[];
  competidores: number;
  /**
   * Posición de nuestra oferta ordenando por el "Total Oferta" que publica MP. 1 = el total
   * más bajo. NO significa "la mejor oferta": ver `notaComparacion`.
   */
  nuestraPosicion: number | null;
  totalOferentesConMonto: number;
  /**
   * Por qué el ranking puede NO ser una comparación válida, o null si no hay reparos.
   * Se calcula, no se asume, y viaja con el número para que nunca se lea solo.
   */
  notaComparacion: string | null;
}

const ORDEN_CATEGORIAS: CategoriaAnexo[] = [
  'ECONOMICOS', 'TECNICOS', 'ADMINISTRATIVOS', 'DECLARACION_JURADA', 'INFORMACION_PROVEEDOR', 'OTRO',
];

export async function obtenerAperturaVista(codigo: string): Promise<AperturaVista> {
  const base: AperturaVista = {
    codigo, aperturada: false, leidaEn: null, diagnostico: null,
    oferentes: [], competidores: 0, nuestraPosicion: null, totalOferentesConMonto: 0,
    notaComparacion: null,
  };

  try {
    const [ap] = await pool.query(
      `SELECT aperturada, ofertas_leidas_en, ofertas_diagnostico
         FROM licitacion_apertura WHERE licitacion_codigo = ? LIMIT 1`, [codigo],
    ) as any;
    const fila = (ap as any[])[0];
    if (fila) {
      base.aperturada  = !!fila.aperturada;
      base.leidaEn     = fila.ofertas_leidas_en ? String(fila.ofertas_leidas_en) : null;
      base.diagnostico = fila.ofertas_diagnostico ? String(fila.ofertas_diagnostico) : null;
    }
  } catch (e) {
    console.error(`[ofertas] estado de apertura de ${codigo}:`, String(e).slice(0, 200));
  }

  try {
    const [rows] = await pool.query(
      `SELECT proveedor_rut, proveedor_nombre, nombre_oferta, estado, linea_numero,
              linea_descripcion, monto, moneda, es_nuestra
         FROM oferta_competencia
        WHERE licitacion_codigo = ?
        ORDER BY linea_numero ASC, (monto IS NULL) ASC, monto ASC`,
      [codigo],
    ) as any;
    const [docs] = await pool.query(
      `SELECT id, proveedor_rut, categoria, nombre, descripcion, tipo_mp, tamano_kb, url_r2, error
         FROM oferta_competencia_documento
        WHERE licitacion_codigo = ?
        ORDER BY categoria, nombre`,
      [codigo],
    ) as any;

    // Documentos agrupados por proveedor → categoría.
    const docsPorProveedor = new Map<string, Map<CategoriaAnexo, DocumentoVista[]>>();
    for (const d of docs as any[]) {
      const rut = String(d.proveedor_rut || '');
      const cat = (String(d.categoria || 'OTRO') as CategoriaAnexo);
      if (!docsPorProveedor.has(rut)) docsPorProveedor.set(rut, new Map());
      const porCat = docsPorProveedor.get(rut)!;
      if (!porCat.has(cat)) porCat.set(cat, []);
      porCat.get(cat)!.push({
        id: Number(d.id),
        nombre: String(d.nombre),
        descripcion: d.descripcion ? String(d.descripcion) : null,
        tipoMp: d.tipo_mp ? String(d.tipo_mp) : null,
        tamanoKb: d.tamano_kb == null ? null : Number(d.tamano_kb),
        url: d.url_r2 ? String(d.url_r2) : null,
        error: d.error ? String(d.error) : null,
      });
    }

    // Una fila por OFERENTE (no por línea): la línea 0 manda como cabecera y las demás quedan
    // como desglose. Antes se listaba una fila por línea y el mismo proveedor aparecía N veces.
    const porRut = new Map<string, OferenteVista>();
    for (const r of rows as any[]) {
      const rut = String(r.proveedor_rut);
      const linea = Number(r.linea_numero) || 0;
      const monto = r.monto == null ? null : Number(r.monto);
      if (!porRut.has(rut)) {
        const porCat = docsPorProveedor.get(rut) || new Map<CategoriaAnexo, DocumentoVista[]>();
        const categorias: CategoriaVista[] = ORDEN_CATEGORIAS
          .filter(c => (porCat.get(c) || []).length > 0)
          .map(c => ({ categoria: c, rotulo: ROTULO_CATEGORIA[c], documentos: porCat.get(c)! }));
        const todos = categorias.flatMap(c => c.documentos);
        porRut.set(rut, {
          proveedorRut: rut,
          proveedorNombre: String(r.proveedor_nombre),
          nombreOferta: r.nombre_oferta ? String(r.nombre_oferta) : null,
          estado: r.estado ? String(r.estado) : null,
          monto: linea === 0 ? monto : null,
          moneda: r.moneda ? String(r.moneda) : null,
          esNuestra: !!r.es_nuestra,
          lineas: [],
          categorias,
          totalDocumentos: todos.length,
          documentosDescargados: todos.filter(d => d.url).length,
          montoAnomalo: false,   // se resuelve abajo, cuando están todos los montos
        });
      }
      const of = porRut.get(rut)!;
      if (linea === 0) {
        if (of.monto == null) of.monto = monto;
      } else {
        of.lineas.push({ lineaNumero: linea, lineaDescripcion: r.linea_descripcion ? String(r.linea_descripcion) : null, monto });
      }
    }

    // Orden: nuestra oferta primero (es la referencia), luego por monto ascendente.
    base.oferentes = [...porRut.values()].sort((a, b) => {
      if (a.esNuestra !== b.esNuestra) return a.esNuestra ? -1 : 1;
      if (a.monto == null) return 1;
      if (b.monto == null) return -1;
      return a.monto - b.monto;
    });

    base.competidores = base.oferentes.filter(o => !o.esNuestra).length;

    const conMonto = base.oferentes.filter(o => o.monto != null).sort((a, b) => a.monto! - b.monto!);
    base.totalOferentesConMonto = conMonto.length;
    const idx = conMonto.findIndex(o => o.esNuestra);
    base.nuestraPosicion = idx >= 0 ? idx + 1 : null;

    // ── ¿Es comparable este ranking? ─────────────────────────────────────────
    // "La 9ª más baja de 10" suena a veredicto, y NO lo es: solo ordena el campo "Total Oferta"
    // que publica MP. Dos cosas lo invalidan seguido y hay que decirlas junto al número:
    //
    //  · MONTOS FUERA DE ESCALA. MP publica lo que el proveedor escribió, sin validar: en la
    //    apertura 1173418-1-LE26 un oferente aparece con "$ 4". No se filtra (sería inventar
    //    datos), pero un total así no compite con nadie y corre el puesto de todos los demás.
    //  · TOTALES NO EQUIVALENTES. Si se adjudica por líneas, quien ofertó 1 de 4 líneas tiene
    //    un total más bajo sin ser más barato. Se detecta por dispersión: cuando el menor total
    //    real es menos de un tercio de la mediana, lo más probable es que no todos cotizaron lo
    //    mismo.
    const montos = conMonto.map(o => o.monto!).filter(m => m > 0);
    if (montos.length >= 3) {
      const mediana = montos.length % 2
        ? montos[(montos.length - 1) / 2]
        : (montos[montos.length / 2 - 1] + montos[montos.length / 2]) / 2;

      const UMBRAL_ANOMALO = mediana * 0.05;   // 5% de la mediana: eso ya no es una oferta
      for (const o of base.oferentes) {
        if (o.monto != null && o.monto > 0 && o.monto < UMBRAL_ANOMALO) o.montoAnomalo = true;
      }

      const anomalos = base.oferentes.filter(o => o.montoAnomalo).length;
      const sanos = montos.filter(m => m >= UMBRAL_ANOMALO);
      const dispersos = sanos.length >= 2 && sanos[0] < mediana / 3;

      const razones: string[] = [];
      if (anomalos > 0) {
        razones.push(`${anomalos} oferta${anomalos === 1 ? '' : 's'} con un total fuera de escala (lo publica así Mercado Público)`);
      }
      if (dispersos) {
        razones.push('los totales difieren tanto entre sí que probablemente no todos cotizaron las mismas líneas');
      }
      base.notaComparacion = razones.length
        ? `Compara el "Total Oferta" publicado por Mercado Público, no la calidad ni el alcance de cada oferta. Tómalo con cuidado: ${razones.join(' y ')}.`
        : 'Compara el "Total Oferta" publicado por Mercado Público, no la calidad ni el alcance de cada oferta.';
    }
  } catch (e) {
    console.error(`[ofertas] lectura de ofertas de ${codigo}:`, String(e).slice(0, 200));
  }

  return base;
}
