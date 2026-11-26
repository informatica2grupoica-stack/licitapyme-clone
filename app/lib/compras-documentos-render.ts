// app/lib/compras-documentos-render.ts
// Armado del HTML de un documento desde su plantilla. Sin dependencias de servidor: lo usan el PDF (servidor) y la vista previa del formulario (navegador).
export interface CampoPlantilla { clave: string; etiqueta: string; tipo: 'texto' | 'lista' | 'fecha' | 'tabla' | 'logo'; valorPorDefecto?: string; ayuda?: string; donde?: string; columnas?: string[]; filasMin?: number }
export interface Plantilla {
  id: number; clave: string; nombre: string; descripcion: string | null; porPersona: boolean;
  campos: CampoPlantilla[]; cuerpoHtml: string;
  /** Plantillas hechas en el editor: el diseño es un JSON (elementos con posición en mm sobre una hoja A4) y se puede volver a editar. */
  layout?: LayoutDoc | null; editable?: boolean;
}

// ── Plantillas diseñadas en el editor ────────────────────────────────────────────────────────────────────────────────────────────
export type TipoElemento = 'texto' | 'logo' | 'linea' | 'caja' | 'tabla' | 'firma';
export interface ElementoLayout {
  id: string; tipo: TipoElemento; x: number; y: number; w: number; h: number; // mm sobre la hoja A4 (210 x 297)
  texto?: string; tam?: number; negrita?: boolean; cursiva?: boolean; subrayado?: boolean; alinea?: 'left' | 'center' | 'right'; color?: string; serif?: boolean;
  logo?: string; etiqueta?: string; columnas?: string[]; filasMin?: number; grosor?: number; relleno?: string;
}
export interface LayoutDoc { v: 1; elementos: ElementoLayout[] }
export const HOJA_MM = { w: 210, h: 297 };
/** Variables que se llenan solas (o por persona); cualquier otra {{palabra}} escrita en un texto se vuelve un campo del formulario. */
export const VARIABLES_FIJAS: { k: string; n: string }[] = [
  { k: 'empresa', n: 'Empresa' }, { k: 'rut_empresa', n: 'RUT de la empresa' }, { k: 'licitacion_codigo', n: 'Código de la licitación' },
  { k: 'licitacion_nombre', n: 'Nombre de la licitación' }, { k: 'organismo', n: 'Organismo comprador' }, { k: 'fecha_larga', n: 'Fecha (en letras)' },
  { k: 'representante', n: 'Representante' }, { k: 'representante_cargo', n: 'Cargo del representante' }, { k: 'nombre', n: 'Nombre de la persona' }, { k: 'rut', n: 'RUT de la persona' },
];
const RESERVADAS = new Set([...VARIABLES_FIJAS.map(v => v.k), 'unidad_de', 'logo_img', 'emp_der', 'timbre_img', 'firma_img']);
const humanizar = (k: string) => { const t = k.replace(/_/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const num = (n: number) => Math.round(n * 100) / 100;

/** Campos del formulario que salen del diseño: una variable propia por cada {{palabra}}, un selector por logo, una tabla por tabla. */
export function derivarCampos(layout: LayoutDoc): CampoPlantilla[] {
  const campos: CampoPlantilla[] = []; const vistos = new Set<string>();
  const ordenados = [...layout.elementos].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const agregar = (c: CampoPlantilla) => { if (vistos.has(c.clave)) return; vistos.add(c.clave); campos.push(c); };
  for (const el of ordenados) {
    if (el.tipo === 'logo') agregar({ clave: 'logo_' + el.id, etiqueta: el.etiqueta || 'Logo', tipo: 'logo', valorPorDefecto: el.logo || '', donde: 'Se elige del banco de logos.' });
    else if (el.tipo === 'tabla') agregar({ clave: 'tabla_' + el.id, etiqueta: el.etiqueta || 'Tabla', tipo: 'tabla', columnas: el.columnas || [], filasMin: el.filasMin || 0, donde: 'Una fila por línea; las celdas se separan con «|».', ayuda: (el.columnas || []).slice(0, -1).map(c => c || '…').join(' | ') });
    else if (el.tipo === 'texto') {
      for (const m of String(el.texto || '').matchAll(/\{\{(\w+)\}\}/g)) {
        const k = m[1];
        if (k === 'fecha_larga') agregar({ clave: 'fecha', etiqueta: 'Fecha del documento', tipo: 'fecha', donde: 'Se escribe en letras donde pusiste la fecha.' });
        else if (!RESERVADAS.has(k)) agregar({ clave: k, etiqueta: humanizar(k), tipo: 'texto' });
      }
    }
  }
  return campos;
}

/** HTML de la hoja diseñada. Los datos van como {{variable}} y los resuelve armarHtml (igual que en las plantillas escritas a mano). */
export function htmlLayout(layout: LayoutDoc): string {
  return layout.elementos.map(el => {
    const pos = `left:${num(el.x)}mm;top:${num(el.y)}mm;width:${num(el.w)}mm;height:${num(el.h)}mm`;
    const col = /^#[0-9a-fA-F]{3,8}$/.test(el.color || '') ? el.color : '#1f1f1f';
    if (el.tipo === 'texto') {
      const est = `font-size:${el.tam || 11}pt;font-weight:${el.negrita ? 700 : 400};font-style:${el.cursiva ? 'italic' : 'normal'};text-decoration:${el.subrayado ? 'underline' : 'none'};text-align:${el.alinea || 'left'};color:${col};font-family:${el.serif ? "Georgia,'Times New Roman',serif" : "Arial,Helvetica,sans-serif"}`;
      return `<div class="el" style="${pos};${est}">${esc(el.texto || '').replace(/\n/g, '<br>')}</div>`;
    }
    if (el.tipo === 'logo') return `<div class="el logoel" style="${pos}">{{logo_${el.id}}}</div>`;
    if (el.tipo === 'linea') return `<div class="el" style="left:${num(el.x)}mm;top:${num(el.y)}mm;width:${num(el.w)}mm;height:0;border-top:${Math.max(0.25, el.grosor || 0.5)}mm solid ${col}"></div>`;
    if (el.tipo === 'caja') return `<div class="el" style="${pos};border:${Math.max(0.25, el.grosor || 0.4)}mm solid ${col};${/^#[0-9a-fA-F]{3,8}$/.test(el.relleno || '') ? 'background:' + el.relleno : ''}"></div>`;
    if (el.tipo === 'tabla') return `<div class="el" style="${pos}">{{tabla_${el.id}}}</div>`;
    return `<div class="el firmael" style="${pos}"><div class="fw">{{firma_img}}{{timbre_img}}</div><div class="linea"></div><b>{{representante}}</b><br>{{representante_cargo}}<br>{{empresa}}</div>`;
  }).join('');
}
export interface DocumentoGenerado { id: number; plantillaId: number; plantillaNombre: string; titulo: string; personas: number; creadoPor: string | null; createdAt: string }
export interface LogoOpcion { clave: string; nombre: string }
export interface ContextoDocumento { logos?: Record<string, string>; logosOpciones?: LogoOpcion[]; empresa: string; rutEmpresa: string; licitacionCodigo: string; licitacionNombre: string; organismo: string; hoy: string; representante?: string; representanteRut?: string; representanteCargo?: string; logoUri?: string | null; firmaUri?: string | null; timbreUri?: string | null; entregaSugerida?: { items: string; guiaDespacho: string } }
export interface PersonaDoc { nombre: string; rut: string }

const esc = (x: unknown) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ETIQUETAS_FIJAS: Record<string, string> = { nombre: 'Nombre de la persona', rut: 'RUT de la persona', unidad_de: 'Comprador', representante: 'Representante', representante_cargo: 'Cargo' };

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function fechaLarga(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return iso || '';
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}

/** Una página por persona (o una sola). Lo escrito se escapa; solo la plantilla puede traer HTML. */
export function armarHtml(p: Plantilla, valores: Record<string, string>, ctx: ContextoDocumento, personas: PersonaDoc[], vista = false): string {
  // vista = vista previa del formulario: cada dato escrito se marca de color y lo que falta aparece como [etiqueta], para ver dónde queda.
  const marca = (txt: string, etiqueta: string) => vista ? (txt ? `<span class="v">${txt}</span>` : `<span class="v vacio">[${esc(etiqueta)}]</span>`) : txt;
  // Actas hechas antes de que el organismo y el ID fueran editables no los guardaron: vuelven a salir con los de la licitación.
  valores = { ...valores }; if (valores.organismo_acta === undefined) valores.organismo_acta = ctx.organismo; if (valores.id_licitacion === undefined) valores.id_licitacion = ctx.licitacionCodigo;
  const hojas = (p.porPersona ? personas : [{ nombre: '', rut: '' }]).map(per => {
    const base: Record<string, string> = {
      empresa: ctx.empresa, rut_empresa: ctx.rutEmpresa, licitacion_codigo: ctx.licitacionCodigo, licitacion_nombre: ctx.licitacionNombre, organismo: ctx.organismo,
      unidad_de: valores.unidad?.trim() ? ' de ' + valores.unidad.trim() : '', representante: ctx.representante || '', representante_cargo: ctx.representanteCargo || '', nombre: per.nombre, rut: per.rut, fecha_larga: fechaLarga(valores.fecha || ctx.hoy),
      fecha_corta: (/^(\d{4})-(\d{2})-(\d{2})/.exec(valores.fecha || ctx.hoy) || []).slice(1).reverse().join('/'),
    };
    return (p.layout ? htmlLayout(p.layout) : p.cuerpoHtml).replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
      // Imágenes de la empresa (data URI armado por el servidor): único HTML que no se escapa.
      if (k === 'logo_img') return ctx.logoUri ? `<img src="${ctx.logoUri}" alt="">` : ''; // sin logo (Inversiones Claro) el encabezado queda igual, con ese lado vacío
      if (k === 'emp_der') return `<b>${esc(ctx.empresa)}</b><br>`;
      if (k === 'timbre_img') return ctx.timbreUri ? `<img class="timbreimg" src="${ctx.timbreUri}" alt="">` : '';
      if (k === 'firma_img') return ctx.firmaUri ? `<img class="firmaimg" src="${ctx.firmaUri}" alt="">` : '<div style="height:56px"></div>';
      const campo = p.campos.find(c => c.clave === k);
      // Logos elegidos del banco: clave de la opción → imagen (en el PDF ya viene como data URI). Sin valor guardado vale el de la plantilla.
      if (/^logo_\w+$/.test(k) && !['logo_img'].includes(k)) { const src = ctx.logos?.[valores[k] ?? campo?.valorPorDefecto ?? '']; return src ? `<img src="${src}" alt="">` : ''; }
      const v = k in base ? base[k] : (valores[k] ?? '');
      if (k in base && !['nombre', 'rut', 'unidad_de'].includes(k)) return esc(v); // lo que se llena solo no se marca
      const etiqueta = campo?.etiqueta || ETIQUETAS_FIJAS[k] || k;
      if (campo?.tipo === 'tabla') {
        // Una fila por línea; las celdas van separadas por «|» y se llenan en el orden de las columnas (las que sobran quedan en blanco, a mano).
        const cols = campo.columnas || [];
        const filas = String(v).split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => s.split('|').map(c => c.trim()));
        while (filas.length < (campo.filasMin || 0)) filas.push([]);
        const cuerpo = filas.map(f => `<tr>${cols.map((_, i) => `<td>${esc(f[i] ?? '')}</td>`).join('')}</tr>`).join('');
        return `<table class="tabla"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${cuerpo}</tbody></table>`;
      }
      if (campo?.tipo === 'lista') {
        const li = String(v).split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => `<li>${esc(s)}</li>`).join('');
        return li ? (vista ? `<div class="v bloque"><ul>${li}</ul></div>` : `<ul>${li}</ul>`) : marca('', etiqueta);
      }
      if (k === 'unidad_de') return v ? marca(esc(v), etiqueta) : '';
      if (k === 'rec_fecha' && !v && !vista) return '____/____/____'; // sin fecha escrita, queda para llenar a mano
      return marca(esc(v), etiqueta);
    });
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#2b2b2b;font-size:14.5px;line-height:1.75;margin:0}
  .hoja{page-break-after:always;box-sizing:border-box;height:268mm;padding:0} .hoja:last-child{page-break-after:auto}
  .marco{height:100%;box-sizing:border-box;border:1.5px solid #3a3a3a;outline:0.5px solid #b8b8b8;outline-offset:-7px;padding:34px 46px 26px;display:flex;flex-direction:column}
  .cab{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #3a3a3a;padding-bottom:14px}
  .emp img{height:52px;display:block;margin:0 0 6px auto} .logo img{height:74px;display:block} .nom{font-size:22px;font-weight:700;letter-spacing:.5px;color:#2b2b2b} .emp{text-align:right;font-size:11.5px;line-height:1.45;color:#555} .emp b{font-size:13px;color:#2b2b2b}
  .titulo{text-align:center;margin:44px 0 34px} .titulo span{display:block}
  .sup{font-size:12px;letter-spacing:5px;text-transform:uppercase;color:#777} .gran{font-size:34px;font-weight:700;letter-spacing:4px;color:#2b2b2b;margin-top:2px}
  .sub{font-size:13.5px;color:#555;margin-top:8px;font-style:italic}
  .otorga{text-align:center;margin:14px 0 0;color:#777;letter-spacing:1px;font-size:12px}
  .nombre{text-align:center;font-family:Georgia,'Times New Roman',serif;font-size:32px;margin:8px 30px 0;padding-bottom:6px;border-bottom:1px solid #9a9a9a}
  .rutp{text-align:center;margin:8px 0 34px;color:#555;font-size:12.5px}
  .cuerpo{text-align:justify;margin:0 0 10px} ul{margin:4px 0 0 4px;padding:0;list-style:none} li{margin:9px 0;padding-left:22px;position:relative} li:before{content:'';position:absolute;left:2px;top:7px;width:7px;height:7px;background:#3a3a3a;transform:rotate(45deg)}
  .lugar{text-align:right;margin:auto 0 0;padding-top:20px;color:#555}
  .firma{text-align:center;margin-top:8px;font-size:12px;line-height:1.45;color:#555} .firma b{color:#2b2b2b;font-size:13px} .fw{position:relative;width:250px;margin:0 auto} .timbreimg{position:absolute;right:-86px;top:6px;width:96px;height:96px;object-fit:contain;mix-blend-mode:multiply;opacity:.88;transform:rotate(-7deg)}
  .firmaimg{mix-blend-mode:multiply;height:84px;display:block;margin:0 auto -6px}
  .linea{border-top:1px solid #2b2b2b;width:250px;margin:0 auto 6px}
  .acta{height:100%;display:flex;flex-direction:column;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.5;color:#1a1a1a;padding:8px 6px}
  .acta .cab2{display:flex;justify-content:space-between;align-items:flex-start} .acta .cab2 img{height:56px;display:block;mix-blend-mode:multiply} .acta .cab2 .cen{text-align:center;font-weight:700;font-size:13px;padding-top:2px;text-transform:uppercase}
  .acta .bloque1{display:flex;gap:18px;margin-top:26px;align-items:flex-start} .acta .izq{width:150px;text-align:center;font-size:13.5px;line-height:1.45;padding-top:14px} .acta .izq u{display:block;margin-bottom:2px}
  .acta .med{flex:1;text-align:center} .acta .med .tit{font-weight:700;text-decoration:underline;font-size:14px;text-transform:uppercase} .acta .med .caja{border:1px dotted #777;font-style:italic;font-weight:700;padding:3px 8px;margin-top:3px;min-height:20px;text-transform:uppercase} .acta .der{width:90px;white-space:nowrap;font-weight:700;text-align:right;padding-top:30px;font-size:13px}
  .acta .sec{margin-top:22px;font-size:13.5px} .acta .cat{text-align:center;font-weight:700;margin-top:4px;text-transform:uppercase}
  .tabla{width:100%;border-collapse:collapse;margin-top:2px;font-size:12px;border:2px solid #222} .tabla th,.tabla td{border:1.5px solid #222;padding:4px 6px;text-align:center;height:20px} .tabla th{font-weight:400;font-size:13px} .tabla td:nth-child(4){text-align:left}
  .acta .datos{margin:20px 0 0 130px;font-size:11.5px} .acta .datos div{display:flex;margin:5px 0} .acta .datos b.k{font-weight:400;width:160px} .acta .datos .val{font-size:13px;font-weight:700}
  .acta .rec{margin:34px 0 0 130px;font-size:11.5px} .acta .rec .fila{display:flex;align-items:flex-end;margin-top:32px} .acta .rec .fila .k{width:160px;padding-bottom:2px} .acta .rec .fila .raya{flex:1;border-bottom:1px solid #222;height:24px;max-width:430px} .acta .rec .fila .raya{line-height:22px;padding-left:4px;font-weight:700;font-size:12.5px;overflow:hidden;white-space:nowrap} .acta .rec .fila .fr{margin-left:28px;white-space:nowrap;font-size:12.5px}
  .hoja.lay{height:296.6mm;width:210mm;position:relative;overflow:hidden}
  .el{position:absolute;box-sizing:border-box;overflow:hidden;line-height:1.35;word-wrap:break-word} .logoel img{width:100%;height:100%;object-fit:contain;display:block;object-position:left center} .el.firmael{overflow:visible;text-align:center;font-size:12px;line-height:1.4;color:#555} .firmael b{color:#2b2b2b;font-size:13px} .firmael .fw{width:100%;max-width:250px} .firmael .linea{width:100%;max-width:250px}
  .v{background:#fff3b0;border-radius:3px;padding:0 2px;box-decoration-break:clone}.bloque{display:block;padding:2px 6px}.vacio{background:#eceff1;color:#78909c;font-style:normal;font-weight:400;letter-spacing:0;text-transform:none}
  </style></head><body>${hojas.map(h => `<div class="hoja${p.layout ? ' lay' : ''}">${h}</div>`).join('')}</body></html>`;
}

