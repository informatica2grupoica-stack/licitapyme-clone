// app/api/empresas/[id]/documentos/route.ts
// Identidad de la empresa para el Auditor Técnico: logo, firma escaneada, timbre digital
// (columnas directas en `empresas`, un archivo cada una — se reemplaza al subir uno nuevo) y
// certificados/experiencia acreditable (tabla hija `empresa_documentos`, acumulan — mismo
// patrón que checklist_comercial_documentos).
//
//   POST   multipart { tipo: 'logo'|'firma'|'timbre'|'certificado'|'experiencia', titulo?, descripcion?, file }
//   DELETE ?documentoId=  → borra una fila de empresa_documentos (certificado/experiencia)
//          ?tipo=logo|firma|timbre  → limpia la columna singular correspondiente
//
// Mutaciones solo admin, igual que el resto del CRUD de empresas (app/api/empresas/[id]/route.ts).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { agregarFirmaEmpresa, listarFirmasEmpresa, sincronizarFirmaPrincipal } from '@/app/lib/empresa-firmas';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

type Params = { params: Promise<{ id: string }> };

// 'firma' YA NO está acá: desde migration-84 una empresa puede tener VARIAS firmas (tabla
// empresa_firmas, ver /api/empresas/[id]/firmas). Este endpoint sigue aceptando tipo='firma' para
// no romper a ningún llamador viejo, pero delega en esa tabla en vez de pisar la columna —
// `empresas.firma_url` pasó a ser el espejo de la firma principal, no la fuente.
const TIPOS_COLUMNA = ['logo', 'timbre'] as const;
const TIPOS_TABLA = ['certificado', 'experiencia', 'otro'] as const;

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Solo el admin puede editar la identidad de la empresa' }, { status: 403 });
  const { id } = await params;

  try {
    const [rows] = await pool.query(`SELECT id FROM empresas WHERE id = ?`, [id]) as any;
    if (!(rows as any[]).length) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });

    const formData = await request.formData();
    const tipo = String(formData.get('tipo') || '');
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const publicUrl = await subirDocumentoR2(`empresas/${id}`, file.name, buffer, file.type);

    if (tipo === 'firma') {
      const etiqueta = String(formData.get('titulo') || '').trim() || file.name.replace(/\.[a-z0-9]+$/i, '');
      const id_firma = await agregarFirmaEmpresa(id, {
        etiqueta, url: publicUrl, nombre: file.name,
        subidoPor: userId, subidoPorNombre: request.headers.get('x-user-nombre') || null,
      });
      return NextResponse.json({ success: true, id: id_firma, url: publicUrl, nombre: file.name });
    }

    if ((TIPOS_COLUMNA as readonly string[]).includes(tipo)) {
      await pool.query(
        `UPDATE empresas SET ${tipo}_url = ?, ${tipo}_nombre = ? WHERE id = ?`,
        [publicUrl, file.name, id],
      );
      return NextResponse.json({ success: true, url: publicUrl, nombre: file.name });
    }

    if ((TIPOS_TABLA as readonly string[]).includes(tipo)) {
      const titulo = String(formData.get('titulo') || file.name).slice(0, 300);
      const descripcion = formData.get('descripcion') ? String(formData.get('descripcion')).slice(0, 2000) : null;
      const [result] = await pool.query(
        `INSERT INTO empresa_documentos (empresa_id, tipo, titulo, descripcion, url, nombre, subido_por, subido_por_nombre, subido_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [id, tipo, titulo, descripcion, publicUrl, file.name, userId, request.headers.get('x-user-nombre') || null],
      ) as any;
      return NextResponse.json({ success: true, id: (result as any).insertId, url: publicUrl, nombre: file.name });
    }

    return NextResponse.json({ error: `Tipo de documento inválido: "${tipo}"` }, { status: 400 });
  } catch (error) {
    console.error('[empresas][documentos][POST]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;

  try {
    const [rows] = await pool.query(
      `SELECT id, tipo, titulo, descripcion, url, nombre, orden, subido_por_nombre, subido_at
         FROM empresa_documentos WHERE empresa_id = ? ORDER BY tipo, orden, id`,
      [id],
    ) as any;
    return NextResponse.json({ success: true, documentos: rows });
  } catch (error) {
    // Migración 51 pendiente → sin documentos, no un 500 opaco.
    return NextResponse.json({ success: true, documentos: [] });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Solo el admin puede eliminar documentos de la empresa' }, { status: 403 });
  const { id } = await params;

  try {
    const documentoId = request.nextUrl.searchParams.get('documentoId');
    const tipoColumna = request.nextUrl.searchParams.get('tipo');

    if (documentoId) {
      await pool.query(`DELETE FROM empresa_documentos WHERE id = ? AND empresa_id = ?`, [documentoId, id]);
      return NextResponse.json({ success: true });
    }

    // Compatibilidad: "borrar la firma" sin decir cuál = borrar la que estaba en uso (la
    // principal), no todas — borrar en silencio firmas que el llamador viejo ni sabe que existen
    // sería destruir datos por una llamada que antes afectaba a un solo archivo.
    if (tipoColumna === 'firma') {
      const principal = (await listarFirmasEmpresa(id)).find(f => f.es_principal);
      if (principal) await pool.query(`DELETE FROM empresa_firmas WHERE id = ? AND empresa_id = ?`, [principal.id, id]);
      await sincronizarFirmaPrincipal(id);
      return NextResponse.json({ success: true });
    }

    if (tipoColumna && (TIPOS_COLUMNA as readonly string[]).includes(tipoColumna)) {
      await pool.query(`UPDATE empresas SET ${tipoColumna}_url = NULL, ${tipoColumna}_nombre = NULL WHERE id = ?`, [id]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Falta documentoId o tipo' }, { status: 400 });
  } catch (error) {
    console.error('[empresas][documentos][DELETE]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
