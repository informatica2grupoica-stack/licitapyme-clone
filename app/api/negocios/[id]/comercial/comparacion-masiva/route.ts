// app/api/negocios/[id]/comercial/comparacion-masiva/route.ts
// "Comparar contra un documento" del Auditor Técnico, como TRABAJO DE FONDO.
//
//   POST → sube la ficha ya guardada y arranca la comparación; responde 202 de inmediato
//   GET  → estado del trabajo (avance, fase, resultado final o error), para el polling del front
//
// POR QUÉ NO SE HACE EN LA MISMA PETICIÓN (19-ago-2026, caso real 3489-29-LP26): son 88 líneas
// técnicas, cada una con al menos una llamada de IA. El túnel corta cualquier respuesta HTTP a
// los ~100s. Mismo patrón que /api/licitacion-viabilidad-ia (migración 68 → acá migración 70).
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/app/lib/db';
import { publicarCambio } from '@/app/lib/sse-bus';
import { puedeVerNegocioAsignado } from '@/app/lib/api-auth';
import { yaCongelado } from '@/app/lib/congelamiento';
import { resumirChecklist } from '@/app/lib/checklist-comercial';
import { cargarNegocio, leerInforme, nombreDe, COLS } from '../route';
import {
  iniciarComparacionMasiva, leerJobComparacion, marcarJobError, JOB_HUERFANO_SEG,
} from '@/app/lib/auditor-comparacion-masiva';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  const rol = req.headers.get('x-user-rol');
  return { id: id ? parseInt(id) : null, rol };
}

/** Negocio + permisos. Devuelve la respuesta de error ya armada, o el negocio si todo está bien. */
async function autorizar(request: NextRequest, id: string) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  const negocio = await cargarNegocio(id);
  if (!negocio) return { error: NextResponse.json({ error: 'No encontrado' }, { status: 404 }) };
  if (!(await puedeVerNegocioAsignado(userId, rol, negocio.asignado_a)))
    return { error: NextResponse.json({ error: 'Sin permisos' }, { status: 403 }) };
  return { userId, rol, negocio };
}

// ═══ GET — estado del trabajo (polling) ═════════════════════════════════════════════════════
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await autorizar(request, id);
  if ('error' in auth) return auth.error;

  const job = await leerJobComparacion(auth.negocio.id);
  if (!job) return NextResponse.json({ success: true, job: null });

  // HUÉRFANO: dice "procesando" pero hace rato que no da señales de vida — el proceso murió
  // (despliegue, reinicio del contenedor). Se marca error para que la pantalla deje de girar.
  if (job.estado === 'procesando' && Number(job.edad_seg) > JOB_HUERFANO_SEG) {
    await marcarJobError(auth.negocio.id, job.run_id,
      'La comparación se interrumpió (el servidor se reinició). Vuelve a intentarlo: lo ya comparado quedó guardado.');
    const refrescado = await leerJobComparacion(auth.negocio.id);
    return NextResponse.json({ success: true, job: serializar(refrescado) });
  }

  return NextResponse.json({ success: true, job: serializar(job) });
}

function serializar(job: any) {
  if (!job) return null;
  let resumen: any = null;
  try { resumen = job.resumen_json ? JSON.parse(job.resumen_json) : null; } catch { resumen = null; }
  return {
    estado: job.estado, fase: job.fase, documento: job.documento_nombre,
    total: Number(job.total), procesadas: Number(job.procesadas),
    error: job.error, resumen, elapsedSeg: Number(job.elapsed_seg),
    // Gasto real de IA. Se manda también mientras corre (se actualiza en cada línea), porque el
    // valor de mostrarlo está justamente en poder cortar una corrida que se está yendo de precio.
    costo: {
      llamadas: Number(job.llamadas_ia ?? 0), tokensIn: Number(job.tokens_in ?? 0),
      tokensOut: Number(job.tokens_out ?? 0), usd: Number(job.costo_usd ?? 0),
    },
  };
}

// ═══ POST — arrancar la comparación ═════════════════════════════════════════════════════════
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await autorizar(request, id);
  if ('error' in auth) return auth.error;
  const { userId, negocio } = auth;

  if (await yaCongelado(negocio.id))
    return NextResponse.json({ error: 'Este negocio ya se postuló: el Auditor Técnico quedó congelado, de solo lectura.' }, { status: 409 });

  const body = await request.json().catch(() => ({}));
  const documentoUrl = String(body.documentoUrl || '');
  const documentoNombre = String(body.documentoNombre || 'documento');
  if (!documentoUrl) return NextResponse.json({ error: 'Falta el documento.' }, { status: 400 });

  // A qué línea(s) corresponde esta ficha. Lo dice quien la sube, porque el documento en sí no
  // siempre lo declara y adivinarlo por parecido de nombres es justo lo que producía comparaciones
  // cruzadas ("0 de 2 cumple" en Cámara de frío con una ficha de herramientas). Vacío = todo lo
  // ofertado, el comportamiento de siempre.
  const lineasObjetivo = Array.isArray(body.lineas)
    ? body.lineas.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n))
    : [];

  // Ya hay una corrida viva: no es un error, el front sigue con su polling sobre la que corre.
  const previo = await leerJobComparacion(negocio.id);
  if (previo?.estado === 'procesando' && Number(previo.edad_seg) <= JOB_HUERFANO_SEG)
    return NextResponse.json({ success: true, estado: 'procesando' }, { status: 202 });

  // El informe se sigue leyendo porque, cuando SÍ trae caracteristicas[], son la mejor fuente
  // (vienen con la cita del documento). El motor cae a las bases técnicas solo para lo que falte.
  const informe = await leerInforme(negocio.licitacion_codigo);

  const nombreActor = request.headers.get('x-user-nombre') || (await nombreDe(userId!)) || 'Usuario';
  const arranque = await iniciarComparacionMasiva(
    {
      negocioId: negocio.id, licitacionCodigo: negocio.licitacion_codigo,
      userId: userId!, nombreActor, documentoUrl, documentoNombre, lineasObjetivo,
    },
    informe,
    () => publicarCambio('checklist_comercial'),   // al terminar, los tableros abiertos se refrescan solos
  );
  if ('error' in arranque) return NextResponse.json({ error: arranque.error }, { status: 400 });

  publicarCambio('checklist_comercial');
  return NextResponse.json({ success: true, estado: 'procesando' }, { status: 202 });
}

// ═══ DELETE — descartar el resultado ya visto ═══════════════════════════════════════════════
// El resumen queda guardado en el job para poder mostrarlo tras un refresh de la página; cuando
// el usuario cierra la tabla de resultados, se borra la fila (si no, reaparecería para siempre).
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await autorizar(request, id);
  if ('error' in auth) return auth.error;

  await pool.query(`DELETE FROM auditor_tecnico_jobs WHERE negocio_id = ? AND estado <> 'procesando'`, [auth.negocio.id]);
  const [items] = await pool.query(
    `SELECT ${COLS} FROM checklist_comercial WHERE negocio_id = ? ORDER BY orden, id`, [auth.negocio.id],
  ) as any;
  return NextResponse.json({ success: true, resumen: resumirChecklist(items as any[]) });
}
