// app/lib/compras-proyectos-obuma.ts
// "PROYECTOS" DE OBUMA — hallazgo del 22-sep-2026 (soporte de Obuma, por correo, fuera de la doc
// pública): `/v1.0/ext-proyectos.list.json` expone el módulo real de Proyectos SIN pedir el header
// `access-url` de v2.0 que la cuenta no tiene contratado. Reemplaza por completo el intento anterior
// (reconstrucción aproximada por centro de costo + login-scraping de la web con las credenciales
// personales del usuario — ver obuma-proyectos-scraper.ts, ya no se usa). Con esto se cruza TODO en
// vivo, por API real, sin login: `proyecto_id` del Proyecto es el MISMO `rel_proyecto_id` que trae
// `contabilidadCentrosDeCostos.list.json` — confirmado en vivo (folio 155 → proyecto_id 30532,
// exactamente el ID que ya usaba la reconstrucción vieja) — así que ya no hace falta aproximar nada.
import pool from '@/app/lib/db';
import {
  centrosDeCostoCompleto, comprasOcCompleto, comprasCompleto, proyectosExtCompleto, clientesObumaCompleto,
  proveedoresObumaCompleto, ESTADOS_PROYECTO_OBUMA, type ObumaCentroCosto,
} from '@/app/lib/obuma';
import { mencionaCodigo } from '@/app/lib/ordenes-compra';

export interface NegocioCoincidente {
  negocioId: number; licitacionCodigo: string; licitacionNombre: string | null;
}

export interface OcDelProyecto {
  compraOcId: string; folio: string | null; fecha: string | null; estado: string | null;
  proveedorNombre: string | null; proveedorRut: string | null; total: number;
}

// Tope de OC que se listan en detalle por proyecto — hay centros de costo genéricos (ej. el propio
// nombre de la empresa) con miles de OC adentro; mostrarlas todas sería un payload enorme para una
// pantalla de comparación. El total/cantidad ya se cuentan sobre TODAS, esto es solo el detalle.
const TOPE_OC_DETALLE = 100;

export interface ProyectoObuma {
  proyectoId: string;               // proyecto_id real de Obuma, o `centro-<id>` si el centro no tiene Proyecto asociado
  tieneProyectoReal: boolean;       // true = viene de ext-proyectos.list.json (ficha real)
  folio: number | null;
  nombre: string | null;            // real (ficha) si tieneProyectoReal, si no null
  referencia: string | null;        // campo real "Referencia" de la ficha del Proyecto
  cliente: string | null;
  presupuesto: number | null;
  costo: number | null;
  precioNeto: number | null;
  facturadoMonto: number | null;
  estado: string | null;            // ya mapeado a texto (Abierto/Cerrado/Cancelado/Rechazado/En proceso)
  fechaIngreso: string | null;
  fechaInicio: string | null;
  centros: { id: string; nombre: string; codigo: string; activo: boolean }[];
  totalGastado: number;             // suma de órdenes de compra (comprasOc)
  cantidadOc: number;
  totalFacturado: number;           // suma de facturas/compras reales (compras.list.json)
  cantidadFacturas: number;
  negociosCoincidentes: NegocioCoincidente[];
  ocs: OcDelProyecto[];
  ocsTruncadas: boolean;
  ultimaFecha: string | null;       // criterio de orden: OC más reciente, o si no hay, fecha de ingreso del proyecto
}

let cacheProyectos: { en: number; datos: ProyectoObuma[] } | null = null;
const CACHE_PROYECTOS_MS = 5 * 60_000;

/** Junta el Proyecto real (ext-proyectos.list.json) con sus centros de costo (mismo `proyecto_id` =
 *  `rel_proyecto_id`), sus OC (comprasOc) y sus facturas reales (compras.list.json) — todo por API,
 *  sin login. Los centros de costo sin Proyecto asociado (ej. "TECNOMAQ", "ADMINISTRACION" — gasto
 *  general de la empresa, no un proyecto puntual) siguen apareciendo, como entradas sin ficha.
 *  Orden: la actividad más reciente primero (última OC, o si no tiene, la fecha de ingreso real del
 *  Proyecto) — pedido explícito del usuario, 22-sep-2026. */
export async function listarProyectosObuma(forzar = false): Promise<ProyectoObuma[]> {
  if (!forzar && cacheProyectos && Date.now() - cacheProyectos.en < CACHE_PROYECTOS_MS) return cacheProyectos.datos;

  const [centros, ocs, facturas, proyectosExt, clientes, proveedores, negociosRows] = await Promise.all([
    centrosDeCostoCompleto(),
    comprasOcCompleto(),
    comprasCompleto(),
    proyectosExtCompleto(),
    clientesObumaCompleto(),
    proveedoresObumaCompleto(),
    pool.query(
      `SELECT id, licitacion_codigo, licitacion_nombre FROM negocios
        WHERE activo = TRUE AND licitacion_codigo IS NOT NULL AND licitacion_codigo <> ''`,
    ).then(([r]) => r as { id: number; licitacion_codigo: string; licitacion_nombre: string | null }[]),
  ]);

  const clientePorId = new Map(clientes.map(c => [c.cliente_id, c.cliente_razon_social]));
  const proveedorPorIdMap = new Map(proveedores.map(p => [p.proveedor_id, { nombre: p.proveedor_razon_social, rut: p.proveedor_rut }]));
  const centrosPorProyectoId = new Map<string, ObumaCentroCosto[]>();
  const centrosSueltos: ObumaCentroCosto[] = [];
  for (const c of centros) {
    if (c.relProyectoId) {
      if (!centrosPorProyectoId.has(c.relProyectoId)) centrosPorProyectoId.set(c.relProyectoId, []);
      centrosPorProyectoId.get(c.relProyectoId)!.push(c);
    } else {
      centrosSueltos.push(c);
    }
  }

  function num(v: unknown): number | null {
    const n = Number(v);
    return Number.isFinite(n) && v !== '' && v !== '0' ? n : (v === '0' ? 0 : null);
  }

  function armarEntrada(
    proyectoId: string, tieneProyectoReal: boolean, grupo: ObumaCentroCosto[],
    ficha: { folio: number | null; nombre: string | null; referencia: string | null; cliente: string | null;
      presupuesto: number | null; costo: number | null; precioNeto: number | null; facturadoMonto: number | null;
      estado: string | null; fechaIngreso: string | null; fechaInicio: string | null },
  ): ProyectoObuma {
    const ids = new Set(grupo.map(c => c.id));
    const ocsDelGrupo = ids.size ? ocs.filter(oc => ids.has(String(oc.compra_oc_centro_costo))) : [];
    const totalGastado = ocsDelGrupo.reduce((s, oc) => s + (Number(oc.compra_oc_total) || 0), 0);
    const facturasDelGrupo = ids.size ? facturas.filter(f => ids.has(String(f.compra_centro_costo))) : [];
    const totalFacturado = facturasDelGrupo.reduce((s, f) => s + (Number(f.compra_total) || 0), 0);

    const vistos = new Set<number>();
    const negociosCoincidentes: NegocioCoincidente[] = [];
    const candidatosMatch = [ficha.referencia, ...grupo.map(c => c.nombre)].filter(Boolean) as string[];
    for (const texto of candidatosMatch) {
      for (const n of negociosRows) {
        if (vistos.has(n.id)) continue;
        if (mencionaCodigo(texto, n.licitacion_codigo)) {
          vistos.add(n.id);
          negociosCoincidentes.push({ negocioId: n.id, licitacionCodigo: n.licitacion_codigo, licitacionNombre: n.licitacion_nombre });
        }
      }
    }

    const ordenadas = [...ocsDelGrupo].sort((a, b) => String(b.compra_oc_fecha_ingreso || '').localeCompare(String(a.compra_oc_fecha_ingreso || '')));
    const ocsDetalle: OcDelProyecto[] = ordenadas.slice(0, TOPE_OC_DETALLE).map(oc => {
      const prov = proveedorPorIdMap.get(String(oc.rel_proveedor_id));
      return {
        compraOcId: oc.compra_oc_id, folio: oc.compra_oc_folio || null,
        fecha: oc.compra_oc_fecha_ingreso || null, estado: oc.compra_oc_estado || null,
        proveedorNombre: prov?.nombre || null, proveedorRut: prov?.rut || null, total: Number(oc.compra_oc_total) || 0,
      };
    });

    const ultimaFecha = ordenadas[0]?.compra_oc_fecha_ingreso || ficha.fechaIngreso || null;

    return {
      proyectoId, tieneProyectoReal, folio: ficha.folio, nombre: ficha.nombre, referencia: ficha.referencia,
      cliente: ficha.cliente, presupuesto: ficha.presupuesto, costo: ficha.costo, precioNeto: ficha.precioNeto,
      facturadoMonto: ficha.facturadoMonto, estado: ficha.estado, fechaIngreso: ficha.fechaIngreso, fechaInicio: ficha.fechaInicio,
      centros: grupo.map(c => ({ id: c.id, nombre: c.nombre, codigo: c.codigo, activo: c.activo })),
      totalGastado, cantidadOc: ocsDelGrupo.length, totalFacturado, cantidadFacturas: facturasDelGrupo.length,
      negociosCoincidentes, ocs: ocsDetalle, ocsTruncadas: ocsDelGrupo.length > ocsDetalle.length, ultimaFecha,
    };
  }

  const resultado: ProyectoObuma[] = [];
  const proyectoIdsVistos = new Set<string>();

  for (const p of proyectosExt) {
    const proyectoId = p.proyecto_id;
    proyectoIdsVistos.add(proyectoId);
    const grupo = centrosPorProyectoId.get(proyectoId) || [];
    resultado.push(armarEntrada(proyectoId, true, grupo, {
      folio: Number(p.proyecto_folio) || null, nombre: p.proyecto_nombre || null,
      referencia: p.proyecto_referencia || null, cliente: clientePorId.get(p.rel_cliente_id) || null,
      presupuesto: num(p.proyecto_presupuesto), costo: num(p.proyecto_costo), precioNeto: num(p.proyecto_valor),
      facturadoMonto: num(p.proyecto_facturado_monto), estado: ESTADOS_PROYECTO_OBUMA[p.proyecto_estado] || p.proyecto_estado || null,
      fechaIngreso: (p.proyecto_ingreso_fecha || '').slice(0, 10) || null,
      fechaInicio: p.proyecto_fecha_inicio && p.proyecto_fecha_inicio !== '0000-00-00' ? p.proyecto_fecha_inicio : null,
    }));
  }

  // Centros de costo con rel_proyecto_id que NO vino en ext-proyectos.list.json (proyecto borrado,
  // muy viejo, o de otra empresa vinculada a la misma cuenta) — igual se muestran, sin ficha.
  for (const [proyectoId, grupo] of centrosPorProyectoId) {
    if (proyectoIdsVistos.has(proyectoId)) continue;
    resultado.push(armarEntrada(proyectoId, false, grupo, {
      folio: null, nombre: null, referencia: null, cliente: null, presupuesto: null, costo: null,
      precioNeto: null, facturadoMonto: null, estado: null, fechaIngreso: null, fechaInicio: null,
    }));
  }

  // Centros de costo sueltos, sin ningún Proyecto asociado (gasto general de la empresa).
  for (const c of centrosSueltos) {
    resultado.push(armarEntrada(`centro-${c.id}`, false, [c], {
      folio: null, nombre: null, referencia: null, cliente: null, presupuesto: null, costo: null,
      precioNeto: null, facturadoMonto: null, estado: null, fechaIngreso: null, fechaInicio: null,
    }));
  }

  resultado.sort((a, b) => {
    if (a.ultimaFecha && b.ultimaFecha) return b.ultimaFecha.localeCompare(a.ultimaFecha);
    if (a.ultimaFecha && !b.ultimaFecha) return -1;
    if (!a.ultimaFecha && b.ultimaFecha) return 1;
    return (b.folio ?? -1) - (a.folio ?? -1);
  });

  cacheProyectos = { en: Date.now(), datos: resultado };
  return resultado;
}
