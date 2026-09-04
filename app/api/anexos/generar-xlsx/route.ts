// app/api/anexos/generar-xlsx/route.ts
// POST /api/anexos/generar-xlsx { codigo, documentoId, excluirFilas? }
// Genera el .xlsx final del anexo económico con el precio unitario relleno. Hermano de
// /api/anexos/generar (para .docx) — motor separado (anexos-excel-precios.ts). Los precios se
// recalculan siempre en el servidor (nunca se confía en un monto que mande el cliente); la única
// entrada del usuario es "excluirFilas", para destildar una fila que no quiere autocompletar.
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import pool from '@/app/lib/db';
import { getAuthedUser, puedeVerLicitacion, esAdmin } from '@/app/lib/api-auth';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { cargarDocumentoXlsx, obtenerItemsCosteoParaAnexo, obtenerDatosAuditorParaAnexo } from '@/app/lib/anexos-datos';
import {
  detectarTablaPrecios, matchearPreciosExcel, escribirPreciosExcel,
  detectarCamposSueltos, matchearCamposSueltos, escribirCamposSueltos,
} from '@/app/lib/anexos-excel-precios';
import { verificarTotalEconomico } from '@/app/lib/auditor-verificacion-total';
import { registrarActividad } from '@/app/lib/actividad';
import { yaCongelado } from '@/app/lib/congelamiento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONTENT_TYPE_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function subirYRegistrar(codigo: string, nombre: string, buffer: Buffer, usuarioId: number) {
  const url = await subirDocumentoR2(codigo, nombre, buffer, CONTENT_TYPE_XLSX);
  await pool.query(
    `INSERT INTO documentos_cache
       (licitacion_codigo, documento_nombre, documento_url_local, size_bytes, content_type, categoria, usuario_id)
     VALUES (?, ?, ?, ?, ?, 'DOCUMENTOS_PROPIOS', ?)
     ON DUPLICATE KEY UPDATE
       documento_url_local = VALUES(documento_url_local),
       size_bytes          = VALUES(size_bytes),
       updated_at          = CURRENT_TIMESTAMP`,
    [codigo, nombre, url, buffer.length, CONTENT_TYPE_XLSX, usuarioId],
  );
  return url;
}

export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const codigo = body?.codigo;
  const documentoId = body?.documentoId;
  const excluirFilas = new Set<number>(Array.isArray(body?.excluirFilas) ? body.excluirFilas : []);

  if (!codigo || !documentoId) {
    return NextResponse.json({ error: 'Faltan parámetros: codigo, documentoId' }, { status: 400 });
  }
  if (!(await puedeVerLicitacion(request, codigo))) {
    return NextResponse.json({ error: 'Sin acceso a esta licitación' }, { status: 403 });
  }
  if (!(await esAdmin(request))) {
    return NextResponse.json({ error: 'El creador de anexos está disponible solo para administradores por ahora' }, { status: 403 });
  }

  // Mismo guardarraíl que /api/anexos/generar: negocio postulado y congelado no genera más anexos.
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
    const [{ bufferOriginal, nombreOriginal }, itemsCosteo, datosAuditor] = await Promise.all([
      cargarDocumentoXlsx(codigo, documentoId),
      obtenerItemsCosteoParaAnexo(codigo),
      obtenerDatosAuditorParaAnexo(codigo),
    ]);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bufferOriginal as any);
    const ws = wb.worksheets.find(h => detectarTablaPrecios(h)) || wb.worksheets[0];
    const tabla = ws ? detectarTablaPrecios(ws) : null;
    if (!tabla || !ws) {
      return NextResponse.json({ error: 'No se reconoció una tabla de precios en este archivo.' }, { status: 400 });
    }

    const matchesTodos = itemsCosteo.length ? await matchearPreciosExcel(tabla, itemsCosteo) : [];
    const matches = matchesTodos.filter(m => !excluirFilas.has(m.fila));

    const resultado = escribirPreciosExcel(wb, tabla, matches);

    // Campos sueltos fuera de la tabla (hoy: "Plazo de entrega") — mismo dato que ya aprobó el
    // Auditor Técnico, mismo módulo puro que ya usa el motor de Word (resolverCamposSueltosConAuditor).
    const camposSueltos = detectarCamposSueltos(ws, tabla.filaFinTabla);
    const camposResueltos = matchearCamposSueltos(camposSueltos, datosAuditor);
    if (camposResueltos.length) escribirCamposSueltos(ws, camposResueltos);

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    // GUARDARRAÍL DEL ANEXO ECONÓMICO (mismo criterio que /api/anexos/generar): el precio es lo
    // que se evalúa — un total que no calza con el costeo aprobado no se sube.
    const [costeoRows] = await pool.query(
      `SELECT c.total_precio_neto FROM checklist_comercial_costeo c
         JOIN negocios n ON n.id = c.negocio_id
        WHERE n.licitacion_codigo = ? AND n.activo = TRUE AND c.vigente = 1
        LIMIT 1`,
      [codigo],
    ) as any;
    const totalCosteoNeto = (costeoRows as any[])[0]?.total_precio_neto ?? null;
    const verificacion = verificarTotalEconomico({
      totalEnAnexo: resultado.totalEscritoNeto, totalCosteoNeto: totalCosteoNeto != null ? Number(totalCosteoNeto) : null,
      lineas: tabla.filas.length,
    });
    if (!verificacion.calza) {
      return NextResponse.json({ error: verificacion.mensaje, totalNoCalza: true }, { status: 409 });
    }

    const nombreFinal = `ANEXO_${nombreOriginal}`;
    const url = await subirYRegistrar(codigo, nombreFinal, buffer, usuario.id);

    registrarActividad({
      usuarioId: usuario.id, accion: 'anexo_relleno',
      entidadTipo: 'licitacion', entidadId: codigo,
      descripcion: `Rellenó el anexo económico "${nombreOriginal}" (${resultado.completados} precios automáticos`
        + `${camposResueltos.length ? `, ${camposResueltos.length} campo(s) de texto` : ''}`
        + `${resultado.pieCorregido ? ', totales corregidos' : ''})`,
      metadata: {
        licitacion_codigo: codigo, documento: nombreOriginal,
        completados: resultado.completados, filasSinMatch: resultado.filasSinMatch,
        camposSueltos: camposResueltos.length, pieCorregido: resultado.pieCorregido,
      },
    });

    return NextResponse.json({
      success: true, archivo: { nombre: nombreFinal, url },
      completados: resultado.completados, filasSinMatch: resultado.filasSinMatch,
      camposSueltos: camposResueltos.length, pieCorregido: resultado.pieCorregido,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 400 });
  }
}
