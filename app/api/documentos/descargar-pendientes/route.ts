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
import { getAuthedUser } from '@/app/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Gate de prefiltro: la licitación debe tener decisión PASA o REVISION_HUMANA.
const GATE_PREFILTRO =
  `AND EXISTS (
     SELECT 1 FROM prefiltro_licitacion pf
     WHERE pf.licitacion_codigo = al.licitacion_codigo
       AND pf.decision IN ('PASA','REVISION_HUMANA')
   )`;

type Origen = 'radar' | 'negocios';

// Ámbito de la descarga. Dos ORÍGENES:
//  • 'radar'    → tabla alertas_licitaciones + GATE de prefiltro (solo PASA/REVISION).
//  • 'negocios' → tabla negocios (asignadas activas), SIN gate: son elecciones manuales.
// Y dos ALCANCES por rol (espejo de /api/alertas):
//  • admin  → "super": todos los perfiles (ignora usuario).
//  • usuario → solo lo suyo.
async function resolverAmbito(
  req: NextRequest, origen: Origen,
): Promise<{ table: string; where: string; params: number[]; gate: string } | null> {
  const u = await getAuthedUser(req);
  if (!u) return null;
  const admin = u.rol === 'admin';
  if (origen === 'negocios') {
    return {
      table: 'negocios',
      where: admin ? 'al.activo = TRUE' : 'al.activo = TRUE AND al.asignado_a = ?',
      params: admin ? [] : [u.id],
      gate: '', // asignadas manualmente → sin gate de prefiltro
    };
  }
  return {
    table: 'alertas_licitaciones',
    where: admin ? '1 = 1' : 'al.usuario_id = ?',
    params: admin ? [] : [u.id],
    gate: GATE_PREFILTRO,
  };
}

// origen desde query (?origen=negocios) o body ({ origen: 'negocios' }). Default 'radar'.
function parseOrigen(v: unknown): Origen { return v === 'negocios' ? 'negocios' : 'radar'; }

// Cuenta de licitaciones sin documentos (según ámbito). Ambas tablas (negocios y
// alertas_licitaciones) tienen licitacion_codigo y licitacion_cierre.
// Si la tabla prefiltro_licitacion no existe → fallback sin gate.
async function contarPendientes(table: string, where: string, gate: string, scopeParams: number[]): Promise<number> {
  const base = (g: string) =>
    `SELECT COUNT(DISTINCT al.licitacion_codigo) AS pendientes
     FROM ${table} al
     WHERE ${where}
       AND NOT EXISTS (
         SELECT 1 FROM documentos_cache dc
         WHERE dc.licitacion_codigo = al.licitacion_codigo
       )
       ${g}`;
  try {
    const [rows] = await pool.query(base(gate), [...scopeParams]) as any[];
    return Number((rows as any[])[0]?.pendientes ?? 0);
  } catch (e: any) {
    if (!gate || !String(e).toLowerCase().includes("prefiltro_licitacion")) throw e;
    const [rows] = await pool.query(base(''), [...scopeParams]) as any[];
    return Number((rows as any[])[0]?.pendientes ?? 0);
  }
}

// Próximos N códigos sin documentos (cierre más próximo primero).
async function proximosCodigos(table: string, where: string, gate: string, scopeParams: number[], lote: number): Promise<string[]> {
  const base = (g: string) =>
    `SELECT DISTINCT al.licitacion_codigo
     FROM ${table} al
     WHERE ${where}
       AND NOT EXISTS (
         SELECT 1 FROM documentos_cache dc
         WHERE dc.licitacion_codigo = al.licitacion_codigo
       )
       ${g}
     ORDER BY al.licitacion_cierre DESC
     LIMIT ?`;
  try {
    const [rows] = await pool.query(base(gate), [...scopeParams, lote]) as any[];
    return (rows as any[]).map((r: any) => r.licitacion_codigo as string);
  } catch (e: any) {
    if (!gate || !String(e).toLowerCase().includes("prefiltro_licitacion")) throw e;
    const [rows] = await pool.query(base(''), [...scopeParams, lote]) as any[];
    return (rows as any[]).map((r: any) => r.licitacion_codigo as string);
  }
}

// GET — cuántas licitaciones (según origen/ámbito) no tienen documentos todavía
// ?origen=radar (default) | negocios
export async function GET(request: NextRequest) {
  const origen = parseOrigen(new URL(request.url).searchParams.get('origen'));
  const ambito = await resolverAmbito(request, origen);
  if (!ambito) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const pendientes = await contarPendientes(ambito.table, ambito.where, ambito.gate, ambito.params);

    const [totalRows] = await pool.query(
      `SELECT COUNT(DISTINCT licitacion_codigo) AS total
       FROM ${ambito.table} al
       WHERE ${ambito.where}`,
      [...ambito.params],
    ) as any[];

    return NextResponse.json({
      origen,
      pendientes,
      total: Number((totalRows as any[])[0]?.total ?? 0),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST — procesa el siguiente lote sin documentos
// Body: { lote?: number, origen?: 'radar' | 'negocios' }  (default lote 3, origen 'radar')
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { lote = 3 } = body;
  const origen = parseOrigen(body?.origen);
  const ambito = await resolverAmbito(request, origen);
  if (!ambito) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  try {
    const codigos = await proximosCodigos(ambito.table, ambito.where, ambito.gate, ambito.params, lote);

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

    const pendientes = await contarPendientes(ambito.table, ambito.where, ambito.gate, ambito.params);

    return NextResponse.json({ completado: pendientes === 0, procesados, pendientes });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
