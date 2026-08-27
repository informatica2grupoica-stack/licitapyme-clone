// app/api/anexos/rellenar-pdf/route.ts
// POST /api/anexos/rellenar-pdf { codigo, documentoId, empresaId }
// Rellena un anexo PDF ESCANEADO (sin capa de texto, publicado tal cual por el organismo) con los
// datos de la empresa — ver app/lib/anexos-pdf-rellenar.ts para el cómo y el porqué (en una
// licitación pública el documento que se sube tiene que ser el MISMO oficial, así que este motor
// escribe encima del PDF original en vez de reconstruirlo en Word).
//
// PRIMERA VERSIÓN EN PRODUCCIÓN (24-ago-2026): sin pantalla de revisión todavía — el resultado
// sube directo a "Documentos para MP" para que el asistente lo REVISE A MANO antes de subirlo al
// portal (la respuesta trae el detalle de qué se completó y qué quedó pendiente). Cobertura
// medida sobre un documento real: 7 de ~10 casillas: es un asistente, no un reemplazo del
// criterio humano — sobre todo tratándose de una licitación pública.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { cargarDocumentoPdfYEmpresa } from '@/app/lib/anexos-datos';
import { rellenarAnexoPdfEscaneado } from '@/app/lib/anexos-pdf-rellenar';
import { registrarActividad } from '@/app/lib/actividad';
import { yaCongelado } from '@/app/lib/congelamiento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONTENT_TYPE_PDF = 'application/pdf';

export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const codigo = body?.codigo;
  const documentoId = body?.documentoId;
  const empresaId = body?.empresaId;

  if (!codigo || !documentoId || !empresaId) {
    return NextResponse.json({ error: 'Faltan parámetros: codigo, documentoId, empresaId' }, { status: 400 });
  }
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  // Mismo criterio que /api/anexos/generar: admin-only mientras se decide quiénes más lo usan.
  if (!(await esAdmin(request))) {
    return NextResponse.json({ error: 'El relleno de anexos está disponible solo para administradores por ahora' }, { status: 403 });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE ORDER BY id DESC LIMIT 1`,
      [codigo],
    ) as any;
    const negocio = (rows as any[])[0];
    // Ya se validó esAdmin() arriba: mismo bypass que /api/anexos/generar.
    if (negocio && (await yaCongelado(negocio.id, 'admin'))) {
      return NextResponse.json(
        { error: 'Este negocio ya se postuló y su Auditor Técnico quedó congelado — ya no se pueden generar más anexos.' },
        { status: 409 },
      );
    }
  } catch {
    return NextResponse.json({ error: 'No se pudo verificar el estado del negocio, inténtalo de nuevo.' }, { status: 503 });
  }

  try {
    const { bufferOriginal, nombreOriginal, empresa } = await cargarDocumentoPdfYEmpresa(codigo, documentoId, empresaId);
    const resultado = await rellenarAnexoPdfEscaneado(bufferOriginal, empresa);

    if (resultado.completados === 0) {
      return NextResponse.json({
        error: 'No se pudo completar ningún campo automáticamente — revisa el documento a mano.',
        campos: resultado.campos,
      }, { status: 200 });
    }

    const nombreSalida = nombreOriginal.replace(/\.pdf$/i, '') + '_RELLENO.pdf';
    const url = await subirDocumentoR2(codigo, nombreSalida, resultado.bufferFinal, CONTENT_TYPE_PDF);
    await pool.query(
      `INSERT INTO documentos_cache
         (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, categoria_manual, usuario_id)
       VALUES (?, ?, ?, ?, ?, 'DOCUMENTOS_PROPIOS', 1, ?)
       ON DUPLICATE KEY UPDATE
         documento_url_local = VALUES(documento_url_local),
         size_bytes          = VALUES(size_bytes),
         updated_at          = CURRENT_TIMESTAMP`,
      [codigo, nombreSalida, url, resultado.bufferFinal.length, CONTENT_TYPE_PDF, usuario.id],
    );

    registrarActividad({
      usuarioId: usuario.id, accion: 'anexo_relleno',
      entidadTipo: 'licitacion', entidadId: codigo,
      descripcion: `Rellenó el anexo PDF "${nombreOriginal}" (${resultado.completados}/${resultado.totalDetectados} casillas detectadas) — revisar antes de presentar`,
      metadata: { licitacion_codigo: codigo, documento: nombreOriginal, completados: resultado.completados, total: resultado.totalDetectados },
    });

    return NextResponse.json({
      success: true, archivo: { nombre: nombreSalida, url },
      completados: resultado.completados, totalDetectados: resultado.totalDetectados,
      campos: resultado.campos,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 400 });
  }
}
