// app/lib/entrega-pdf.ts
// Frente F.1 — el resumen ejecutivo del proyecto ganado, como documento imprimible.
//
// La pantalla de Entregas ya muestra todo esto, pero el área de entrega trabaja con un documento:
// se imprime, se adjunta a un correo, se archiva con el proyecto. Por eso existe este export.
//
// REUSA el motor del Informe Técnico (generarInformePdf: HTML autocontenido → chromium → PDF A4),
// que ya está resuelto y probado. Acá solo se arma el HTML.
//
// FUENTE ÚNICA: se pinta el resumen CONGELADO que guardó `entrega_proyecto.resumen` al momento de
// ganar, no una consulta nueva. El PDF tiene que decir lo que se comprometió entonces, aunque
// después se edite el negocio — es lo mismo que hace el traspaso a Compras.

import type { ResumenEjecutivo } from '@/app/lib/entrega-proyecto';

const esc = (x: any): string => String(x ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const clp = (n: number | null | undefined): string =>
  n == null ? '—' : `$${Number(n).toLocaleString('es-CL')}`;

const fecha = (f: string | null | undefined): string => {
  if (!f) return '—';
  const d = new Date(f);
  return isNaN(d.getTime()) ? String(f) : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
};

/** Sección con título; se omite entera si no hay nada que mostrar (nada de cajas vacías). */
function seccion(titulo: string, cuerpo: string): string {
  return cuerpo.trim() ? `<section><h2>${esc(titulo)}</h2>${cuerpo}</section>` : '';
}

function lista(items: string[]): string {
  const limpios = items.filter(x => x && String(x).trim());
  return limpios.length === 0 ? '' : `<ul>${limpios.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
}

function filas(pares: [string, string][]): string {
  const útiles = pares.filter(([, v]) => v && v !== '—');
  return útiles.length === 0 ? '' :
    `<table class="kv">${útiles.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
}

export function construirResumenEntregaHtml(r: ResumenEjecutivo, generadoPor?: string | null): string {
  const lineas = (r.lineasGanadas || []).filter(l => l.producto || l.montoUnitario != null);
  const tablaLineas = lineas.length === 0 ? '' : `
    <table class="datos">
      <thead><tr><th>Producto adjudicado</th><th class="num">Cantidad</th><th class="num">Monto unitario</th></tr></thead>
      <tbody>${lineas.map(l => `<tr>
        <td>${esc(l.producto || '—')}</td>
        <td class="num">${l.cantidad ?? '—'}</td>
        <td class="num">${clp(l.montoUnitario)}</td>
      </tr>`).join('')}</tbody>
    </table>`;

  const competidores = (r.competidoresAdjudicados || []).filter(c => c.proveedor);
  const tablaCompetidores = competidores.length === 0 ? '' : `
    <table class="datos">
      <thead><tr><th>Otro adjudicado</th><th>RUT</th><th class="num">Líneas</th></tr></thead>
      <tbody>${competidores.map(c => `<tr>
        <td>${esc(c.proveedor)}</td><td>${esc(c.rut || '—')}</td><td class="num">${c.lineas}</td>
      </tr>`).join('')}</tbody>
    </table>`;

  const contactos = r.contactosCliente as any;
  const bloqueContactos = !contactos ? '' : filas([
    ['Nombre',   contactos.nombre || contactos.contacto || ''],
    ['Cargo',    contactos.cargo || ''],
    ['Correo',   contactos.email || contactos.correo || ''],
    ['Teléfono', contactos.telefono || ''],
    ['Dirección', contactos.direccion || ''],
  ]);

  const plazos = (r.plazosComprometidos || []) as any[];
  const bloquePlazos = plazos.length === 0 ? '' :
    lista(plazos.map(p => typeof p === 'string' ? p : [p.concepto, p.valor, p.detalle].filter(Boolean).join(': ')));

  const garantias = (r.garantias || []) as any[];
  const bloqueGarantias = garantias.length === 0 ? '' :
    lista(garantias.map(g => typeof g === 'string' ? g : [g.concepto, g.valor, g.detalle].filter(Boolean).join(': ')));

  const postventa = (r.compromisosPostventa || []) as any[];
  const bloquePostventa = postventa.length === 0 ? '' :
    lista(postventa.map(g => typeof g === 'string' ? g : [g.concepto, g.valor, g.detalle].filter(Boolean).join(': ')));

  const m = r.multas;
  const bloqueMultas = !m ? '' : filas([
    ['Estructura',        m.estructura || ''],
    ['Costo por día',     m.costoPorDia || ''],
    ['Tope de multas',    m.costoMaximo || ''],
    ['Umbral de término', m.umbralTermino || ''],
    ['Fuente',            m.fuente || ''],
  ]);

  const docs = (r.documentosPropios || []);
  const bloqueDocs = docs.length === 0 ? '' : `<ul>${docs.map(d =>
    `<li><a href="${esc(d.url)}">${esc(d.nombre)}</a>${d.subidoPorNombre ? ` <span class="sutil">— ${esc(d.subidoPorNombre)}</span>` : ''}</li>`
  ).join('')}</ul>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Entrega de proyecto ${esc(r.licitacionCodigo)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; font-size: 11px; line-height: 1.5; margin: 0; }
  header { border-bottom: 3px solid #4f46e5; padding-bottom: 10px; margin-bottom: 16px; }
  .eyebrow { font-size: 9px; letter-spacing: .12em; text-transform: uppercase; color: #4f46e5; font-weight: 700; }
  h1 { font-size: 17px; margin: 4px 0 2px; }
  .codigo { font-family: ui-monospace, "Courier New", monospace; font-size: 10px; color: #64748b; }
  h2 { font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; color: #475569;
       border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; margin: 16px 0 7px; }
  section { break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; }
  table.kv th { text-align: left; font-weight: 600; color: #64748b; width: 150px; padding: 3px 8px 3px 0; vertical-align: top; font-size: 10.5px; }
  table.kv td { padding: 3px 0; vertical-align: top; }
  table.datos { margin-top: 4px; font-size: 10.5px; }
  table.datos th { text-align: left; background: #f1f5f9; color: #475569; font-weight: 600; padding: 4px 6px; border: 1px solid #e2e8f0; }
  table.datos td { padding: 4px 6px; border: 1px solid #e2e8f0; }
  .num { text-align: right; white-space: nowrap; }
  ul { margin: 4px 0; padding-left: 16px; }
  li { margin-bottom: 2px; }
  .destacados { display: flex; gap: 8px; margin: 10px 0 4px; }
  .kpi { flex: 1; border: 1px solid #e2e8f0; border-radius: 6px; padding: 7px 9px; background: #f8fafc; }
  .kpi .lbl { font-size: 8.5px; text-transform: uppercase; letter-spacing: .06em; color: #64748b; }
  .kpi .val { font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 1px; }
  .aviso { border-left: 3px solid #f59e0b; background: #fffbeb; padding: 7px 10px; border-radius: 0 4px 4px 0; margin-top: 6px; }
  .aviso strong { color: #b45309; }
  .sutil { color: #94a3b8; }
  footer { margin-top: 22px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; }
  a { color: #4f46e5; text-decoration: none; }
</style></head><body>

<header>
  <p class="eyebrow">Entrega de proyecto · Proyecto adjudicado</p>
  <h1>${esc(r.licitacionNombre || 'Proyecto adjudicado')}</h1>
  <p class="codigo">${esc(r.licitacionCodigo)}${r.organismo ? ` · ${esc(r.organismo)}` : ''}</p>
</header>

<div class="destacados">
  <div class="kpi"><div class="lbl">Nos adjudicaron</div><div class="val">${clp(r.montoNuestro ?? r.montoOfertado)}</div></div>
  <div class="kpi"><div class="lbl">Total licitación</div><div class="val">${clp(r.montoAdjudicadoTotal)}</div></div>
  <div class="kpi"><div class="lbl">Oferentes</div><div class="val">${r.numeroOferentes ?? '—'}</div></div>
  <div class="kpi"><div class="lbl">Adjudicación</div><div class="val" style="font-size:11px">${fecha(r.fechaAdjudicacion)}</div></div>
</div>

${seccion('Qué ganamos', filas([
  ['Empresa del grupo', [r.empresaNombre, r.empresaRut].filter(Boolean).join(' · ')],
  ['Organismo', r.organismo || ''],
  ['Responsable del negocio', r.responsableNombre || ''],
  ['Monto ofertado', clp(r.montoOfertado)],
  ['Acta de adjudicación', r.urlActa || ''],
]) + tablaLineas)}

${seccion('Contra quién competimos', tablaCompetidores)}

${seccion('Contacto de la entidad', bloqueContactos)}

${seccion('Plazos comprometidos', bloquePlazos)}

${seccion('Garantías', bloqueGarantias)}

${seccion('Compromisos de postventa', bloquePostventa)}

${seccion('Multas y sanciones', bloqueMultas)}

${seccion('Riesgos detectados en el análisis', lista([...(r.riesgosViabilidad || []), ...(r.alertasViabilidad || [])]))}

${seccion('Documentación del proyecto', bloqueDocs)}

${(r.faltantes || []).length === 0 ? '' : `
<section>
  <h2>Qué faltaba al momento de ganar</h2>
  <div class="aviso">
    <strong>Atención:</strong> esto no estaba disponible cuando se armó el traspaso. Hay que conseguirlo antes de ejecutar.
    ${lista(r.faltantes)}
  </div>
</section>`}

<footer>
  Documento generado por Licitank desde el resumen congelado al momento de la adjudicación.
  ${generadoPor ? `Solicitado por ${esc(generadoPor)}.` : ''}
  Los montos y compromisos son los vigentes al ganar; cualquier cambio posterior se acuerda con la entidad.
</footer>
</body></html>`;
}
