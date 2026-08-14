// app/lib/anexos-datos.ts
// Frente E.1 — puente entre las rutas de la app (DB + R2) y el módulo puro de relleno
// (anexos-rellenar.ts, que solo trabaja con buffers en memoria). Aísla las dos rutas
// (analizar/generar) de tener que duplicar la misma consulta y el mismo fetch.
import pool from '@/app/lib/db';
import type { EmpresaCampos } from '@/app/lib/anexos-ia-motor';
import { conCamposDerivados, fechaLargaChile } from '@/app/lib/anexos-derivados';
import { convertirDocADocx } from '@/app/lib/anexos-doc-legacy';
import { parsearCosteo, itemsPrecioDeCosteo, type ItemCosteoPrecio } from '@/app/lib/motor-comercial';
import { ocrTieneHuecos, esTextoBasuraOCR } from '@/app/lib/zai-ocr';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { MONEDA_LABEL_MAP } from '@/app/types/mercado-publico.types';
import { ocsParaExperiencia } from '@/app/lib/ordenes-compra';

export interface DocumentoBase {
  bufferOriginal: Buffer;
  nombreOriginal: string;
}

export interface DocumentoYEmpresa extends DocumentoBase {
  empresa: EmpresaCampos;
}

// Carga y normaliza el .doc/.docx crudo de la licitación (sin nada de empresa/negocio) — el único
// puente que comparten cargarDocumentoYEmpresa (relleno, necesita además la ficha de la empresa) y
// anexos-separar (solo necesita el documento, se usa ANTES de rellenar nada).
export async function cargarDocumentoBase(codigo: string, documentoId: string): Promise<DocumentoBase> {
  const [docRows] = await pool.query(
    // Sin filtro de categoría a propósito: el clasificador de Mercado Público a veces mete un
    // anexo real en otra caja (BASES_ADMINISTRATIVAS, OTROS, sin clasificar…) — cualquier .doc/
    // .docx descargado de la licitación es candidato, no solo los que cayeron en ANEXOS_OFERENTE.
    `SELECT documento_nombre, documento_url_local
       FROM documentos_cache WHERE id = ? AND licitacion_codigo = ? LIMIT 1`,
    [documentoId, codigo],
  );
  const doc = (docRows as any[])[0];
  if (!doc) throw new Error('Documento no encontrado en esta licitación');

  const nombre: string = doc.documento_nombre || '';
  const esDocx = /\.docx$/i.test(nombre);
  const esDocLegado = !esDocx && /\.doc$/i.test(nombre);
  if (!esDocx && !esDocLegado) {
    throw new Error('Solo se soportan documentos Word (.doc o .docx), este no lo es');
  }

  const resDoc = await fetch(doc.documento_url_local);
  if (!resDoc.ok) throw new Error(`No se pudo bajar el documento original (HTTP ${resDoc.status})`);
  const bufferDescargado = Buffer.from(await resDoc.arrayBuffer());

  // .doc legado (Word 97-2003, binario OLE) no se puede editar directo — se convierte a .docx
  // en el conversor del VPS (LibreOffice headless) antes de analizar/rellenar/separar.
  const bufferOriginal = esDocLegado ? await convertirDocADocx(bufferDescargado) : bufferDescargado;
  const nombreOriginal = esDocLegado ? nombre.replace(/\.doc$/i, '.docx') : nombre;

  return { bufferOriginal, nombreOriginal };
}

export async function cargarDocumentoYEmpresa(
  codigo: string,
  documentoId: string,
  empresaId: string,
): Promise<DocumentoYEmpresa> {
  const { bufferOriginal, nombreOriginal } = await cargarDocumentoBase(codigo, documentoId);

  // `empresaId` viaja como parámetro del cliente (query string en /analizar, body en /generar) sin
  // ningún cruce contra la licitación — auditoría 12-ago-2026: a diferencia de `documentoId` (que
  // SÍ está scopeado arriba con `AND licitacion_codigo = ?`), nada impedía pedir el anexo de ESTA
  // licitación con los datos de CUALQUIER otra empresa activa del sistema. Las dos rutas son
  // admin-only, así que no es una fuga entre tenants (un admin ya puede ver cualquier empresa),
  // pero sí un guardarraíl de negocio real: sin esto, un `empresaId` viejo/equivocado en el cliente
  // genera en silencio un anexo legal con la razón social/RUT de OTRA empresa. Mismo criterio de
  // "activo, el más reciente" que ya usa el guardarraíl de congelamiento en /api/anexos/generar.
  const [negocioRows] = await pool.query(
    `SELECT empresa_id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE ORDER BY id DESC LIMIT 1`,
    [codigo],
  );
  const negocio = (negocioRows as any[])[0];
  if (negocio?.empresa_id != null && String(negocio.empresa_id) !== String(empresaId)) {
    throw new Error('La empresa indicada no es la asignada a esta licitación');
  }

  const [empRows] = await pool.query(
    `SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
            fecha_escritura, notaria, numero_repertorio, fojas_numero_anio,
            representante_nombre, representante_rut, representante_cargo,
            email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email,
            banco_titular_nombre, banco_titular_rut, firma_url, timbre_url
       FROM empresas WHERE id = ? AND activo = TRUE LIMIT 1`,
    [empresaId],
  );
  const empresaCruda = (empRows as any[])[0] as EmpresaCampos | undefined;
  if (!empresaCruda) throw new Error('Empresa no encontrada');
  // Ciudad/comuna (extraídas de la dirección), región completa y fecha de hoy — ver
  // anexos-derivados.ts. Se agregan ACÁ, en el único puente que usan las dos rutas
  // (analizar/generar), para que ninguna pueda quedarse con el registro crudo por olvido.
  // Los datos de LA LICITACIÓN (código, organismo, monto, fechas — ver obtenerLicitacionParaAnexo)
  // se fusionan en el mismo punto, por la misma razón.
  //
  // FECHA (14-ago-2026, pedido explícito del usuario, instructivo interno "Presentacion_Creacion_
  // Anexos_FINAL_CON_EJEMPLOS.pdf" punto 7): "fecha_hoy" — la fecha con la que se firma y presenta
  // la oferta — se basa en la FECHA DE CIERRE vigente de la licitación, no en el reloj del momento
  // en que se genera el anexo. Antes usaba `new Date()` (la hora real del servidor): un anexo
  // preparado varios días antes del cierre quedaba fechado con el día de la preparación, no con el
  // día de cierre que pide la política de la empresa. Se obtiene la licitación PRIMERO (antes tenía
  // el orden invertido) para tener la fecha de cierre disponible al llamar a conCamposDerivados —
  // sin cierre disponible (MP lento/caído, o licitación sin fecha), se degrada al reloj real, igual
  // que siempre.
  const { campos: datosLicitacion, fechaCierre } = await obtenerLicitacionParaAnexo(codigo);
  const empresa = { ...conCamposDerivados(empresaCruda, fechaCierre ?? undefined), ...datosLicitacion };

  return { bufferOriginal, nombreOriginal, empresa };
}

// ── Datos de LA LICITACIÓN (código, organismo, monto, fechas…) para el motor de IA ───────────
// Pedido explícito del usuario (4-ago-2026): varios anexos piden "ID Licitación", "Nombre del
// organismo", "Dirección"/"Unidad compradora", "Presupuesto" — datos que YA conoce Mercado
// Público, no algo que haya que adivinar de las Bases ni pedirle a la empresa. Se resuelven acá
// 100% determinista (nunca por la IA — mismo criterio que fecha_hoy en anexos-derivados.ts) y se
// fusionan a la ficha en cargarDocumentoYEmpresa, arriba.
//
// Llamada LIVE a la API de Mercado Público (mismo patrón que obtenerContactosCliente en
// congelamiento.ts): best-effort, timeout corto, NUNCA lanza — si el organismo de MP está lento o
// caído, el Anexo Creator sigue funcionando igual que hoy, solo sin estos campos (quedan
// pendientes con su propio motivo, no rompen nada).
function formatearMontoCLP(monto: number | null | undefined): string | null {
  if (monto == null || !Number.isFinite(monto) || monto <= 0) return null;
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(monto);
}

function formatearFechaLicitacion(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return fechaLargaChile(fecha);
}

type CamposLicitacion = Pick<EmpresaCampos,
  | 'licitacion_codigo' | 'licitacion_nombre' | 'licitacion_organismo' | 'licitacion_organismo_rut'
  | 'licitacion_direccion' | 'licitacion_comuna' | 'licitacion_region' | 'licitacion_unidad_compradora'
  | 'licitacion_monto_estimado' | 'licitacion_moneda' | 'licitacion_fecha_publicacion' | 'licitacion_fecha_cierre'
>;

// `fechaCierre` viaja SUELTA (además de dentro de `campos`, ya formateada como texto largo) porque
// cargarDocumentoYEmpresa la necesita como Date real para conCamposDerivados — ver el comentario
// de ahí sobre por qué "fecha_hoy" pasó a basarse en el cierre de la licitación, no en el reloj.
async function obtenerLicitacionParaAnexo(codigo: string): Promise<{ campos: CamposLicitacion; fechaCierre: Date | null }> {
  try {
    const lic = await getMercadoPublicoClient().obtenerPorCodigoRapido(codigo, 8_000);
    if (!lic) return { campos: {}, fechaCierre: null };
    const fechaCierreCruda = lic.FechaCierre ? new Date(lic.FechaCierre) : null;
    const fechaCierre = fechaCierreCruda && !Number.isNaN(fechaCierreCruda.getTime()) ? fechaCierreCruda : null;
    return {
      campos: {
        licitacion_codigo: lic.Codigo || codigo,
        licitacion_nombre: lic.Nombre || null,
        licitacion_organismo: lic.Organismo || null,
        licitacion_organismo_rut: lic.RutOrganismo || null,
        licitacion_direccion: lic.DireccionUnidad || null,
        licitacion_comuna: lic.ComunaUnidad || null,
        licitacion_region: lic.Region || null,
        licitacion_unidad_compradora: lic.NombreUnidad || null,
        licitacion_monto_estimado: formatearMontoCLP(lic.MontoEstimado ?? lic.MontoTotal),
        licitacion_moneda: MONEDA_LABEL_MAP[lic.Moneda || 'CLP'] || lic.Moneda || null,
        licitacion_fecha_publicacion: formatearFechaLicitacion(lic.FechaPublicacion),
        licitacion_fecha_cierre: fechaCierre ? fechaLargaChile(fechaCierre) : null,
      },
      fechaCierre,
    };
  } catch (e) {
    console.error(`[anexos-datos] no se pudo obtener la licitación ${codigo} para el Anexo Creator:`, String(e).slice(0, 200));
    return { campos: {}, fechaCierre: null };
  }
}

// ── Puente con el Motor Comercial (Fase 4) — precios reales para el anexo económico ──────────
// Mismo patrón que ya usa /api/negocios/[id]/comercial/costeo: el detalle por ítem no se persiste
// aparte, se re-parsea del .xlsx vigente en R2 cada vez que se necesita (ver cabecera de
// motor-comercial.ts). Nunca lanza: sin negocio asignado, sin costeo subido, o si el archivo no
// se pudo leer, se degrada a "sin precios" — el Anexo Creator sigue funcionando igual que hoy,
// solo sin el auto-relleno de precios.
export async function obtenerItemsCosteoParaAnexo(codigo: string): Promise<ItemCosteoPrecio[]> {
  // 1) El camino "oficial": la planilla vigente del checklist comercial.
  try {
    const [rows] = await pool.query(
      `SELECT ccc.archivo_url
         FROM checklist_comercial_costeo ccc
         JOIN negocios n ON n.id = ccc.negocio_id
        WHERE n.licitacion_codigo = ? AND n.activo = TRUE AND ccc.vigente = 1
        LIMIT 1`,
      [codigo],
    ) as any;
    const url = (rows as any[])[0]?.archivo_url;
    if (url) {
      const items = await itemsDeUnCosteo(url);
      if (items.length) return items;
    }
  } catch (e) {
    console.error(`[anexos-datos] no se pudo leer el costeo del checklist de ${codigo}:`, String(e).slice(0, 200));
  }

  // 2) BUG REAL (539119-76-LP26, "los anexos donde hay que poner precio no los detecta"): el
  // ANEXO N°3 de oferta económica quedaba 0/10 aunque el costeo YA estaba hecho y cargado —
  // porque el usuario lo subió a mano a Documentos Propios y nunca pasó por el checklist
  // comercial, que es la única tabla que se miraba acá. La planilla estaba a un clic de
  // distancia, con los precios exactos de los 5 productos del anexo, y el Anexo Creator ni la
  // veía. Documentos Propios es donde el usuario deja la planilla en el flujo real, así que ese
  // es el segundo lugar donde hay que buscar, no un caso raro.
  //
  // No basta con mirar el nombre: se PARSEA cada candidato y se acepta el primero que rinda
  // ítems con precio (la planilla real siempre los tiene), así que un .xlsx propio que no sea un
  // costeo simplemente no aporta nada y se sigue de largo — mismo criterio degradable que el
  // resto de la función. Se ordenan poniendo primero los que se llaman "costeo" (el nombre que
  // genera el propio sistema, ver generar-costeo.ts) y, dentro de eso, el más reciente.
  try {
    const [rows] = await pool.query(
      `SELECT documento_nombre, documento_url_local
         FROM documentos_cache
        WHERE licitacion_codigo = ? AND categoria = 'DOCUMENTOS_PROPIOS'
          AND (documento_nombre LIKE '%.xlsx' OR documento_nombre LIKE '%.xlsm')
        ORDER BY (documento_nombre LIKE '%COSTEO%') DESC, id DESC
        LIMIT ?`,
      [codigo, MAX_COSTEOS_PROPIOS],
    ) as any;
    for (const doc of rows as any[]) {
      if (!doc.documento_url_local) continue;
      const items = await itemsDeUnCosteo(doc.documento_url_local);
      if (items.length) {
        console.log(`[anexos-datos] precios del anexo económico tomados de Documentos Propios: "${doc.documento_nombre}" (${items.length} ítems)`);
        return items;
      }
    }
  } catch (e) {
    console.error(`[anexos-datos] no se pudo leer el costeo de Documentos Propios de ${codigo}:`, String(e).slice(0, 200));
  }

  return [];
}

// Cuántas planillas propias se alcanzan a probar antes de rendirse. Parsear un .xlsx es barato
// comparado con el resto del análisis, pero esto corre en cada apertura de la pantalla: sin tope,
// una licitación con 20 planillas propias pagaría 20 descargas para nada.
const MAX_COSTEOS_PROPIOS = 4;

// Descarga y parsea UNA planilla. Nunca lanza: un archivo que no sea un costeo (o una URL caída)
// devuelve lista vacía y el que llama sigue probando el siguiente candidato.
async function itemsDeUnCosteo(url: string): Promise<ItemCosteoPrecio[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const buffer = Buffer.from(await res.arrayBuffer());
    const filas = await parsearCosteo(buffer);
    return itemsPrecioDeCosteo(filas);
  } catch (e) {
    console.error('[anexos-datos] planilla de costeo ilegible:', String(e).slice(0, 200));
    return [];
  }
}

// ── Texto de las bases — para el Paso 1 del motor de IA (alertas de inadmisibilidad) ─────────
// Best-effort y NUNCA lanza: usa el texto que YA esté cacheado (migración 22, mismo campo que
// llena el análisis de viabilidad al asignar la licitación) sin volver a pedir OCR — el Anexo
// Creator no es quien debe pagar ese costo/latencia; si el texto no está o quedó con huecos/
// basura, simplemente se omite el Paso 1 (el motor lo maneja sin bloquear el resto).
const LARGO_MAX_BASES = 14_000;

export async function obtenerTextoBasesParaAnexo(codigo: string): Promise<string> {
  try {
    const [rows] = await pool.query(
      `SELECT documento_nombre, categoria, texto_extraido
         FROM documentos_cache
        WHERE licitacion_codigo = ? AND categoria IN ('BASES_ADMINISTRATIVAS', 'BASES_TECNICAS')
        ORDER BY created_at ASC`,
      [codigo],
    ) as any;
    const docs = (rows as any[]).filter(d => {
      const txt = (d.texto_extraido || '').trim();
      return txt.length >= 50 && !ocrTieneHuecos(txt) && !esTextoBasuraOCR(txt);
    });
    if (!docs.length) return '';
    const texto = docs
      .map(d => `--- ${d.documento_nombre} ---\n${d.texto_extraido.trim()}`)
      .join('\n\n')
      .slice(0, LARGO_MAX_BASES);
    return texto;
  } catch (e) {
    console.error(`[anexos-datos] no se pudo leer el texto de bases de ${codigo}:`, String(e).slice(0, 200));
    return '';
  }
}

// ── Órdenes de compra reales — candidatos para la tabla "Experiencia del Oferente" ────────────
// (14-ago-2026, pedido explícito del usuario, ver ocsParaExperiencia en ordenes-compra.ts para el
// filtro de estado y el criterio completo). Se formatea como texto plano compacto — mismo
// tratamiento que obtenerTextoBasesParaAnexo de arriba: el motor de IA recibe texto, nunca la
// estructura completa, así resolverExperienciaDesdeOrdenesCompra (anexos-ia-motor.ts) queda
// desacoplado del esquema real de la tabla `ordenes_compra`. Best-effort y NUNCA lanza: sin OC
// reales que ofrecer, el Anexo Creator sigue igual, esas casillas simplemente siguen pendientes.
function formatearMontoOC(monto: number | null, moneda: string | null): string {
  if (monto == null) return 'monto no registrado';
  const fmt = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(monto);
  return `${moneda || 'CLP'} ${fmt}`;
}

export async function obtenerExperienciaOcParaAnexo(empresaId: number): Promise<string> {
  try {
    const ocs = await ocsParaExperiencia(empresaId);
    if (!ocs.length) return '';
    return ocs
      .map(oc => `N° OC ${oc.codigo} | Fecha: ${oc.fecha ? fechaLargaChile(new Date(oc.fecha)) : 'sin fecha'} | Cliente/mandante: ${oc.cliente || 'sin registrar'} | Objeto: ${oc.descripcion || 'sin descripción'} | Monto: ${formatearMontoOC(oc.monto, oc.moneda)}`)
      .join('\n');
  } catch (e) {
    console.error(`[anexos-datos] no se pudieron leer las OC de experiencia de la empresa ${empresaId}:`, String(e).slice(0, 200));
    return '';
  }
}
