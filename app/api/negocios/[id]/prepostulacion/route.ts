// app/api/negocios/[id]/prepostulacion/route.ts
// PRE-POSTULACIÓN (estado que reemplaza a ANEXOS): entrada = opciones APROBADAS del AUDITOR; salida = certificado de admisibilidad,
// bloque técnico-administrativo confirmado y el candado que habilita la generación de anexos. Lógica en app/lib/auditor-prepostulacion.ts.
// Mismo acceso que el Auditor (admin o permiso `auditor_compra`, ver app/lib/auditor-acceso.ts).
//
//   GET  → tablero: líneas, certificado por línea, ítems técnico-administrativos y candado con sus causales.
//   POST → { accion, ... }: revisar_linea · revisar_todas · confirmar · desconfirmar · confirmar_varios · no_aplica · restaurar · agregar_item · segunda_pasada
import { NextRequest, NextResponse } from 'next/server';
import { contextoAuditor } from '@/app/lib/auditor-acceso';
import { invalidarEnVuelo } from '@/app/lib/en-vuelo';
import {
  migracionAplicada, armarPrePostulacionCompartida, revisarCompromisosDeLinea, revisarTodasLasLineas, confirmarItem, confirmarItems,
  marcarItemNoAplica, agregarItemManual, correrSegundaPasada,
} from '@/app/lib/auditor-prepostulacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const c = await contextoAuditor(request, params);
  if (c instanceof NextResponse) return c;
  try {
    if (!(await migracionAplicada())) return NextResponse.json({ success: true, migracionPendiente: true });
    const dto = await armarPrePostulacionCompartida(c.negocio.id, c.negocio.licitacion_codigo);
    return NextResponse.json({ success: true, ...dto });
  } catch (e) {
    console.error('[prepostulacion][GET]', String(e));
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const c = await contextoAuditor(request, params);
  if (c instanceof NextResponse) return c;
  const { negocio, actor } = c;
  const body = await request.json().catch(() => ({}));
  const accion = String(body.accion || '');

  invalidarEnVuelo(negocio.id);
  try {
    if (!(await migracionAplicada())) return NextResponse.json({ error: 'Falta aplicar la migración 135 (node scripts/aplicar-migration-135.mjs).' }, { status: 409 });
    switch (accion) {
      case 'revisar_linea': {
        const r = await revisarCompromisosDeLinea({ negocioId: negocio.id, licitacionCodigo: negocio.licitacion_codigo, filaId: String(body.filaId || ''), actor });
        return NextResponse.json({ success: !r.error, ...r });
      }
      case 'revisar_todas': {
        const r = await revisarTodasLasLineas({ negocioId: negocio.id, licitacionCodigo: negocio.licitacion_codigo, actor, forzar: body.forzar === true });
        return NextResponse.json({ success: true, resultados: r, creados: r.reduce((n, x) => n + x.creados, 0), errores: r.filter(x => x.error).length });
      }
      case 'confirmar': await confirmarItem(negocio.id, Number(body.id), true, actor); break;
      case 'desconfirmar': await confirmarItem(negocio.id, Number(body.id), false, actor); break;
      case 'confirmar_varios': {
        const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isFinite) : [];
        return NextResponse.json({ success: true, confirmados: await confirmarItems(negocio.id, ids, actor) });
      }
      case 'no_aplica': await marcarItemNoAplica(negocio.id, Number(body.id), true, String(body.comentario || ''), actor); break;
      case 'restaurar': await marcarItemNoAplica(negocio.id, Number(body.id), false, '', actor); break;
      case 'agregar_item': {
        const id = await agregarItemManual(negocio.id, {
          filaId: body.filaId ? String(body.filaId) : null, materia: String(body.materia || 'otro'), exigeBaseLiteral: String(body.exigeBaseLiteral || ''),
          fuenteBases: body.fuenteBases ? String(body.fuenteBases) : undefined, seCompromete: body.seCompromete ? String(body.seCompromete) : undefined, conCosto: body.conCosto === true,
        }, actor);
        return NextResponse.json({ success: true, id });
      }
      case 'segunda_pasada': {
        const r = await correrSegundaPasada(negocio.id, Number(body.opcionId), actor);
        return NextResponse.json({ success: true, ...r });
      }
      default:
        return NextResponse.json({ error: `Acción desconocida: ${accion}` }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[prepostulacion][POST]', accion, msg);
    return NextResponse.json({ error: msg }, { status: 400 });
  } finally {
    invalidarEnVuelo(negocio.id);
  }
}
