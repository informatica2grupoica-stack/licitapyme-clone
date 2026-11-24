// app/lib/compras-auditoria-negocio.ts
// AUDITORÍA COMPLETA DE UNA COMPRA: qué se costeó, qué se cotizó (cotización elegida), qué se compró (OC) y qué se facturó,
// proveedor por proveedor, con la diferencia en pesos de cada paso y POR QUÉ se generó. Todo NETO (sin IVA).
// Solo lee: arma sobre `resumenComparativoCompra` (la misma fuente de la pestaña «Seguimiento · Comparativo»), así que las cifras
// de las dos pantallas no pueden separarse. Sin datos de ninguna empresa escritos aquí (multiempresa): todo sale de la BD del negocio.
import pool from '@/app/lib/db';
import { resumenComparativoCompra, type ResumenComparativo } from '@/app/lib/compras-resumen-comparativo';
import { resumenGastosCompra } from '@/app/lib/compras-oc-obuma';
import { listarProyectosObuma, type DocumentoDelProyecto } from '@/app/lib/compras-proyectos-obuma';

export type EtapaAuditoria = 'costeo-cotizado' | 'cotizado-oc' | 'oc-factura';
export interface Hallazgo {
  etapa: EtapaAuditoria;
  /** Dónde está la diferencia: producto · proveedor · OC o factura. */
  donde: string;
  /** Con signo: lo que hay en el paso nuevo menos lo del paso anterior. + = se pagó/gastó MÁS. */
  monto: number;
  texto: string;
  /** Qué hay que hacer para corregirlo (si corresponde). */
  accion?: string;
}
export interface LineaAuditoria {
  producto: string; cantidad: number;
  costeoUnit: number | null; cotizadoUnit: number | null; ocUnit: number | null;
  costeoNeto: number | null; cotizadoNeto: number | null; ocNeto: number | null;
  /** OC (folio) donde se compró, si se compró. */
  oc: string | null;
}
export interface FacturaAuditoria { folio: string | null; fecha: string | null; neto: number; enlazada: boolean; /** Tipo SII: 33 factura · 34 exenta · 56 nota de débito · 61 nota de crédito. */ tipo?: string }
export interface OcAuditoria {
  folio: string; estado: string | null; fecha: string | null; neto: number; facturadoNeto: number; facturas: FacturaAuditoria[];
  /** Lo que lleva esta OC, línea por línea. */
  lineas: { producto: string; cantidad: number | null; unit: number | null; neto: number | null }[];
}
/** Un producto del negocio: lo vendido, lo costeado, lo comprado, a quién y el margen que dejó. Todo neto. */
export interface ItemAuditoria {
  producto: string; cantidad: number | null; proveedor: string | null; oc: string | null;
  ventaNeto: number | null; costeoNeto: number | null; cotizadoNeto: number | null; compradoNeto: number | null;
  margen: number | null; margenPct: number | null;
}
export interface ProveedorAuditoria {
  proveedor: string;
  lineas: LineaAuditoria[];
  ocs: OcAuditoria[];
  costeoNeto: number; cotizadoNeto: number; ocNeto: number; facturadoNeto: number;
  hallazgos: Hallazgo[];
  /** Diferencia que ninguna causa explica (debería ser 0). */
  sinExplicar: { cotizadoOc: number; ocFactura: number };
}
export interface AuditoriaCompra {
  negocioId: number; codigo: string; nombre: string; organismo: string;
  generadoEn: string;
  proveedores: ProveedorAuditoria[];
  items: ItemAuditoria[];
  /** Resumen por etapa para el «puente» del informe. */
  puente: { venta: number; costeo: number; cotizado: number; oc: number; facturado: number; gastosExtra: number; margenNeto: number; margenPct: number | null };
  puentePorTipo: { etapa: EtapaAuditoria; monto: number; texto: string }[];
  /** Facturas del proyecto de Obuma que no se pudieron atribuir a ninguna OC. */
  facturasSueltas: FacturaAuditoria[] & { proveedor?: string }[];
  avisos: string[];
  cuadre: ResumenComparativo['cuadre'];
}

const r0 = (n: number) => Math.round(n);
const clp = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-CL')}`;
const nombreSimple = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const pct = (a: number, b: number) => (b ? `${a > b ? '+' : '−'}${String(Math.round(Math.abs((a - b) / b) * 10000) / 100).replace('.', ',')} %` : '');
const fechaISO = (f: unknown): string | null => {
  if (!f) return null;
  // Obuma entrega los documentos como DD-MM-AAAA: new Date() lo leería como MM-DD y daría otra fecha (o ninguna).
  const dma = /^(\d{2})-(\d{2})-(\d{4})/.exec(String(f));
  if (dma) return `${dma[3]}-${dma[2]}-${dma[1]}`;
  const d = new Date(f as string);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export async function auditoriaCompra(negocioId: number): Promise<AuditoriaCompra> {
  const [[neg]]: any = await pool.query(`SELECT licitacion_codigo, licitacion_nombre, licitacion_organismo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]);
  const [res, gastos] = await Promise.all([resumenComparativoCompra(negocioId), resumenGastosCompra(negocioId, null)]);

  // Fechas de las OC (el comparativo no las trae) y documentos del proyecto de Obuma (facturas que no cuelgan de ninguna OC).
  const folios = res.porOc.map(o => o.ocFolio);
  const fechaOc = new Map<string, string | null>();
  if (folios.length) {
    const [rows]: any = await pool.query(`SELECT folio, fecha_ingreso FROM obuma_compras WHERE folio IN (${folios.map(() => '?').join(',')})`, folios).catch(() => [[]]);
    for (const x of rows as any[]) fechaOc.set(String(x.folio), fechaISO(x.fecha_ingreso));
  }
  let documentos: DocumentoDelProyecto[] = [];
  try {
    const { proyectos } = await listarProyectosObuma();
    documentos = proyectos.find(p => p.negociosCoincidentes.some(n => n.negocioId === negocioId))?.documentos ?? [];
  } catch { /* sin snapshot de Obuma: se audita sin las facturas sueltas */ }
  const foliosEnlazados = new Set(gastos.facturas.detalle.map(f => `${f.folio}`));
  const netoDoc = (d: DocumentoDelProyecto) => r0(d.neto ?? d.total / 1.19);
  // Las notas de crédito y de débito nunca cuelgan de una OC en Licitank, y su folio puede repetirse con el de una factura de otro proveedor: no se comparan por folio.
  const sueltas = documentos.filter(d => d.proveedorNombre && (d.tipo === '61' || d.tipo === '56' || !foliosEnlazados.has(d.folio)));
  const notasCredito = documentos.filter(d => d.tipo === '61');
  const sueltaUsada = new Set<string>();

  // ── Grupos por proveedor ──
  const grupos = new Map<string, ProveedorAuditoria>();
  const grupo = (nombre: string | null | undefined): ProveedorAuditoria => {
    const k = nombreSimple(nombre) || 'SINPROVEEDOR';
    let g = grupos.get(k);
    if (!g) { g = { proveedor: nombre?.trim() || 'Sin proveedor asignado', lineas: [], ocs: [], costeoNeto: 0, cotizadoNeto: 0, ocNeto: 0, facturadoNeto: 0, hallazgos: [], sinExplicar: { cotizadoOc: 0, ocFactura: 0 } }; grupos.set(k, g); }
    return g;
  };
  const explicadoCotOc = new Map<ProveedorAuditoria, number>();
  // Una OC pertenece al proveedor de la cotización con la que se emparejó, aunque Obuma lo tenga con otra razón social («CUA» / «CIA.»).
  const grupoDeOc = new Map<string, ProveedorAuditoria>();
  const sinCotizacion = new Map<ProveedorAuditoria, { n: number; monto: number }>();
  const suma = (g: ProveedorAuditoria, v: number) => explicadoCotOc.set(g, (explicadoCotOc.get(g) ?? 0) + v);

  // 1) Cotización elegida vs costeo, producto por producto (se anota en el proveedor de la cotización).
  for (const f of res.filas) {
    const gPlan = f.planProveedor ? grupo(f.planProveedor) : grupo(f.obumaProveedor);
    const linea: LineaAuditoria = {
      producto: f.producto, cantidad: f.cantidad,
      costeoUnit: f.costeoUnit, cotizadoUnit: f.planUnit, ocUnit: f.obumaUnit,
      costeoNeto: f.costeoNeto, cotizadoNeto: f.planNeto, ocNeto: f.obumaNeto, oc: f.obumaOc,
    };
    gPlan.lineas.push(linea);
    if (f.obumaOc && !f.otroProveedor) grupoDeOc.set(String(f.obumaOc), gPlan);
    gPlan.costeoNeto += f.costeoNeto ?? 0;
    gPlan.cotizadoNeto += f.planNeto ?? 0;

    // costeo → cotizado
    if (f.planNeto != null && f.costeoNeto == null) {
      gPlan.hallazgos.push({ etapa: 'costeo-cotizado', donde: `${f.producto} · ${gPlan.proveedor}`, monto: f.planNeto, texto: `«${f.producto}» no estaba en el costeo: aparece recién con la cotización elegida, ${clp(f.planNeto)}.`, accion: 'Si es un gasto real del proyecto, déjalo asentado en el costeo o en Gastos extra para que el margen lo considere.' });
    } else if (f.planNeto != null && f.costeoNeto != null && Math.abs(f.planNeto - f.costeoNeto) >= 1) {
      const d = f.planNeto - f.costeoNeto;
      gPlan.hallazgos.push({ etapa: 'costeo-cotizado', donde: `${f.producto} · ${gPlan.proveedor}`, monto: d, texto: `«${f.producto}»: se costeó a ${clp(f.costeoUnit ?? 0)} c/u y la cotización elegida es ${clp(f.planUnit ?? 0)} c/u (${pct(f.planUnit ?? 0, f.costeoUnit ?? 0)}) × ${f.cantidad} u. = ${d < 0 ? 'ahorro' : 'sobrecosto'} de ${clp(Math.abs(d))}.` });
    } else if (f.planNeto == null && f.costeoNeto != null) {
      gPlan.hallazgos.push({ etapa: 'costeo-cotizado', donde: `${f.producto} · ${gPlan.proveedor}`, monto: -f.costeoNeto, texto: `«${f.producto}» está costeado (${clp(f.costeoNeto)}) pero no tiene cotización elegida.`, accion: 'Elegir cotización o marcar el producto como no comprado.' });
    }

    // cotizado → OC (a nivel producto; el total del proveedor sale de sus OC)
    if (f.planNeto != null && f.obumaOc == null) {
      suma(gPlan, -f.planNeto);
      gPlan.hallazgos.push({ etapa: 'cotizado-oc', donde: `${f.producto} · ${gPlan.proveedor} · sin OC`, monto: -f.planNeto, texto: `«${f.producto}» (${clp(f.planNeto)}) está cotizado pero todavía no tiene orden de compra.`, accion: 'Emitir la OC a este proveedor.' });
    } else if (f.planNeto != null && f.obumaNeto != null) {
      const gOc = f.otroProveedor ? grupo(f.obumaProveedor) : gPlan;
      if (f.otroProveedor) {
        suma(gPlan, -f.planNeto); suma(gOc, f.obumaNeto);
        gPlan.hallazgos.push({ etapa: 'cotizado-oc', donde: `${f.producto} · ${gPlan.proveedor} (lo cotizado)`, monto: -f.planNeto, texto: `«${f.producto}» se cotizó con este proveedor pero se compró a ${f.obumaProveedor} (OC ${f.obumaOc}).`, accion: 'Confirmar el cambio de proveedor o corregir la OC.' });
        gOc.hallazgos.push({ etapa: 'cotizado-oc', donde: `${f.producto} · ${gOc.proveedor} · OC ${f.obumaOc}`, monto: f.obumaNeto, texto: `«${f.producto}» se compró aquí (OC ${f.obumaOc}, ${clp(f.obumaNeto)}) aunque la cotización elegida era de ${f.planProveedor} (${clp(f.planNeto)}).` });
        gOc.lineas.push({ ...linea, cotizadoUnit: null, cotizadoNeto: null, costeoUnit: null, costeoNeto: null });
        grupoDeOc.set(String(f.obumaOc), gOc);
      } else {
        const d = f.obumaNeto - f.planNeto;
        suma(gPlan, d);
        if (Math.abs(d) >= 1) {
          const dUnit = (f.obumaUnit ?? 0) - (f.planUnit ?? 0);
          gPlan.hallazgos.push({ etapa: 'cotizado-oc', donde: `${f.producto} · ${gPlan.proveedor} · OC ${f.obumaOc}`, monto: d, texto: Math.abs(d) <= 2 * Math.max(1, f.cantidad)
            ? `«${f.producto}»: ${clp(Math.abs(d))} de diferencia entre la cotización y la OC ${f.obumaOc} por redondeo del precio unitario.`
            : Math.abs(dUnit) >= 0.5
            ? `«${f.producto}»: la OC ${f.obumaOc} cobra ${clp(f.obumaUnit ?? 0)} c/u y la cotización elegida decía ${clp(f.planUnit ?? 0)} c/u (${pct(f.obumaUnit ?? 0, f.planUnit ?? 0)}).`
            : `«${f.producto}»: la OC ${f.obumaOc} es por un monto distinto al cotizado con el mismo precio unitario: cambió la cantidad pedida.`, accion: 'Revisar la OC contra la cotización.' });
        }
      }
    } else if (f.planNeto == null && f.obumaNeto != null) {
      suma(gPlan, f.obumaNeto);
      const sc = sinCotizacion.get(gPlan) ?? { n: 0, monto: 0 }; sc.n++; sc.monto += f.obumaNeto; sinCotizacion.set(gPlan, sc);
    }
  }
  // Líneas de OC que no son producto del plan (transporte, extras).
  for (const l of res.lineasSinPlan) {
    const g = grupoDeOc.get(String(l.ocFolio)) ?? grupo(l.proveedor);
    suma(g, l.neto ?? 0);
    g.hallazgos.push({ etapa: 'cotizado-oc', donde: `${l.producto} · ${g.proveedor} · OC ${l.ocFolio}`, monto: l.neto ?? 0, texto: `La OC ${l.ocFolio} incluye «${l.producto}»${l.cantidad ? ` (${l.cantidad} u.)` : ''} que no es un producto cotizado (transporte o extra).`, accion: 'Confirmar que esté aprobado.' });
  }

  // 2) OC y facturas por proveedor. Las notas de crédito (restan) y de débito (suman) del proyecto de Obuma se descuentan de lo facturado de su OC:
  // por proveedor (si tiene una sola OC en este negocio) o por monto igual a una factura de la OC (la nota puede venir a nombre de otra razón social).
  for (const o of res.porOc) {
    const g = grupoDeOc.get(String(o.ocFolio)) ?? grupo(o.proveedor);
    const facs: FacturaAuditoria[] = gastos.facturas.detalle.filter(f => f.ocFolio === o.ocFolio)
      .map(f => ({ folio: `${f.folio}`, fecha: fechaISO(f.fecha), neto: r0((f.total || 0) / 1.19), enlazada: true, tipo: '33' }));
    if (o.ocPropia && o.facturas > 0 && !facs.length) facs.push({ folio: null, fecha: null, neto: o.facturadoNeto, enlazada: true });
    // Notas de crédito/débito de esta OC: las asocia el Comparativo (misma regla, un solo lugar) y ya vienen sumadas en o.facturadoNeto.
    const notas = o.notas ?? [];
    for (const n of notas) {
      for (const d of sueltas) if (d.tipo === n.tipo && d.folio === n.folio) sueltaUsada.add(d.folio);
      facs.push({ folio: n.folio, fecha: fechaISO(n.fecha), neto: n.neto, enlazada: false, tipo: n.tipo });
    }
    const facturadoOc = o.facturadoNeto;
    const lineasOc = [
      ...res.filas.filter(f => f.obumaOc && String(f.obumaOc).split(', ').includes(o.ocFolio)).map(f => ({ producto: f.producto, cantidad: f.cantidad as number | null, unit: f.obumaUnit, neto: f.obumaNeto })),
      ...res.lineasSinPlan.filter(l => l.ocFolio === o.ocFolio).map(l => ({ producto: l.producto, cantidad: l.cantidad, unit: l.cantidad && l.neto != null ? r0(l.neto / l.cantidad) : null, neto: l.neto })),
    ];
    g.ocs.push({ folio: o.ocFolio, estado: o.estado, fecha: fechaOc.get(o.ocFolio) ?? null, neto: o.obumaNeto, facturadoNeto: facturadoOc, facturas: facs, lineas: lineasOc });
    g.ocNeto += o.obumaNeto;
    g.facturadoNeto += facturadoOc;

    const dif = facturadoOc - o.obumaNeto;
    if (o.obumaNeto <= 0 || o.din?.length) continue;
    const donde = `${g.proveedor} · OC ${o.ocFolio}`;
    if (o.facturas === 0) {
      const cand = sueltas.find(d => !sueltaUsada.has(d.folio) && (d.tipo === '33' || d.tipo === '34') && nombreSimple(d.proveedorNombre) === nombreSimple(o.proveedor));
      if (cand) {
        sueltaUsada.add(cand.folio);
        const n = netoDoc(cand);
        g.ocs[g.ocs.length - 1].facturas.push({ folio: cand.folio, fecha: fechaISO(cand.fecha), neto: n, enlazada: false, tipo: cand.tipo });
        // Esa factura suelta puede estar anulada por una nota de crédito del mismo monto: entonces no hay nada que enlazar, la OC sigue sin factura.
        const anula = sueltas.find(d => !sueltaUsada.has(d.folio) && d.tipo === '61' && nombreSimple(d.proveedorNombre) === nombreSimple(o.proveedor) && Math.abs(Math.abs(netoDoc(d)) - n) <= 2);
        if (anula) {
          sueltaUsada.add(anula.folio);
          g.ocs[g.ocs.length - 1].facturas.push({ folio: anula.folio, fecha: fechaISO(anula.fecha), neto: netoDoc(anula), enlazada: false, tipo: '61' });
          g.hallazgos.push({ etapa: 'oc-factura', donde: `${donde} · factura N° ${cand.folio}`, monto: dif, texto: `La factura N° ${cand.folio} (${clp(n)}) de la OC ${o.ocFolio} quedó anulada por la nota de crédito N° ${anula.folio} y no hay una factura nueva: la OC queda sin facturar en Obuma.`, accion: 'Confirmar con Compras si falta re-facturar o si la nota de crédito está mal puesta.' });
          continue;
        }
        g.hallazgos.push({ etapa: 'oc-factura', donde: `${donde} · factura N° ${cand.folio}`, monto: dif, texto: `La OC ${o.ocFolio} (${o.estado ?? '—'}) figura sin factura, pero la factura N° ${cand.folio} de ${cand.proveedorNombre} (${clp(n)} neto, ${clp(cand.total)} con IVA) ya está contabilizada en el proyecto de Obuma y ${Math.abs(n - o.obumaNeto) <= 2 ? 'coincide con la OC' : `difiere de la OC en ${clp(n - o.obumaNeto)}`}: solo no está enlazada a la OC.`, accion: `En Obuma, enlazar la factura ${cand.folio} a la OC ${o.ocFolio}.` });
      } else {
        g.hallazgos.push({ etapa: 'oc-factura', donde, monto: dif, texto: `La OC ${o.ocFolio} (${o.estado ?? '—'}, ${clp(o.obumaNeto)}) no tiene factura.`, accion: 'Pedir la factura al proveedor o enlazarla en Obuma si ya llegó.' });
      }
    } else if (notas.length) {
      const lista = notas.map(n => `${n.tipo === '61' ? 'nota de crédito' : 'nota de débito'} N° ${n.folio} (${clp(n.neto)})`).join(', ');
      if (Math.abs(facturadoOc) <= 2) g.hallazgos.push({ etapa: 'oc-factura', donde, monto: dif, texto: `La factura de la OC ${o.ocFolio} quedó anulada por ${lista} y no hay una factura nueva: la OC queda sin facturar en Obuma.`, accion: 'Confirmar con Compras si falta re-facturar o si la nota de crédito está mal puesta.' });
      else if (Math.abs(dif) <= 2) g.hallazgos.push({ etapa: 'oc-factura', donde, monto: dif, texto: `OC ${o.ocFolio}: la factura se corrigió con ${lista}; el neto final queda ${clp(Math.abs(dif))} de diferencia por redondeo.` });
      else g.hallazgos.push({ etapa: 'oc-factura', donde, monto: dif, texto: `Con ${lista}, lo facturado de la OC ${o.ocFolio} queda en ${clp(facturadoOc)}: ${clp(Math.abs(dif))} ${dif > 0 ? 'más' : 'menos'} que la OC.`, accion: 'Revisar con Compras que las notas corresponden a esta OC y el monto final.' });
    } else if (Math.abs(dif) >= 1) {
      if (Math.abs(dif) <= 2) g.hallazgos.push({ etapa: 'oc-factura', donde, monto: dif, texto: `OC ${o.ocFolio}: ${clp(Math.abs(dif))} de diferencia por redondeo del IVA (la factura se calcula con IVA y se pasa a neto).` });
      else {
        const nc = notasCredito.filter(d => nombreSimple(d.proveedorNombre) === nombreSimple(o.proveedor));
        g.hallazgos.push({ etapa: 'oc-factura', donde, monto: dif, texto: `La factura de la OC ${o.ocFolio} es ${clp(Math.abs(dif))} ${dif > 0 ? 'mayor' : 'menor'} que la OC (${pct(facturadoOc, o.obumaNeto)}).${nc.length ? ` Hay nota de crédito ${nc.map(d => d.folio).join(', ')} de este proveedor en el proyecto.` : ''}`, accion: dif > 0 ? 'Pagaste más que lo ordenado: revisar con el proveedor.' : 'Revisar si falta cobrar o hay una entrega parcial.' });
      }
    }
  }

  for (const [g, sc] of sinCotizacion) g.hallazgos.push({ etapa: 'cotizado-oc', donde: `${g.proveedor} · compras directas en Obuma`, monto: sc.monto, texto: `${sc.n} producto(s) con OC por ${clp(sc.monto)} sin cotización elegida en Licitank (compra hecha directo en Obuma).` });

  // 3) Lo que ninguna causa explica (control de la propia auditoría).
  for (const g of grupos.values()) {
    const explicado = explicadoCotOc.get(g) ?? 0;
    const real = g.ocNeto - g.cotizadoNeto;
    const res1 = r0(real - explicado);
    const explicadoFac = g.hallazgos.filter(h => h.etapa === 'oc-factura').reduce((s, h) => s + h.monto, 0);
    const res2 = r0(g.facturadoNeto - g.ocNeto - explicadoFac);
    g.sinExplicar = { cotizadoOc: Math.abs(res1) >= 2 ? res1 : 0, ocFactura: Math.abs(res2) >= 2 ? res2 : 0 };
    if (g.sinExplicar.cotizadoOc) g.hallazgos.push({ etapa: 'cotizado-oc', donde: `${g.proveedor}`, monto: g.sinExplicar.cotizadoOc, texto: `Diferencia de ${clp(g.sinExplicar.cotizadoOc)} entre lo cotizado y lo ordenado que no se puede atribuir a un producto concreto.`, accion: 'Revisar las OC de este proveedor a mano.' });
    // Orden de lectura: primero cotización, luego OC, luego factura.
    const orden: Record<EtapaAuditoria, number> = { 'costeo-cotizado': 0, 'cotizado-oc': 1, 'oc-factura': 2 };
    g.hallazgos.sort((a, b) => orden[a.etapa] - orden[b.etapa]);
    g.costeoNeto = r0(g.costeoNeto); g.cotizadoNeto = r0(g.cotizadoNeto);
  }

  const proveedores = [...grupos.values()].sort((a, b) => b.ocNeto - a.ocNeto || b.cotizadoNeto - a.cotizadoNeto);

  // Puente global: se suman los hallazgos por etapa y tipo de causa.
  const t = res.totales;
  const clasifica = (h: Hallazgo): string => {
    if (h.etapa === 'costeo-cotizado') return h.texto.includes('no estaba en el costeo') ? 'Ítems que no estaban en el costeo (se agregaron al comprar)' : h.texto.includes('no tiene cotización') ? 'Costeado sin cotización elegida' : 'Precio de la cotización distinto al costeado';
    if (h.etapa === 'cotizado-oc') return h.texto.includes('no tiene orden de compra') ? 'Cotizado sin OC todavía' : h.texto.includes('se compró a') || h.texto.includes('se compró aquí') ? 'Cambio de proveedor' : h.texto.includes('cobra') || h.texto.includes('cantidad') || h.texto.includes('redondeo del precio') ? 'Precio o cantidad de la OC distinto al cotizado' : h.texto.includes('sin cotización elegida') ? 'Compras directas en Obuma sin cotización elegida en Licitank' : 'Otras diferencias de OC';
    return h.texto.includes('no está enlazada') ? 'Factura contabilizada pero sin enlazar a su OC' : h.texto.includes('no tiene factura') ? 'OC sin factura' : h.texto.includes('redondeo') ? 'Redondeo de IVA' : 'Factura distinta a la OC';
  };
  const porTipo = new Map<string, { etapa: EtapaAuditoria; monto: number; texto: string }>();
  for (const g of proveedores) for (const h of g.hallazgos) {
    const k = `${h.etapa}|${clasifica(h)}`;
    const p = porTipo.get(k) ?? { etapa: h.etapa, monto: 0, texto: clasifica(h) };
    p.monto += h.monto; porTipo.set(k, p);
  }

  const lineasSueltas = sueltas.filter(d => !sueltaUsada.has(d.folio)).map(d => ({ folio: d.folio, fecha: fechaISO(d.fecha), neto: netoDoc(d), enlazada: false, tipo: d.tipo, proveedor: d.proveedorNombre ?? undefined }));

  // Producto por producto: vendido, costeado, comprado, a quién y margen (venta − comprado; si aún no hay OC, se usa la cotización elegida).
  const proveedorDe = (folio: string | null, def: string | null) => (folio && grupoDeOc.get(String(folio))?.proveedor) || def;
  const items: ItemAuditoria[] = [
    ...res.filas.map(f => {
      const comprado = f.obumaNeto ?? f.planNeto;
      const margen = f.ventaNeto != null && comprado != null ? f.ventaNeto - comprado : null;
      return { producto: f.producto, cantidad: f.cantidad, proveedor: proveedorDe(f.obumaOc, f.obumaProveedor ?? f.planProveedor), oc: f.obumaOc, ventaNeto: f.ventaNeto, costeoNeto: f.costeoNeto, cotizadoNeto: f.planNeto, compradoNeto: comprado,
        margen, margenPct: margen != null && f.ventaNeto ? Math.round((margen / f.ventaNeto) * 1000) / 10 : null };
    }),
    ...res.lineasSinPlan.map(l => ({ producto: l.producto, cantidad: l.cantidad, proveedor: proveedorDe(l.ocFolio, l.proveedor), oc: l.ocFolio, ventaNeto: null, costeoNeto: null, cotizadoNeto: null, compradoNeto: l.neto, margen: null, margenPct: null })),
  ];

  return {
    negocioId, codigo: neg?.licitacion_codigo ?? String(negocioId), nombre: neg?.licitacion_nombre ?? '', organismo: neg?.licitacion_organismo ?? '',
    generadoEn: new Date().toISOString(),
    proveedores, items,
    puente: { venta: t.ventaGanada, costeo: t.costeo, cotizado: t.plan, oc: t.obumaOc, facturado: t.facturado, gastosExtra: t.gastosExtra, margenNeto: t.margenRealNeto, margenPct: t.margenRealPct },
    puentePorTipo: [...porTipo.values()].filter(x => Math.abs(x.monto) >= 1),
    facturasSueltas: lineasSueltas as AuditoriaCompra['facturasSueltas'],
    avisos: res.avisos,
    cuadre: res.cuadre,
  };
}
