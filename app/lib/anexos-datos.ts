// app/lib/anexos-datos.ts
// Frente E.1 — puente entre las rutas de la app (DB + R2) y el módulo puro de relleno
// (anexos-rellenar.ts, que solo trabaja con buffers en memoria). Aísla las dos rutas
// (analizar/generar) de tener que duplicar la misma consulta y el mismo fetch.
import pool from '@/app/lib/db';
import type { EmpresaCampos } from '@/app/lib/anexos-diccionario';
import { convertirDocADocx } from '@/app/lib/anexos-doc-legacy';

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
            representante_nombre, representante_rut, representante_cargo,
            email1, telefono1, banco_tipo_cuenta, banco_numero, banco_nombre, banco_email
       FROM empresas WHERE id = ? AND activo = TRUE LIMIT 1`,
    [empresaId],
  );
  const empresa = (empRows as any[])[0] as EmpresaCampos | undefined;
  if (!empresa) throw new Error('Empresa no encontrada');

  const resDoc = await fetch(doc.documento_url_local);
  if (!resDoc.ok) throw new Error(`No se pudo bajar el anexo original (HTTP ${resDoc.status})`);
  const bufferDescargado = Buffer.from(await resDoc.arrayBuffer());

  // .doc legado (Word 97-2003, binario OLE) no se puede editar directo — se convierte a .docx
  // en el conversor del VPS (LibreOffice headless) antes de analizar/rellenar.
  const bufferOriginal = esDocLegado ? await convertirDocADocx(bufferDescargado) : bufferDescargado;
  const nombreOriginal = esDocLegado ? nombre.replace(/\.doc$/i, '.docx') : nombre;

  return { bufferOriginal, nombreOriginal, empresa };
}
