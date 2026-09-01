// app/api/empresas/[id]/firmas/route.ts
// VARIAS firmas escaneadas por empresa (migration-84) — el usuario firma con más de una persona
// (rep. legal titular y suplente, apoderado por rubro) y cuál va en cada anexo lo decide el
// documento, no la ficha. Reemplaza al slot único `tipo=firma` de /documentos, que pisaba la
// anterior al subir una nueva.
//
//   GET                          → todas las firmas de la empresa, la principal primero
//   POST   multipart { etiqueta?, file, principal? }
//   PATCH  ?firmaId=  { etiqueta?, principal? }
//   DELETE ?firmaId=
//
// La columna espejo `empresas.firma_url` la mantiene sincronizada empresa-firmas.ts en cada
// mutación — ver el comentario de ese archivo: nada de lo que ya leía la firma única se entera.
// Mutaciones solo admin, igual que el resto del CRUD de empresas.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { subirDocumentoR2 } from '@/app/lib/r2';
import { listarFirmasEmpresa, agregarFirmaEmpresa, sincronizarFirmaPrincipal } from '@/app/lib/empresa-firmas';

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

type Params = { params: Promise<{ id: string }> };

// pdf-lib (estampado sobre PDF) y anexos-docx solo embeben PNG/JPG. Se rechaza ACÁ, al subir, en
// vez de dejar que reviente recién al generar el anexo: el mismo error existía, pero aparecía
// media hora después y a otra persona.
const EXTENSIONES_OK = /\.(png|jpe?g)$/i;

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;
  return NextResponse.json({ success: true, firmas: await listarFirmasEmpresa(id) });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Solo el admin puede editar las firmas de la empresa' }, { status: 403 });
  const { id } = await params;

  try {
    const [rows] = await pool.query(`SELECT id FROM empresas WHERE id = ?`, [id]) as any;
    if (!(rows as any[]).length) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 });
    if (!EXTENSIONES_OK.test(file.name)) {
      return NextResponse.json(
        { error: `"${file.name}" no sirve como firma: tiene que ser PNG o JPG (es el único formato que se puede estampar sobre el PDF del anexo).` },
        { status: 400 },
      );
    }

    // Sin etiqueta escrita se usa el nombre del archivo — nunca vacía: la etiqueta ES lo que el
    // usuario ve al elegir qué firma arrastrar sobre el PDF.
    const etiqueta = String(formData.get('etiqueta') || '').trim() || file.name.replace(EXTENSIONES_OK, '');
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await subirDocumentoR2(`empresas/${id}/firmas`, file.name, buffer, file.type);

    const firmaId = await agregarFirmaEmpresa(id, {
      etiqueta, url, nombre: file.name,
      subidoPor: userId, subidoPorNombre: request.headers.get('x-user-nombre') || null,
      hacerPrincipal: String(formData.get('principal') || '') === '1',
    });

    return NextResponse.json({ success: true, id: firmaId, url, firmas: await listarFirmasEmpresa(id) });
  } catch (error) {
    console.error('[empresas][firmas][POST]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Solo el admin puede editar las firmas de la empresa' }, { status: 403 });
  const { id } = await params;

  try {
    const firmaId = Number(request.nextUrl.searchParams.get('firmaId'));
    if (!Number.isFinite(firmaId)) return NextResponse.json({ error: 'Falta firmaId' }, { status: 400 });

    const body = await request.json().catch(() => ({} as any));
    // El WHERE lleva empresa_id además del id: el firmaId viaja desde el cliente y sin ese cruce
    // se podría renombrar/ascender la firma de OTRA empresa pasando un id ajeno.
    if (typeof body.etiqueta === 'string' && body.etiqueta.trim()) {
      await pool.query(
        `UPDATE empresa_firmas SET etiqueta = ? WHERE id = ? AND empresa_id = ?`,
        [body.etiqueta.trim().slice(0, 160), firmaId, id],
      );
    }
    if (body.principal === true) await sincronizarFirmaPrincipal(id, firmaId);

    return NextResponse.json({ success: true, firmas: await listarFirmasEmpresa(id) });
  } catch (error) {
    console.error('[empresas][firmas][PATCH]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId || rol !== 'admin')
    return NextResponse.json({ error: 'Solo el admin puede eliminar firmas de la empresa' }, { status: 403 });
  const { id } = await params;

  try {
    const firmaId = Number(request.nextUrl.searchParams.get('firmaId'));
    if (!Number.isFinite(firmaId)) return NextResponse.json({ error: 'Falta firmaId' }, { status: 400 });

    await pool.query(`DELETE FROM empresa_firmas WHERE id = ? AND empresa_id = ?`, [firmaId, id]);
    // Si la borrada era la principal, acá asciende otra (o la columna espejo queda en NULL si no
    // queda ninguna) — nunca se deja a la empresa con firmas pero sin principal.
    await sincronizarFirmaPrincipal(id);

    return NextResponse.json({ success: true, firmas: await listarFirmasEmpresa(id) });
  } catch (error) {
    console.error('[empresas][firmas][DELETE]', String(error));
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
