// app/api/radar/procesar-pasa/route.ts
// "Procesar PASA": flujo único que, SOLO para licitaciones que pasaron el prefiltro
// (PASA / REVISION_HUMANA), hace en cadena por lote:
//   1) si no tiene documentos → los descarga
//   2) corre el ANÁLISIS PROFUNDO IA (PROMPT 2, el mismo del botón manual): Gemini lee
//      todos los documentos y emite el veredicto completo (informe_ejecutivo._informe_ia).
// Las EXCLUIDO nunca entran (ahorro de tokens/recursos). Reanudable: salta las que ya
// tienen informe profundo. El cliente llama lote a lote (cada análisis es pesado, ~1-2 min).
//
// Requiere IP chilena para la descarga (local/Docker/notebook, NO Vercel).

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { descargarDocumentosLicitacion } from '@/app/lib/mp-descarga-orquestador';
import { analizarYGuardarViabilidadIA } from '@/app/lib/viabilidad-ia';
import { iaTextoConfigurada } from '@/app/lib/gemini';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function getUserId(req: NextRequest): number | null {
  const id = req.headers.get('x-user-id');
  if (!id) return null;
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}

// Gate de prefiltro: solo PASA / REVISION_HUMANA.
const GATE_PREFILTRO =
  `AND EXISTS (
     SELECT 1 FROM prefiltro_licitacion pf
     WHERE pf.licitacion_codigo = al.licitacion_codigo
       AND pf.decision IN ('PASA','REVISION_HUMANA')
   )`;

// "Pendiente" = PASA/REVISION cuya viabilidad AÚN no tiene informe profundo (_informe_ia).
// Incluye tanto las que no tienen documentos como las que los tienen pero sin análisis IA.
// `excluir` permite saltar códigos que ya fallaron en esta corrida (evita reintentar en bucle
// la misma licitación que está al frente del orden y bloquea el avance del resto).
async function pendientesCodigos(userId: number, lote: number | null, excluir: string[]): Promise<string[]> {
  const ex = excluir.slice(0, 1000);
  const exClause = ex.length ? `AND al.licitacion_codigo NOT IN (${ex.map(() => '?').join(',')})` : '';
  const sql = (gate: string) =>
    `SELECT DISTINCT al.licitacion_codigo
     FROM alertas_licitaciones al
     WHERE al.usuario_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM viabilidad_licitacion v
         WHERE v.licitacion_codigo = al.licitacion_codigo
           AND INSTR(v.informe_ejecutivo, '_informe_ia') > 0
       )
       ${gate}
       ${exClause}
     ORDER BY al.licitacion_cierre DESC` + (lote ? ` LIMIT ${Math.max(1, Math.min(lote, 10))}` : '');
  const params = [userId, ...ex];
  try {
    const [rows] = await pool.query(sql(GATE_PREFILTRO), params) as any[];
    return (rows as any[]).map(r => r.licitacion_codigo as string);
  } catch (e: any) {
    if (!String(e).toLowerCase().includes('prefiltro_licitacion')) throw e;
    const [rows] = await pool.query(sql(''), params) as any[];
    return (rows as any[]).map(r => r.licitacion_codigo as string);
  }
}

async function tieneDocumentos(codigo: string): Promise<boolean> {
  const [rows] = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM documentos_cache WHERE licitacion_codigo = ?) AS hay`, [codigo]);
  return Number((rows as any[])[0]?.hay) === 1;
}

// GET — cuántas PASA/REVISION quedan sin análisis profundo
export async function GET(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  try {
    const pendientes = await pendientesCodigos(userId, null, []);
    return NextResponse.json({ pendientes: pendientes.length });
  } catch (e: any) {
    return NextResponse.json({ pendientes: 0, error: e.message });
  }
}

// POST — procesa el siguiente lote. Body: { lote?: number (default 1), excluir?: string[] }
export async function POST(request: NextRequest) {
  const userId = getUserId(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  if (!iaTextoConfigurada()) {
    return NextResponse.json({ error: 'No hay proveedor de IA configurado (ZAI_API_KEY).' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const lote: number = Number(body.lote) || 1;
  const excluir: string[] = Array.isArray(body.excluir) ? body.excluir.filter((c: unknown) => typeof c === 'string') : [];

  try {
    const codigos = await pendientesCodigos(userId, lote, excluir);
    if (codigos.length === 0) {
      return NextResponse.json({ completado: true, procesados: [], pendientes: 0 });
    }

    type Item = {
      codigo: string; descargado: boolean; analizado: boolean; exito: boolean;
      semaforo?: string; score?: number; area?: string; error?: string;
    };
    const procesados: Item[] = [];

    for (const codigo of codigos) {
      const item: Item = { codigo, descargado: false, analizado: false, exito: false };
      try {
        // 1) Descargar documentos si faltan.
        if (!(await tieneDocumentos(codigo))) {
          const dl = await descargarDocumentosLicitacion(codigo);
          item.descargado = !!dl.exito;
          if (!dl.exito && !(await tieneDocumentos(codigo))) {
            item.error = dl.error || 'no se pudieron descargar documentos';
            procesados.push(item);
            continue;
          }
        }

        // 2) Análisis profundo IA (el mismo del botón manual).
        const informe = await analizarYGuardarViabilidadIA(codigo);
        if (!informe) {
          item.error = 'sin documentos legibles para analizar';
        } else {
          item.analizado = true;
          item.exito = true;
          item.semaforo = informe.semaforo;
          item.score = informe.score_0_100;
          item.area = informe.area_negocio;
        }
      } catch (e: any) {
        item.error = String(e?.message ?? e).slice(0, 200);
      }
      procesados.push(item);
    }

    // completado = ya no quedan códigos procesables saltando los fallidos (de esta tanda + previos).
    const fallidos = procesados.filter(p => !p.exito).map(p => p.codigo);
    const excluirNext = [...new Set([...excluir, ...fallidos])];
    const restantes = await pendientesCodigos(userId, 1, excluirNext);
    // pendientes "reales" para el contador (sin saltar fallidos): refleja el estado verdadero.
    const pendientesReales = (await pendientesCodigos(userId, null, [])).length;

    return NextResponse.json({
      completado: restantes.length === 0,
      procesados,
      pendientes: pendientesReales,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
