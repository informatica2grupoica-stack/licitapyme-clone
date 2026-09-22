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
  estado: string | null;            // ya mapeado a texto (Abierto/Cerrado/Cancelado/Rechazado/En proceso), o null si no tiene ficha
  fechaIngreso: string | null;      // fecha/hora real de creación del Proyecto en Obuma (para mostrar, cortada a fecha en la UI)
  fechaInicio: string | null;
  centros: { id: string; nombre: string; codigo: string; activo: boolean }[];
  totalGastado: number;             // suma de órdenes de compra (comprasOc)
  cantidadOc: number;
  totalFacturado: number;           // suma de facturas/compras reales (compras.list.json)
  cantidadFacturas: number;
  negociosCoincidentes: NegocioCoincidente[];
  ocs: OcDelProyecto[];
  ocsTruncadas: boolean;
  ordenFecha: string | null;        // criterio real de orden: fecha de creación del Proyecto (si tiene ficha), si no la OC más reciente
}

export interface MetaProyectosObuma {
  totalReportadoPorObuma: number | null; // lo que Obuma dice tener en ext-proyectos.list.json (data-total-items)
  totalConFicha: number;                 // los que de verdad se lograron traer y armar
  completo: boolean;                     // totalConFicha === totalReportadoPorObuma (o no se pudo confirmar)
  fuentesConError: string[];             // qué fuentes fallaron esta corrida (la función sigue funcionando igual, con menos datos)
}

let cacheProyectos: { en: number; datos: ProyectoObuma[]; meta: MetaProyectosObuma } | null = null;
const CACHE_PROYECTOS_MS = 5 * 60_000;

/** Trae una fuente de Obuma con tolerancia a fallos — si UNA falla (rate limit, timeout, Obuma
 *  caído un rato), el resto de la pantalla sigue funcionando con lo que sí se pudo traer, en vez de
 *  romper toda la carga por un solo endpoint. Pedido explícito del usuario (22-sep-2026: "hazlo más
 *  robusto"). Cada fallo se anota en `fuentesConError` para que quede visible, no silencioso. */
async function conTolerancia<T>(nombre: string, fn: () => Promise<T>, valorPorDefecto: T, errores: string[]): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    console.warn(`[compras-proyectos-obuma] fuente "${nombre}" falló, sigue con datos parciales:`, String(e?.message || e).slice(0, 200));
    errores.push(nombre);
    return valorPorDefecto;
  }
}

/** Junta el Proyecto real (ext-proyectos.list.json) con sus centros de costo (mismo `proyecto_id` =
 *  `rel_proyecto_id`), sus OC (comprasOc) y sus facturas reales (compras.list.json) — todo por API,
 *  sin login. Los centros de costo sin Proyecto asociado (ej. "TECNOMAQ", "ADMINISTRACION" — gasto
 *  general de la empresa, no un proyecto puntual) siguen apareciendo, como entradas sin ficha.
 *  Orden: fecha de CREACIÓN del Proyecto, la más nueva primero (pedido explícito del usuario,
 *  22-sep-2026); los que no tienen ficha (centros sueltos) se ordenan por su última OC. */
export async function listarProyectosObuma(forzar = false): Promise<{ proyectos: ProyectoObuma[]; meta: MetaProyectosObuma }> {
  if (!forzar && cacheProyectos && Date.now() - cacheProyectos.en < CACHE_PROYECTOS_MS) {
    return { proyectos: cacheProyectos.datos, meta: cacheProyectos.meta };
  }

  const fuentesConError: string[] = [];
  const [centros, ocs, facturas, { datos: proyectosExt, totalReportado }, clientes, proveedores, negociosRows] = await Promise.all([
    conTolerancia('centros de costo', centrosDeCostoCompleto, [], fuentesConError),
    conTolerancia('órdenes de compra', comprasOcCompleto, [], fuentesConError),
    conTolerancia('facturas/compras', comprasCompleto, [], fuentesConError),
    conTolerancia('proyectos (ext-proyectos)', proyectosExtCompleto, { datos: [], totalReportado: null }, fuentesConError),
    conTolerancia('clientes', clientesObumaCompleto, [], fuentesConError),
    conTolerancia('proveedores', proveedoresObumaCompleto, [], fuentesConError),
    pool.query(
      `SELECT id, licitacion_codigo, licitacion_nombre FROM negocios
        WHERE activo = TRUE AND licitacion_codigo IS NOT NULL AND licitacion_codigo <> ''`,
    ).then(([r]) => r as { id: number; licitacion_codigo: string; licitacion_nombre: string | null }[])
      .catch(e => { console.warn('[compras-proyectos-obuma] negocios (BD) falló:', String(e).slice(0, 150)); fuentesConError.push('negocios (BD)'); return []; }),
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

    // Criterio de orden pedido explícito (22-sep-2026): fecha de CREACIÓN del proyecto, no de su
    // última actividad — un proyecto real ordena por cuándo se creó en Obuma. Los centros sin
    // ficha (sin fecha de creación propia) caen a la fecha de su OC más reciente.
    const ordenFecha = tieneProyectoReal ? ficha.fechaIngreso : (ordenadas[0]?.compra_oc_fecha_ingreso || null);

    return {
      proyectoId, tieneProyectoReal, folio: ficha.folio, nombre: ficha.nombre, referencia: ficha.referencia,
      cliente: ficha.cliente, presupuesto: ficha.presupuesto, costo: ficha.costo, precioNeto: ficha.precioNeto,
      facturadoMonto: ficha.facturadoMonto, estado: ficha.estado, fechaIngreso: ficha.fechaIngreso, fechaInicio: ficha.fechaInicio,
      centros: grupo.map(c => ({ id: c.id, nombre: c.nombre, codigo: c.codigo, activo: c.activo })),
      totalGastado, cantidadOc: ocsDelGrupo.length, totalFacturado, cantidadFacturas: facturasDelGrupo.length,
      negociosCoincidentes, ocs: ocsDetalle, ocsTruncadas: ocsDelGrupo.length > ocsDetalle.length, ordenFecha,
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
      fechaIngreso: p.proyecto_ingreso_fecha || null,
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
    if (a.ordenFecha && b.ordenFecha) return b.ordenFecha.localeCompare(a.ordenFecha);
    if (a.ordenFecha && !b.ordenFecha) return -1;
    if (!a.ordenFecha && b.ordenFecha) return 1;
    return (b.folio ?? -1) - (a.folio ?? -1);
  });

  const totalConFicha = resultado.filter(p => p.tieneProyectoReal).length;
  const meta: MetaProyectosObuma = {
    totalReportadoPorObuma: totalReportado,
    totalConFicha,
    completo: totalReportado == null ? fuentesConError.length === 0 : totalConFicha === totalReportado,
    fuentesConError,
  };

  cacheProyectos = { en: Date.now(), datos: resultado, meta };
  return { proyectos: resultado, meta };
}
