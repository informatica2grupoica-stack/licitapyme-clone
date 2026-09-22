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
import { centrosDeCostoCompleto, comprasOcCompleto, type ObumaCentroCosto } from '@/app/lib/obuma';
import { mencionaCodigo } from '@/app/lib/ordenes-compra';

export interface NegocioCoincidente {
  negocioId: number;
  licitacionCodigo: string;
  licitacionNombre: string | null;
  centroCostoNombre: string;
}

export interface ProyectoObuma {
  proyectoId: string;          // rel_proyecto_id real, o `centro-<id>` si el centro no tiene Proyecto asociado
  tieneProyectoReal: boolean;  // false = es un centro de costo suelto, sin rel_proyecto_id
  centros: { id: string; nombre: string; codigo: string; activo: boolean }[];
  totalGastado: number;
  cantidadOc: number;
  negociosCoincidentes: NegocioCoincidente[];
}

/** Agrupa los centros de costo de Obuma por Proyecto (rel_proyecto_id), suma sus OC reales, y
 *  marca qué licitaciones/negocios nuestros calzan (mismo matcher que ya usa el cruce OC-MP ↔
 *  Obuma, mencionaCodigo() — el código de licitación viene escrito en el NOMBRE del centro de
 *  costo). Ordenado: primero los que calzan con algo nuestro, después por gasto descendente. */
export async function listarProyectosObuma(): Promise<ProyectoObuma[]> {
  const [centros, ocs, negociosRows] = await Promise.all([
    centrosDeCostoCompleto(),
    comprasOcCompleto(),
    pool.query(
      `SELECT id, licitacion_codigo, licitacion_nombre FROM negocios
        WHERE activo = TRUE AND licitacion_codigo IS NOT NULL AND licitacion_codigo <> ''`,
    ).then(([r]) => r as { id: number; licitacion_codigo: string; licitacion_nombre: string | null }[]),
  ]);

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

    resultado.push({
      proyectoId, tieneProyectoReal: !proyectoId.startsWith('centro-'),
      centros: grupo.map(c => ({ id: c.id, nombre: c.nombre, codigo: c.codigo, activo: c.activo })),
      totalGastado, cantidadOc: ocsDelGrupo.length, negociosCoincidentes,
    });
  }

  resultado.sort((a, b) => {
    const aMatch = a.negociosCoincidentes.length > 0 ? 1 : 0;
    const bMatch = b.negociosCoincidentes.length > 0 ? 1 : 0;
    if (aMatch !== bMatch) return bMatch - aMatch;
    return b.totalGastado - a.totalGastado;
  });

  return resultado;
}
