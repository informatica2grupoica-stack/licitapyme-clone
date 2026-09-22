// app/lib/compras-proyectos-obuma.ts
// "PROYECTOS" DE OBUMA — vista v1-only, sin acceso a v2.0 (Módulo de Proyectos real de Obuma:
// pide el header `access-url`, que la cuenta no tiene contratado — ver obuma.ts). No se puede leer
// el Proyecto en sí (nombre, ficha, estado), pero sí se puede reconstruir la agrupación: cada
// centro de costo (`contabilidadCentrosDeCostos.list.json`, v1) trae `rel_proyecto_id`, el ID del
// Proyecto de Obuma al que pertenece (hallazgo del 22-sep-2026, no documentado por Obuma). Varios
// centros de costo pueden compartir el mismo Proyecto (sub-proyectos/canastas).
//
// Esto arma, por cada Proyecto (agrupado por rel_proyecto_id), su gasto real total y si calza con
// alguna licitación/negocio nuestro — pedido explícito del usuario (22-sep-2026): "ver si tenemos
// lo mismo de Obuma... para hacer una comparación".
import pool from '@/app/lib/db';
import { centrosDeCostoCompleto, comprasOcCompleto, proveedoresObumaCompleto, type ObumaCentroCosto } from '@/app/lib/obuma';
import { mencionaCodigo } from '@/app/lib/ordenes-compra';

export interface NegocioCoincidente {
  negocioId: number;
  licitacionCodigo: string;
  licitacionNombre: string | null;
  centroCostoNombre: string;
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
  proyectoId: string;          // rel_proyecto_id real, o `centro-<id>` si el centro no tiene Proyecto asociado
  tieneProyectoReal: boolean;  // false = es un centro de costo suelto, sin rel_proyecto_id
  centros: { id: string; nombre: string; codigo: string; activo: boolean }[];
  totalGastado: number;
  cantidadOc: number;
  negociosCoincidentes: NegocioCoincidente[];
  ocs: OcDelProyecto[];        // detalle, hasta TOPE_OC_DETALLE (más recientes primero)
  ocsTruncadas: boolean;       // true si cantidadOc > ocs.length
  ultimaFecha: string | null;          // fecha de la OC más reciente del grupo — criterio de orden principal
  proyNumeroReferencia: number | null; // número "PROY-N" hallado en el nombre del centro de costo (o el
                                        // rel_proyecto_id si no hay patrón) — respaldo cuando no hay fecha
}

/** Número "PROY-N" (a veces con otro prefijo/formato) dentro del nombre de un centro de costo —
 *  se usa como referencia de antigüedad cuando el proyecto no tiene ninguna OC con fecha. Toma el
 *  número más alto encontrado en cualquiera de los nombres del grupo (más alto = más nuevo, mismo
 *  criterio que un correlativo). */
function numeroProyectoDeNombres(nombres: string[]): number | null {
  let max: number | null = null;
  for (const n of nombres) {
    const m = /PROY[^\d]{0,3}(\d+)/i.exec(n);
    if (m) { const v = Number(m[1]); if (max == null || v > max) max = v; }
  }
  return max;
}

// La reconstrucción completa (centros de costo + TODAS las OC de la cuenta, paginadas, + el
// catálogo de proveedores, también paginado) tarda varios segundos — no es una consulta liviana.
// Pedido explícito del usuario (22-sep-2026): "eso carga cada vez que entro, no lo quiero" — se
// cachea el resultado ya armado, mismo criterio que `centrosDeCostoCompleto`/`comprasOcCompleto`
// en obuma.ts. `forzar` se deja para un futuro botón "Actualizar" explícito.
let cacheProyectos: { en: number; datos: ProyectoObuma[] } | null = null;
const CACHE_PROYECTOS_MS = 5 * 60_000;

/** Agrupa los centros de costo de Obuma por Proyecto (rel_proyecto_id), suma sus OC reales, y
 *  marca qué licitaciones/negocios nuestros calzan (mismo matcher que ya usa el cruce OC-MP ↔
 *  Obuma, mencionaCodigo() — el código de licitación viene escrito en el NOMBRE del centro de
 *  costo). Ordenado por fecha de la OC más reciente del proyecto (el más recién movido primero);
 *  si no tiene ninguna OC con fecha, se ordena por el número "PROY-N" de referencia, el más alto
 *  primero (pedido explícito del usuario, 22-sep-2026). */
export async function listarProyectosObuma(forzar = false): Promise<ProyectoObuma[]> {
  if (!forzar && cacheProyectos && Date.now() - cacheProyectos.en < CACHE_PROYECTOS_MS) return cacheProyectos.datos;
  const [centros, ocs, negociosRows, proveedores] = await Promise.all([
    centrosDeCostoCompleto(),
    comprasOcCompleto(),
    pool.query(
      `SELECT id, licitacion_codigo, licitacion_nombre FROM negocios
        WHERE activo = TRUE AND licitacion_codigo IS NOT NULL AND licitacion_codigo <> ''`,
    ).then(([r]) => r as { id: number; licitacion_codigo: string; licitacion_nombre: string | null }[]),
    proveedoresObumaCompleto(),
  ]);
  const proveedorPorId = new Map(proveedores.map(p => [String(p.proveedor_id), { nombre: p.proveedor_razon_social, rut: p.proveedor_rut }]));

  const grupos = new Map<string, ObumaCentroCosto[]>();
  for (const c of centros) {
    const key = c.relProyectoId || `centro-${c.id}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(c);
  }

  const resultado: ProyectoObuma[] = [];
  for (const [proyectoId, grupo] of grupos) {
    const ids = new Set(grupo.map(c => c.id));
    const ocsDelGrupo = ocs.filter(oc => ids.has(String(oc.compra_oc_centro_costo)));
    const totalGastado = ocsDelGrupo.reduce((s, oc) => s + (Number(oc.compra_oc_total) || 0), 0);

    const vistos = new Set<number>();
    const negociosCoincidentes: NegocioCoincidente[] = [];
    for (const c of grupo) {
      if (!c.nombre) continue;
      for (const n of negociosRows) {
        if (vistos.has(n.id)) continue;
        if (mencionaCodigo(c.nombre, n.licitacion_codigo)) {
          vistos.add(n.id);
          negociosCoincidentes.push({
            negocioId: n.id, licitacionCodigo: n.licitacion_codigo,
            licitacionNombre: n.licitacion_nombre, centroCostoNombre: c.nombre,
          });
        }
      }
    }

    const ordenadas = [...ocsDelGrupo].sort((a, b) => String(b.compra_oc_fecha_ingreso || '').localeCompare(String(a.compra_oc_fecha_ingreso || '')));
    const ocsDetalle: OcDelProyecto[] = ordenadas.slice(0, TOPE_OC_DETALLE).map(oc => {
      const prov = proveedorPorId.get(String(oc.rel_proveedor_id));
      return {
        compraOcId: oc.compra_oc_id, folio: oc.compra_oc_folio || null,
        fecha: oc.compra_oc_fecha_ingreso || null, estado: oc.compra_oc_estado || null,
        proveedorNombre: prov?.nombre || null, proveedorRut: prov?.rut || null,
        total: Number(oc.compra_oc_total) || 0,
      };
    });

    const tieneProyectoReal = !proyectoId.startsWith('centro-');
    resultado.push({
      proyectoId, tieneProyectoReal,
      centros: grupo.map(c => ({ id: c.id, nombre: c.nombre, codigo: c.codigo, activo: c.activo })),
      totalGastado, cantidadOc: ocsDelGrupo.length, negociosCoincidentes,
      ocs: ocsDetalle, ocsTruncadas: ocsDelGrupo.length > ocsDetalle.length,
      ultimaFecha: ordenadas[0]?.compra_oc_fecha_ingreso || null,
      proyNumeroReferencia: numeroProyectoDeNombres(grupo.map(c => c.nombre))
        ?? (tieneProyectoReal ? Number(proyectoId) : null),
    });
  }

  // Criterio pedido: fecha de la OC más reciente primero; si no hay fecha, por el número "PROY-N"
  // de referencia (o el rel_proyecto_id si no hay patrón en el nombre), el más alto primero.
  resultado.sort((a, b) => {
    if (a.ultimaFecha && b.ultimaFecha) return b.ultimaFecha.localeCompare(a.ultimaFecha);
    if (a.ultimaFecha && !b.ultimaFecha) return -1;
    if (!a.ultimaFecha && b.ultimaFecha) return 1;
    const an = a.proyNumeroReferencia ?? -1;
    const bn = b.proyNumeroReferencia ?? -1;
    return bn - an;
  });

  cacheProyectos = { en: Date.now(), datos: resultado };
  return resultado;
}

// ── Proyectos REALES de Obuma (snapshot leído a mano de la web, migration-122) ──────────────────
// A diferencia de todo lo de arriba (reconstrucción v1 desde centros de costo, aproximada), esto
// lee el campo REFERENCIA real de la ficha del Proyecto en Obuma — mucho más confiable que buscar
// el código de licitación adentro del nombre de un centro de costo. No está en vivo: es una foto
// que se vuelve a cargar a mano cuando haga falta (ver scripts/scratch/importar-obuma-proyectos-reales.mjs).
export interface ProyectoRealObuma {
  folio: number; fechaIngreso: string | null; fechaInicio: string | null;
  nombre: string | null; referencia: string | null; cliente: string | null;
  presupuesto: number | null; costo: number | null; precioNeto: number | null;
  facturadoNeto: number | null; estado: string | null;
  negocioId: number | null; licitacionCodigo: string | null; licitacionNombre: string | null;
}

export async function listarProyectosRealesObuma(): Promise<{ proyectos: ProyectoRealObuma[]; capturadoAt: string | null }> {
  const [rows, negociosRows] = await Promise.all([
    pool.query(
      `SELECT folio, DATE_FORMAT(fecha_ingreso,'%Y-%m-%d') fecha_ingreso, DATE_FORMAT(fecha_inicio,'%Y-%m-%d') fecha_inicio,
              nombre, referencia, cliente, presupuesto, costo, precio_neto, facturado_neto, estado,
              DATE_FORMAT(capturado_at,'%Y-%m-%d %H:%i') capturado_at
         FROM obuma_proyectos_reales ORDER BY folio DESC`,
    ).then(([r]) => r as any[]),
    pool.query(
      `SELECT id, licitacion_codigo, licitacion_nombre FROM negocios
        WHERE activo = TRUE AND licitacion_codigo IS NOT NULL AND licitacion_codigo <> ''`,
    ).then(([r]) => r as { id: number; licitacion_codigo: string; licitacion_nombre: string | null }[]),
  ]);

  const proyectos: ProyectoRealObuma[] = rows.map(r => {
    let match: { id: number; licitacion_codigo: string; licitacion_nombre: string | null } | undefined;
    if (r.referencia) match = negociosRows.find(n => mencionaCodigo(r.referencia, n.licitacion_codigo));
    return {
      folio: r.folio, fechaIngreso: r.fecha_ingreso, fechaInicio: r.fecha_inicio,
      nombre: r.nombre, referencia: r.referencia, cliente: r.cliente,
      presupuesto: r.presupuesto != null ? Number(r.presupuesto) : null,
      costo: r.costo != null ? Number(r.costo) : null,
      precioNeto: r.precio_neto != null ? Number(r.precio_neto) : null,
      facturadoNeto: r.facturado_neto != null ? Number(r.facturado_neto) : null,
      estado: r.estado,
      negocioId: match?.id ?? null, licitacionCodigo: match?.licitacion_codigo ?? null,
      licitacionNombre: match?.licitacion_nombre ?? null,
    };
  });

  return { proyectos, capturadoAt: rows[0]?.capturado_at ?? null };
}
