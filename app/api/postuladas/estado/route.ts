// app/api/postuladas/estado/route.ts
// Devuelve, en UNA sola llamada, el estado de TODAS las postuladas del usuario:
//   · resultado de adjudicación (cache-first, sin golpear MP en vivo salvo que falte cache),
//   · si está APERTURADA (tabla licitacion_apertura + detección on-demand por el portal).
//
// Reemplaza el consultar "una por una" desde el navegador (que mostraba una animación lenta
// y demoraba en dar el total). Aquí el servidor resuelve todo en paralelo y responde junto.
//
// La detección de apertura lee el portal de MP → requiere IP chilena (como la descarga). Si
// la app corre fuera de Chile, degrada a lo que haya en la tabla (lo llena el cron).

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { tienePermiso } from '@/app/lib/api-auth';
import { obtenerAdjudicacion } from '@/app/lib/adjudicacion';
import { leerAperturas } from '@/app/lib/detectar-aperturas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null };
}

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]); }
  }));
}

export async function GET(request: NextRequest) {
  const { id: userId } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    // Alcance por rol: admin ve todas; el resto solo las suyas (igual que /api/negocios).
    const verOtros = await tienePermiso(request, 'ver_otros_negocios').catch(() => false);
    const where = verOtros
      ? `n.activo = TRUE AND n.estado_pipeline = 'POSTULADA'`
      : `n.activo = TRUE AND n.estado_pipeline = 'POSTULADA' AND n.asignado_a = ?`;
    const [rows] = await pool.query(
      `SELECT DISTINCT n.licitacion_codigo AS codigo FROM negocios n WHERE ${where}`,
      verOtros ? [] : [userId],
    ) as any[];
    const codigos = (rows as any[]).map(r => r.codigo).filter(Boolean) as string[];
    if (codigos.length === 0) return NextResponse.json({ estados: {} });

    // 1) Adjudicación: SOLO cache (sin tocar MP) → respuesta casi instantánea. El cron
    //    (procesar-postuladas) mantiene el cache al día en segundo plano.
    const estados: Record<string, any> = {};
    const setEstado = (codigo: string, adj: any) => {
      estados[codigo] = {
        esAdjudicada: !!adj?.esAdjudicada,
        estado: adj?.estado ?? null,
        ganamos: !!adj?.ganamos,
        montoNuestro: adj?.montoNuestro ?? null,
        montoAdjudicadoTotal: adj?.montoAdjudicadoTotal ?? null,
        fechaAdjudicacion: adj?.fechaAdjudicacion ?? null,
        adjudicacion: adj?.adjudicacion ?? null,
        lineasAdjudicadas: adj?.lineasAdjudicadas ?? [],
        aperturada: 0,
      };
    };
    await mapLimit(codigos, 12, async (codigo) => {
      const adj = await obtenerAdjudicacion(codigo, { sinRed: true }).catch(() => null);
      setEstado(codigo, adj);
    });

    // 1b) Relleno en vivo ACOTADO: solo para los que aún no tienen cache, usando la API de MP
    //     (rápida, no el portal). Cap y presupuesto de tiempo estrictos para no volver a
    //     alentar la carga; el resto queda para que el cron lo rellene.
    const sinCache = codigos.filter(c => !estados[c] || estados[c].estado == null);
    const MAX_VIVO = 6;
    const PRESUPUESTO_VIVO_MS = 6_000;
    const iniVivo = Date.now();
    let rellenados = 0;
    await mapLimit(sinCache.slice(0, MAX_VIVO), 4, async (codigo) => {
      if (Date.now() - iniVivo > PRESUPUESTO_VIVO_MS) return;
      const adj = await obtenerAdjudicacion(codigo, { soloCache: true }).catch(() => null);
      if (adj) { setEstado(codigo, adj); rellenados++; }
    });

    // 2) Apertura: se lee SOLO de la tabla (rápido, sin rascar el portal). La detección por
    //    portal (IP chilena) la hace el cron /api/cron/aperturas. Una ADJUDICADA ya pasó por
    //    apertura por definición → aperturada aunque no haya fila.
    const apertura = await leerAperturas(codigos).catch(() => new Map<string, boolean>());
    for (const c of codigos) {
      estados[c].aperturada = estados[c].esAdjudicada || apertura.get(c) ? 1 : 0;
    }

    return NextResponse.json({ estados });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
