// app/lib/anexos-datos.ts
// Frente E.1 — puente entre las rutas de la app (DB + R2) y el módulo puro de relleno
// (anexos-rellenar.ts, que solo trabaja con buffers en memoria). Aísla las dos rutas
// (analizar/generar) de tener que duplicar la misma consulta y el mismo fetch.
import pool from '@/app/lib/db';
import type { EmpresaCampos } from '@/app/lib/anexos-ia-motor';
import { conCamposDerivados, fechaLargaChile, camposDelCodigoLicitacion } from '@/app/lib/anexos-derivados';
import { convertirDocADocx, convertirPdfADocx } from '@/app/lib/anexos-doc-legacy';
import { parsearCosteo, itemsPrecioDeCosteo, type ItemCosteoPrecio } from '@/app/lib/motor-comercial';
import { ocrTieneHuecos, esTextoBasuraOCR } from '@/app/lib/zai-ocr';
import { getMercadoPublicoClient } from '@/app/lib/mercado-publico';
import { MONEDA_LABEL_MAP } from '@/app/types/mercado-publico.types';
import { ocsParaExperiencia } from '@/app/lib/ordenes-compra';
import type { DatosAuditorAnexo, LineaTecnicaAuditor, ItemComercialAuditor } from '@/app/lib/anexos-auditor-fuente';

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

// Variante de cargarDocumentoBase SOLO para /api/anexos/separar (14-ago-2026, pedido explícito
// del usuario: "sacar los anexos de un PDF y dejarlos en Word, sin tocar el PDF"). También acepta
// .pdf, convertido a .docx con el mismo conversor LibreOffice que ya usan los .doc legados — la
// única diferencia real es el Content-Type que le indica al conversor qué extensión escribir (ver
// convertirPdfADocx). NO se usa para rellenar (cargarDocumentoYEmpresa/cargarDocumentoBase de
// arriba siguen solo con .doc/.docx): un PDF convertido es una aproximación de LibreOffice de la
// estructura del documento, no una plantilla Word real con sus casillas — separarlo en fragmentos
// es razonablemente seguro, pero mandarlo al motor de auto-relleno arriesgaría escribir sobre una
// estructura que no es la que el organismo publicó de verdad.
export type DocumentoParaSeparar =
  | ({ tipo: 'docx' } & DocumentoBase)
  // PDF ESCANEADO: se devuelve el archivo TAL CUAL, sin pasar por LibreOffice. Sus anexos se
  // separan por geometría y OCR (anexos-pdf-secciones.ts + anexos-pdf-dividir.ts), recortando el
  // PDF original en vez de reconstruirlo en Word — que es además lo correcto para presentar en el
  // portal: el archivo que se sube sigue siendo el que publicó el organismo.
  | ({ tipo: 'pdf_escaneado' } & DocumentoBase);

export async function cargarDocumentoParaSeparar(codigo: string, documentoId: string): Promise<DocumentoParaSeparar> {
  const [docRows] = await pool.query(
    `SELECT documento_nombre, documento_url_local, metodo_extraccion
       FROM documentos_cache WHERE id = ? AND licitacion_codigo = ? LIMIT 1`,
    [documentoId, codigo],
  );
  const doc = (docRows as any[])[0];
  if (!doc) throw new Error('Documento no encontrado en esta licitación');

  const nombre: string = doc.documento_nombre || '';
  const esDocx = /\.docx$/i.test(nombre);
  const esDocLegado = !esDocx && /\.doc$/i.test(nombre);
  const esPdf = !esDocx && !esDocLegado && /\.pdf$/i.test(nombre);
  if (!esDocx && !esDocLegado && !esPdf) {
    throw new Error('Solo se soportan documentos Word (.doc/.docx) o PDF, este no lo es');
  }

  const resDoc = await fetch(doc.documento_url_local);
  if (!resDoc.ok) throw new Error(`No se pudo bajar el documento original (HTTP ${resDoc.status})`);
  const bufferDescargado = Buffer.from(await resDoc.arrayBuffer());

  if (esDocLegado) {
    return { tipo: 'docx', bufferOriginal: await convertirDocADocx(bufferDescargado), nombreOriginal: nombre.replace(/\.doc$/i, '.docx') };
  }
  if (esPdf) {
    // ¿Este PDF tiene texto real o es un escaneo? `metodo_extraccion` lo sabe (lo cachea el
    // análisis de lectura previo) y 'pdf-text' es el ÚNICO método que confirma texto real. Antes,
    // cualquier otra respuesta era un error duro: LibreOffice no hace OCR y habría convertido la
    // imagen a un .docx vacío, así que avisar era mejor que separar "con éxito" pura basura.
    //
    // Ya no hace falta rendirse (25-ago-2026, caso 545774-35-LE26 de San Miguel, que publica sus
    // 7 formatos pegados al final del decreto escaneado): un PDF sin texto se separa por su
    // GEOMETRÍA, recortando el original. Se sigue prefiriendo la vía Word cuando hay texto real,
    // porque un .docx editable es más cómodo de completar que un PDF; el recorte es para cuando
    // esa vía no existe.
    //
    // Sin dato cacheado (documento nunca analizado) se toma el camino del escaneo: es el que
    // funciona en los dos casos — sobre un PDF de texto la geometría igual encuentra las tablas —
    // mientras que mandarlo a LibreOffice sin saber arriesga el .docx vacío de siempre.
    if (doc.metodo_extraccion === 'pdf-text') {
      return { tipo: 'docx', bufferOriginal: await convertirPdfADocx(bufferDescargado), nombreOriginal: nombre.replace(/\.pdf$/i, '.docx') };
    }
    return { tipo: 'pdf_escaneado', bufferOriginal: bufferDescargado, nombreOriginal: nombre };
  }
  return { tipo: 'docx', bufferOriginal: bufferDescargado, nombreOriginal: nombre };
}

// `empresaId` viaja como parámetro del cliente (query string en /analizar, body en /generar) sin
// ningún cruce contra la licitación — auditoría 12-ago-2026: a diferencia de `documentoId` (que
// SÍ está scopeado arriba con `AND licitacion_codigo = ?`), nada impedía pedir el anexo de ESTA
// licitación con los datos de CUALQUIER otra empresa activa del sistema. Las dos rutas son
// admin-only, así que no es una fuga entre tenants (un admin ya puede ver cualquier empresa),
// pero sí un guardarraíl de negocio real: sin esto, un `empresaId` viejo/equivocado en el cliente
// genera en silencio un anexo legal con la razón social/RUT de OTRA empresa. Mismo criterio de
// "activo, el más reciente" que ya usa el guardarraíl de congelamiento en /api/anexos/generar.
//
// Extraído a su propio helper (antes vivía inline en cargarDocumentoYEmpresa) para que el relleno
// de PDF escaneado (cargarDocumentoPdfYEmpresa, anexos-pdf-rellenar.ts) lo reuse tal cual: la
// ficha de empresa enriquecida (ciudad/comuna, fecha_hoy, datos de la licitación) es la MISMA sea
// cual sea el formato del documento que se está rellenando.
export async function cargarEmpresaEnriquecida(codigo: string, empresaId: string): Promise<EmpresaCampos> {
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
            representante_nombre, representante_rut, representante_cargo, representante_profesion,
            email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email,
            banco_titular_nombre, banco_titular_rut, firma_url, timbre_url
       FROM empresas WHERE id = ? AND activo = TRUE LIMIT 1`,
    [empresaId],
  );
  const empresaCruda = (empRows as any[])[0] as EmpresaCampos | undefined;
  if (!empresaCruda) throw new Error('Empresa no encontrada');
  // Ciudad/comuna (extraídas de la dirección), región completa y fecha de hoy — ver
  // anexos-derivados.ts. Se agregan ACÁ, en el único puente que usan las rutas de relleno
  // (analizar/generar/PDF), para que ninguna pueda quedarse con el registro crudo por olvido.
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
  const fusionada = { ...conCamposDerivados(empresaCruda, fechaCierre ?? undefined), ...datosLicitacion };
  // Los tramos del código ("2495-17-B226" → "2495"/"17"/"B226") se derivan DESPUÉS del merge, no
  // dentro de conCamposDerivados: acá arriba la ficha cruda todavía no tiene `licitacion_codigo`
  // (llega en `datosLicitacion`, desde la API de MP), así que calcularlos antes daba siempre null.
  return { ...fusionada, ...camposDelCodigoLicitacion(fusionada.licitacion_codigo) };
}

/**
 * La ficha de la empresa asignada a esta licitación, SIN los datos de la licitación (que salen de
 * la API de Mercado Público y cuestan una llamada de red). La usa el feedback loop
 * (/api/anexos/feedback) para deducir QUÉ campo corrigió el experto — ver
 * `campoDeLaFichaConEsteValor` en anexos-feedback.ts. null si la licitación no tiene negocio
 * activo con empresa: ahí simplemente no se aprende un override, la corrección se guarda igual.
 */
export async function cargarFichaEmpresaDeLicitacion(codigo: string): Promise<EmpresaCampos | null> {
  const [negocioRows] = await pool.query(
    `SELECT empresa_id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE ORDER BY id DESC LIMIT 1`,
    [codigo],
  );
  const empresaId = (negocioRows as any[])[0]?.empresa_id;
  if (empresaId == null) return null;

  const [empRows] = await pool.query(
    `SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
            fecha_escritura, notaria, numero_repertorio, fojas_numero_anio,
            representante_nombre, representante_rut, representante_cargo, representante_profesion,
            email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email,
            banco_titular_nombre, banco_titular_rut, firma_url, timbre_url
       FROM empresas WHERE id = ? AND activo = TRUE LIMIT 1`,
    [empresaId],
  );
  const empresaCruda = (empRows as any[])[0] as EmpresaCampos | undefined;
  return empresaCruda ? conCamposDerivados(empresaCruda) : null;
}

export async function cargarDocumentoYEmpresa(
  codigo: string,
  documentoId: string,
  empresaId: string,
): Promise<DocumentoYEmpresa> {
  const { bufferOriginal, nombreOriginal } = await cargarDocumentoBase(codigo, documentoId);
  const empresa = await cargarEmpresaEnriquecida(codigo, empresaId);
  return { bufferOriginal, nombreOriginal, empresa };
}

// Carga el PDF crudo (sin conversión, sin OCR) de la licitación — para el relleno de PDF
// ESCANEADO (anexos-pdf-rellenar.ts), que escribe directo sobre el documento original y por eso
// nunca pasa por LibreOffice (a diferencia de cargarDocumentoBaseParaSeparar). Rechaza cualquier
// archivo que no sea .pdf: para .doc/.docx ya existe el camino de siempre (cargarDocumentoYEmpresa).
export async function cargarDocumentoPdfYEmpresa(
  codigo: string,
  documentoId: string,
  empresaId: string,
): Promise<DocumentoYEmpresa> {
  const [docRows] = await pool.query(
    `SELECT documento_nombre, documento_url_local
       FROM documentos_cache WHERE id = ? AND licitacion_codigo = ? LIMIT 1`,
    [documentoId, codigo],
  );
  const doc = (docRows as any[])[0];
  if (!doc) throw new Error('Documento no encontrado en esta licitación');
  const nombreOriginal: string = doc.documento_nombre || '';
  if (!/\.pdf$/i.test(nombreOriginal)) throw new Error('Solo se soporta PDF en este camino, este documento no lo es');

  const resDoc = await fetch(doc.documento_url_local);
  if (!resDoc.ok) throw new Error(`No se pudo bajar el documento original (HTTP ${resDoc.status})`);
  const bufferOriginal = Buffer.from(await resDoc.arrayBuffer());

  const empresa = await cargarEmpresaEnriquecida(codigo, empresaId);
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

// ── AUDITOR: ficha técnica/comercial ya aprobada, fuente para los anexos técnico y económico ────
// (21-ago-2026, pedido explícito del usuario). SOLO trae ítems con estado = 'APROBADO' — es
// exactamente el mismo candado que ya usa decidirGeneracion() en auditor-generacion.ts para
// habilitar el botón "Generar anexo", pero acá filtra a nivel de FILA (no de bloque completo):
// si un asesor observó un ítem puntual y el resto del bloque sigue aprobado, ese ítem puntual
// simplemente no aparece como fuente — el resolutor (anexos-auditor-fuente.ts) no se entera de
// que existió, así que no hay forma de que se cuele en el anexo.
export async function obtenerDatosAuditorParaAnexo(codigo: string): Promise<DatosAuditorAnexo> {
  const vacio: DatosAuditorAnexo = { lineasTecnicas: [], itemsComerciales: [] };
  try {
    const [negRows] = await pool.query(
      `SELECT id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE ORDER BY id DESC LIMIT 1`,
      [codigo],
    ) as any;
    const negocioId = (negRows as any[])[0]?.id;
    if (!negocioId) return vacio;

    const [itemRows] = await pool.query(
      `SELECT id, bloque, tipo, titulo, linea_numero, descripcion, valor_texto, valor_numero
         FROM checklist_comercial
        WHERE negocio_id = ? AND bloque IN ('TECNICO', 'COMERCIAL') AND estado = 'APROBADO'`,
      [negocioId],
    ) as any;
    const items = itemRows as any[];
    if (!items.length) return vacio;

    const lineasTecnicasPorId = new Map<number, LineaTecnicaAuditor>();
    const itemsComerciales: ItemComercialAuditor[] = [];
    for (const it of items) {
      if (it.bloque === 'TECNICO' && it.tipo === 'linea_tecnica') {
        lineasTecnicasPorId.set(it.id, {
          lineaNumero: it.linea_numero, titulo: it.titulo, caracteristicas: [],
        });
      } else if (it.bloque === 'COMERCIAL') {
        itemsComerciales.push({
          lineaNumero: it.linea_numero, titulo: it.titulo, tipo: it.tipo,
          descripcion: it.descripcion, valorTexto: it.valor_texto, valorNumero: it.valor_numero,
        });
      }
    }
    if (!lineasTecnicasPorId.size) return { lineasTecnicas: [], itemsComerciales };

    const [caractRows] = await pool.query(
      `SELECT item_id, descripcion, valor_ofertado_texto, valor_ofertado_numero, unidad_requerida,
              veredicto, pendiente_confirmacion_proveedor
         FROM checklist_comercial_caracteristicas
        WHERE item_id IN (?)`,
      [Array.from(lineasTecnicasPorId.keys())],
    ) as any;
    for (const c of caractRows as any[]) {
      const linea = lineasTecnicasPorId.get(c.item_id);
      if (!linea) continue;
      linea.caracteristicas.push({
        descripcion: c.descripcion,
        valorOfertadoTexto: c.valor_ofertado_texto,
        valorOfertadoNumero: c.valor_ofertado_numero != null ? Number(c.valor_ofertado_numero) : null,
        unidadRequerida: c.unidad_requerida,
        veredicto: c.veredicto,
        pendienteConfirmacionProveedor: !!c.pendiente_confirmacion_proveedor,
      });
    }

    return { lineasTecnicas: Array.from(lineasTecnicasPorId.values()), itemsComerciales };
  } catch (e) {
    console.error(`[anexos-datos] no se pudieron leer los datos del Auditor de ${codigo}:`, String(e).slice(0, 200));
    return vacio;
  }
}
