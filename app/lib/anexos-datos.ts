// app/lib/anexos-datos.ts
// Frente E.1 — puente entre las rutas de la app (DB + R2) y el módulo puro de relleno
// (anexos-rellenar.ts, que solo trabaja con buffers en memoria). Aísla las dos rutas
// (analizar/generar) de tener que duplicar la misma consulta y el mismo fetch.
import pool from '@/app/lib/db';
import type { EmpresaCampos } from '@/app/lib/anexos-ia-motor';
import { conCamposDerivados } from '@/app/lib/anexos-derivados';
import { convertirDocADocx } from '@/app/lib/anexos-doc-legacy';
import { parsearCosteo, itemsPrecioDeCosteo, type ItemCosteoPrecio } from '@/app/lib/motor-comercial';
import { ocrTieneHuecos, esTextoBasuraOCR } from '@/app/lib/zai-ocr';

export interface DocumentoYEmpresa {
  bufferOriginal: Buffer;
  nombreOriginal: string;
  empresa: EmpresaCampos;
}

export async function cargarDocumentoYEmpresa(
  codigo: string,
  documentoId: string,
  empresaId: string,
): Promise<DocumentoYEmpresa> {
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
    throw new Error('Solo se soportan anexos Word (.doc o .docx), este no lo es');
  }

  const [empRows] = await pool.query(
    `SELECT razon_social, rut, direccion, region, giro, tipo_persona_juridica, fecha_sociedad,
            fecha_escritura, notaria, numero_repertorio, fojas_numero_anio,
            representante_nombre, representante_rut, representante_cargo,
            email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email, firma_url
       FROM empresas WHERE id = ? AND activo = TRUE LIMIT 1`,
    [empresaId],
  );
  const empresaCruda = (empRows as any[])[0] as EmpresaCampos | undefined;
  if (!empresaCruda) throw new Error('Empresa no encontrada');
  // Ciudad/comuna (extraídas de la dirección), región completa y fecha de hoy — ver
  // anexos-derivados.ts. Se agregan ACÁ, en el único puente que usan las dos rutas
  // (analizar/generar), para que ninguna pueda quedarse con el registro crudo por olvido.
  const empresa = conCamposDerivados(empresaCruda);

  const resDoc = await fetch(doc.documento_url_local);
  if (!resDoc.ok) throw new Error(`No se pudo bajar el anexo original (HTTP ${resDoc.status})`);
  const bufferDescargado = Buffer.from(await resDoc.arrayBuffer());

  // .doc legado (Word 97-2003, binario OLE) no se puede editar directo — se convierte a .docx
  // en el conversor del VPS (LibreOffice headless) antes de analizar/rellenar.
  const bufferOriginal = esDocLegado ? await convertirDocADocx(bufferDescargado) : bufferDescargado;
  const nombreOriginal = esDocLegado ? nombre.replace(/\.doc$/i, '.docx') : nombre;

  return { bufferOriginal, nombreOriginal, empresa };
}

// ── Puente con el Motor Comercial (Fase 4) — precios reales para el anexo económico ──────────
// Mismo patrón que ya usa /api/negocios/[id]/comercial/costeo: el detalle por ítem no se persiste
// aparte, se re-parsea del .xlsx vigente en R2 cada vez que se necesita (ver cabecera de
// motor-comercial.ts). Nunca lanza: sin negocio asignado, sin costeo subido, o si el archivo no
// se pudo leer, se degrada a "sin precios" — el Anexo Creator sigue funcionando igual que hoy,
// solo sin el auto-relleno de precios.
export async function obtenerItemsCosteoParaAnexo(codigo: string): Promise<ItemCosteoPrecio[]> {
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
    if (!url) return [];

    const res = await fetch(url);
    if (!res.ok) return [];
    const buffer = Buffer.from(await res.arrayBuffer());
    const filas = await parsearCosteo(buffer);
    return itemsPrecioDeCosteo(filas);
  } catch (e) {
    console.error(`[anexos-datos] no se pudo leer el costeo de ${codigo} para el Anexo Creator:`, String(e).slice(0, 200));
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
