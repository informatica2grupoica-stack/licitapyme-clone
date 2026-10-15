// app/api/negocios/[id]/readjudicada/route.ts
// Marca manual «readjudicada a nosotros» (migration-149). Solo admin.
//   PUT { activa: boolean, nota?: string }
// Cuando el organismo readjudica por decreto y la ficha de MP sigue mostrando al otro proveedor, la
// marca prevalece sobre el acta (ver enriquecer() en app/lib/adjudicacion.ts). Al activarla el
// negocio pasa a ADJUDICADA y se abren Entrega y Compras, igual que con un acta que dice que ganamos.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { registrarEvento } from '@/app/lib/historial';
import { publicarCambio } from '@/app/lib/sse-bus';
import { invalidarReadjudicadas } from '@/app/lib/adjudicacion';
import { abrirEntregaSiCorresponde } from '@/app/lib/entrega-proyecto';
import { abrirComprasSiCorresponde } from '@/app/lib/compras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const userId = Number(request.headers.get('x-user-id')) || null;
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (request.headers.get('x-user-rol') !== 'admin')
    return NextResponse.json({ error: 'Solo un administrador puede marcar una readjudicación' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const activa = !!body.activa;
  const nota = String(body.nota || '').trim().slice(0, 300) || null;

  const [rows] = await pool.query(
    `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.asignado_a, u.nombre AS actor
       FROM negocios n LEFT JOIN usuarios u ON u.id = ? WHERE n.id = ?`, [userId, id]);
  const neg = (rows as any[])[0];
  if (!neg) return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 });

  try {
    if (activa) {
      await pool.query(
        `UPDATE negocios SET readjudicada_at = NOW(), readjudicada_nota = ?, readjudicada_por = ?,
                estado_pipeline = 'ADJUDICADA', updated_at = NOW() WHERE id = ?`, [nota, neg.actor || null, id]);
    } else {
      await pool.query(
        `UPDATE negocios SET readjudicada_at = NULL, readjudicada_nota = NULL, readjudicada_por = NULL, updated_at = NOW() WHERE id = ?`, [id]);
    }
  } catch (e) {
    return NextResponse.json({ error: 'Falta aplicar migration-149: ' + String(e).slice(0, 120) }, { status: 500 });
  }
  invalidarReadjudicadas();
  if (activa) {
    await abrirEntregaSiCorresponde(neg.id, neg.licitacion_codigo, neg.asignado_a).catch(() => {});
    await abrirComprasSiCorresponde(neg.id, neg.licitacion_codigo, neg.asignado_a).catch(() => {});
  }
  await registrarEvento({
    tipo: 'RESULTADO_ADJUDICACION',
    licitacionCodigo: neg.licitacion_codigo, licitacionNombre: neg.licitacion_nombre,
    usuarioId: neg.asignado_a, usuarioNombre: null,
    actorId: userId, actorNombre: neg.actor || null,
    mensaje: activa
      ? `${neg.actor || 'Un administrador'} marcó la licitación como readjudicada a nosotros${nota ? `: ${nota}` : ''}`
      : `${neg.actor || 'Un administrador'} quitó la marca de readjudicación`,
    metadata: { licitacion_codigo: neg.licitacion_codigo, readjudicada: activa },
  }).catch(() => {});
  publicarCambio('negocio');
  return NextResponse.json({ success: true, readjudicada: activa });
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = await pool.query(
    `SELECT readjudicada_at, readjudicada_nota, readjudicada_por FROM negocios WHERE id = ?`, [id])
    .then(r => r[0] as any[]).catch(() => [] as any[]);
  const r = rows[0];
  return NextResponse.json({ readjudicada: !!r?.readjudicada_at, nota: r?.readjudicada_nota ?? null, por: r?.readjudicada_por ?? null });
}
