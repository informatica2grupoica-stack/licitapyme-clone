// app/lib/compras-validacion-sugerida.ts
// PRE-RELLENO DE "VALIDACIÓN TÉCNICA REAL" DESDE EL AUDITOR TÉCNICO (24-sep-2026).
//
// El Auditor Técnico ya comparó, característica por característica, lo que piden las bases contra la
// ficha del producto ofertado (checklist_comercial + checklist_comercial_caracteristicas). La tarea
// de Compras pide confirmar justo eso —que la ficha es de un producto real y que el producto cotizado
// es el correcto— así que se propone el formulario ya armado con lo que el Auditor Técnico sabe.
//
// REGLA: solo se afirma lo que está respaldado. Un "Sí" sale únicamente si hay evidencia en el
// Auditor Técnico; si no la hay, el campo queda vacío y se dice por qué. No se adivina la marca ni el
// modelo (el Auditor Técnico no los guarda como dato): el producto se propone con el nombre de la
// línea y la persona lo completa. Es una SUGERENCIA — se revisa y se guarda a mano.
import pool from '@/app/lib/db';

export interface CaracteristicaAuditor {
  veredicto: string;                       // CUMPLE | NO_CUMPLE | CUMPLE_CON_COMPLEMENTO
  origen: string | null;                   // 'ficha' cuando salió de una ficha técnica cargada
  fundamentoDocumento: string | null;      // nombre del PDF que la respalda
  pendienteConfirmacionProveedor: boolean;
}
export interface LineaAuditor {
  titulo: string;                          // "Línea 1 — Luminancímetros"
  caracteristicas: CaracteristicaAuditor[];
}
export interface DatosSugerencia {
  lineas: LineaAuditor[];
  /** Dominios de los links del costeo (donde se cotizó el producto), sin duplicados. */
  sitiosDelCosteo: string[];
}

export interface SugerenciaValidacionTecnica {
  /** Campos del formulario que se proponen (solo los que tienen respaldo). */
  registro: Record<string, string>;
  /** Por qué faltan los que faltan — se le muestra a la persona. */
  avisos: string[];
  /** false = el Auditor Técnico no tiene nada útil para este negocio. */
  hayDatos: boolean;
}

const unicos = <T,>(xs: T[]) => [...new Set(xs)];

export function sugerirValidacionTecnica(d: DatosSugerencia): SugerenciaValidacionTecnica {
  const lineas = d.lineas.filter(l => l.caracteristicas.length > 0);
  if (lineas.length === 0) {
    return { registro: {}, avisos: ['El Auditor Técnico no tiene características evaluadas para este negocio: no hay nada que pre-rellenar.'], hayDatos: false };
  }
  const todas = lineas.flatMap(l => l.caracteristicas);
  const cumplen = todas.filter(c => c.veredicto === 'CUMPLE').length;
  const noCumplen = todas.filter(c => c.veredicto === 'NO_CUMPLE').length;
  const conComplemento = todas.filter(c => c.veredicto === 'CUMPLE_CON_COMPLEMENTO' || c.pendienteConfirmacionProveedor).length;
  const fichas = unicos(todas.filter(c => c.origen === 'ficha' && c.fundamentoDocumento).map(c => c.fundamentoDocumento as string));

  const registro: Record<string, string> = {};
  const avisos: string[] = [];

  // Producto: el nombre de la línea, sin el prefijo "Línea N —". La marca y el modelo no están en el
  // Auditor Técnico como dato, así que se le pide a la persona que los complete.
  registro.producto = lineas.map(l => l.titulo.replace(/^L[ií]nea\s+\d+\s*[—–-]\s*/i, '').trim()).join('; ');
  avisos.push('Completa la marca y el modelo en "Producto": el Auditor Técnico no los guarda como dato.');

  // Ficha real y fabricante: solo hay evidencia si alguna característica salió de una ficha cargada.
  if (fichas.length > 0) {
    registro.ficha_real = 'Sí';
    registro.fabricante = 'Sí';
  } else {
    avisos.push('No hay una ficha técnica cargada en el Auditor Técnico, así que "fabricante identificable" y "ficha real" quedan sin responder.');
  }

  // Producto correcto: solo si TODAS las características cumplen y nada quedó pendiente con el proveedor.
  if (noCumplen === 0 && conComplemento === 0 && cumplen === todas.length) {
    registro.producto_correcto = 'Sí';
  } else if (noCumplen > 0) {
    registro.producto_correcto = 'No';
    avisos.push(`${noCumplen} característica(s) NO cumplen según el Auditor Técnico: revisa antes de confirmar.`);
  } else {
    avisos.push(`${conComplemento} característica(s) cumplen solo con complemento o están pendientes de confirmar con el proveedor: "producto correcto" queda sin responder.`);
  }

  const fuentes: string[] = [];
  if (fichas.length) fuentes.push(`Ficha técnica: ${fichas.join(', ')}`);
  if (d.sitiosDelCosteo.length) fuentes.push(`Cotizado en: ${d.sitiosDelCosteo.join(', ')}`);
  if (fuentes.length) registro.fuente = fuentes.join(' · ');

  registro.observaciones =
    `Pre-rellenado desde el Auditor Técnico: ${cumplen} de ${todas.length} característica(s) CUMPLEN` +
    `${noCumplen ? `, ${noCumplen} NO cumplen` : ''}${conComplemento ? `, ${conComplemento} con complemento/pendientes` : ''}` +
    `${fichas.length ? ` (respaldo: ${fichas.join(', ')})` : ''}.`;

  return { registro, avisos, hayDatos: true };
}

const hostDe = (url: string): string | null => {
  try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, ''); } catch { return null; }
};

/** Lee lo que el Auditor Técnico y el costeo saben de este negocio. */
export async function cargarDatosSugerencia(negocioId: number): Promise<DatosSugerencia> {
  const [lineasRows] = await pool.query(
    `SELECT id, titulo FROM checklist_comercial
      WHERE negocio_id = ? AND bloque = 'TECNICO' AND tipo = 'linea_tecnica' AND (ofertamos IS NULL OR ofertamos <> 0)
      ORDER BY orden`,
    [negocioId],
  ) as any;
  const [carRows] = await pool.query(
    `SELECT item_id, veredicto, origen, fundamento_documento, pendiente_confirmacion_proveedor
       FROM checklist_comercial_caracteristicas WHERE negocio_id = ?`,
    [negocioId],
  ) as any;
  const porItem = new Map<number, CaracteristicaAuditor[]>();
  for (const r of carRows as any[]) {
    const arr = porItem.get(Number(r.item_id)) || [];
    arr.push({
      veredicto: String(r.veredicto || ''), origen: r.origen, fundamentoDocumento: r.fundamento_documento,
      pendienteConfirmacionProveedor: !!r.pendiente_confirmacion_proveedor,
    });
    porItem.set(Number(r.item_id), arr);
  }
  const lineas: LineaAuditor[] = (lineasRows as any[]).map(l => ({ titulo: String(l.titulo || ''), caracteristicas: porItem.get(Number(l.id)) || [] }));

  const sitios: string[] = [];
  try {
    const [costeo] = await pool.query(`SELECT datos_json FROM negocio_costeo_editor WHERE negocio_id = ? LIMIT 1`, [negocioId]) as any;
    const raw = (costeo as any[])[0]?.datos_json;
    const datos = typeof raw === 'string' ? JSON.parse(raw) : raw;
    for (const g of datos?.grupos || []) for (const f of g.filas || []) {
      if (f.agregadoPorCompras) continue; // un gasto extra no es un producto cotizado
      for (const l of [f.link1, f.link2, f.link3]) { const h = l ? hostDe(String(l)) : null; if (h) sitios.push(h); }
    }
  } catch { /* sin costeo: la sugerencia sale igual, sin "cotizado en" */ }

  return { lineas, sitiosDelCosteo: unicos(sitios) };
}
