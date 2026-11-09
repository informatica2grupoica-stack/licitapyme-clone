// app/lib/compras-resumen-comparativo.ts
// ¿LO QUE SE COSTEÓ, LO QUE SE PLANEÓ COMPRAR EN LICITANK Y LO QUE SE COMPRÓ DE VERDAD EN OBUMA
// COINCIDEN? Junta, por producto, las cuatro fuentes del proyecto (todo NETO):
//   venta (lo ganado) · costeo (lo que costeó el asistente) · plan (escenario de compra elegido en
//   Licitank) · Obuma (OC reales hechas directo + sus facturas). Solo lee de base; no llama a Obuma.
import { listarProductosCompra } from '@/app/lib/compras';
import { costeadoPorProducto } from '@/app/lib/compras-auditoria-cotizacion';
import { resumenGastosCompra } from '@/app/lib/compras-oc-obuma';
import { emparejarPlanConObuma } from '@/app/lib/compras-sku-obuma';
import { netoDeCompra, esOcDeGarantia } from '@/app/lib/obuma-compras';
import { listarProyectosObuma } from '@/app/lib/compras-proyectos-obuma';
import { listarGastos } from '@/app/lib/compras-gastos';
import { listarOcPropias } from '@/app/lib/compras-oc-propia';
import pool from '@/app/lib/db';

export interface FilaComparativa {
  productoId: number; producto: string; cantidad: number;
  ventaUnit: number | null; ventaNeto: number | null;
  costeoUnit: number | null; costeoNeto: number | null;
  planProveedor: string | null; planUnit: number | null; planNeto: number | null;
  obumaProveedor: string | null; obumaOc: string | null; obumaEstado: string | null; obumaSku: string | null;
  obumaUnit: number | null; obumaNeto: number | null;
  /** La OC de Obuma es de un proveedor distinto al del plan de compra. */
  otroProveedor: boolean;
  /** Lo comprado viene de una OC propia (Comercial MP, emitida en Licitank, no pasa por Obuma). */
  ocPropia?: boolean;
}
export interface FilaPorOc {
  ocFolio: string; proveedor: string | null; estado: string | null;
  planNeto: number | null; obumaNeto: number; facturadoNeto: number; facturas: number;
  ocPropia?: boolean;
  /** N° de DIN (declaración de ingreso, importación) enlazada a la OC: no es factura. */
  din?: string[];
}
/** Cuadre entre lo que dice el PROYECTO en Obuma y lo que cuenta Licitank (todo con IVA, tal como lo muestra Obuma). */
export interface DiferenciaCuadre {
  concepto: string;
  /** Con signo: + = Obuma tiene ese monto de MÁS que Licitank; − = de menos (una nota de crédito). */
  monto: number;
  /** Un gasto propio de Obuma (horas extras, retiros…) que debería estar en «Gastos extra». */
  gastoPropio?: { descripcion: string; categoria: string };
}
export interface CuadreLado {
  obumaCantidad: number; obumaTotal: number; licitankCantidad: number; licitankTotal: number;
  diferencias: DiferenciaCuadre[]; sinExplicar: number;
}
export interface CuadreObuma {
  proyectoFolio: number | null; proyectoNombre: string | null;
  oc: CuadreLado; facturas: CuadreLado;
  /** Facturas que Licitank no suma y que en Obuma NO están contabilizadas en el proyecto (solo mal enlazadas en una OC). */
  soloEnOc: string[];
  cuadra: boolean;
}

export interface ResumenComparativo {
  /** null = este negocio no tiene un Proyecto identificable en Obuma. */
  cuadre: CuadreObuma | null;
  filas: FilaComparativa[];
  /** Líneas de OC de Obuma que no son un producto del plan (transporte, extras). */
  lineasSinPlan: { ocFolio: string; proveedor: string | null; producto: string; sku: string | null; cantidad: number | null; neto: number | null }[];
  porOc: FilaPorOc[];
  /** Gastos extra del negocio (módulo «Gastos extra»: flete cobrado aparte, puesta en marcha…). Solo los en CLP suman. */
  gastosExtra: { id: number; categoria: string; descripcion: string; monto: number; moneda: string; fecha: string | null; origen: 'licitank' | 'obuma' }[];
  totales: { venta: number; /** Lo que paga el cliente: su OC de Mercado Público (neto) o, si no hay, la suma del costeo. */ ventaGanada: number; costeo: number; plan: number; obumaOc: number; facturado: number; gastosExtra: number; margenRealNeto: number; margenRealPct: number | null };
  avisos: string[];
}

const clp = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;
const corto = (s: string) => s.replace(/\s+/g, ' ').trim().split(' - ')[0].slice(0, 70);
const r0 = (n: number) => Math.round(n);

export async function resumenComparativoCompra(negocioId: number): Promise<ResumenComparativo> {
  const [productos, costeo, emp, gastos, gastosRows, propiasTodas, ocCliente] = await Promise.all([
    listarProductosCompra(negocioId),
    costeadoPorProducto(negocioId).catch(() => ({} as Record<number, number | null>)),
    emparejarPlanConObuma(negocioId),
    resumenGastosCompra(negocioId, null),
    listarGastos(negocioId).catch(() => []),
    listarOcPropias(negocioId).catch(() => []),
    pool.query(`SELECT oc_total_neto, oc_codigo_mp FROM compras_asignacion WHERE negocio_id = ? LIMIT 1`, [negocioId])
      .then(([r]: any) => r[0] ?? null).catch(() => null),
  ]);
  // OC propias vigentes (Comercial MP): lo que se compró por fuera de Obuma. 979: la vacuolavadora salía «sin OC en Obuma».
  const propias = propiasTodas.filter(o => o.estado !== 'ANULADA');
  const propiaDe = new Map<number, { folio: string; proveedor: string; estado: string; codigo: string | null; cantidad: number; neto: number }>();
  for (const o of propias) for (const it of o.items) {
    if (it.productoId == null) continue;
    const prev = propiaDe.get(it.productoId);
    propiaDe.set(it.productoId, {
      folio: prev ? `${prev.folio}, ${o.folio}` : o.folio, proveedor: o.proveedor.nombre, estado: o.estado, codigo: it.codigo,
      cantidad: (prev?.cantidad ?? 0) + it.cantidad, neto: (prev?.neto ?? 0) + it.cantidad * it.precio,
    });
  }
  const vigentes = productos.filter(p => !['RENUNCIADO', 'NO_ADJUDICADA'].includes(p.subestado));
  const parDe = new Map(emp.pares.map(p => [p.item.productoId, p]));
  const planDe = new Map<number, { grupo: string; unit: number; neto: number }>();
  for (const p of emp.pares) planDe.set(p.item.productoId, { grupo: p.grupo.proveedorNombre, unit: p.item.precioUnitario, neto: p.item.subtotal });
  for (const p of emp.planSinOc) planDe.set(p.item.productoId, { grupo: p.grupo.proveedorNombre, unit: p.item.precioUnitario, neto: p.item.subtotal });

  const filas: FilaComparativa[] = vigentes.map(p => {
    const cant = p.cantidad ?? 0;
    const par = parDe.get(p.id); const plan = planDe.get(p.id);
    const cUnit = costeo[p.id] ?? null;
    const obumaUnit = par?.linea.precio ?? null;
    const pr = !par ? propiaDe.get(p.id) : undefined;
    if (pr) {
      return {
        productoId: p.id, producto: corto(p.descripcion), cantidad: cant,
        ventaUnit: p.montoUnitario, ventaNeto: p.montoUnitario != null ? r0(cant * p.montoUnitario) : null,
        costeoUnit: cUnit, costeoNeto: cUnit != null ? r0(cant * cUnit) : null,
        planProveedor: plan?.grupo ?? null, planUnit: plan?.unit ?? null, planNeto: plan ? r0(plan.neto) : null,
        obumaProveedor: pr.proveedor, obumaOc: pr.folio, obumaEstado: pr.estado, obumaSku: pr.codigo,
        obumaUnit: pr.cantidad > 0 ? r0(pr.neto / pr.cantidad) : null, obumaNeto: r0(pr.neto),
        otroProveedor: !!plan && plan.grupo !== pr.proveedor, ocPropia: true,
      };
    }
    return {
      productoId: p.id, producto: corto(p.descripcion), cantidad: cant,
      ventaUnit: p.montoUnitario, ventaNeto: p.montoUnitario != null ? r0(cant * p.montoUnitario) : null,
      costeoUnit: cUnit, costeoNeto: cUnit != null ? r0(cant * cUnit) : null,
      planProveedor: plan?.grupo ?? null, planUnit: plan?.unit ?? null, planNeto: plan ? r0(plan.neto) : null,
      obumaProveedor: par?.oc.proveedorRazonSocial ?? null, obumaOc: par ? (par.oc.folio || par.oc.compraOcId) : null,
      obumaEstado: par?.oc.estado ?? null, obumaSku: par?.linea.codigoComercial ?? null,
      obumaUnit, obumaNeto: par?.linea.subtotal != null ? r0(par.linea.subtotal) : (obumaUnit != null ? r0(cant * obumaUnit) : null),
      otroProveedor: !!par && !par.exacto,
    };
  });

  // La OC de una garantía (boleta de fiel cumplimiento) no es una compra de productos: se muestra como gasto del proyecto.
  const ocGarantia = emp.ocs.filter(esOcDeGarantia);
  const esGarantia = (folio: string) => ocGarantia.some(o => (o.folio || o.compraOcId) === folio);

  const lineasSinPlan = emp.lineasSinPlan.filter(({ oc }) => !esGarantia(oc.folio || oc.compraOcId)).map(({ oc, linea }) => ({
    ocFolio: oc.folio || oc.compraOcId, proveedor: oc.proveedorRazonSocial, producto: linea.descripcion.replace(/\s+/g, ' ').trim(),
    sku: linea.codigoComercial ?? null, cantidad: linea.cantidad, neto: linea.subtotal != null ? r0(linea.subtotal) : null,
  }));

  const planPorOc = new Map<string, number>();
  for (const p of emp.pares) { const k = p.oc.folio || p.oc.compraOcId; planPorOc.set(k, (planPorOc.get(k) || 0) + p.item.subtotal); }
  const porOc: FilaPorOc[] = emp.ocs.filter(oc => !esOcDeGarantia(oc)).map(oc => {
    const folio = oc.folio || oc.compraOcId;
    const fs = gastos.facturas.detalle.filter(f => f.ocFolio === folio);
    return {
      ocFolio: folio, proveedor: oc.proveedorRazonSocial, estado: oc.estado,
      planNeto: planPorOc.has(folio) ? r0(planPorOc.get(folio)!) : null,
      obumaNeto: netoDeCompra(oc),
      facturadoNeto: r0(fs.reduce((s, f) => s + (f.total || 0), 0) / 1.19), facturas: fs.length, din: oc.din,
    };
  });
  for (const o of propias) {
    porOc.push({
      ocFolio: o.folio, proveedor: o.proveedor.nombre, estado: o.estado, planNeto: null, obumaNeto: r0(o.neto),
      facturadoNeto: o.factura ? r0(o.factura.neto ?? (o.factura.total != null ? o.factura.total / 1.19 : 0)) : 0, facturas: o.factura ? 1 : 0, ocPropia: true,
    });
  }

  const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
  const venta = sum(filas.map(f => f.ventaNeto));
  const costeoTot = sum(filas.map(f => f.costeoNeto));
  const planTot = sum(filas.map(f => f.planNeto));
  const obumaOc = sum(porOc.map(o => o.obumaNeto));
  const facturado = sum(porOc.map(o => o.facturadoNeto));
  const gastosExtra: ResumenComparativo['gastosExtra'] = [
    ...gastosRows.map(g => ({ id: g.id, categoria: g.categoriaEtiqueta || 'Sin categoría', descripcion: g.descripcion, monto: g.monto, moneda: g.moneda, fecha: g.fechaGasto, origen: 'licitank' as const })),
    ...ocGarantia.map(o => ({ id: -Number(o.compraOcId), categoria: 'Garantía de fiel cumplimiento', descripcion: `OC ${o.folio || o.compraOcId} · ${o.proveedorRazonSocial || 'Obuma'} (exenta de IVA)`, monto: netoDeCompra(o), moneda: 'CLP', fecha: o.fechaIngreso ? new Date(o.fechaIngreso as unknown as string).toISOString().slice(0, 10) : null, origen: 'obuma' as const })),
  ];
  const gastosExtraClp = gastosExtra.filter(g => g.moneda === 'CLP').reduce((s, g) => s + g.monto, 0);
  const costoReal = obumaOc + gastosExtraClp;
  // La venta por producto sale del costeo; lo que de verdad paga el cliente es su OC de Mercado Público. El margen real se calcula
  // sobre esa OC cuando existe (el mismo número que usa la aprobación del margen), no sobre la suma del costeo.
  const ventaOc = ocCliente?.oc_total_neto != null && Number(ocCliente.oc_total_neto) > 0 ? Number(ocCliente.oc_total_neto) : null;
  const ventaGanada = ventaOc ?? venta;
  const totales = {
    venta, ventaGanada, costeo: costeoTot, plan: planTot, obumaOc, facturado, gastosExtra: r0(gastosExtraClp),
    margenRealNeto: ventaGanada - costoReal, margenRealPct: ventaGanada > 0 ? Math.round(((ventaGanada - costoReal) / ventaGanada) * 1000) / 10 : null,
  };

  const avisos: string[] = [];
  // Si no calzan, los números por producto están mal (979: costeo $34.680.000 contra OC del cliente $40.560.000; la línea 2 valía la
  // mitad en el costeo).
  if (ventaOc != null && ventaOc > 0 && Math.abs(ventaOc - venta) > 1) {
    avisos.push(`La venta del costeo (${clp(venta)}) no calza con la OC del cliente${ocCliente?.oc_codigo_mp ? ` ${ocCliente.oc_codigo_mp}` : ''} (${clp(ventaOc)} neto): diferencia de ${clp(Math.abs(ventaOc - venta))}. Revisa los precios de venta del costeo; el margen real depende de eso.`);
  }
  const sinVenta = filas.filter(f => f.ventaNeto == null);
  if (sinVenta.length) avisos.push(`${sinVenta.length} producto(s) sin precio de venta en el costeo (no suman a la venta): ${sinVenta.map(f => f.producto).join(', ')}.`);
  const sinOc = filas.filter(f => !f.obumaOc);
  if (sinOc.length) avisos.push(`${sinOc.length} producto(s) de la cotización elegida no tienen OC (ni en Obuma ni propia): ${sinOc.map(f => f.producto).join(', ')}.`);
  const otro = filas.filter(f => f.otroProveedor);
  if (otro.length) avisos.push(`${otro.length} producto(s) se compraron a un proveedor distinto al de la cotización elegida: ${otro.map(f => `${f.producto} (cotización ${f.planProveedor}, Obuma ${f.obumaProveedor})`).join('; ')}.`);
  // Una OC en $0 (p. ej. la garantía de seriedad de FINFAST) no es una compra: no necesita factura.
  const sinFactura = porOc.filter(o => o.facturas === 0 && o.obumaNeto > 0 && !o.din?.length);
  if (sinFactura.length) avisos.push(`${sinFactura.length} OC sin factura todavía: ${sinFactura.map(o => `OC ${o.ocFolio} ${o.proveedor || ''} (${o.estado || '—'})`).join('; ')}.`);
  if (gastos.facturas.descartadas.length) avisos.push(`${gastos.facturas.descartadas.length} factura(s) no se suman por estar mal enlazadas o duplicadas en Obuma (ver el recuadro de arriba).`);
  if (costeoTot > 0 && costoReal > costeoTot) avisos.push(`Lo comprado (${clp(costoReal)} entre OC de Obuma y gastos extra) supera lo costeado (${clp(costeoTot)}).`);
  const garantiasManuales = gastosExtra.filter(g => g.origen === 'licitank' && /garant[ií]a|boleta|p[oó]liza/i.test(`${g.categoria} ${g.descripcion}`));
  if (garantiasManuales.length && ocGarantia.length) avisos.push('La garantía aparece dos veces: una OC en Obuma y un gasto cargado a mano. Deja solo una para no contarla doble.');
  if (gastosExtra.some(g => /flete|transporte|despacho/i.test(`${g.categoria} ${g.descripcion}`)) && lineasSinPlan.some(l => /transporte|flete|despacho/i.test(l.producto)))
    avisos.push('Hay un flete en Gastos extra y también una línea de transporte en una OC de Obuma: revisa que no sea el mismo gasto contado dos veces.');
  if (totales.margenRealPct != null && totales.margenRealPct < 20) avisos.push(`El margen real con lo comprado hasta ahora es ${totales.margenRealPct}% (piso del 20%).`);

  // ── Cuadre con el proyecto de Obuma ──
  let cuadre: CuadreObuma | null = null;
  try {
    const { proyectos } = await listarProyectosObuma();
    const proy = proyectos.find(p => p.negociosCoincidentes.some(n => n.negocioId === negocioId));
    if (proy) {
      const vigentes = emp.ocs;                                   // sin anuladas
      const licOcTotal = Math.round(vigentes.reduce((s, o) => s + (o.total ?? 0), 0));
      const anuladas = proy.ocs.filter(o => /anulad/i.test(o.estado || ''));
      const ocDif: DiferenciaCuadre[] = anuladas.map(o => ({ concepto: `OC ${o.folio} ${o.proveedorNombre || ''} — ANULADA en Obuma, no es gasto`, monto: Math.round(o.total) }));
      // OC vigente que Obuma tiene en este proyecto pero que es de OTRA licitación (su referencia/licitación en la OC es otra): Obuma la enlazó mal.
      const foliosVigentes = new Set(vigentes.map(o => String(o.folio || o.compraOcId)));
      const ajenas = proy.ocs.filter(o => !/anulad/i.test(o.estado || '') && !foliosVigentes.has(String(o.folio)));
      if (ajenas.length) {
        const [[neg]]: any = await pool.query(`SELECT licitacion_codigo FROM negocios WHERE id = ? LIMIT 1`, [negocioId]);
        const [filas]: any = await pool.query(`SELECT folio, licitacion_codigo FROM obuma_compras WHERE folio IN (${ajenas.map(() => '?').join(',')})`, ajenas.map(o => String(o.folio)));
        const codigoDe = new Map<string, string | null>((filas as any[]).map(r => [String(r.folio), r.licitacion_codigo ?? null]));
        for (const o of ajenas) {
          const cod = codigoDe.get(String(o.folio));
          if (cod && neg?.licitacion_codigo && cod !== neg.licitacion_codigo) ocDif.push({ concepto: `OC ${o.folio} ${o.proveedorNombre || ''} — es de otra licitación (${cod}): Obuma la tiene en este proyecto por error, no es gasto de este negocio`, monto: Math.round(o.total) });
        }
      }
      const ocSin = Math.round(proy.totalGastado - ocDif.reduce((s, d) => s + d.monto, 0) - licOcTotal);

      // Facturas: se compara documento a documento lo que Obuma contabilizó en el centro de costo del proyecto.
      // Solo las facturas de Obuma: las de OC propias (dteId vacío) no existen en el proyecto de Obuma y descuadrarían.
      const facObuma = gastos.facturas.detalle.filter(f => !!f.dteId);
      const licFacTotal = Math.round(facObuma.reduce((s, f) => s + (f.total || 0), 0));
      const enLicitank = new Set(facObuma.map(f => `${f.folio}`));
      const descartada = new Map(gastos.facturas.descartadas.map(f => [`${f.folio}`, f]));
      const facDif: DiferenciaCuadre[] = [];
      const foliosObuma = new Set<string>();
      for (const d of proy.documentos) {
        foliosObuma.add(d.folio);
        const monto = Math.round(d.total);
        const quien = d.proveedorNombre || '';
        if (d.tipo === '61') { facDif.push({ concepto: `Nota de crédito ${d.folio} ${quien} — resta en Obuma`, monto }); continue; }
        if (!d.proveedorNombre && (d.folio === '' || d.folio === '0')) {
          const obs = d.observacion || 'gasto propio';
          facDif.push({ concepto: `Gasto propio en Obuma: ${obs}`, monto, gastoPropio: { descripcion: obs, categoria: /horas?\s*extra/i.test(obs) ? 'Horas extras' : /retiro|entrega|flete|transporte/i.test(obs) ? 'Flete / transporte' : '' } });
          continue;
        }
        if (enLicitank.has(d.folio)) continue;
        const desc = descartada.get(d.folio);
        facDif.push({ concepto: desc ? `Factura ${d.folio} ${quien} — ${desc.motivo}` : `Factura ${d.folio} ${quien} — está en el proyecto pero no cuelga de ninguna OC`, monto });
      }
      const soloEnOc = gastos.facturas.descartadas.filter(f => !foliosObuma.has(`${f.folio}`)).map(f => `Factura ${f.folio} ${f.proveedor || ''} (${clp(f.total ?? 0)}): en Obuma NO está contabilizada en este proyecto; solo aparece enlazada a una OC por error. ${f.motivo}`);
      const facSin = Math.round(proy.totalFacturado - facDif.reduce((s, d) => s + d.monto, 0) - licFacTotal);
      cuadre = {
        proyectoFolio: proy.folio, proyectoNombre: proy.nombre,
        oc: { obumaCantidad: proy.cantidadOc, obumaTotal: Math.round(proy.totalGastado), licitankCantidad: vigentes.length, licitankTotal: licOcTotal, diferencias: ocDif, sinExplicar: ocSin },
        facturas: { obumaCantidad: proy.cantidadFacturas, obumaTotal: Math.round(proy.totalFacturado), licitankCantidad: facObuma.length, licitankTotal: licFacTotal, diferencias: facDif, sinExplicar: facSin },
        soloEnOc, cuadra: Math.abs(ocSin) <= 2 && Math.abs(facSin) <= 2,
      };
    }
  } catch { /* Obuma/snapshot no disponible: el comparativo sigue sin el cuadre */ }

  return { cuadre, filas, lineasSinPlan, porOc, gastosExtra, totales, avisos };
}
