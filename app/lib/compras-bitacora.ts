// app/lib/compras-bitacora.ts
// QUIÉN HIZO QUÉ EN COMPRAS. Con varios encargados por negocio, cada acción que modifica algo queda registrada con la persona que la hizo
// (aparece en la pestaña «Actividad»). Se aplica a las rutas de /api/compras/[negocioId]/** con `conBitacoraCompras`: si la acción salió
// bien (respuesta < 400) se guarda un evento COMPRAS_ACCION con quien la ejecutó. Nunca rompe ni retrasa la acción: si guardar falla, se ignora.
import { registrarEvento } from '@/app/lib/historial';
import pool from '@/app/lib/db';

type Cuerpo = Record<string, any> | null;

const TIPO_APROB: Record<string, string> = { COMPRA: 'de compra', MARGEN: 'de margen' };
const DECISION: Record<string, string> = { APROBAR: 'Aprobó', APROBAR_CON_MODIFICACION: 'Aprobó con modificación', RECHAZAR: 'Rechazó' };
const FICHA: Record<string, string> = {
  procesar_url: 'Procesó un documento de fichas técnicas', texto: 'Pegó el texto de una ficha técnica', asignar: 'Asignó una ficha técnica a un producto',
  complementar: 'Complementó un dato técnico de una ficha', quitar_modelo: 'Quitó un modelo del panel de fichas técnicas',
  olvidar_documento: 'Quitó un documento del panel de fichas técnicas', proveedor: 'Cambió el proveedor de una ficha técnica', comparar: 'Comparó las fichas técnicas de un producto con las bases',
};
const ENTREGA: Record<string, string> = { verificacion: 'Registró la verificación de la entrega' };

/** Frase corta («Hizo X») de lo que ejecutó la persona, a partir del método, la ruta y lo que mandó. Sin datos sensibles. */
export function describirAccionCompras(metodo: string, ruta: string, cuerpo: Cuerpo): string {
  const r = ruta.replace(/^\/api\/compras\/\d+\/?/, '').replace(/\/$/, '');
  const c = cuerpo || {};
  const partes = r.split('/').filter(Boolean);
  const raiz = partes[0] || '';
  const id = partes.find((x, i) => i > 0 && /^\d+$/.test(x));
  const m = metodo.toUpperCase();

  switch (raiz) {
    case 'asignar': return Array.isArray(c.coencargadoIds) ? 'Cambió los otros encargados del negocio' : 'Asignó o cambió al encargado principal';
    case 'aprobaciones': return m === 'PATCH'
      ? `${DECISION[c.decision] || 'Resolvió'} la aprobación ${TIPO_APROB[c.tipo] || ''}`.trim()
      : `Propuso la aprobación ${TIPO_APROB[c.tipo] || ''} para el jefe de ventas`.trim();
    case 'cotizaciones':
      if (partes[1] === 'extraer') return 'Leyó cotizaciones con IA';
      if (!id) return 'Registró una cotización';
      if (partes[2] === 'items') return `Asignó productos a la cotización #${id}`;
      if (partes[2] === 'adicionales') return `Cambió los adicionales de la cotización #${id}`;
      if (partes[2] === 'auditar') return `Auditó la cotización #${id}`;
      if (partes[2] === 'auditoria-override') return `Corrigió a mano el dictamen de la cotización #${id}`;
      if (partes[2] === 'homologar') return `Homologó la cotización #${id}`;
      return m === 'DELETE' ? `Eliminó la cotización #${id}` : `Editó la cotización #${id}`;
    case 'fichas': return FICHA[c.accion] || 'Subió fichas técnicas';
    case 'escenarios': return m === 'PATCH' ? 'Modificó el escenario de compra' : (c.tipo === 'SELECCION' ? 'Armó la compra a mano (proveedor por producto)' : 'Eligió el escenario de compra');
    case 'gastos': return m === 'DELETE' ? 'Eliminó un gasto extra' : 'Agregó un gasto extra';
    case 'costo-real': return 'Registró el costo real de un producto';
    case 'costeo-compra': return 'Cargó la compra al costeo';
    case 'auditor-costeo': return 'Auditó el costeo';
    case 'productos': return c.accion === 'sincronizar_costeo' ? 'Sincronizó los productos con el costeo'
      : c.accion === 'proponer_renuncia' ? 'Propuso renunciar a una línea' : c.accion === 'aprobar_renuncia' ? 'Aprobó la renuncia a una línea'
      : c.accion === 'subestado' ? `Cambió el estado de un producto${c.subestado ? ` a ${String(c.subestado).replace(/_/g, ' ').toLowerCase()}` : ''}` : 'Modificó un producto';
    case 'sku': return partes[2] === 'verificar-obuma' ? 'Verificó un SKU contra Obuma' : 'Creó un SKU';
    case 'orden-compra': return partes[1] === 'buscar' ? 'Buscó la orden de compra del cliente' : 'Registró la orden de compra del cliente';
    case 'orden-compra-obuma': return partes[1] === 'proveedor' ? 'Creó o verificó un proveedor para la orden de compra' : 'Emitió una orden de compra en Obuma';
    case 'sincronizar-obuma': return 'Sincronizó con Obuma';
    case 'factura': return 'Registró una factura';
    case 'entrega': return ENTREGA[c.accion] || `Actualizó la entrega${c.accion ? ` (${String(c.accion).replace(/_/g, ' ')})` : ''}`;
    case 'reparto': return 'Actualizó el reparto administrativo';
    case 'reloj': return partes[1] === 'prorroga' ? (m === 'DELETE' ? 'Quitó una prórroga del plazo' : 'Registró una prórroga del plazo')
      : partes[1] === 'entregado' ? 'Marcó el proyecto como entregado' : partes[1] === 'entrega-con-multa' ? 'Registró una entrega con multa' : 'Fijó el plazo de entrega';
    case 'tarea': return 'Creó una tarea';
    case 'incidencias': return m === 'PATCH' ? 'Actualizó una incidencia' : partes[1] === 'oportunidad-mejora' ? 'Registró una oportunidad de mejora' : 'Registró una incidencia';
    case 'fracaso': return m === 'PATCH' ? 'Dictaminó la causa de un fracaso de entrega' : 'Declaró que no se puede entregar';
    case 'importacion': return 'Actualizó los datos de importación';
    case 'modalidad-retiro': return 'Cambió la modalidad de retiro';
    case 'postventa': return 'Actualizó la postventa';
    case 'cierre-legado': return m === 'DELETE' ? 'Quitó el cierre de un proyecto legado' : 'Marcó un proyecto como cierre legado';
    case 'resumen': return 'Volvió a armar el resumen ejecutivo';
    case 'agente-documentos': return 'Revisó los documentos con el agente';
    default: return `Modificó «${raiz || 'Compras'}»`;
  }
}

/** Anota la acción en el historial del proyecto. Los errores se ignoran a propósito: la bitácora nunca debe frenar lo que hizo la persona. */
async function anotar(request: Request, metodo: string, negocioIdEnRuta: number | null, tareaId: number | null, cuerpo: Cuerpo) {
  const userId = Number(request.headers.get('x-user-id'));
  if (!Number.isFinite(userId) || userId <= 0) return;
  const rawNombre = request.headers.get('x-user-nombre');
  let nombre: string | null = null;
  try { nombre = rawNombre ? decodeURIComponent(rawNombre) : null; } catch { nombre = rawNombre; }
  let negocioId = negocioIdEnRuta;
  if (negocioId == null && tareaId != null) {
    const [rows] = await pool.query(`SELECT negocio_id FROM compras_tarea WHERE id = ? LIMIT 1`, [tareaId]) as any;
    negocioId = (rows as any[])[0]?.negocio_id ?? null;
  }
  if (negocioId == null) return;
  const [neg] = await pool.query(`SELECT licitacion_codigo, licitacion_nombre FROM negocios WHERE id = ? LIMIT 1`, [negocioId]) as any;
  const n = (neg as any[])[0];
  const ruta = new URL(request.url).pathname;
  const texto = tareaId != null && negocioIdEnRuta == null
    ? (cuerpo?.estado ? `Cambió una tarea a «${String(cuerpo.estado).toLowerCase()}»` : 'Actualizó una tarea')
    : describirAccionCompras(metodo, ruta, cuerpo);
  await registrarEvento({
    tipo: 'COMPRAS_ACCION', licitacionCodigo: n?.licitacion_codigo ?? null, licitacionNombre: n?.licitacion_nombre ?? null,
    actorId: userId, actorNombre: nombre, mensaje: `${nombre || 'Alguien'}: ${texto}.`,
    metadata: { negocio_id: negocioId, metodo, ruta },
  });
}

/** Envuelve un handler de escritura (POST/PATCH/PUT/DELETE). Conserva exactamente la firma y la respuesta del original. */
export function conBitacoraCompras<F extends (...args: any[]) => Promise<Response | undefined>>(handler: F, metodo: 'POST' | 'PATCH' | 'PUT' | 'DELETE'): F {
  const envuelto = async (request: Request, ctx: any) => {
    let cuerpo: Cuerpo = null;
    if (metodo !== 'DELETE' && (request.headers.get('content-type') || '').includes('application/json')) {
      try { cuerpo = await request.clone().json(); } catch { cuerpo = null; }
    }
    const respuesta = await handler(request, ctx);
    if (respuesta && respuesta.status < 400) {
      void (async () => {
        const p = await Promise.resolve(ctx?.params).catch(() => null);
        const negocioId = p?.negocioId != null ? parseInt(p.negocioId) : null;
        const tareaId = p?.tareaId != null ? parseInt(p.tareaId) : null;
        await anotar(request, metodo, Number.isFinite(negocioId as number) ? negocioId : null, Number.isFinite(tareaId as number) ? tareaId : null, cuerpo);
      })().catch(e => console.error('[compras-bitacora]', String(e).slice(0, 200)));
    }
    return respuesta;
  };
  return envuelto as unknown as F;
}
