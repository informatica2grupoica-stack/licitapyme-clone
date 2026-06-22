// app/api/documentos/descargar-pendientes/route.ts
// Descarga masiva de documentos para licitaciones del radar sin documentos aún.
// Procesa un lote a la vez (llamadas sucesivas desde el cliente).
// Requiere IP chilena — correr en local/Docker, NO en Vercel.
//
// GATE DE PREFILTRO (Fase 0): SOLO se descargan documentos de licitaciones cuya
// decisión de prefiltro es PASA o REVISION_HUMANA. Las EXCLUIDO —y las que aún no
// tienen decisión— NO bajan documentos (ahorro de descarga + Fase 1 + Fase 2).
// Si la tabla prefiltro_licitacion no existe todavía (migración 21 pendiente), se
// cae al comportamiento previo (sin gate) para no romper el radar.
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { descargarDocumentosLicitacion } from '@/app/lib/mp-descarga-orquestador';
import { procesarLicitacionCompleta } from '@/app/lib/pipeline-licitacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function getUserId(req: NextRequest): number | null {
  const id = req.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}

// Gate de prefiltro: la licitación debe tener decisión PASA o REVISION_HUMANA.
const GATE_PREFILTRO =
  `AND EXISTS (
     SELECT 1 FROM prefiltro_licitacion pf
     WHERE pf.licitacion_codigo = al.licitacion_codigo
       AND pf.decision IN ('PASA','REVISION_HUMANA')
   )`;

// Cuenta de licitaciones sin documentos que YA pasaron el prefiltro.
// Si la tabla prefiltro_licitacion no existe → fallback sin gate.
async function contarPendientes(userId: number): Promise<number> {
  const base = (gate: string) =>
    `SELECT COUNT(DISTINCT al.licitacion_codigo) AS pendientes
     FROM alertas_licitaciones al
     WHERE al.usuario_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM documentos_cache dc
         WHERE dc.licitacion_codigo = al.licitacion_codigo
       )
       ${gate}`;
  try {
    const [rows] = await pool.query(base(GATE_PREFILTRO), [userId]) as any[];
    return Number((rows as any[])[0]?.pendientes ?? 0);
  } catch (e: any) {
    if (!String(e).toLowerCase().includes("prefiltro_licitacion")) throw e;
    const [rows] = await pool.query(base(''), [userId]) as any[];
    return Number((rows as any[])[0]?.pendientes ?? 0);
  }
}

// Próximos N códigos sin documentos que YA pasaron el prefiltro (cierre más próximo primero).
async function proximosCodigos(userId: number, lote: number): Promise<string[]> {
  const base = (gate: string) =>
    `SELECT DISTINCT al.licitacion_codigo
     FROM alertas_licitaciones al
     WHERE al.usuario_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM documentos_cache dc
         WHERE dc.licitacion_codigo = al.licitacion_codigo
       )
       ${gate}
     ORDER BY al.licitacion_cierre DESC
     LIMIT ?`;
  try {
    const [rows] = await pool.query(base(GATE_PREFILTRO), [userId, lote]) as any[];
    return (rows as any[]).map((r: any) => r.licitacion_codigo as string);
  } catch (e: any) {
    if (!String(e).toLowerCase().includes("prefiltro_licitacion")) throw e;
    const [rows] = await pool.query(base(''), [userId, lote]) as any[];
    return (rows as any[]).map((r: any) => r.licitacion_codigo as string);
  }
}

// GET — cuántas licitaciones del radar (que pasaron el prefiltro) no tienen documentos todavía
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const pendientes = await contarPendientes(userId);

    const [totalRows] = await pool.query(
      `SELECT COUNT(DISTINCT licitacion_codigo) AS total
       FROM alertas_licitaciones
       WHERE usuario_id = ?`,
      [userId],
    ) as any[];

    return NextResponse.json({
      pendientes,
      total: Number((totalRows as any[])[0]?.total ?? 0),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST — procesa el siguiente lote de licitaciones (que pasaron el prefiltro) sin documentos
// Body: { lote?: number }  (default 3)
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { lote = 3 } = await request.json().catch(() => ({}));

  try {
    const codigos = await proximosCodigos(userId, lote);

    if (codigos.length === 0) {
      return NextResponse.json({ completado: true, procesados: [], pendientes: 0 });
    }

    const procesados: { codigo: string; exito: boolean; nuevos: number; error?: string }[] = [];

    for (const codigo of codigos) {
      try {
        const res = await descargarDocumentosLicitacion(codigo);
        procesados.push({ codigo, exito: res.exito, nuevos: res.nuevos, error: res.error });

        // Tras descargar, encadenar pipeline completo (clasificar → análisis → viabilidad).
        // Best-effort: si falla, NO se rompe el lote — la descarga ya quedó guardada.
        if (res.exito && process.env.GEMINI_API_KEY) {
          try {
            await procesarLicitacionCompleta(codigo);
          } catch (e: any) {
            console.warn(`[descargar-pendientes] pipeline falló para ${codigo}:`, e.message);
          }
        }
      } catch (e: any) {
        procesados.push({ codigo, exito: false, nuevos: 0, error: e.message });
      }
    }

    const pendientes = await contarPendientes(userId);

    return NextResponse.json({ completado: pendientes === 0, procesados, pendientes });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
