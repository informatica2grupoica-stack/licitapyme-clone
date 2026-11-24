// app/lib/compras-auditoria-pdf.ts
// El documento de «Auditoría de la compra» (HTML autocontenido → generarInformePdf lo pasa a PDF A4).
// La misma pieza se muestra en pantalla (iframe) y se descarga, así que lo que ves es lo que se lleva.
// Diseño: licitank-ui (teal como marca, sin cajas dentro de cajas, estado con punto, números grandes, rótulos en minúscula).
import type { AuditoriaCompra, Hallazgo, EtapaAuditoria } from '@/app/lib/compras-auditoria-negocio';

const esc = (x: unknown): string => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clp = (n: number | null | undefined): string => n == null ? '—' : `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('es-CL')}`;
const fecha = (f: string | null | undefined): string => f ? f.slice(0, 10).split('-').reverse().join('-') : '—';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = (f: string): string => { const d = new Date(f); return isNaN(d.getTime()) ? f : `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; };
/** Diferencia con color: gastar MÁS que el paso anterior es rojo, menos es verde, cero es neutro. */
const dif = (n: number): string => Math.abs(n) < 1 ? '<span class="neutro">sin diferencia</span>' : `<span class="${n > 0 ? 'mas' : 'menos'}">${n > 0 ? '+' : '−'}${clp(Math.abs(n)).replace('−', '')}</span>`;
const dato = (rotulo: string, valor: string) => `<div class="dato"><div class="rot">${rotulo}</div><div class="val">${valor}</div></div>`;
const estado = (e: string | null) => { const t = (e ?? '—'); const c = /FACTURADA|PAGADA|ENTREGADA/i.test(t) ? '#16a34a' : /ANULAD/i.test(t) ? '#dc2626' : '#d97706'; return `<span class="est"><i style="background:${c}"></i>${esc(t.charAt(0) + t.slice(1).toLowerCase())}</span>`; };

const ETAPA: Record<EtapaAuditoria, string> = {
  'costeo-cotizado': 'Costeo → cotización',
  'cotizado-oc': 'Cotización → OC',
  'oc-factura': 'OC → factura',
};

function hallazgos(hs: Hallazgo[]): string {
  if (!hs.length) return '<p class="ok"><i></i>Sin diferencias: lo costeado, cotizado, ordenado y facturado coincide.</p>';
  return `<table class="t hall"><tbody>${hs.map(h =>
    `<tr><td class="paso">${ETAPA[h.etapa]}</td><td class="num monto">${dif(h.monto)}</td><td>${esc(h.texto)}${h.accion ? `<div class="accion">${esc(h.accion)}</div>` : ''}</td></tr>`).join('')}</tbody></table>`;
}

/** Barra horizontal proporcional al mayor valor de la serie. */
function barra(rotulo: string, valor: number, max: number, tono: string): string {
  const w = max > 0 ? Math.max(1.5, Math.round((valor / max) * 1000) / 10) : 0;
  return `<div class="barra"><span class="b-rot">${rotulo}</span><span class="b-pista"><span class="b-rel" style="width:${w}%;background:${tono}"></span></span><span class="b-val">${clp(valor)}</span></div>`;
}

export function construirAuditoriaHtml(a: AuditoriaCompra, generadoPor?: string | null): string {
  const p = a.puente;
  const max = Math.max(p.costeo, p.cotizado, p.oc, p.facturado, 1);

  // LIBRO DE DIFERENCIAS: cada peso que se movió entre un paso y el siguiente, dónde está y por qué. Suma exacta al total del paso.
  const libro = (titulo: string, de: string, a2: string, desdeV: number, hastaV: number, etapas: EtapaAuditoria[]): string => {
    const hs = a.proveedores.flatMap(g => g.hallazgos).filter(h => etapas.includes(h.etapa));
    const grandes = hs.filter(h => Math.abs(h.monto) > 2).sort((x, y) => Math.abs(y.monto) - Math.abs(x.monto));
    const chicas = hs.filter(h => Math.abs(h.monto) <= 2);
    const real = hastaV - desdeV;
    const sinAtribuir = Math.round(real - hs.reduce((s, h) => s + h.monto, 0));
    const accionUtil = (h: Hallazgo) => !!h.accion && (h.etapa === 'oc-factura' ? Math.abs(h.monto) > 2 : h.etapa === 'cotizado-oc' && Math.abs(h.monto) >= 1000);
    const filas = [
      ...grandes.map(h => `<tr><td>${esc(h.donde)}</td><td class="num">${dif(h.monto)}</td><td>${esc(h.texto)}${accionUtil(h) ? `<div class="accion">${esc(h.accion)}</div>` : ''}</td></tr>`),
      ...(chicas.length ? [`<tr><td>${chicas.length} caso(s) menores</td><td class="num">${dif(chicas.reduce((s, h) => s + h.monto, 0))}</td><td>Diferencias de $1 o $2 al pasar el IVA a neto o redondear un precio unitario.</td></tr>`] : []),
      ...(Math.abs(sinAtribuir) >= 2 ? [`<tr><td>Sin atribuir</td><td class="num">${dif(sinAtribuir)}</td><td>No se pudo asignar a un producto u OC concreto.</td></tr>`] : []),
    ];
    return `<div class="libro"><p class="libro-cab"><b>${titulo}</b><span>${de} ${clp(desdeV)} → ${a2} ${clp(hastaV)} · diferencia ${dif(real)}</span></p>${
      Math.abs(real) < 1 && !filas.length ? '<p class="ok"><i></i>Sin diferencia.</p>' : `<table class="t fijo"><colgroup><col style="width:27%"><col style="width:96px"><col></colgroup><thead><tr><th>Dónde está</th><th class="num">Diferencia</th><th>Por qué</th></tr></thead><tbody>${filas.join('')}</tbody><tfoot><tr><td>Total</td><td class="num">${dif(real)}</td><td></td></tr></tfoot></table>`}</div>`;
  };
  const puente = libro('Del costeo a lo comprado', 'Costeado', 'Comprado en OC', p.costeo, p.oc, ['costeo-cotizado', 'cotizado-oc'])
    + libro('De lo comprado a lo facturado', 'Comprado en OC', 'Facturado', p.oc, p.facturado, ['oc-factura']);

  // Por ítem: lo vendido, costeado, comprado, a quién y el margen. Es lo primero que se mira.
  const itemsTabla = a.items.length === 0 ? '' : (() => {
    const tot = a.items.reduce((t, i) => ({ v: t.v + (i.ventaNeto ?? 0), c: t.c + (i.costeoNeto ?? 0), b: t.b + (i.compradoNeto ?? 0), m: t.m + (i.margen ?? 0), vm: t.vm + (i.margen != null ? i.ventaNeto ?? 0 : 0) }), { v: 0, c: 0, b: 0, m: 0, vm: 0 });
    const mg = (m: number | null) => m == null ? '<span class="neutro">—</span>' : `<span class="${m < 0 ? 'mas' : ''}">${clp(m)}</span>`;
    return `<table class="t fijo items"><colgroup><col><col style="width:22%"><col style="width:36px"><col style="width:76px"><col style="width:76px"><col style="width:76px"><col style="width:76px"><col style="width:44px"></colgroup>
      <thead><tr><th>Producto</th><th>Comprado a</th><th class="num">Cant.</th><th class="num">Venta</th><th class="num">Costeado</th><th class="num">Comprado</th><th class="num">Margen</th><th class="num">%</th></tr></thead><tbody>${a.items.map(i => `<tr>
        <td>${esc(i.producto)}</td><td>${esc(i.proveedor ?? '—')}${i.oc ? `<span class="peq">OC ${esc(i.oc)}</span>` : '<span class="peq mas">sin OC</span>'}</td><td class="num">${i.cantidad ?? '—'}</td>
        <td class="num">${clp(i.ventaNeto)}</td><td class="num">${clp(i.costeoNeto)}</td><td class="num">${clp(i.compradoNeto)}</td><td class="num">${mg(i.margen)}</td><td class="num">${i.margenPct != null ? String(i.margenPct).replace('.', ',') : '—'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3">Total</td><td class="num">${clp(tot.v)}</td><td class="num">${clp(tot.c)}</td><td class="num">${clp(tot.b)}</td><td class="num">${clp(tot.m)}</td><td class="num">${tot.vm ? String(Math.round((tot.m / tot.vm) * 1000) / 10).replace('.', ',') : '—'}</td></tr></tfoot></table>
      <p class="nota">Venta y costeado salen del costeo. Comprado = la orden de compra (o la cotización elegida si aún no hay OC). Margen = venta − comprado, sin gastos extra${p.gastosExtra ? ` (${clp(p.gastosExtra)})` : ''}.</p>`;
  })();

  const bloques = a.proveedores.map(g => {
    const ocs = g.ocs.length === 0 ? '<p class="sutil">Todavía no hay órdenes de compra a este proveedor.</p>' : g.ocs.map(o => {
      const sinFac = o.facturas.length === 0;
      const d = sinFac ? -o.neto : o.facturadoNeto - o.neto;
      const fs = o.facturas.map(f => `N° ${esc(f.folio ?? 's/n')}${f.fecha ? ` · ${fecha(f.fecha)}` : ''}${f.enlazada ? '' : ' <span class="aviso-i">(está en el proyecto de Obuma, sin enlazar a la OC)</span>'}`).join('<br>');
      const lineasOc = o.lineas.length === 0 ? '' : `<table class="t fijo"><colgroup><col><col style="width:50px"><col style="width:92px"><col style="width:100px"></colgroup><thead><tr><th>Producto en la OC</th><th class="num">Cant.</th><th class="num">Precio c/u</th><th class="num">Neto</th></tr></thead><tbody>${o.lineas.map(l => `<tr><td>${esc(l.producto)}</td><td class="num">${l.cantidad ?? '—'}</td><td class="num">${clp(l.unit)}</td><td class="num">${clp(l.neto)}</td></tr>`).join('')}</tbody></table>`;
      return `<div class="oc"><div class="oc-cab"><b>OC ${esc(o.folio)}</b><span>${fecha(o.fecha)}</span>${estado(o.estado)}</div>
        ${lineasOc}
        <div class="cierre">
          <div class="paso-c"><span class="rot">Total de la OC</span><span class="cif">${clp(o.neto)}</span></div><span class="flecha">→</span>
          <div class="paso-c"><span class="rot">Factura</span><span class="cif">${sinFac ? '<span class="mas">sin factura</span>' : clp(o.facturadoNeto)}</span>${sinFac ? '' : `<span class="peq">${fs}</span>`}</div><span class="flecha">→</span>
          <div class="paso-c"><span class="rot">Diferencia (factura − OC)</span><span class="cif">${dif(d)}</span>${Math.abs(d) >= 1 && Math.abs(d) <= 2 ? '<span class="peq">redondeo de IVA</span>' : ''}</div>
        </div></div>`;
    }).join('');
    return `<section class="prov">
      <div class="prov-cab"><h3>${esc(g.proveedor)}</h3>
        <div class="mini">${dato('Costeado', clp(g.costeoNeto))}${dato('Cotizado', clp(g.cotizadoNeto))}${dato('Comprado', clp(g.ocNeto))}${dato('Facturado', clp(g.facturadoNeto))}</div></div>
      ${ocs}
    </section>`;
  }).join('');

  const sueltas = a.facturasSueltas as unknown as { folio: string | null; fecha: string | null; neto: number; proveedor?: string }[];
  const bloqueSueltas = sueltas.length === 0 ? '' : `<h2>Facturas del proyecto sin enlazar a una OC</h2><p class="sutil">Están contabilizadas en el proyecto de Obuma pero no cuelgan de ninguna orden de compra de este negocio; pueden ser un duplicado o una OC mal enlazada.</p>
    <table class="t"><thead><tr><th>Proveedor</th><th>Factura</th><th>Fecha</th><th class="num">Neto</th></tr></thead><tbody>${sueltas.map(f => `<tr><td>${esc(f.proveedor ?? '—')}</td><td>N° ${esc(f.folio ?? 's/n')}</td><td>${fecha(f.fecha)}</td><td class="num">${clp(f.neto)}</td></tr>`).join('')}</tbody></table>`;

  const cuadre = a.cuadre ? `<h2>Cuadre con el proyecto en Obuma</h2><p class="sutil">Proyecto ${esc(a.cuadre.proyectoFolio ?? '—')} · ${esc(a.cuadre.proyectoNombre ?? '')}. Montos con IVA, como los muestra Obuma.</p>
    <table class="t"><thead><tr><th></th><th class="num">En Obuma</th><th class="num">En Licitank</th><th class="num">Sin explicar</th></tr></thead><tbody>
      <tr><td>Órdenes de compra (${a.cuadre.oc.obumaCantidad} en Obuma · ${a.cuadre.oc.licitankCantidad} en Licitank)</td><td class="num">${clp(a.cuadre.oc.obumaTotal)}</td><td class="num">${clp(a.cuadre.oc.licitankTotal)}</td><td class="num">${clp(a.cuadre.oc.sinExplicar)}</td></tr>
      <tr><td>Facturas (${a.cuadre.facturas.obumaCantidad} en Obuma · ${a.cuadre.facturas.licitankCantidad} en Licitank)</td><td class="num">${clp(a.cuadre.facturas.obumaTotal)}</td><td class="num">${clp(a.cuadre.facturas.licitankTotal)}</td><td class="num">${clp(a.cuadre.facturas.sinExplicar)}</td></tr>
    </tbody></table>${[...a.cuadre.oc.diferencias, ...a.cuadre.facturas.diferencias].map(d => `<p class="nota">${esc(d.concepto)} · ${clp(d.monto)} con IVA</p>`).join('')}` : '';

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Auditoría de la compra ${esc(a.codigo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Roboto, "Segoe UI", -apple-system, Helvetica, Arial, sans-serif; color: #0f172a; font-size: 11px; line-height: 1.5; margin: 0; padding: 4px 8px 8px; font-variant-numeric: tabular-nums; }
  .marca { display: flex; justify-content: space-between; align-items: baseline; font-size: 10px; color: #64748b; padding-bottom: 8px; border-bottom: 1px solid #e2e8f0; }
  .marca b { color: #0d9488; font-weight: 700; letter-spacing: .04em; font-size: 11px; }
  h1 { font-size: 22px; font-weight: 600; letter-spacing: -.01em; margin: 14px 0 3px; line-height: 1.2; }
  .codigo { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 10.5px; color: #64748b; margin: 0; }
  h2 { font-size: 15px; font-weight: 600; letter-spacing: -.005em; margin: 26px 0 8px; }
  h3 { font-size: 13.5px; font-weight: 600; margin: 0; }
  .sub { font-size: 10px; color: #64748b; margin: 12px 0 2px; font-weight: 500; }
  .cifras { display: flex; margin: 14px 0 4px; }
  .dato { flex: 1; padding: 0 14px; border-left: 1px solid #e2e8f0; }
  .dato:first-child { padding-left: 0; border-left: 0; }
  .dato .rot { font-size: 10px; color: #64748b; }
  .dato .val { font-size: 19px; font-weight: 600; letter-spacing: -.01em; margin-top: 1px; }
  .barras { margin: 12px 0 2px; }
  .barra { display: flex; align-items: center; gap: 10px; margin: 5px 0; }
  .b-rot { width: 78px; color: #475569; font-size: 10.5px; }
  .b-pista { flex: 1; height: 9px; background: #f1f5f9; border-radius: 5px; overflow: hidden; }
  .b-rel { display: block; height: 100%; border-radius: 5px; }
  .b-val { width: 92px; text-align: right; font-weight: 600; }
  .lectura { margin: 10px 0 0; color: #334155; }
  .lectura b { font-weight: 600; color: #0f172a; }
  .t { width: 100%; border-collapse: collapse; margin: 6px 0 4px; font-size: 10px; }
  .t th { text-align: left; font-weight: 500; color: #64748b; padding: 5px 8px 5px 0; border-bottom: 1px solid #cbd5e1; font-size: 10px; }
  .t td { padding: 6px 8px 6px 0; border-bottom: 1px solid #eef2f6; vertical-align: top; }
  .t tr { break-inside: avoid; }
  .t tr.abre td { border-top: 1px solid #cbd5e1; }
  .t td:last-child, .t th:last-child { padding-right: 0; }
  .t th.num, .t td.num { text-align: right; white-space: nowrap; }
  .t.fijo { table-layout: fixed; }
  .t.fijo td { overflow-wrap: anywhere; }
  .t tfoot td { font-weight: 600; border-top: 1px solid #94a3b8; border-bottom: 0; padding-top: 7px; }
  .peq { display: block; font-size: 9.5px; color: #64748b; font-weight: 400; }
  .oc { margin: 10px 0 0; }
  .oc-cab { display: flex; gap: 12px; align-items: baseline; margin-bottom: 2px; font-size: 11px; }
  .oc-cab span { color: #64748b; }
  .cierre { display: flex; align-items: flex-start; gap: 10px; margin: 6px 0 2px; padding: 8px 10px; background: #f8fafc; border-radius: 8px; }
  .paso-c { flex: 1; } .paso-c .rot { display: block; font-size: 9.5px; color: #64748b; } .paso-c .cif { display: block; font-size: 13px; font-weight: 600; }
  .flecha { color: #94a3b8; padding-top: 12px; }
  .paso { color: #475569; font-weight: 500; width: 22%; }
  .hall td.paso { width: 16%; } .hall td.monto { width: 13%; font-weight: 600; }
  .mas { color: #b91c1c; font-weight: 600; } .menos { color: #15803d; font-weight: 600; } .neutro { color: #94a3b8; }
  .est { white-space: nowrap; } .est i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; }
  .ok { color: #15803d; margin: 6px 0 2px; } .ok i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #16a34a; margin-right: 6px; vertical-align: 1px; }
  .accion { color: #0f766e; margin-top: 2px; font-weight: 500; }
  .aviso-i { color: #b45309; font-size: 9.5px; }
  .sutil { color: #94a3b8; margin: 3px 0; } .nota { margin: 3px 0; color: #475569; font-size: 10px; }
  .pend { margin: 4px 0; padding: 0; list-style: none; } .pend li { padding: 5px 0; border-bottom: 1px solid #eef2f6; }
  .pend b { font-weight: 600; }
  .prov { margin: 18px 0 0; padding-top: 14px; border-top: 2px solid #0d9488; }
  .prov-cab { display: flex; justify-content: space-between; align-items: flex-end; gap: 14px; margin-bottom: 4px; }
  .prov-cab h3 { flex: 1; }
  .mini { display: flex; } .mini .dato { padding: 0 11px; flex: none; } .mini .dato:last-child { padding-right: 0; } .mini .val { font-size: 12px; } .mini .rot { font-size: 9.5px; }
  .pie { margin-top: 26px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; }
</style></head><body>
<div class="marca"><b>LICITANK</b><span>Auditoría de la compra · ${esc(fechaLarga(a.generadoEn))}</span></div>
<h1>${esc(a.nombre || 'Compra')}</h1>
<p class="codigo">${esc(a.codigo)}${a.organismo ? ` · ${esc(a.organismo)}` : ''}</p>

<h2>Resumen</h2>
<div class="cifras">
  ${dato('Venta (OC del cliente)', clp(p.venta))}${dato('Costeado', clp(p.costeo))}${dato('Cotizado', clp(p.cotizado))}${dato('Comprado en OC', clp(p.oc))}${dato('Facturado', clp(p.facturado))}
</div>
<div class="barras">
  ${barra('Costeado', p.costeo, max, '#94a3b8')}${barra('Cotizado', p.cotizado, max, '#64748b')}${barra('Comprado (OC)', p.oc, max, '#0d9488')}${barra('Facturado', p.facturado, max, '#0f766e')}
</div>
<p class="lectura">Margen real con lo comprado: <b>${clp(p.margenNeto)}</b>${p.margenPct != null ? ` (${String(p.margenPct).replace('.', ',')} %)` : ''}${p.gastosExtra ? `, contando gastos extra por ${clp(p.gastosExtra)}` : ''}. Del costeo a lo comprado hay ${dif(p.oc - p.costeo)}; de lo comprado a lo facturado, ${dif(p.facturado - p.oc)}. Todo sin IVA.</p>

${itemsTabla ? `<h2>Producto por producto</h2>${itemsTabla}` : ''}

${puente ? `<h2>De dónde salen las diferencias</h2>${puente}` : ''}

<h2>Órdenes de compra y facturas, por proveedor</h2>
${bloques || '<p class="sutil">Este negocio todavía no tiene cotización elegida ni órdenes de compra.</p>'}

${bloqueSueltas}

${cuadre}

<p class="pie">${generadoPor ? `Generado por ${esc(generadoPor)}. ` : ''}Cotizado = cotización elegida en Compras · Comprado = órdenes de compra vigentes · Facturado = facturas enlazadas a cada OC.</p>
</body></html>`;
}
