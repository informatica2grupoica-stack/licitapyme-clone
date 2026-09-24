// app/lib/auditor-comparador-db.ts
// Lectura mínima de las causales de inadmisibilidad de una línea, para el bloqueo de "Aprobar
// línea" (comercial/route.ts). Vive aparte de comparador/route.ts para no crear un ciclo de
// imports entre rutas. Devuelve null cuando la línea nunca pasó por el comparador de fichas (o la
// migración 127 no está aplicada): ahí el flujo de siempre no cambia.
import pool from '@/app/lib/db';
import {
  parseAnalisis, criticidadP4, ambitoDe, certificadoAdmisibilidad, type CausalAdmisibilidad, type FilaComparador,
} from '@/app/lib/auditor-comparador-core';

export async function causalesAbiertasDeLinea(itemId: number, criticidadLinea: string | null): Promise<CausalAdmisibilidad[] | null> {
  let rows: any[];
  try {
    [rows] = await pool.query(
      `SELECT id, descripcion, tipo, valor_requerido_texto, valor_requerido_numero, valor_requerido_numero_max, unidad_requerida,
              valor_ofertado_numero, valor_convertido_numero, veredicto, pendiente_confirmacion_proveedor,
              fundamento_cita, origen, respuesta_manual, corregido_at, adjunto_url, analisis_json
         FROM checklist_comercial_caracteristicas WHERE item_id = ?`, [itemId]) as any;
  } catch { return null; }   // sin migración 72/127: el bloqueo nuevo no aplica
  const criticidad = criticidadP4(criticidadLinea);
  const filas = rows.map(r => {
    const analisis = parseAnalisis(r.analisis_json);
    return {
      ...r, pendiente_confirmacion_proveedor: !!r.pendiente_confirmacion_proveedor, respuesta_manual: !!r.respuesta_manual,
      valor_requerido_numero: r.valor_requerido_numero == null ? null : Number(r.valor_requerido_numero),
      valor_requerido_numero_max: r.valor_requerido_numero_max == null ? null : Number(r.valor_requerido_numero_max),
      valor_ofertado_numero: r.valor_ofertado_numero == null ? null : Number(r.valor_ofertado_numero),
      valor_convertido_numero: r.valor_convertido_numero == null ? null : Number(r.valor_convertido_numero),
      criticidad, analisis: { ...analisis, ambito: ambitoDe(r, analisis) },
    } as FilaComparador;
  });
  if (!filas.some(f => f.analisis.origen_dato)) return null;
  return certificadoAdmisibilidad(filas).filter(c => c.estado !== 'CUMPLIDA');
}
