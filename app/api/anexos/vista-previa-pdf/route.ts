// app/api/anexos/vista-previa-pdf/route.ts
// POST /api/anexos/vista-previa-pdf { codigo, documentoId, empresaId, respuestas }
// Genera el anexo con el texto YA puesto (igual que /api/anexos/generar) pero SIN firma/timbre
// (respuestas nunca trae `firma:N` en este paso), lo convierte a PDF y lo devuelve tal cual —
// nunca se sube a R2, es solo para que el navegador lo muestre y el usuario arrastre la firma/
// timbre encima con posición real (ver anexos-pdf-firma.ts). El archivo FINAL sale de
// /api/anexos/generar-firmado, que repite este mismo trabajo y además quema las imágenes.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { cargarDocumentoYEmpresa, obtenerItemsCosteoParaAnexo, obtenerTextoBasesParaAnexo, obtenerExperienciaOcParaAnexo, obtenerDatosAuditorParaAnexo } from '@/app/lib/anexos-datos';
import { generarAnexoFinal } from '@/app/lib/anexos-rellenar';
import { abrirDocx, verificarXmlBienFormado } from '@/app/lib/anexos-docx';
import { convertirDocxAPdf } from '@/app/lib/anexos-doc-legacy';
import { yaCongelado } from '@/app/lib/congelamiento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const codigo = body?.codigo;
  const documentoId = body?.documentoId;
  const empresaId = body?.empresaId;
  // Nunca se leen claves `firma:N`/`firmaPos:N` de acá aunque el cliente las mande — esta vista
  // previa es justamente el paso ANTES de decidir dónde va la firma, no puede llevar ninguna.
  const respuestas: Record<string, string> = { ...(body?.respuestas || {}) };
  for (const k of Object.keys(respuestas)) if (k.startsWith('firma:') || k.startsWith('firmaPos:')) delete respuestas[k];

  if (!codigo || !documentoId || !empresaId) {
    return NextResponse.json({ error: 'Faltan parámetros: codigo, documentoId, empresaId' }, { status: 400 });
  }
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  if (!(await esAdmin(request))) {
    return NextResponse.json({ error: 'El creador de anexos está disponible solo para administradores por ahora' }, { status: 403 });
  }

  try {
    const [rows] = await pool.query(
      `SELECT id FROM negocios WHERE licitacion_codigo = ? AND activo = TRUE ORDER BY id DESC LIMIT 1`,
      [codigo],
    ) as any;
    const negocio = (rows as any[])[0];
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
    const [{ bufferOriginal, empresa }, itemsCosteo, basesTexto, datosAuditor, experienciaOcTexto] = await Promise.all([
      cargarDocumentoYEmpresa(codigo, documentoId, empresaId),
      obtenerItemsCosteoParaAnexo(codigo),
      obtenerTextoBasesParaAnexo(codigo),
      obtenerDatosAuditorParaAnexo(codigo),
      obtenerExperienciaOcParaAnexo(Number(empresaId)),
    ]);

    const resultado = await generarAnexoFinal(bufferOriginal, empresa, respuestas, itemsCosteo, basesTexto, datosAuditor, experienciaOcTexto);
    if (!resultado.integridad.parrafosIguales) {
      return NextResponse.json(
        { error: 'Verificación de integridad falló: el documento generado no calza con el original.' },
        { status: 500 },
      );
    }
    const chequeo = verificarXmlBienFormado((await abrirDocx(resultado.buffer)).xml);
    if (!chequeo.valido) {
      return NextResponse.json({ error: `El documento quedó mal formado (${chequeo.error}).` }, { status: 500 });
    }

    const pdfBuffer = await convertirDocxAPdf(resultado.buffer);
    return new NextResponse(new Uint8Array(pdfBuffer), { status: 200, headers: { 'Content-Type': 'application/pdf' } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 400 });
  }
}
