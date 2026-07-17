// app/api/radar/descartar/route.ts
// Descartar / restaurar licitaciones del radar (acción de admin, a nivel empresa).
// Soporta lote: { codigos: string[], descartar?: boolean, motivo?: string }.
// descartar=true (default) marca como descartadas; descartar=false las restaura.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { getAuthedUser } from '@/app/lib/api-auth';
import { registrarActividad } from '@/app/lib/actividad';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function ensureTable(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS licitaciones_descartadas (
    licitacion_codigo VARCHAR(64) NOT NULL PRIMARY KEY,
    descartada_por    INT NULL,
    motivo            VARCHAR(255) NULL,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
}

export async function POST(request: NextRequest) {
  const usuario = await getAuthedUser(request);
  if (!usuario) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (usuario.rol !== 'admin') return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }

  const codigos: string[] = Array.isArray(body?.codigos)
    ? Array.from(new Set(body.codigos.filter((c: any) => typeof c === 'string' && c.trim()).map((c: string) => c.trim())))
    : [];
  const descartar = body?.descartar !== false; // default: descartar
  const motivo = typeof body?.motivo === 'string' ? body.motivo.slice(0, 255) : null;
  if (codigos.length === 0) return NextResponse.json({ error: 'No se indicaron licitaciones.' }, { status: 400 });

  try {
    await ensureTable();
    if (descartar) {
      const valores = codigos.map(() => '(?, ?, ?)').join(',');
      const params = codigos.flatMap(c => [c, usuario.id, motivo]);
      await pool.query(
        `INSERT INTO licitaciones_descartadas (licitacion_codigo, descartada_por, motivo) VALUES ${valores}
         ON DUPLICATE KEY UPDATE descartada_por = VALUES(descartada_por), motivo = VALUES(motivo)`,
        params,
      );
    } else {
      const placeholders = codigos.map(() => '?').join(',');
      await pool.query(`DELETE FROM licitaciones_descartadas WHERE licitacion_codigo IN (${placeholders})`, codigos);
    }

    // Bitácora: una línea por licitación para que cada una tenga su historial completo.
    for (const c of codigos) {
      registrarActividad({
        usuarioId: usuario.id, accion: 'descarte_radar',
        entidadTipo: 'licitacion', entidadId: c,
        descripcion: descartar
          ? `Descartó ${c} del radar${motivo ? `: ${motivo}` : ''}`
          : `Restauró ${c} al radar`,
        metadata: { licitacion_codigo: c, descartada: descartar, motivo: motivo || undefined },
      });
    }

    return NextResponse.json({ success: true, count: codigos.length, descartada: descartar });
  } catch (error) {
    console.error('[radar:descartar]', String(error));
    return NextResponse.json({ error: 'No se pudo actualizar el descarte.' }, { status: 500 });
  }
}
