// app/lib/generar-informe.ts
// Genera el DOCUMENTO del Informe de Viabilidad (bloque B del PROMPT 2 v3.3: "informe legible")
// en PDF, a partir del JSON canónico ya guardado (_informe_ia_v3). Es el análogo del Excel de
// costeo: arma un HTML autocontenido print-friendly y lo renderiza a PDF con el chromium que ya
// usa el scraping (puppeteer-core + @sparticuz/chromium). Tolerante a v3.3 (clase/productos/
// tramo_max_puntaje) y a informes v3.2 guardados (tipo_aplicacion/costeo/piso_o_tope).
import puppeteerCore from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { existsSync } from 'fs';

// ── util ───────────────────────────────────────────────────────────────────────────
const esc = (x: any): string => String(x ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cap = (s: any): string => { const t = String(s ?? '').replace(/_/g, ' ').toLowerCase(); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const fmtCLP = (n: any): string => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? '$' + v.toLocaleString('es-CL') : '—';
};
const TIPO_LABEL: Record<string, string> = {
  LEY_DEL_MINIMO: '⭐ LEY DEL MÍNIMO', LEY_DEL_MAXIMO: '⭐ LEY DEL MÁXIMO',
  POR_TRAMOS: 'POR TRAMOS', TRAMO_CERRADO: 'TRAMO CERRADO', BINARIO: 'BINARIO',
};
const JUGADA_ICON: Record<string, string> = { OPORTUNIDAD: '🟢', RESOLVER: '🟡', EMPATE: '⚪', EN_CONTRA: '🔴' };
const CRIT_ICON: Record<string, string> = { ADMISIBILIDAD_DURA: '🔴', PUNTAJE_CONDICIONANTE: '🟡', COMPROMISO_EJECUCION: '🟢' };

// Chromium: mismo criterio que mp-descarga-browser (env → binario del sistema → @sparticuz).
const CANDIDATOS_WINDOWS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const CANDIDATOS_LINUX = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
const ARGS_SISTEMA = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];

async function resolverChromium(): Promise<{ executablePath: string; args: string[] }> {
  const crudo = process.env.CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '';
  const limpio = crudo.trim().replace(/^["']|["']$/g, '');
  if (limpio && existsSync(limpio)) return { executablePath: limpio, args: ARGS_SISTEMA };
  const candidatos = process.platform === 'win32' ? CANDIDATOS_WINDOWS : CANDIDATOS_LINUX;
  const encontrado = candidatos.find(p => p && existsSync(p));
  if (encontrado) return { executablePath: encontrado, args: ARGS_SISTEMA };
  return { executablePath: await chromium.executablePath(), args: chromium.args };
}

/** Renderiza un HTML autocontenido a PDF A4 (buffer). */
export async function generarInformePdf(html: string): Promise<Buffer> {
  const { executablePath, args } = await resolverChromium();
  const browser = await puppeteerCore.launch({ args, executablePath, headless: true });
  try {
    const page = await browser.newPage();
    // El HTML es autocontenido (CSS inline, sin recursos externos) → 'load' basta.
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

// ── bloques del informe ──────────────────────────────────────────────────────────────
function seccion(titulo: string, cuerpo: string, badge = ''): string {
  if (!cuerpo.trim()) return '';
  return `<section class="sec">
    <h2>${esc(titulo)}${badge ? `<span class="badge">${esc(badge)}</span>` : ''}</h2>
    ${cuerpo}
  </section>`;
}
const fuente = (f: any): string => f ? `<span class="src">${esc(f)}</span>` : '';

/** Construye el HTML completo del informe legible desde el JSON v3.3 (o v3.2 guardado). */
export function construirInformeHtml(codigo: string, informe: any): string {
  const meta = informe.meta || {};
  const t = informe.tarjeta_decision || {};
  const score = Math.round(Number(informe.score_0_100 ?? informe.score_global) || 0);
  const semColor = score >= 70 ? '#10b981' : score >= 50 ? '#22c55e' : score >= 35 ? '#eab308' : '#ef4444';
  const verLabel = t.veredicto === 'GANABLE' ? 'GANABLE' : t.veredicto === 'NO_VAMOS' ? 'NO VAMOS' : 'PUEDE SER';
  const esNoVamos = t.veredicto === 'NO_VAMOS';
  const adj = informe.adjudicacion || {};
  const atr = informe.atractivo || {};
  const est = informe.estrategia || {};
  const dsd = est.donde_se_decide || {};
  const adm = informe.requisitos_admisibilidad || {};
  const plz = informe.plazos || {};
  const mul = informe.multas || {};
  const crit = informe.criterios_evaluacion || {};
  const criterios: any[] = crit.criterios || [];
  const lin = informe.lineas_a_atacar || {};
  const acc = informe.acciones_y_advertencias || {};
  const enRevision = informe.veredicto?.estado_veredicto === 'REVISION_HUMANA';

  // Productos (mismo criterio que el panel: fuente más completa; en empate, la del informe con fichas).
  const cost = informe.productos || informe.costeo || {};
  const hojas = cost.hojas_costeo_segun_adjudicacion || cost.hojas_segun_adjudicacion || '';
  const _manif: any[] = Array.isArray(informe.manifiesto_productos) ? informe.manifiesto_productos : [];
  const _prod: any[] = Array.isArray(cost.items) ? cost.items : [];
  const fuenteItems: any[] = _manif.length > _prod.length ? _manif : (_prod.length ? _prod : _manif);
  const items = fuenteItems.map((p: any, i: number) => ({
    linea: p.linea ?? i + 1,
    descripcion: p.descripcion ?? p.nombre ?? p.descripcion_exacta ?? '',
    modelo: p.modelo ?? p.marca_modelo_referencia ?? p.marca_modelo ?? '',
    cantidad: p.cantidad, unidad_medida: p.unidad_medida, unidad_inferida: p.unidad_inferida, ruta: p.ruta,
    marca_exclusiva: p.marca_exclusiva,
    clasificacion: String(p.clasificacion ?? p.tipo ?? '').toLowerCase(),
    caracteristicas: Array.isArray(p.caracteristicas) ? p.caracteristicas : [],
    libertad_de_oferta: p.libertad_de_oferta ?? false,
    admite_equivalente: p.admite_equivalente,
  }));
  const etiquetaLinea = (l: any) => typeof l === 'string' && /^L/i.test(l) ? l : `L${l}`;

  // TARJETA
  const tarjeta = `
    <div class="card" style="border-color:${semColor}">
      <div class="card-top">
        <div class="gauge" style="border-color:${semColor};color:${semColor}">${score}</div>
        <div>
          <div class="ver" style="background:${semColor}">${esc(verLabel)}</div>
          ${meta.linea_negocio ? `<span class="chip">${esc(cap(meta.linea_negocio))}</span>` : ''}
          <span class="chip ${enRevision ? 'warn' : 'ok'}">${enRevision ? 'REVISIÓN HUMANA' : 'DEFINITIVO'}</span>
          ${t.titular ? `<p class="titular">${esc(t.titular)}</p>` : ''}
        </div>
      </div>
      ${esNoVamos
        ? (t.porque_no ? `<p class="porque-no"><b>POR QUÉ NO:</b> ${esc(t.porque_no)}</p>` : '')
        : `${t.se_gana_en ? `<p><b>SE GANA EN:</b> ${esc(t.se_gana_en)}</p>` : ''}
           ${(t.para_ganar?.length) ? `<p class="lbl">PARA GANAR</p><ol>${t.para_ganar.map((x: string) => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}
           ${(t.no_quedes_fuera?.length) ? `<p class="lbl red">NO QUEDES FUERA</p><ul>${t.no_quedes_fuera.map((x: string) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
           ${t.antes_de_ir ? `<p class="muted"><b>ANTES DE IR:</b> ${esc(t.antes_de_ir)}</p>` : ''}`}
    </div>`;

  // DATOS CLAVE
  const datos = `<div class="grid4">
    <div class="kpi"><span>Presupuesto</span><b>${esc(atr.presupuesto_mostrar || fmtCLP(informe.presupuesto?.neto ?? informe.presupuesto?.bruto))}</b>${adm.presupuesto?.tipo === 'excluyente' ? '<i class="tag red">EXCLUYENTE</i>' : '<i class="tag">referencial</i>'}</div>
    <div class="kpi"><span>Cómo se adjudica</span><b>${esc(cap(adj.como_se_adjudica) || '—')}</b>${adj.cotizar_100_obligatorio ? '<i class="tag red">COTIZAR 100%</i>' : ''}</div>
    <div class="kpi"><span>Colchón</span><b>${plz.colchon_dias_corridos != null ? `${esc(plz.colchon_dias_corridos)} días` : '—'}</b>${plz.ventana_importacion ? '<i class="tag blue">importar</i>' : ''}</div>
    <div class="kpi"><span>Atractivo</span><b>${esc(cap(atr.nivel || atr.veredicto) || '—')}</b></div>
  </div>`;

  // CRITERIOS
  const critHtml = criterios.length ? seccion('Criterios de evaluación',
    criterios.slice().sort((a, b) => (Number(b.ponderacion_efectiva) || 0) - (Number(a.ponderacion_efectiva) || 0)).map(c => {
      const clase = c.clase ?? c.tipo_aplicacion;
      const borde = c.tramo_max_puntaje?.borde_comodo || c.piso_o_tope;
      return `<div class="item">
        <p><b>${esc(c.nombre)}</b> ${TIPO_LABEL[clase] ? `<i class="tag">${esc(TIPO_LABEL[clase])}</i>` : ''} ${borde ? `<i class="tag amber">${esc(borde)}</i>` : ''} <span class="pct">${esc(c.ponderacion_efectiva ?? 0)}%</span></p>
        ${c.forma_aplicacion ? `<p class="muted">${esc(c.forma_aplicacion)}</p>` : ''}
        ${c.medio_verificacion ? `<p class="muted sm">Verificación: ${esc(c.medio_verificacion)}</p>` : ''}
        ${fuente(c.fuente)}
      </div>`;
    }).join('') +
    ((crit.alertas?.length) ? `<div class="alert">${crit.alertas.map((a: string) => `⚠ ${esc(a)}`).join('<br>')}</div>` : ''),
    `suma ${Math.round(Number(crit.suma_ponderaciones_real) || 0)}%${crit.suma_valida ? ' ✓' : ' ⚠'}`)
    : (informe.veredicto?.motivos_revision?.length ? `<section class="sec"><h2>Criterios de evaluación</h2><div class="alert">⚠ ${esc(informe.veredicto.motivos_revision.join(' · '))}</div></section>` : '');

  // ATRACTIVO
  const atrHtml = atr.lectura_comercial ? seccion('Atractivo', `<p>${esc(atr.lectura_comercial)}</p>`, cap(atr.nivel || atr.veredicto)) : '';

  // ESTRATEGIA
  const jugadas = est.jugadas || [];
  const estHtml = (jugadas.length || dsd.orden_final) ? seccion('Estrategia — dónde se gana y qué hacer',
    jugadas.map((j: any) => {
      const clase = j.clase ?? j.tipo_aplicacion;
      return `<div class="item">
        <p><b>${JUGADA_ICON[j.etiqueta] || '•'} ${esc(j.criterio)}</b>${TIPO_LABEL[clase] ? ` · ${esc(TIPO_LABEL[clase])}` : ''}${j.exige_respaldo ? ' · ⚠ EXIGE STOCK/RESPALDO' : ''}</p>
        ${j.lectura ? `<p class="muted">${esc(j.lectura)}</p>` : ''}
        ${j.orden ? `<p class="orden">▸ ${esc(j.orden)}${j.valor_a_ofertar ? ` (${esc(j.valor_a_ofertar)})` : ''}</p>` : ''}
        ${fuente(j.fuente)}
      </div>`;
    }).join('') +
    (dsd.orden_final ? `<div class="decide"><b>Dónde se decide:</b> ${esc(dsd.orden_final)}${dsd.se_decide_en ? ` <i class="tag">se decide en: ${esc(cap(dsd.se_decide_en))}</i>` : ''}${dsd.tenemos_ventaja_costo === 'si' ? ' <i class="tag green">ventaja de costo</i>' : ''}</div>` : '')) : '';

  // ADMISIBILIDAD
  const admLineas: string[] = [];
  admLineas.push(`${adm.firma_puno_y_letra?.exigida ? '⚠' : '✓'} Firma: ${adm.firma_puno_y_letra?.exigida ? 'PUÑO Y LETRA exigida' : 'electrónica válida'} ${fuente(adm.firma_puno_y_letra?.fuente)}`);
  if (adm.presupuesto?.tipo) admLineas.push(`${adm.presupuesto.tipo === 'excluyente' ? '🔴' : '•'} Presupuesto: ${adm.presupuesto.tipo === 'excluyente' ? 'EXCLUYENTE' : 'referencial'} ${fuente(adm.presupuesto.fuente)}`);
  if (adm.cotizar_100?.aplica) admLineas.push(`🚫 Cotizar el 100% — falta 1 ítem = fuera ${fuente(adm.cotizar_100.fuente)}`);
  if (adm.boleta?.aplica) admLineas.push(`• Boleta: ${esc(adm.boleta.detalle || `sobre ${adm.boleta.umbral_utm ?? 1000} UTM`)} ${fuente(adm.boleta.fuente)}`);
  if (adm.fiel_cumplimiento?.exige) admLineas.push(`⚠ Garantía de fiel cumplimiento${adm.fiel_cumplimiento.forma ? ` (${esc(cap(adm.fiel_cumplimiento.forma))})` : ''} · fuerza cadena LARGA ${fuente(adm.fiel_cumplimiento.fuente)}`);
  if (adm.contrato?.exige) admLineas.push(`• Suscripción de contrato${adm.contrato.plazos ? ` — ${esc(adm.contrato.plazos)}` : ''} · fuerza cadena LARGA ${fuente(adm.contrato.fuente)}`);
  if (adm.seriedad_oferta?.exige) admLineas.push(`• Garantía de seriedad de la oferta ${fuente(adm.seriedad_oferta.fuente)}`);
  if (adm.marca_exclusiva?.es_exclusiva) admLineas.push(`⚠ MARCA EXCLUSIVA sin "o equivalente" ${fuente(adm.marca_exclusiva.fuente)}`);
  (adm.bloqueantes || []).forEach((b: any) => admLineas.push(`🚫 ${esc(b.item)} ${fuente(b.fuente)}`));
  (adm.a_favor || []).forEach((b: any) => admLineas.push(`✅ ${esc(b.item)} ${fuente(b.fuente)}`));
  const admHtml = seccion('Requisitos de admisibilidad', admLineas.map(l => `<p class="chk">${l}</p>`).join(''),
    (adm.bloqueantes?.length) ? `${adm.bloqueantes.length} bloqueante(s)` : 'sin bloqueantes');

  // ANEXOS PROPIOS (orden de trabajo)
  const anexos = adm.orden_anexos_propios || [];
  const anexosHtml = anexos.length ? seccion('Documentos propios a crear — orden de trabajo',
    anexos.slice().sort((a: any, b: any) => (a.criticidad === 'ADMISIBILIDAD_DURA' ? 0 : a.criticidad === 'PUNTAJE_CONDICIONANTE' ? 1 : 2) - (b.criticidad === 'ADMISIBILIDAD_DURA' ? 0 : b.criticidad === 'PUNTAJE_CONDICIONANTE' ? 1 : 2)).map((d: any) => `<div class="item">
      <p>${CRIT_ICON[d.criticidad] || '🟢'} <b>${esc(d.que_crear)}</b>${d.responsable ? ` <i class="tag">${esc(cap(d.responsable))}</i>` : ''}</p>
      ${d.por_que ? `<p class="muted sm">POR QUÉ: ${esc(d.por_que)}</p>` : ''}
      ${d.que_debe_contener ? `<p class="muted sm">CONTENER: ${esc(d.que_debe_contener)}</p>` : ''}
      ${d.que_cubre ? `<p class="muted sm">CUBRE: ${esc(d.que_cubre)}</p>` : ''}
      ${fuente(d.fuente)}
    </div>`).join(''), `${anexos.length}`) : '';

  // PLAZOS
  const plazosHtml = (plz.colchon_dias_corridos != null || (plz.hitos?.length)) ? seccion('Plazos (colchón administrativo)',
    `<p><b>Colchón:</b> ≈ ${esc(plz.colchon_dias_corridos ?? '—')} días corridos · cadena ${esc(cap(plz.cadena))}${plz.ventana_importacion ? ' · ✅ VENTANA PARA IMPORTAR' : ''}</p>
    ${plz.frontera?.descripcion ? `<p class="muted">Frontera (arranca la entrega): ${esc(plz.frontera.descripcion)} ${fuente(plz.frontera.fuente)}</p>` : ''}
    ${(plz.hitos || []).map((h: any) => `<p class="chk">• ${esc(h.hito)}${h.duracion != null ? ` — ${esc(h.duracion)} ${esc(h.unidad || '')}` : ''}${h.duracion_corridos != null && h.duracion_corridos > 0 && h.unidad !== 'corridos' ? ` (≈ ${esc(h.duracion_corridos)} corridos)` : ''}${h.inferido ? ' (inferido ⚠)' : ''} ${fuente(h.fuente)}</p>`).join('')}`,
    plz.colchon_dias_corridos != null ? `colchón ${plz.colchon_dias_corridos} días` : '') : '';

  // MULTAS
  const multasHtml = (mul.detectadas || mul.estructura) ? seccion('Multas por atraso',
    mul.detectadas === false ? '<p class="muted">No se detectaron multas por atraso.</p>'
      : `<p>${esc(mul.estructura || '')}${mul.costo_por_dia_pesos ? ` · ${esc(mul.costo_por_dia_pesos)}/día` : ''}${mul.tope ? ` · tope: ${esc(mul.tope)}` : ''}${mul.efecto_al_superar_tope ? ` · ${esc(mul.efecto_al_superar_tope)}` : ''} ${fuente(mul.fuente)}</p>`) : '';

  // PRODUCTOS
  const prodHtml = items.length ? seccion('Productos a costear (base del scraping)',
    ((cost.entregables_word?.length) ? `<p class="muted sm">Entregables: ${cost.entregables_word.map((w: string) => esc(cap(w))).join(' · ')} (fichas en el informe; Word pendiente)</p>` : '') +
    items.map((p) => `<div class="prod">
      <p><span class="ln">${esc(etiquetaLinea(p.linea))}</span> ${esc(p.descripcion)}${p.modelo ? ` · ${esc(p.modelo)}` : ''} ${p.cantidad != null ? `<span class="qty">${esc(p.cantidad)} ${esc(p.unidad_medida || '')}${p.unidad_inferida ? '*' : ''}</span>` : ''}</p>
      <p class="tags">${p.clasificacion === 'especifico' ? '<i class="tag indigo">Específico</i>' : p.clasificacion === 'generico' ? '<i class="tag">Genérico</i>' : ''}${p.libertad_de_oferta ? '<i class="tag green">🟢 Libertad de oferta</i>' : ''}${p.admite_equivalente === false ? '<i class="tag amber">marca exacta</i>' : ''}${p.ruta ? `<i class="tag">Ruta ${esc(p.ruta)}</i>` : ''}${p.marca_exclusiva ? '<i class="tag amber">⚠ marca exclusiva</i>' : ''}</p>
      ${p.caracteristicas.length ? `<ul class="ficha">${p.caracteristicas.map((c: string) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    </div>`).join(''), `${items.length} ítems · ${esc(hojas)}`) : '';

  // LÍNEAS A ATACAR
  const lineasHtml = (lin.modo === 'POR_LINEAS' ? (lin.lineas?.length) : !!lin.mensaje_global_o_lote) ? seccion('Líneas a atacar',
    lin.modo === 'POR_LINEAS'
      ? (lin.lineas || []).map((l: any) => `<p class="chk"><i class="tag ${l.decision === 'atacar' ? 'green' : ''}">${esc(etiquetaLinea(l.linea))} · ${esc(cap(l.decision))}</i> ${esc(l.motivo)}</p>`).join('')
      : `<p>${esc(lin.mensaje_global_o_lote)}</p>`, cap(lin.modo)) : '';

  // ACCIONES Y ADVERTENCIAS
  const accHtml = ((acc.acciones?.length) || (acc.advertencias?.length)) ? seccion('Acciones y advertencias',
    ((acc.acciones?.length) ? `<p class="lbl">PARA POSTULAR</p><ol>${acc.acciones.map((a: any) => `<li><b>${esc(a.orden)}</b>${a.por_que ? ` — ${esc(a.por_que)}` : ''} ${fuente(a.fuente)}</li>`).join('')}</ol>` : '') +
    ((acc.advertencias?.length) ? `<p class="lbl red">ADVERTENCIAS</p><ul>${acc.advertencias.map((a: any) => `<li>⚠ ${esc(a.riesgo)}${a.consecuencia ? ` — ${esc(a.consecuencia)}` : ''} ${fuente(a.fuente)}</li>`).join('')}</ul>` : '')) : '';

  const fecha = new Date().toISOString().slice(0, 10);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color:#1e293b; font-size:11px; line-height:1.42; margin:0; }
    h1 { font-size:16px; margin:0 0 2px; }
    .head { border-bottom:2px solid #7c3aed; padding-bottom:8px; margin-bottom:12px; }
    .head .meta { color:#64748b; font-size:10.5px; }
    .card { border:2px solid; border-radius:12px; padding:12px; margin-bottom:12px; page-break-inside:avoid; }
    .card-top { display:flex; gap:12px; align-items:center; margin-bottom:6px; }
    .gauge { width:52px; height:52px; border:4px solid; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:18px; font-weight:800; flex-shrink:0; }
    .ver { display:inline-block; color:#fff; font-weight:800; font-size:11px; padding:2px 8px; border-radius:5px; }
    .titular { font-size:13px; font-weight:700; margin:5px 0 0; }
    .chip { display:inline-block; font-size:9px; border:1px solid #cbd5e1; color:#475569; padding:1px 7px; border-radius:20px; margin-left:5px; }
    .chip.ok { background:#ecfdf5; color:#047857; border-color:#a7f3d0; }
    .chip.warn { background:#fffbeb; color:#b45309; border-color:#fde68a; }
    .lbl { font-size:9px; font-weight:800; color:#94a3b8; text-transform:uppercase; margin:6px 0 2px; }
    .lbl.red { color:#ef4444; }
    .porque-no { color:#b91c1c; }
    .muted { color:#64748b; }
    .sm { font-size:10px; }
    ol, ul { margin:2px 0; padding-left:18px; }
    li { margin:1px 0; }
    .grid4 { display:flex; gap:6px; margin-bottom:12px; }
    .kpi { flex:1; border:1px solid #e2e8f0; border-radius:8px; padding:7px; }
    .kpi span { font-size:9px; font-weight:700; color:#94a3b8; text-transform:uppercase; display:block; }
    .kpi b { font-size:12px; color:#0f172a; display:block; margin:1px 0; }
    .tag { display:inline-block; font-size:9px; background:#f1f5f9; color:#475569; padding:1px 6px; border-radius:4px; font-style:normal; margin-right:3px; }
    .tag.red { background:#fee2e2; color:#b91c1c; } .tag.amber { background:#fef3c7; color:#b45309; }
    .tag.green { background:#d1fae5; color:#047857; } .tag.blue { background:#e0f2fe; color:#0369a1; }
    .tag.indigo { background:#eef2ff; color:#4f46e5; }
    .sec { margin-bottom:12px; page-break-inside:avoid; }
    .sec h2 { font-size:12px; color:#7c3aed; border-bottom:1px solid #ede9fe; padding-bottom:3px; margin:0 0 6px; }
    .badge { float:right; font-size:9px; font-weight:600; color:#94a3b8; }
    .item { border-bottom:1px solid #f1f5f9; padding:4px 0; }
    .item p { margin:1px 0; }
    .pct { float:right; font-weight:800; }
    .orden { font-weight:700; text-transform:uppercase; font-size:10.5px; }
    .decide { background:#f5f3ff; border:1px solid #ddd6fe; border-radius:8px; padding:7px; margin-top:5px; }
    .chk { margin:2px 0; }
    .alert { color:#b45309; background:#fffbeb; border-radius:6px; padding:5px; margin-top:4px; }
    .prod { border-bottom:1px solid #f1f5f9; padding:4px 0; page-break-inside:avoid; }
    .prod .ln { display:inline-block; width:28px; color:#94a3b8; }
    .prod .qty { color:#64748b; }
    .prod .tags { padding-left:28px; margin:2px 0; }
    .ficha { padding-left:40px; color:#64748b; font-size:10px; }
    .src { display:block; font-size:9px; color:#a1a1aa; font-style:italic; }
    .foot { margin-top:14px; border-top:1px solid #e2e8f0; padding-top:6px; font-size:9.5px; color:#94a3b8; text-align:center; }
  </style></head><body>
    <div class="head">
      <h1>${esc(meta.nombre || 'Informe de Viabilidad')}</h1>
      <div class="meta">${esc(meta.organismo || '')}${meta.region ? ` · ${esc(meta.region)}` : ''} · ${esc(codigo)}</div>
    </div>
    ${tarjeta}
    ${datos}
    ${critHtml}
    ${atrHtml}
    ${estHtml}
    ${admHtml}
    ${anexosHtml}
    ${plazosHtml}
    ${multasHtml}
    ${prodHtml}
    ${lineasHtml}
    ${accHtml}
    <div class="foot">
      ${(informe.pendientes_fase3?.length) ? `Pendiente Fase 3: ${esc(informe.pendientes_fase3.join(', '))} · ` : ''}
      Leídos ${esc(informe.documentos_leidos?.length ?? 0)} doc(s) · confianza ${Math.round((informe.confianza_global ?? 0) * 100)}% · Informe v3.3 · Generado ${esc(fecha)}
    </div>
  </body></html>`;
}
