// BANDEJA DEL EM (26-oct-2026) — lo que espera al Encargado de Mercado Público en el AUDITOR, de TODOS los negocios en preparación:
//   · opciones EN APROBACIÓN (firmadas, pasaron la pasada final, falta Aprobar/Rechazar);
//   · requisitos ❓/❌ que el asistente COMPLEMENTÓ (nota y/o archivo) y siguen abiertos: solo el EM los da por cumplidos.
// Antes el EM tenía que entrar negocio por negocio y abrir cada línea. Los datos salen del MISMO panel del Auditor de cada negocio
// (armarPanelAuditorCompartido), así la bandeja muestra exactamente lo que se ve adentro. La aprobación sigue siendo por opción
// (resolverAprobacion) y la aceptación por requisito (confirmarCeldaTecnica, como EM): aquí solo se hacen varias de una vez.
import pool from '@/app/lib/db';
import { idsEquivalentes } from '@/app/lib/pipeline';
import { armarPanelAuditorCompartido, resolverAprobacion, confirmarCeldaTecnica, type LineaAuditorDTO } from '@/app/lib/auditor-opciones';
import type { RespaldoCelda } from '@/app/lib/auditor-comparador-v3';
import { registrarEvento } from '@/app/lib/historial';

// Mismos estados que la bandeja de Aprobaciones (app/api/aprobaciones): un negocio postulado, perdido o descartado ya no tiene nada que aprobar.
const ESTADOS_EN_PREPARACION = ['ASIGNADO', 'EN_PROCESO', 'ANEXOS', 'ANEXO_LISTO', 'VISADO'];

export interface NegocioBandejaEM {
  negocioId: number; licitacionCodigo: string; licitacionNombre: string | null; asignadoNombre: string | null; cierre: string | null;
  opciones: Array<{
    opcionId: number; filaId: string; linea: string; detalle: string; producto: string; proveedor: string;
    costoNeto: number | null; costeadoNeto: number | null; firmadaPorNombre: string | null; firmadaAt: string | null;
    tecnico: { cumple: number; total: number };
  }>;
  requisitos: Array<{
    opcionId: number; filaId: string; linea: string; producto: string; n: number; requisito: string; estado: 'FALTA_DATO' | 'NO_CUMPLE';
    puedeDejarnosFuera: boolean; citaDocumento: string; complementos: RespaldoCelda[];
  }>;
}

/** Número visible de la línea: el de Mercado Público (lineaReal) o el ítem del costeo; varios ítems de una línea → 7.1, 7.2… (igual que la pantalla del Auditor). */
function etiquetasDeLineas(lineas: LineaAuditorDTO[]): Map<string, string> {
  const veces = new Map<number, number>();   // número de la línea de Mercado Público (lineaReal); si no hay, el ítem del costeo
  for (const l of lineas) veces.set(l.lineaReal ?? l.item, (veces.get(l.lineaReal ?? l.item) ?? 0) + 1);
  const vistos = new Map<number, number>();
  return new Map(lineas.map(l => {
    const num = l.lineaReal ?? l.item;
    if ((veces.get(num) ?? 0) < 2) return [l.filaId, String(num)];
    const k = (vistos.get(num) ?? 0) + 1; vistos.set(num, k);
    return [l.filaId, `${num}.${k}`];
  }));
}

/** Negocios en preparación con algo para el EM: una opción en aprobación o un complemento de requisito (los que ya se cerraron se filtran después). */
async function negociosCandidatos(): Promise<Array<{ id: number; licitacion_codigo: string; licitacion_nombre: string | null; licitacion_cierre: unknown; asignado_nombre: string | null }>> {
  const [rows] = await pool.query(
    `SELECT n.id, n.licitacion_codigo, n.licitacion_nombre, n.licitacion_cierre, u.nombre AS asignado_nombre
       FROM negocios n LEFT JOIN usuarios u ON u.id = n.asignado_a
      WHERE n.activo = TRUE AND COALESCE(n.estado_pipeline, 'ASIGNADO') IN (?)
        AND (EXISTS (SELECT 1 FROM auditor_opcion o WHERE o.negocio_id = n.id AND o.estado = 'en_aprobacion')
          OR EXISTS (SELECT 1 FROM auditor_evento e WHERE e.negocio_id = n.id AND e.tipo = 'respaldo_celda'))
      ORDER BY n.licitacion_cierre IS NULL, n.licitacion_cierre ASC`,
    [ESTADOS_EN_PREPARACION.flatMap(idsEquivalentes)]) as any;
  return rows as any[];
}

export async function construirBandejaEM(): Promise<NegocioBandejaEM[]> {
  const candidatos = await negociosCandidatos();
  const salida: NegocioBandejaEM[] = [];
  // De a uno: cada panel hace ~20 consultas en paralelo; varios negocios juntos saturarían el pool.
  for (const n of candidatos) {
    let panel;
    try { panel = await armarPanelAuditorCompartido(n.id, n.licitacion_codigo); } catch { continue; }
    if (panel.sinCosteo) continue;
    const et = etiquetasDeLineas(panel.lineas);
    const item: NegocioBandejaEM = {
      negocioId: n.id, licitacionCodigo: n.licitacion_codigo, licitacionNombre: n.licitacion_nombre, asignadoNombre: n.asignado_nombre,
      cierre: n.licitacion_cierre ? (n.licitacion_cierre instanceof Date ? n.licitacion_cierre.toISOString() : String(n.licitacion_cierre)) : null,
      opciones: [], requisitos: [],
    };
    for (const l of panel.lineas) {
      if (l.noOfertada) continue;
      for (const o of l.opciones) {
        const producto = [o.marca, o.modelo].filter(Boolean).join(' ') || o.producto?.nombre || 'Producto sin identificar';
        const filas = o.tecnico.resultado?.filas ?? [];
        if (o.estado === 'en_aprobacion') {
          const cumple = filas.filter(f => f.confirmada || ['CUMPLE', 'SOBRECUMPLE'].includes(f.estadoCelda ?? (f.veredicto === 'CUMPLE' ? 'CUMPLE' : ''))).length;
          item.opciones.push({
            opcionId: o.id, filaId: l.filaId, linea: et.get(l.filaId) ?? String(l.item), detalle: l.detalle, producto, proveedor: o.proveedorRazonSocial || 'Proveedor sin identificar',
            costoNeto: o.verificacion?.costoNetoUnitario ?? null, costeadoNeto: l.costeadoNeto, firmadaPorNombre: o.firmadaPorNombre, firmadaAt: o.firmadaAt,
            tecnico: { cumple, total: filas.length },
          });
        }
        if (['descartada', 'en_aprobacion', 'aprobada'].includes(o.estado)) continue;
        for (const f of filas) {
          const estado = f.estadoCelda ?? (f.veredicto === 'NO_CUMPLE' ? 'NO_CUMPLE' : f.veredicto === 'SIN_VEREDICTO' ? 'FALTA_DATO' : 'CUMPLE');
          const complementos = o.tecnico.respaldosCelda?.[f.n] ?? [];
          if (f.confirmada || !complementos.length || (estado !== 'FALTA_DATO' && estado !== 'NO_CUMPLE')) continue;
          item.requisitos.push({
            opcionId: o.id, filaId: l.filaId, linea: et.get(l.filaId) ?? String(l.item), producto, n: f.n, requisito: f.requeridoTexto, estado,
            puedeDejarnosFuera: !!f.rojo, citaDocumento: f.partes?.[0]?.citaOriginal || '', complementos,
          });
        }
      }
    }
    if (item.opciones.length || item.requisitos.length) salida.push(item);
  }
  return salida;
}

export interface ResultadoLote { ok: number; errores: Array<{ ref: string; error: string }> }

/** Aprueba o rechaza VARIAS opciones. Cada una se resuelve con la misma regla de siempre (solo si sigue «en aprobación»); un error no frena las demás. */
export async function resolverOpcionesEnLote(items: Array<{ negocioId: number; opcionId: number }>, decision: 'aprobar' | 'rechazar', comentario: string | null,
  actor: { id: number; nombre: string }): Promise<ResultadoLote> {
  const res: ResultadoLote = { ok: 0, errores: [] };
  for (const it of items) {
    try { await resolverAprobacion(it.negocioId, it.opcionId, decision, comentario, actor); res.ok++; }
    catch (e) { res.errores.push({ ref: `${it.negocioId}/${it.opcionId}`, error: e instanceof Error ? e.message : String(e) }); }
  }
  await avisarAsignados(items, decision === 'aprobar' ? 'aprobó' : 'rechazó', actor, comentario);
  return res;
}

/** Aviso al asistente cuando el EM aprueba o rechaza desde DENTRO del negocio (el Auditor), igual que desde la bandeja. */
export const avisarDecisionAlAsistente = (negocioId: number, decision: 'aprobar' | 'rechazar', actor: { id: number; nombre: string }, comentario: string | null) =>
  avisarAsignados([{ negocioId }], decision === 'aprobar' ? 'aprobó' : 'rechazó', actor, comentario);

/** Da por cumplidos VARIOS requisitos complementados (como EM). El motivo queda en cada uno: el que escribió el EM o, si no escribió, el complemento del asistente. */
export async function aceptarRequisitosEnLote(items: Array<{ negocioId: number; opcionId: number; n: number }>, motivo: string,
  actor: { id: number; nombre: string }): Promise<ResultadoLote> {
  const res: ResultadoLote = { ok: 0, errores: [] };
  for (const it of items) {
    try {
      const razon = motivo.trim() || 'Aceptado por el EM con el complemento del asistente.';
      await confirmarCeldaTecnica(it.negocioId, it.opcionId, it.n, true, actor, razon.length >= 8 ? razon : `${razon} (complemento revisado)`, true);
      res.ok++;
    } catch (e) { res.errores.push({ ref: `${it.negocioId}/${it.opcionId}/${it.n}`, error: e instanceof Error ? e.message : String(e) }); }
  }
  return res;
}

/** Al asistente asignado de cada negocio le llega a la campana qué decidió el EM (un aviso por negocio, no uno por opción). */
async function avisarAsignados(items: Array<{ negocioId: number }>, verbo: string, actor: { id: number; nombre: string }, comentario: string | null) {
  const porNegocio = new Map<number, number>();
  for (const it of items) porNegocio.set(it.negocioId, (porNegocio.get(it.negocioId) ?? 0) + 1);
  for (const [negocioId, cuantas] of porNegocio) {
    try {
      const [rows] = await pool.query(`SELECT n.licitacion_codigo, n.licitacion_nombre, n.asignado_a, u.nombre AS asignado_nombre FROM negocios n LEFT JOIN usuarios u ON u.id = n.asignado_a WHERE n.id = ?`, [negocioId]) as any;
      const n = (rows as any[])[0];
      if (!n?.asignado_a || Number(n.asignado_a) === Number(actor.id)) continue;
      await registrarEvento({
        tipo: 'AUDITOR_APROBACION', licitacionCodigo: n.licitacion_codigo, licitacionNombre: n.licitacion_nombre,
        usuarioId: n.asignado_a, usuarioNombre: n.asignado_nombre, actorId: actor.id, actorNombre: actor.nombre,
        mensaje: `${actor.nombre} ${verbo} ${cuantas === 1 ? 'una opción' : `${cuantas} opciones`} del Auditor${comentario ? `: «${comentario.slice(0, 160)}»` : ''}`,
        metadata: { negocioId, seccion: 'auditor_compra' },
      });
    } catch { /* el aviso es de buena fe: nunca frena la aprobación */ }
  }
}

/** Aviso a los EM cuando un asistente solicita aprobar una opción (o complementa un requisito que solo el EM cierra). A quién: admins y quien tenga
 *  `aprobar_comercial` o `auditor_aprobar`, de la misma empresa (registrarEvento ya corta entre empresas). Nunca a quien hizo la acción. */
export async function avisarAlEM(negocioId: number, mensaje: string, actor: { id: number; nombre: string }): Promise<void> {
  try {
    const [neg] = await pool.query(`SELECT licitacion_codigo, licitacion_nombre FROM negocios WHERE id = ?`, [negocioId]) as any;
    const n = (neg as any[])[0];
    if (!n) return;
    const [us] = await pool.query(`SELECT id, nombre, rol, permisos FROM usuarios WHERE activo = 1`) as any;
    for (const u of us as any[]) {
      if (Number(u.id) === Number(actor.id)) continue;
      let p: Record<string, unknown> = {};
      try { p = u.permisos ? (typeof u.permisos === 'string' ? JSON.parse(u.permisos) : u.permisos) : {}; } catch { p = {}; }
      if (!(u.rol === 'admin' || p.aprobar_comercial || p.auditor_aprobar)) continue;
      await registrarEvento({
        tipo: 'AUDITOR_POR_APROBAR', licitacionCodigo: n.licitacion_codigo, licitacionNombre: n.licitacion_nombre,
        usuarioId: u.id, usuarioNombre: u.nombre, actorId: actor.id, actorNombre: actor.nombre,
        mensaje, metadata: { negocioId, seccion: 'auditor_compra', bandeja: '/aprobaciones' },
      });
    }
  } catch { /* el aviso es de buena fe: nunca frena la acción del asistente */ }
}
