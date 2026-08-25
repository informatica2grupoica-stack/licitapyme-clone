// app/api/anexos/separar/route.ts
// POST /api/anexos/separar { codigo, documentoId }
// Paso INDEPENDIENTE del relleno: toma un .docx/.doc/.pdf TAL COMO se bajó de Mercado Público
// (nunca lo modifica) y, si trae varios anexos pegados en un solo archivo (patrón "FORMULARIO
// N°X" / "ANEXO N°X" — ver anexos-dividir.ts), sube un archivo .docx nuevo por cada uno, nombrado
// por su título real. Cada archivo queda en su caja de "Documentos y Bases" según su categoría
// (ANEXOS_ADMINISTRATIVOS/TECNICOS/ECONOMICOS — ver CATEGORIA_POR_CLASIFICACION abajo), NUNCA en
// Documentos Propios (pedido explícito del usuario 13-ago-2026: separar es organizar la
// licitación, no generar un archivo nuestro aparte).
// Sirve para ORGANIZAR anexos antes de rellenar nada — a diferencia de /api/anexos/generar, que
// también divide pero solo como resultado de rellenar el documento combinado completo (ese SÍ
// sube a Documentos Propios: ahí el resultado es el anexo YA LISTO para presentar).
//
// PDF (14-ago-2026, pedido explícito del usuario: "sacar los anexos de un PDF y dejarlos en Word,
// sin tocar el PDF"): cargarDocumentoParaSeparar (a diferencia de cargarDocumentoBase, que usan
// /analizar y /generar) también acepta .pdf — si TIENE TEXTO REAL lo convierte a .docx con
// LibreOffice (conversor-doc/) antes de dividir. El PDF original NUNCA se toca ni se sube de nuevo
// — solo se generan los fragmentos, igual que con cualquier .docx que ya traía varios anexos.
//
// PDF ESCANEADO (25-ago-2026, caso real 545774-35-LE26 de la Municipalidad de San Miguel): antes
// se rechazaba con un mensaje claro, porque LibreOffice no hace OCR y habría convertido la imagen
// a un .docx vacío. Pero ese caso NO es raro: hay organismos que publican sus formatos pegados al
// final del mismo decreto escaneado que aprueba las bases, y ahí no existe ningún archivo Word que
// bajar. Ahora esos se separan por su GEOMETRÍA (anexos-pdf-secciones.ts localiza cada
// "FORMATO N°X" y anexos-pdf-dividir.ts recorta el PDF original), y el resultado son PDF, no
// .docx: en una licitación pública lo que se sube al portal tiene que ser el documento oficial del
// organismo, así que recortarlo es correcto y reconstruirlo en Word no lo sería.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { cargarDocumentoParaSeparar } from '@/app/lib/anexos-datos';
import { abrirDocx, verificarXmlBienFormado, normalizarParaIds } from '@/app/lib/anexos-docx';
import { dividirPorFormularios, clasificarAnexo } from '@/app/lib/anexos-dividir';
import { detectarSeccionesPdfEscaneado } from '@/app/lib/anexos-pdf-secciones';
import { dividirPdfEnFormatos } from '@/app/lib/anexos-pdf-dividir';
import { registrarActividad } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 240s (antes 120s): un PDF de texto puede tardar hasta 90s en convertirse a .docx con LibreOffice
// (ver convertirPdfADocx), y uno ESCANEADO necesita OCR para ubicar sus formatos — medido sobre el
// decreto de 36 páginas de 545774-35-LE26: 70s. (Eran 210s leyendo las 36 páginas completas; el
// prefiltro por píxeles de anexos-pdf-secciones.ts descarta las 22 que no pueden contener el
// título de un formato, y solo se pasan por OCR las 14 restantes.)
export const maxDuration = 240;

const CONTENT_TYPE_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CONTENT_TYPE_PDF = 'application/pdf';

// Categoría de "Documentos y Bases" (NUNCA Documentos Propios — pedido explícito del usuario
// 13-ago-2026, así queda visible junto al resto de la licitación, no escondido en la sección de
// lo que nosotros subimos). "sin_clasificar" cae en ANEXOS_OFERENTE, la caja catch-all que ya
// existía para anexos sin separar — no amerita una 4ª caja nueva solo para lo no reconocido.
const CATEGORIA_POR_CLASIFICACION: Record<string, string> = {
  administrativo: 'ANEXOS_ADMINISTRATIVOS',
  tecnico: 'ANEXOS_TECNICOS',
  economico: 'ANEXOS_ECONOMICOS',
  sin_clasificar: 'ANEXOS_OFERENTE',
};

export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const codigo = body?.codigo;
  const documentoId = body?.documentoId;

  if (!codigo || !documentoId) {
    return NextResponse.json({ error: 'Faltan parámetros: codigo, documentoId' }, { status: 400 });
  }
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  // Mismo criterio que /api/anexos/generar (admin-only, pedido explícito jul-2026, ver ese
  // archivo) — separar anexos es parte del mismo flujo, todavía no abierto a otros roles.
  if (!(await esAdmin(request))) {
    return NextResponse.json({ error: 'Separar anexos está disponible solo para administradores por ahora' }, { status: 403 });
  }

  try {
    const documento = await cargarDocumentoParaSeparar(codigo, documentoId);
    const { bufferOriginal, nombreOriginal } = documento;

    if (documento.tipo === 'pdf_escaneado') {
      return await separarPdfEscaneado(codigo, usuario.id, bufferOriginal, nombreOriginal);
    }

    const { xml: xmlCrudo } = await abrirDocx(bufferOriginal);
    // BUG REAL (13-ago-2026, caso 1211839-58-LE26): un .docx convertido por el conversor de
    // producción (LibreOffice) puede no traer w14:paraId en sus párrafos (mismo caso ya conocido
    // en anexos-docx.ts — ver su comentario arriba, "1 de 4 documentos probados no lo traía").
    // listarBloquesCrudos (anexos-dividir.ts) SOLO reconoce un párrafo como bloque si trae ese
    // atributo — sin él, todo el contenido (títulos de FORMULARIO incluidos) cae como texto de
    // relleno pegado al bloque anterior y detectarFormularios ve 0, sin importar qué tan limpios
    // estén los encabezados. Las otras rutas que dividen (anexos-rellenar → /api/anexos/generar)
    // no tenían este problema porque el relleno ya normaliza los IDs antes de llegar acá — este
    // paso es INDEPENDIENTE del relleno (ver comentario de arriba) y nunca pasaba por ahí.
    const { xml } = normalizarParaIds(xmlCrudo);
    const formularios = await dividirPorFormularios(bufferOriginal, xml);

    if (formularios.length < 2) {
      // DIAGNÓSTICO (13-ago-2026, caso real 1211839-58-LE26): un .doc convertido por el
      // conversor de producción (LibreOffice) puede estructurar el XML distinto a como lo hace
      // Word para el MISMO documento origen — el mismo archivo separó perfecto (6 formularios)
      // al convertirlo con Word, pero el detector encontró <2 acá. Sin este log, un caso así
      // queda como "no hay nada que separar" indistinguible de un documento que de verdad no
      // trae nada pegado — no hay forma de diagnosticarlo sin reproducirlo a mano.
      const textoPlano = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:(?:br|cr)\b[^>]*\/?>/g)]
        .map(m => (m[1] !== undefined ? m[1] : '\n')).join('');
      const candidatos = [...textoPlano.matchAll(/(?:formulario|anexo)[^\n]{0,60}/gi)].slice(0, 15).map(m => m[0].trim());
      console.log(`[anexos-separar] ${codigo}: "${nombreOriginal}" — solo ${formularios.length} formulario(s) detectado(s), no se divide. Menciones de "formulario/anexo" en el texto (${candidatos.length}):`, candidatos);
      return NextResponse.json({
        success: true,
        separado: false,
        archivos: [],
        mensaje: `"${nombreOriginal}" no trae más de un anexo pegado — no hay nada que separar.`,
      });
    }

    // Igual que /api/anexos/generar: valida TODOS los fragmentos antes de subir el primero, para
    // no dejar una subida a medias si uno sale mal formado y otro no.
    for (const f of formularios) {
      const { xml: fxml } = await abrirDocx(f.buffer);
      const chequeo = verificarXmlBienFormado(fxml);
      if (!chequeo.valido) {
        return NextResponse.json(
          { error: `El fragmento "${f.titulo}" quedó mal formado (${chequeo.error}). No se subió nada.` },
          { status: 500 },
        );
      }
    }

    const archivos: { nombre: string; categoria: string; titulo: string; url: string }[] = [];
    for (const f of formularios) {
      const nombre = `${f.nombreArchivo}.docx`;
      const categoriaCaja = CATEGORIA_POR_CLASIFICACION[f.categoria] || 'ANEXOS_OFERENTE';
      const url = await subirDocumentoR2(codigo, nombre, f.buffer, CONTENT_TYPE_DOCX);
      // BUG REAL (13-ago-2026, caso 1211839-58-LE26): categoria NO estaba en el UPDATE — un
      // reintento sobre un nombre que ya existía (ej. de un intento anterior fallido a medias)
      // dejaba la categoría VIEJA pegada para siempre, aunque este mismo cálculo determinista
      // (clasificarAnexo) ahora diera una distinta. El archivo quedaba subido y su fila existía,
      // pero en la caja equivocada — visualmente indistinguible de "no se separó" para quien
      // solo mira una caja a la vez (reportado como "separó 5 de 6": el 6º estaba ahí, pero en
      // Anexos Oferente en vez de Económicos).
      await pool.query(
        `INSERT INTO documentos_cache
           (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, categoria_manual, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE
           documento_url_local = VALUES(documento_url_local),
           size_bytes          = VALUES(size_bytes),
           categoria           = VALUES(categoria),
           updated_at          = CURRENT_TIMESTAMP`,
        [codigo, nombre, url, f.buffer.length, CONTENT_TYPE_DOCX, categoriaCaja, usuario.id],
      );
      archivos.push({ nombre, categoria: f.categoria, titulo: f.titulo, url });
    }

    registrarActividad({
      usuarioId: usuario.id, accion: 'anexo_separado',
      entidadTipo: 'licitacion', entidadId: codigo,
      descripcion: `Separó "${nombreOriginal}" en ${archivos.length} anexos independientes`,
      metadata: {
        licitacion_codigo: codigo, documento: nombreOriginal,
        archivos: archivos.map(a => ({ nombre: a.nombre, categoria: a.categoria })),
      },
    });

    return NextResponse.json({ success: true, separado: true, archivos });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 400 });
  }
}

/**
 * Camino del PDF ESCANEADO: se localizan los formatos por geometría + OCR y se RECORTA el PDF
 * original en uno por formato (ver la cabecera de este archivo para el porqué de recortar en vez
 * de reconstruir en Word).
 *
 * Se mantiene idéntico al camino .docx en todo lo que le importa al resto del sistema: cada
 * fragmento cae en su caja de "Documentos y Bases" según `clasificarAnexo` —el MISMO clasificador,
 * no una copia— y nunca en Documentos Propios; y si no hay más de un formato, no se sube nada.
 */
async function separarPdfEscaneado(
  codigo: string, usuarioId: number, bufferOriginal: Buffer, nombreOriginal: string,
) {
  const secciones = await detectarSeccionesPdfEscaneado(bufferOriginal);
  if (secciones.length < 2) {
    console.log(`[anexos-separar] ${codigo}: "${nombreOriginal}" (PDF escaneado) — ${secciones.length} formato(s) detectado(s), no se divide.`);
    return NextResponse.json({
      success: true,
      separado: false,
      archivos: [],
      mensaje: `"${nombreOriginal}" es un PDF escaneado y no se encontraron formatos numerados ("FORMATO N°1", "ANEXO N°2"…) adentro — no hay nada que separar.`,
    });
  }

  const partes = await dividirPdfEnFormatos(bufferOriginal, secciones);
  const archivos: { nombre: string; categoria: string; titulo: string; url: string }[] = [];

  for (const parte of partes) {
    const categoria = clasificarAnexo(parte.seccion.titulo, parte.seccion.texto);
    const categoriaCaja = CATEGORIA_POR_CLASIFICACION[categoria] || 'ANEXOS_OFERENTE';
    const url = await subirDocumentoR2(codigo, parte.nombreArchivo, parte.buffer, CONTENT_TYPE_PDF);
    await pool.query(
      `INSERT INTO documentos_cache
         (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, categoria_manual, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)
       ON DUPLICATE KEY UPDATE
         documento_url_local = VALUES(documento_url_local),
         size_bytes          = VALUES(size_bytes),
         categoria           = VALUES(categoria),
         updated_at          = CURRENT_TIMESTAMP`,
      [codigo, parte.nombreArchivo, url, parte.buffer.length, CONTENT_TYPE_PDF, categoriaCaja, usuarioId],
    );
    archivos.push({ nombre: parte.nombreArchivo, categoria, titulo: parte.seccion.titulo, url });
  }

  registrarActividad({
    usuarioId, accion: 'anexo_separado',
    entidadTipo: 'licitacion', entidadId: codigo,
    descripcion: `Separó el PDF escaneado "${nombreOriginal}" en ${archivos.length} formatos independientes (recorte del original)`,
    metadata: {
      licitacion_codigo: codigo, documento: nombreOriginal, escaneado: true,
      archivos: archivos.map(a => ({ nombre: a.nombre, categoria: a.categoria })),
    },
  });

  return NextResponse.json({ success: true, separado: true, archivos });
}
