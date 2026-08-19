// app/lib/motor-comercial-recalculo.ts
// Recalcula las alertas del costeo VIGENTE de un negocio contra el estado ACTUAL del checklist.
//
// POR QUÉ EXISTE (19-ago-2026, caso real 3489-29-LP26): las alertas se calculaban UNA sola vez, al
// subir el costeo, y quedaban congeladas en la fila de `checklist_comercial_costeo`. Si después
// alguien corregía el precio ofertado en el checklist — que es exactamente lo que uno hace cuando
// la alerta le avisa — la alerta seguía mostrando la cifra vieja. El usuario veía:
//
//     "El anexo económico dice $181.422.753 pero el costeo suma $90.329.192"
//
// cuando el checklist ya decía $69.484.117 y el costeo $90.329.192: NINGUNO de los dos números de
// la alerta existía ya. Una alerta que cita cifras que no están en ninguna parte es peor que no
// tener alerta, porque manda a buscar un error donde no está.
//
// Se llama después de cualquier cambio de precio en el checklist. Es idempotente y barato: no
// vuelve a parsear el Excel salvo que haga falta el detalle por línea.
import pool from '@/app/lib/db';
import { parsearCosteo, calcularAlertasMotorComercial, type AlertaMotorComercial } from '@/app/lib/motor-comercial';

/**
 * Vuelve a calcular y guardar las alertas del costeo vigente. Devuelve las alertas nuevas, o null
 * si el negocio no tiene costeo cargado (ahí no hay nada que recalcular).
 *
 * `lineasPublicadas` y `lineasExcluidas` se pasan desde el llamador porque salen del informe de
 * viabilidad y del checklist, que este módulo no debe volver a leer.
 */
export async function recalcularAlertasCosteo(args: {
  negocioId: number;
  lineasPublicadas: Array<{ linea: number; cantidad: number | null; unidad: string | null; presupuestoLinea: number | null }>;
  lineasExcluidas?: Set<number>;
}): Promise<AlertaMotorComercial[] | null> {
  const { negocioId } = args;

  const [filasCosteo] = await pool.query(
    `SELECT id, archivo_url, presupuesto_publicado FROM checklist_comercial_costeo
      WHERE negocio_id = ? AND vigente = 1 LIMIT 1`,
    [negocioId],
  ) as any;
  const costeo = (filasCosteo as any[])[0];
  if (!costeo) return null;

  // El total ofertado SIEMPRE se lee de nuevo del checklist: es el dato que cambió y el motivo por
  // el que estamos recalculando.
  const [filasPrecio] = await pool.query(
    `SELECT valor_numero FROM checklist_comercial
      WHERE negocio_id = ? AND bloque = 'COMERCIAL' AND tipo = 'precio'
        AND (ofertamos IS NULL OR ofertamos = 1)`,
    [negocioId],
  ) as any;
  const valores = (filasPrecio as any[]).map(r => r.valor_numero).filter(v => v != null);
  const totalAnexoEconomico = valores.length ? valores.reduce((s: number, v: any) => s + Number(v), 0) : null;

  let filas: Awaited<ReturnType<typeof parsearCosteo>> = [];
  try {
    const res = await fetch(costeo.archivo_url);
    if (res.ok) filas = await parsearCosteo(Buffer.from(await res.arrayBuffer()));
  } catch {
    // Si el archivo no se puede bajar no se inventan alertas: se dejan las que había. Un fallo de
    // red no debe borrar el diagnóstico anterior ni fabricar uno nuevo.
    return null;
  }
  if (!filas.length) return null;

  const alertas = calcularAlertasMotorComercial({
    filas,
    totalAnexoEconomico,
    presupuestoPublicado: costeo.presupuesto_publicado != null ? Number(costeo.presupuesto_publicado) : null,
    lineasPublicadas: args.lineasPublicadas,
    lineasExcluidas: args.lineasExcluidas,
  });

  await pool.query(
    `UPDATE checklist_comercial_costeo SET alertas = ?, total_anexo_economico = ? WHERE id = ?`,
    [JSON.stringify(alertas), totalAnexoEconomico, costeo.id],
  );
  return alertas;
}
