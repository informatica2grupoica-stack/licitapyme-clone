// app/lib/compras-documentos-render.ts
// Armado del HTML de un documento desde su plantilla. Sin dependencias de servidor: lo usan el PDF (servidor) y la vista previa del formulario (navegador).
export interface CampoPlantilla { clave: string; etiqueta: string; tipo: 'texto' | 'lista' | 'fecha'; valorPorDefecto?: string; ayuda?: string; donde?: string }
export interface Plantilla {
  id: number; clave: string; nombre: string; descripcion: string | null; porPersona: boolean;
  campos: CampoPlantilla[]; cuerpoHtml: string;
}
export interface DocumentoGenerado { id: number; plantillaId: number; plantillaNombre: string; titulo: string; personas: number; creadoPor: string | null; createdAt: string }
export interface ContextoDocumento { empresa: string; rutEmpresa: string; licitacionCodigo: string; licitacionNombre: string; organismo: string; hoy: string; representante?: string; representanteRut?: string; representanteCargo?: string; logoUri?: string | null; firmaUri?: string | null; timbreUri?: string | null }
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
  const hojas = (p.porPersona ? personas : [{ nombre: '', rut: '' }]).map(per => {
    const base: Record<string, string> = {
      empresa: ctx.empresa, rut_empresa: ctx.rutEmpresa, licitacion_codigo: ctx.licitacionCodigo, organismo: ctx.organismo,
      unidad_de: valores.unidad?.trim() ? ' de ' + valores.unidad.trim() : '', representante: ctx.representante || '', representante_cargo: ctx.representanteCargo || '', nombre: per.nombre, rut: per.rut, fecha_larga: fechaLarga(valores.fecha || ctx.hoy),
    };
    return p.cuerpoHtml.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
      // Imágenes de la empresa (data URI armado por el servidor): único HTML que no se escapa.
      if (k === 'logo_img') return ctx.logoUri ? `<img src="${ctx.logoUri}" alt="">` : ''; // sin logo (Inversiones Claro) el encabezado queda igual, con ese lado vacío
      if (k === 'emp_der') return `<b>${esc(ctx.empresa)}</b><br>`;
      if (k === 'timbre_img') return ctx.timbreUri ? `<img class="timbreimg" src="${ctx.timbreUri}" alt="">` : '';
      if (k === 'firma_img') return ctx.firmaUri ? `<img class="firmaimg" src="${ctx.firmaUri}" alt="">` : '<div style="height:56px"></div>';
      const campo = p.campos.find(c => c.clave === k);
      const v = k in base ? base[k] : (valores[k] ?? '');
      if (k in base && !['nombre', 'rut', 'unidad_de'].includes(k)) return esc(v); // lo que se llena solo no se marca
      const etiqueta = campo?.etiqueta || ETIQUETAS_FIJAS[k] || k;
      if (campo?.tipo === 'lista') {
        const li = String(v).split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => `<li>${esc(s)}</li>`).join('');
        return li ? (vista ? `<div class="v bloque"><ul>${li}</ul></div>` : `<ul>${li}</ul>`) : marca('', etiqueta);
      }
      if (k === 'unidad_de') return v ? marca(esc(v), etiqueta) : '';
      return marca(esc(v), etiqueta);
    });
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#2b2b2b;font-size:14.5px;line-height:1.75;margin:0}
  .hoja{page-break-after:always;box-sizing:border-box;height:268mm;padding:0} .hoja:last-child{page-break-after:auto}
  .marco{height:100%;box-sizing:border-box;border:1.5px solid #3a3a3a;outline:0.5px solid #b8b8b8;outline-offset:-7px;padding:34px 46px 26px;display:flex;flex-direction:column}
  .cab{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #3a3a3a;padding-bottom:14px}
  .logo img{height:74px;display:block} .nom{font-size:22px;font-weight:700;letter-spacing:.5px;color:#2b2b2b} .emp{text-align:right;font-size:11.5px;line-height:1.45;color:#555} .emp b{font-size:13px;color:#2b2b2b}
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
  .v{background:#fff3b0;border-radius:3px;padding:0 2px;box-decoration-break:clone}.bloque{display:block;padding:2px 6px}.vacio{background:#eceff1;color:#78909c;font-style:normal;font-weight:400;letter-spacing:0;text-transform:none}
  </style></head><body>${hojas.map(h => `<div class="hoja">${h}</div>`).join('')}</body></html>`;
}

