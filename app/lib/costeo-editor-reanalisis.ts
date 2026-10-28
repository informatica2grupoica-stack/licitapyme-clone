// Al terminar un (re)análisis de viabilidad, el costeo digital guardado de cada negocio de esa
// licitación se pone al día solo — decisión del dueño (28-oct-2026, 3712-74-LP26), que reemplaza la
// del 27-oct («re-viabilidad no toca el costeo»). Agrega los productos nuevos y reubica líneas
// (fusionarConViabilidad, lo mismo que el botón «Actualizar») y corrige nombre y cantidad de los que
// ya están si el documento cambió y nadie los tocó (corregirDesdeViabilidad). Nunca borra filas ni
// toca precios, links, SKU, costo real ni recargos: las filas que la viabilidad ya no trae se siguen
// quitando con «Actualizar». No crea versión (eso es del equipo al guardar) y deja huella en el
// registro de cambios del editor. Deja las filas en el orden del documento (ordenarComoViabilidad).
// Un negocio ya postulado (congelado) no se toca.
import pool from '@/app/lib/db';
import { ahoraChileSQL } from '@/app/lib/tz';
import { adaptarViabilidadACosteo } from '@/app/lib/generar-costeo';
import { datosCosteoAEditor, fusionarConViabilidad, corregirDesdeViabilidad, ordenarComoViabilidad, resumenCambiosCosteo, MARGEN_VENTA_DEFECTO, type EstadoCosteoEditor } from '@/app/lib/costeo-editor';
import { yaCongelado } from '@/app/lib/congelamiento';
import { registrarEvento } from '@/app/lib/historial';

export const ACTOR_REANALISIS = 'Re-análisis de viabilidad';

function estadoDeInforme(codigo: string, informe: any): EstadoCosteoEditor | null {
  if (!informe) return null;
  const datos = adaptarViabilidadACosteo(codigo, informe);
  return datos.grupos.some(g => g.items.length > 0) ? datosCosteoAEditor(datos) : null;
}

export async function actualizarCosteosTrasReanalisis(codigo: string, informeAnterior: any, informeNuevo: any): Promise<void> {
  const nuevo = estadoDeInforme(codigo, informeNuevo);
  if (!nuevo) return;
  const anterior = estadoDeInforme(codigo, informeAnterior);
  const [rows] = await pool.query(
    `SELECT e.negocio_id, e.modalidad, e.datos_json FROM negocio_costeo_editor e
       JOIN negocios n ON n.id = e.negocio_id WHERE n.licitacion_codigo = ?`, [codigo]) as any;
  for (const row of rows as any[]) {
    try {
      if (await yaCongelado(row.negocio_id)) continue;
      const datos = typeof row.datos_json === 'string' ? JSON.parse(row.datos_json) : row.datos_json;
      const actual: EstadoCosteoEditor = {
        modalidad: row.modalidad, margenVenta: Number(datos?.margenVenta) || MARGEN_VENTA_DEFECTO,
        grupos: (datos?.grupos || []).map((g: any) => ({ ...g, ofertamos: g.ofertamos !== false })),
      };
      const f = fusionarConViabilidad(actual, nuevo);
      const c = corregirDesdeViabilidad(f.estado, nuevo, anterior);
      const o = ordenarComoViabilidad(c.estado, nuevo);
      if (!f.agregados && !f.reclasificados && !c.corregidos && !o.reordenados) continue;
      const cambios = resumenCambiosCosteo(actual, o.estado);
      await pool.query(
        `UPDATE negocio_costeo_editor SET datos_json = ?, actualizado_por = NULL, actualizado_por_nombre = ?, actualizado_at = ? WHERE negocio_id = ?`,
        [JSON.stringify(o.estado), ACTOR_REANALISIS, ahoraChileSQL(), row.negocio_id]);
      const partes = [f.agregados && `${f.agregados} producto(s) nuevo(s)`, f.reclasificados && `${f.reclasificados} reubicado(s) de línea`, c.corregidos && `${c.corregidos} corregido(s) en nombre o cantidad`, o.reordenados && `${o.reordenados} fila(s) ordenada(s) como el anexo económico`].filter(Boolean);
      await registrarEvento({
        tipo: 'COSTEO_ACTUALIZADO_VIABILIDAD', licitacionCodigo: codigo, actorNombre: ACTOR_REANALISIS,
        mensaje: `El costeo se actualizó con el re-análisis de viabilidad: ${partes.join(', ')}.`.slice(0, 500),
        metadata: { negocio_id: row.negocio_id, cambios, agregados: f.agregados, reclasificados: f.reclasificados, corregidos: c.corregidos, reordenados: o.reordenados },
      });
      console.log(`[costeo-reanalisis] ${codigo} negocio ${row.negocio_id}: ${partes.join(', ')}.`);
    } catch (e) {
      console.error(`[costeo-reanalisis] ${codigo} negocio ${row.negocio_id}: no se pudo actualizar el costeo:`, String(e).slice(0, 200));
    }
  }
}
