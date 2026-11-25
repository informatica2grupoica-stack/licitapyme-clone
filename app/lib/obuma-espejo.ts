// Espejo de Obuma en nuestra BD (tabla obuma_registro, migration-209). Sin IA: solo API de Obuma → BD.
// Cada pasada baja el listado completo de una entidad (limit 1000 por página: toda la cuenta son ~75 llamadas, el límite es 1.500/día POR MÉTODO)
// y hace upsert por (cliente_id, entidad, obuma_id). Se usa el listado completo y no `fecha_desde` porque ese filtro omite registros (ver docs/memoria/obuma-api.md)
// y así también se reflejan los cambios de estado, pagos y anulaciones de documentos viejos.
import pool from '@/app/lib/db';
import { listarObumaCrudo, obumaCrudoPorId } from '@/app/lib/obuma';
import { createHash } from 'crypto';

type Fila = Record<string, unknown>;
interface Mapa {
  endpoint: string;
  id: string;
  tipo?: string; folio?: string; fecha?: string; contraparteId?: string; rut?: string; nombre?: string;
  neto?: string; iva?: string; total?: string; pagado?: string; estado?: string | ((f: Fila) => string);
  centroCosto?: string; referencia?: string; relDoc?: string;
  limite?: number; // filas por página; por defecto 1000 (comprasPagos solo entrega 500 y sus páginas son de 500)
}

export const ENTIDADES_OBUMA: Record<string, Mapa> = {
  cliente:     { endpoint: 'clientes', id: 'cliente_id', rut: 'cliente_rut', nombre: 'cliente_razon_social', fecha: 'cliente_created_at', estado: f => (String(f.cliente_activo) === '1' ? 'ACTIVO' : 'INACTIVO'), centroCosto: 'cliente_centro_costo', contraparteId: 'cliente_id' },
  proveedor:   { endpoint: 'proveedores', id: 'proveedor_id', rut: 'proveedor_rut', nombre: 'proveedor_razon_social', fecha: 'proveedor_created_at', estado: f => (String(f.proveedor_activo) === '1' ? 'ACTIVO' : 'INACTIVO'), centroCosto: 'proveedor_centro_costo', contraparteId: 'proveedor_id' },
  producto:    { endpoint: 'productos', id: 'producto_id', folio: 'producto_codigo_comercial', nombre: 'producto_nombre', fecha: 'producto_fecha_actualizacion', neto: 'producto_precio_clp_neto', total: 'producto_precio_clp_total', estado: f => (String(f.producto_activo) === '1' ? 'ACTIVO' : 'INACTIVO'), centroCosto: 'producto_centro_costo', contraparteId: 'rel_proveedor_id' },
  compra_oc:   { endpoint: 'comprasOc', id: 'compra_oc_id', folio: 'compra_oc_folio', fecha: 'compra_oc_fecha_ingreso', contraparteId: 'rel_proveedor_id', neto: 'compra_oc_neto', iva: 'compra_oc_iva', total: 'compra_oc_total', estado: 'compra_oc_estado', centroCosto: 'compra_oc_centro_costo', referencia: 'compra_oc_referencia', relDoc: 'rel_factura_id' },
  compra:      { endpoint: 'compras', id: 'compra_id', tipo: 'compra_tipo_dcto', folio: 'compra_folio', fecha: 'compra_fechaingreso', contraparteId: 'rel_proveedor_id', neto: 'compra_neto', iva: 'compra_iva', total: 'compra_total', pagado: 'compra_total_pagado', estado: f => (String(f.compra_anulada) === '1' ? 'ANULADA' : 'VIGENTE'), centroCosto: 'compra_centro_costo', referencia: 'compra_observacion' },
  gasto:       { endpoint: 'comprasGastos', id: 'compra_id', tipo: 'compra_tipo_dcto', folio: 'compra_folio', fecha: 'compra_fechaingreso', contraparteId: 'rel_proveedor_id', neto: 'compra_neto', iva: 'compra_iva', total: 'compra_total', pagado: 'compra_total_pagado', estado: f => (String(f.compra_anulada) === '1' ? 'ANULADA' : 'VIGENTE'), centroCosto: 'compra_centro_costo', referencia: 'compra_observacion' },
  compra_dte:  { endpoint: 'comprasDte', id: 'dte_id', tipo: 'dte_tipo', folio: 'dte_folio', fecha: 'dte_fecha', contraparteId: 'rel_proveedor_id', rut: 'dte_rut_emisor', nombre: 'dte_razonsocial_emisor', neto: 'dte_total_neto', iva: 'dte_total_iva', total: 'dte_total', relDoc: 'rel_compra_id', referencia: 'dte_observacion' },
  pago_compra: { endpoint: 'comprasPagos', limite: 500, id: 'cp_id', fecha: 'cp_fecha_ingreso', contraparteId: 'rel_proveedor_id', total: 'cp_total', pagado: 'cp_pagado', estado: 'cp_origen_nombre', referencia: 'cp_detalle', relDoc: 'rel_compra_id' },
  venta:       { endpoint: 'ventas', id: 'venta_id', tipo: 'venta_tipo_dcto', folio: 'venta_nro_dcto', fecha: 'venta_fecha_ingreso', contraparteId: 'rel_cliente_id', neto: 'venta_neto', iva: 'venta_iva', total: 'venta_total', pagado: 'venta_total_pagado', estado: f => (String(f.venta_anulada) === '1' || String(f.venta_guia_anulada) === '1' ? 'ANULADA' : String(f.venta_estado || 'VIGENTE')), centroCosto: 'venta_centro_costo', referencia: 'venta_observacion' },
  cobro_venta: { endpoint: 'ventasCobros', id: 'vp_id', fecha: 'vp_fecha_ingreso', contraparteId: 'rel_cliente_id', total: 'vp_total', pagado: 'vp_pagado', estado: 'vp_origen_nombre', referencia: 'vp_detalle', relDoc: 'rel_venta_id' },
};

const txt = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fechaSql = (v: unknown): string | null => {
  const s = txt(v, 30);
  if (!s || s.startsWith('0000')) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/);
  if (m) return `${m[1]} ${m[2] || '00:00:00'}`;
  const d = s.match(/^(\d{2})-(\d{2})-(\d{4})(?:[ T](\d{2}:\d{2}:\d{2}))?/); // compras y gastos: «25-11-2026 14:37:08»
  return d ? `${d[3]}-${d[2]}-${d[1]} ${d[4] || '00:00:00'}` : null;
};

export interface ResultadoEspejo { entidad: string; modo: 'rapido' | 'completo'; totalObuma: number | null; filasLocal: number; nuevas: number; cambiadas: number; refrescadas: number; llamadas: number; error?: string }

// Entidades que Obuma entrega de la MÁS NUEVA a la más vieja (verificado 2026-11-25): en modo rápido se leen páginas hasta la primera sin novedades.
const NUEVO_PRIMERO = new Set(['compra', 'compra_oc', 'compra_dte', 'gasto', 'pago_compra', 'venta', 'cobro_venta']);
// Un pago/cobro nuevo cambia el «pagado» de su documento, que puede ser viejo y no estar en las primeras páginas: se vuelve a pedir ESE documento (findById).
const REFRESCA: Record<string, { endpoint: string; destinos: string[] }> = {
  pago_compra: { endpoint: 'compras', destinos: ['compra', 'gasto'] },
  cobro_venta: { endpoint: 'ventas', destinos: ['venta'] },
};
const MAX_REFRESCOS = 80;

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

function valoresDe(m: Mapa, entidad: string, clienteId: number, f: Fila) {
  const e = typeof m.estado === 'function' ? m.estado(f) : m.estado ? f[m.estado] : null;
  return [
    clienteId, entidad, String(f[m.id]), txt(m.tipo ? f[m.tipo] : null, 10), txt(m.folio ? f[m.folio] : null, 40), fechaSql(m.fecha ? f[m.fecha] : null),
    txt(m.contraparteId ? f[m.contraparteId] : null, 40), txt(m.rut ? f[m.rut] : null, 20), txt(m.nombre ? f[m.nombre] : null, 300),
    num(m.neto ? f[m.neto] : null), num(m.iva ? f[m.iva] : null), num(m.total ? f[m.total] : null), num(m.pagado ? f[m.pagado] : null),
    txt(e, 60), txt(m.centroCosto ? f[m.centroCosto] : null, 40), txt(m.referencia ? f[m.referencia] : null, 400), txt(m.relDoc ? f[m.relDoc] : null, 40),
    JSON.stringify(f),
  ];
}

async function guardar(valores: unknown[][]) {
  if (!valores.length) return;
  await pool.query(
    `INSERT INTO obuma_registro (cliente_id, entidad, obuma_id, tipo_dcto, folio, fecha, contraparte_id, contraparte_rut, contraparte_nombre, neto, iva, total, pagado, estado, centro_costo, referencia, rel_documento_id, raw_json)
     VALUES ? ON DUPLICATE KEY UPDATE tipo_dcto=VALUES(tipo_dcto), folio=VALUES(folio), fecha=VALUES(fecha), contraparte_id=VALUES(contraparte_id), contraparte_rut=VALUES(contraparte_rut),
       contraparte_nombre=VALUES(contraparte_nombre), neto=VALUES(neto), iva=VALUES(iva), total=VALUES(total), pagado=VALUES(pagado), estado=VALUES(estado), centro_costo=VALUES(centro_costo),
       referencia=VALUES(referencia), rel_documento_id=VALUES(rel_documento_id), raw_json=VALUES(raw_json), sincronizado_en=NOW()`,
    [valores],
  );
}

/**
 * Sincroniza UNA entidad de Obuma con la BD.
 *  · 'rapido' (el del cron diario): en las entidades «nuevo primero» lee páginas desde la más nueva y se detiene en la primera página SIN novedades
 *    (día tranquilo = 1 llamada por entidad); además refresca solo los documentos tocados por pagos/cobros nuevos que aún no estén pagados del todo.
 *    Las entidades chicas (clientes, proveedores, productos) se leen completas (2–3 llamadas) porque Obuma no las ordena por novedad.
 *  · 'completo': baja todo el listado (primera carga o reconciliación manual).
 * Todo lo NUEVO que llegue de Obuma siempre se guarda. Lo viejo y ya pagado/anulado no se vuelve a leer en modo rápido.
 */
export async function sincronizarEntidadObuma(entidad: string, clienteId = 1, modo: 'rapido' | 'completo' = 'rapido', maxPaginas = 60, esperaMs = 400): Promise<ResultadoEspejo> {
  const m = ENTIDADES_OBUMA[entidad];
  if (!m) throw new Error(`Entidad de Obuma desconocida: ${entidad}`);
  const parar = modo === 'rapido' && NUEVO_PRIMERO.has(entidad);
  let totalObuma: number | null = null, llamadas = 0, vistas = 0, nuevas = 0, cambiadas = 0, refrescadas = 0, error: string | undefined;
  const tocados = new Set<string>();
  try {
    for (let page = 1; page <= maxPaginas; page++) {
      const r = await listarObumaCrudo(m.endpoint, { limit: m.limite ?? 1000, page });
      llamadas++;
      if (r['data-total-items'] != null) totalObuma = Number(r['data-total-items']);
      const lote = r.data || [];
      let novedadesPagina = 0;
      if (lote.length) {
        const ids = lote.map(f => String(f[m.id]));
        const [prev]: any = await pool.query('SELECT obuma_id, MD5(raw_json) h FROM obuma_registro WHERE cliente_id = ? AND entidad = ? AND obuma_id IN (?)', [clienteId, entidad, ids]);
        const previo = new Map<string, string>(prev.map((p: any) => [String(p.obuma_id), String(p.h)]));
        const aGuardar: unknown[][] = [];
        for (const f of lote) {
          const v = valoresDe(m, entidad, clienteId, f);
          const antes = previo.get(String(v[2]));
          if (antes === md5(String(v[17]))) continue;      // idéntico a lo guardado: no se toca
          if (antes === undefined) nuevas++; else cambiadas++;
          novedadesPagina++;
          aGuardar.push(v);
          if (REFRESCA[entidad] && m.relDoc && f[m.relDoc]) tocados.add(String(f[m.relDoc]));
        }
        await guardar(aGuardar);
      }
      vistas += lote.length;
      // Algunos listados (comprasPagos) entregan menos filas por página que el limit pedido y «data-total-pages» se calcula con el limit pedido:
      // se corta por filas vistas / página vacía, no por número de páginas.
      if (lote.length === 0 || (totalObuma != null && vistas >= totalObuma)) break;
      if (parar && novedadesPagina === 0) break;
      await new Promise(res => setTimeout(res, esperaMs));
    }

    // Documentos viejos cuyo pago/cobro acaba de llegar: se vuelven a pedir uno a uno (solo los que no estaban pagados del todo, o que aún no tenemos).
    const ref = REFRESCA[entidad];
    if (ref && tocados.size) {
      const lista = [...tocados];
      const [guardados]: any = await pool.query(
        `SELECT entidad, obuma_id, (pagado IS NULL OR total IS NULL OR pagado < total) AND (estado IS NULL OR estado <> 'ANULADA') AS abierto
           FROM obuma_registro WHERE cliente_id = ? AND entidad IN (?) AND obuma_id IN (?)`, [clienteId, ref.destinos, lista]);
      const porId = new Map<string, { entidad: string; abierto: boolean }>(guardados.map((g: any) => [String(g.obuma_id), { entidad: String(g.entidad), abierto: Number(g.abierto) === 1 }]));
      const pedir = lista.filter(id => !porId.has(id) || porId.get(id)!.abierto).slice(0, MAX_REFRESCOS);
      for (const id of pedir) {
        const f = await obumaCrudoPorId(ref.endpoint, id); llamadas++;
        if (f) {
          const destino = porId.get(id)?.entidad ?? ref.destinos[0];   // compra o gasto según dónde lo teníamos (si es nuevo, compra)
          await guardar([valoresDe(ENTIDADES_OBUMA[destino], destino, clienteId, f)]);
          refrescadas++;
        }
        await new Promise(res => setTimeout(res, esperaMs));
      }
    }
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  const [[c]]: any = await pool.query('SELECT COUNT(*) n FROM obuma_registro WHERE cliente_id = ? AND entidad = ?', [clienteId, entidad]);
  await pool.query(
    `INSERT INTO obuma_sync_estado (cliente_id, entidad, total_obuma, filas_local, llamadas, ultima_sync, ultimo_error) VALUES (?,?,?,?,?,NOW(),?)
     ON DUPLICATE KEY UPDATE total_obuma=VALUES(total_obuma), filas_local=VALUES(filas_local), llamadas=VALUES(llamadas), ultima_sync=NOW(), ultimo_error=VALUES(ultimo_error)`,
    [clienteId, entidad, totalObuma, c.n, llamadas, error ? error.slice(0, 500) : null],
  );
  return { entidad, modo, totalObuma, filasLocal: c.n, nuevas, cambiadas, refrescadas, llamadas, error };
}
