// app/lib/auditor-linea-pdf.ts
// Auditor Técnico — la comparación de UNA línea (PROMPT 4), como documento imprimible.
//
// Por qué existe (28-sep-2026, pedido del usuario): el modal ya muestra todo esto en pantalla,
// pero para archivar la comparación, mandarla a un colega o adjuntarla a un correo hacía falta un
// documento — primero se probó una captura de pantalla, pero el usuario la rechazó ("mejor no como
// pantallazo") y pidió un PDF de verdad.
//
// REUSA el motor del Informe Técnico (generarInformePdf: HTML autocontenido → chromium → PDF A4),
// igual que entrega-pdf.ts. Acá solo se arma el HTML, a partir de EXACTAMENTE los mismos datos que
// pinta el modal (armarEstado() de comparador/route.ts) — nada se recalcula ni se inventa acá.
import type { FilaEstado, EstadoComparador } from '@/app/lib/auditor-comparador-cliente';
import type { CriticidadP4, OrigenDato } from '@/app/lib/auditor-comparador-core';

const esc = (x: any): string => String(x ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const clp = (n: number | null | undefined): string =>
  n == null ? '—' : `$${Number(n).toLocaleString('es-CL')}`;

const fecha = (f: string | null | undefined): string => {
  if (!f) return '—';
  const d = new Date(String(f).replace(' ', 'T'));
  return isNaN(d.getTime()) ? String(f) : d.toLocaleString('es-CL', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const CRITICIDAD: Record<CriticidadP4, string> = {
  INADMISIBLE: 'INADMISIBLE', PUNTAJE: 'PUNTAJE', COMPROMISO: 'COMPROMISO', SIN_CLASIFICAR: 'SIN CLASIFICAR',
};
const ORIGEN: Record<OrigenDato, string> = {
  FICHA: 'ficha', CONFIRMACION_INFORMAL: 'informal', DECLARADO: 'declarado',
  CONTRADICE_FICHA: 'contradice la ficha', HEREDADO: 'heredado', NO_LEGIBLE: 'no legible',
};
const ESTADO_LABEL: Record<FilaEstado['estado'], string> = { NO_CUMPLIDA: 'NO CUMPLE', PENDIENTE: 'PENDIENTE', CUMPLIDA: 'CUMPLE' };
const ESTADO_CLASE: Record<FilaEstado['estado'], string> = { NO_CUMPLIDA: 'e-no', PENDIENTE: 'e-pend', CUMPLIDA: 'e-si' };
const ORDEN_ESTADO: Record<FilaEstado['estado'], number> = { NO_CUMPLIDA: 0, PENDIENTE: 1, CUMPLIDA: 2 };

function exigidoDe(f: FilaEstado): string {
  const u = f.unidad_requerida ? ` ${f.unidad_requerida}` : '';
  const pref = ({ PISO: '≥ ', TECHO: '≤ ', EXACTO: '= ', RANGO: '', CUALITATIVO: '', NORMATIVO: '' } as Record<string, string>)[f.tipo] ?? '';
  if (f.valor_requerido_numero != null && f.valor_requerido_numero !== 0) {
    return f.tipo === 'RANGO' && f.valor_requerido_numero_max != null
      ? `${f.valor_requerido_numero} a ${f.valor_requerido_numero_max}${u}` : `${pref}${f.valor_requerido_numero}${u}`;
  }
  return f.valor_requerido_texto || '—';
}
function ofertadoDe(f: FilaEstado): string {
  if (f.valor_ofertado_texto?.trim()) return f.unidad_ofertada_original && /^[\d.,\s]+$/.test(f.valor_ofertado_texto) ? `${f.valor_ofertado_texto} ${f.unidad_ofertada_original}` : f.valor_ofertado_texto;
  if (f.valor_ofertado_numero != null) return `${f.valor_convertido_numero ?? f.valor_ofertado_numero}${f.unidad_ofertada_original ? ` ${f.unidad_ofertada_original}` : ''}`;
  return 'no declarado en la ficha';
}

function tarjetaCaracteristica(f: FilaEstado): string {
  const a = f.analisis;
  const origen = a.origen_dato ? ORIGEN[a.origen_dato] : null;
  const badges = [
    `<span class="badge ${ESTADO_CLASE[f.estado]}">${esc(ESTADO_LABEL[f.estado])}</span>`,
    `<span class="badge b-crit">${esc(CRITICIDAD[f.criticidad])}</span>`,
    `<span class="badge b-tipo">${esc(f.tipo)}</span>`,
    origen ? `<span class="badge b-origen">${esc(origen)}</span>` : '',
  ].filter(Boolean).join(' ');

  const notas = (a.notas_sistema || []).map(n => `<p class="nota">⚙ ${esc(n)}</p>`).join('');
  const ayuda = a.ayuda;
  const bloqueAyuda = f.estado !== 'CUMPLIDA' && ayuda && (ayuda.diagnostico || ayuda.hipotesis_causa?.length || ayuda.pregunta_proveedor || ayuda.veredicto_equivalencia) ? `
    <div class="ayuda">
      ${ayuda.diagnostico ? `<p><b>Diagnóstico:</b> ${esc(ayuda.diagnostico)}</p>` : ''}
      ${ayuda.hipotesis_causa?.length ? `<p><b>Causa probable:</b> ${esc(ayuda.hipotesis_causa.join(' · '))}</p>` : ''}
      ${ayuda.pregunta_proveedor ? `<p><b>Pregunta al proveedor:</b> "${esc(ayuda.pregunta_proveedor)}"</p>` : ''}
      ${ayuda.veredicto_equivalencia ? `<p><b>Veredicto de equivalencia:</b> ${esc(ayuda.veredicto_equivalencia)}</p>` : ''}
    </div>` : '';

  return `<div class="req">
    <div class="req-badges">${badges}</div>
    <p class="req-desc">${esc(f.descripcion)}</p>
    <div class="req-cols">
      <p><span class="lbl">Exigido:</span> <b>${esc(exigidoDe(f))}</b>${a.fuente_bases ? ` <span class="sutil">· ${esc(a.fuente_bases)}</span>` : ''}</p>
      <p><span class="lbl">Ofertado:</span> <b>${esc(ofertadoDe(f))}</b>${a.fuente_ficha ? ` <span class="sutil">· ${esc(a.fuente_ficha)}</span>` : ''}</p>
    </div>
    ${notas}
    ${bloqueAyuda}
    ${f.ruta_cierre ? `<p class="cierre">Para cerrarlo: ${esc(f.ruta_cierre)}</p>` : ''}
  </div>`;
}

export interface ProductoLineaPdf {
  nombre: string | null;
  ofertado: {
    marca: string | null; modelo: string | null; fabricante: string | null;
    paisFabricacion: string | null; anioFabricacion: string | null;
  } | null;
}

export interface ComparacionLineaPdfInput {
  licitacionCodigo: string;
  item: { titulo: string; linea_numero: number | null; aprobado_por_nombre: string | null; aprobado_at: string | null };
  productos: ProductoLineaPdf[];
  comparador: EstadoComparador;
  comercial: { precio: number | null; plazo: string | null };
  documentos: Array<{ nombre: string }>;
  generadoPor?: string | null;
}

export function construirComparacionLineaHtml(d: ComparacionLineaPdfInput): string {
  const filas = [...d.comparador.caracteristicas].sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]);
  const r = d.comparador.resumen;

  const bloqueProductos = d.productos.filter(p => p.ofertado && (p.ofertado.marca || p.ofertado.modelo)).map(p => `
    <div class="producto">
      ${p.nombre ? `<p class="prod-nombre">${esc(p.nombre)}</p>` : ''}
      <p>
        ${p.ofertado?.marca ? `<b>Marca:</b> ${esc(p.ofertado.marca)} ` : ''}
        ${p.ofertado?.modelo ? `<b>Modelo:</b> ${esc(p.ofertado.modelo)} ` : ''}
        ${p.ofertado?.fabricante ? `<b>Fabricante:</b> ${esc(p.ofertado.fabricante)} ` : ''}
        ${p.ofertado?.paisFabricacion ? `<b>País:</b> ${esc(p.ofertado.paisFabricacion)}` : ''}
      </p>
    </div>`).join('');

  const bloqueMensajes = d.comparador.mensajes_proveedor.length === 0 ? '' : `
    <section>
      <h2>Mensaje al proveedor</h2>
      ${d.comparador.mensajes_proveedor.map(m => `
        <div class="mensaje">
          <p class="msg-head"><b>${esc(m.proveedor)}</b> <span class="sutil">· ${esc(m.productos_incluidos.join(', '))}</span></p>
          <pre>${esc(m.mensaje)}</pre>
        </div>`).join('')}
    </section>`;

  const bloqueComercial = (d.comercial.precio == null && !d.comercial.plazo) ? '' : `
    <section>
      <h2>Comercial</h2>
      <table class="kv">
        ${d.comercial.precio != null ? `<tr><th>Precio de esta línea</th><td>${clp(d.comercial.precio)}</td></tr>` : ''}
        ${d.comercial.plazo ? `<tr><th>Plazo de entrega</th><td>${esc(d.comercial.plazo)}</td></tr>` : ''}
      </table>
    </section>`;

  const bloqueDocumentos = d.documentos.length === 0 ? '' : `
    <section>
      <h2>Documentos de respaldo</h2>
      <ul>${d.documentos.map(doc => `<li>${esc(doc.nombre)}</li>`).join('')}</ul>
    </section>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(d.item.titulo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; font-size: 10.5px; line-height: 1.5; margin: 0; }
  header { border-bottom: 3px solid #7c3aed; padding-bottom: 10px; margin-bottom: 14px; }
  .eyebrow { font-size: 9px; letter-spacing: .12em; text-transform: uppercase; color: #7c3aed; font-weight: 700; }
  h1 { font-size: 16px; margin: 4px 0 2px; }
  .codigo { font-family: ui-monospace, "Courier New", monospace; font-size: 9.5px; color: #64748b; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #475569;
       border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; margin: 16px 0 8px; }
  section { break-inside: avoid; }
  .destacados { display: flex; gap: 8px; margin: 10px 0 4px; }
  .kpi { flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 9px; background: #f8fafc; }
  .kpi .lbl { font-size: 8.5px; text-transform: uppercase; letter-spacing: .06em; color: #64748b; }
  .kpi .val { font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 1px; }
  .producto { border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 9px; background: #f8fafc; margin-bottom: 6px; }
  .prod-nombre { font-weight: 700; margin: 0 0 2px; }
  .req { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; margin-bottom: 7px; break-inside: avoid; }
  .req-badges { margin-bottom: 4px; }
  .badge { display: inline-block; font-size: 8.5px; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-right: 4px; }
  .e-no { background: #ffe4e6; color: #be123c; }
  .e-pend { background: #e0f2fe; color: #0369a1; }
  .e-si { background: #d1fae5; color: #047857; }
  .b-crit { background: #fef3c7; color: #92400e; }
  .b-tipo, .b-origen { background: #f1f5f9; color: #475569; }
  .req-desc { font-weight: 600; margin: 2px 0 4px; }
  .req-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; margin-bottom: 4px; }
  .req-cols p { margin: 0; }
  .lbl { color: #94a3b8; }
  .sutil { color: #94a3b8; }
  .nota { background: #f8fafc; border-radius: 4px; padding: 3px 6px; margin: 3px 0; color: #64748b; }
  .ayuda { border-top: 1px solid #f1f5f9; margin-top: 4px; padding-top: 4px; }
  .ayuda p { margin: 2px 0; }
  .cierre { color: #94a3b8; margin: 4px 0 0; font-size: 9.5px; }
  .mensaje { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; background: #f8fafc; margin-bottom: 6px; }
  .msg-head { margin: 0 0 4px; }
  pre { white-space: pre-wrap; font-family: inherit; margin: 0; font-size: 10px; }
  table.kv { width: 100%; border-collapse: collapse; }
  table.kv th { text-align: left; font-weight: 600; color: #64748b; width: 160px; padding: 3px 8px 3px 0; font-size: 10px; }
  table.kv td { padding: 3px 0; }
  ul { margin: 4px 0; padding-left: 16px; }
  li { margin-bottom: 2px; }
  footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; }
</style></head><body>

<header>
  <p class="eyebrow">Auditor Técnico · Comparación de línea</p>
  <h1>${esc(d.item.titulo)}</h1>
  <p class="codigo">${esc(d.licitacionCodigo)}${d.item.linea_numero != null ? ` · Línea ${d.item.linea_numero}` : ''}</p>
</header>

<div class="destacados">
  <div class="kpi"><div class="lbl">Cumple</div><div class="val">${r.cumplen} de ${r.total}</div></div>
  <div class="kpi"><div class="lbl">No cumple</div><div class="val">${r.noCumplen}</div></div>
  <div class="kpi"><div class="lbl">Con complemento</div><div class="val">${r.conComplemento}</div></div>
  <div class="kpi"><div class="lbl">Por confirmar</div><div class="val">${r.porConfirmar}</div></div>
</div>

${d.item.aprobado_por_nombre ? `<p class="sutil">Aprobado por ${esc(d.item.aprobado_por_nombre)}${d.item.aprobado_at ? ` · ${fecha(d.item.aprobado_at)}` : ''}</p>` : ''}

${bloqueProductos ? `<section><h2>Producto ofertado</h2>${bloqueProductos}</section>` : ''}

<section>
  <h2>Comparación técnica (${filas.length})</h2>
  ${filas.map(tarjetaCaracteristica).join('')}
</section>

${bloqueMensajes}

${bloqueComercial}

${bloqueDocumentos}

<footer>Generado${d.generadoPor ? ` por ${esc(d.generadoPor)}` : ''} el ${fecha(new Date().toISOString())}${d.comparador.comparado_at ? ` · última comparación: ${fecha(d.comparador.comparado_at)}` : ''}</footer>

</body></html>`;
}
