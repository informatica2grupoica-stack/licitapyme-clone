// app/api/compras/[negocioId]/auditor-costeo/route.ts
// AUDITOR DE COMPRAS · VERIFICADOR DE COTIZACIONES (PROMPT 5 v1.2) sobre la TABLA_DE_COSTEO.
//   GET   → panel completo: cada línea con su veredicto, bloqueos, alertas, comparador y evidencia, más el
//           margen acumulado del proyecto, la posición de precio (Parte IX) y los mensajes por proveedor.
//   POST  { accion: 'auditar', filaId }            audita UNA línea (en segundo plano; el panel se refresca solo)
//         { accion: 'auditar_todo' }               audita todas las líneas (segundo plano)
//         { accion: 'pasada_final' }               la pasada del SISTEMA antes de ANEXOS OK (segundo plano)
//         { accion: 'lectura' }                    L3: redacta la lectura de la posición de precio
//         { accion: 'justificar', filaId, texto }  V10: por qué no se usó la opción más barata
//         { accion: 'habilitar', filaId, nivel: 'EM'|'CA'|null, motivo }
import { NextRequest, NextResponse } from 'next/server';
import { obtenerAsignacion } from '@/app/lib/compras';
import { puedeOperarCompras, puedeVerCompras } from '@/app/api/compras/[negocioId]/route';
import { esAsesor } from '@/app/api/negocios/[id]/comercial/route';
import {
  armarPanel, forzarAuditoria, generarLecturaPosicion, iniciarLoteEnSegundoPlano, registrarHabilitacion, registrarJustificacionAhorro,
} from '@/app/lib/auditor-compras';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Params = { params: Promise<{ negocioId: string }> };

function getUser(req: NextRequest) {
  const id = req.headers.get('x-user-id');
  return { id: id ? parseInt(id) : null, rol: req.headers.get('x-user-rol'), nombre: req.headers.get('x-user-nombre') };
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id: userId, rol } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const negId = parseInt((await params).negocioId);
  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeVerCompras(userId, rol, asignacion.asignadoA))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    return NextResponse.json({ success: true, ...(await armarPanel(negId)) });
  } catch (error: any) {
    console.error('[compras/auditor-costeo][GET]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo leer el auditor de compras.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id: userId, rol, nombre } = getUser(request);
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const negId = parseInt((await params).negocioId);
  try {
    const asignacion = await obtenerAsignacion(negId);
    if (!asignacion) return NextResponse.json({ error: 'Compras no está abierto para este negocio.' }, { status: 404 });
    if (!(await puedeOperarCompras(userId, rol, asignacion.asignadoA))) return NextResponse.json({ error: 'Sin acceso.' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const actor = { id: userId, nombre };

    switch (body?.accion) {
      case 'auditar': {
        if (!body.filaId) return NextResponse.json({ error: 'Falta la línea.' }, { status: 400 });
        // «Volver a auditar» a mano fuerza la corrida completa con IA aunque nada haya cambiado.
        forzarAuditoria(negId, String(body.filaId), actor);
        return NextResponse.json({ success: true, iniciado: true });
      }
      case 'auditar_todo': case 'pasada_final': {
        const ok = iniciarLoteEnSegundoPlano(negId, body.accion === 'pasada_final' ? 'final' : 'todo', actor);
        return NextResponse.json({ success: true, iniciado: ok, yaEnCurso: !ok });
      }
      case 'lectura':
        return NextResponse.json({ success: true, ...(await generarLecturaPosicion(negId)) });
      case 'justificar': {
        await registrarJustificacionAhorro(negId, String(body.filaId), String(body.texto || ''), actor);
        return NextResponse.json({ success: true, ...(await armarPanel(negId)) });
      }
      case 'habilitar': {
        const nivel = body.nivel === 'EM' || body.nivel === 'CA' ? body.nivel : null;
        // EM = Encargado de Mercado Público (quien aprueba lo comercial); CA = potestad total (administrador).
        if (nivel === 'CA' && rol !== 'admin') return NextResponse.json({ error: 'Solo un administrador (CA) puede habilitar cualquier línea.' }, { status: 403 });
        if (rol !== 'admin' && !(await esAsesor(userId, rol))) return NextResponse.json({ error: 'Solo el Encargado de Mercado Público puede habilitar o quitar habilitaciones.' }, { status: 403 });
        await registrarHabilitacion(negId, String(body.filaId), nivel, String(body.motivo || ''), actor);
        return NextResponse.json({ success: true, ...(await armarPanel(negId)) });
      }
      default:
        return NextResponse.json({ error: 'Acción desconocida.' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('[compras/auditor-costeo][POST]', String(error));
    return NextResponse.json({ error: error.message || 'No se pudo completar la acción.' }, { status: 500 });
  }
}
