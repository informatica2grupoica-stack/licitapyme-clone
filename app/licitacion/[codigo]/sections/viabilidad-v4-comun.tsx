'use client';

// Piezas compartidas de la vista v4 de viabilidad: formato, ortografía (oración con mayúscula inicial),
// citas con ojo al visor y el ÁMBITO de Mantine. Mantine se carga solo para esta vista: sus variables CSS
// viven dentro del contenedor `.viab-mantine` y se importan únicamente los estilos de los componentes
// que se usan (no `styles.css`, que traería el reset global de Mantine al resto de la app).

import { useContext } from 'react';
import { IconFileSearch as FileSearch, IconEye as Eye } from '@tabler/icons-react';
import { FuenteDocsContext, VisorContext } from './viabilidad-ui-comun';

// ─── Formato y ortografía ──────────────────────────────────────────────────────────────────
export const fmt = (n?: number | null) => n != null && Number.isFinite(Number(n)) ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(n)) : '—';
export const cap = (s?: string) => (s || '').replace(/_/g, ' ');
export const _norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Español: toda frase parte con mayúscula inicial.
export const mayus = (s?: any) => { const x = String(s ?? '').trim(); return x ? x.charAt(0).toUpperCase() + x.slice(1) : ''; };

// Las bases suelen venir EN MAYÚSCULAS: se pasa a oración (mayúscula inicial y tras cada punto), conservando siglas.
const SIGLAS = new Set(['IVA', 'UF', 'UTM', 'TNS', 'OC', 'RUT', 'ISO', 'SII', 'CA', 'EM', 'ID', 'CLP', 'LE', 'LP', 'TDR', 'PDF', 'RM', 'IA', 'TIC', 'MP', 'SERVIU', 'SEREMI', 'FONASA', 'CESFAM']);
export const oracion = (s?: any) => {
  let x = String(s ?? '').trim();
  if (!x) return '';
  const letras = x.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, '');
  const mayusc = letras.replace(/[^A-ZÁÉÍÓÚÑ]/g, '').length;
  if (letras.length >= 8 && mayusc / letras.length > 0.7) {
    x = x.toLowerCase()
      .replace(/[a-záéíóúñ]+/g, w => SIGLAS.has(w.toUpperCase()) ? w.toUpperCase() : w)
      .replace(/([.!?]\s+)([a-záéíóúñ])/g, (_m, a, b) => a + b.toUpperCase());
  }
  return mayus(x);
};

// Informes guardados antes del cambio aún dicen "CA": se muestra siempre como jefe de ventas.
export const sinCA = (x?: any) => String(x ?? '').replace(/\ba CA\b/g, 'al jefe de ventas').replace(/\bCA\b/g, 'el jefe de ventas');

// ─── Catálogos de la vista ─────────────────────────────────────────────────────────────────
export const NIVEL_VISTA: Record<string, { label: string; cls: string; soft: string; tip: string }> = {
  MUY_ALTO:   { label: 'MUY ALTO',   cls: 'bg-emerald-600', soft: 'bg-emerald-50 border-emerald-200', tip: 'Proyecto muy atractivo para nosotros.' },
  ALTO:       { label: 'ALTO',       cls: 'bg-emerald-500', soft: 'bg-emerald-50 border-emerald-200', tip: 'Proyecto atractivo.' },
  MEDIO_ALTO: { label: 'MEDIO ALTO', cls: 'bg-yellow-500',  soft: 'bg-yellow-50 border-yellow-200',   tip: 'Atractivo con condiciones: consulta al jefe de ventas.' },
  MEDIO:      { label: 'MEDIO',      cls: 'bg-yellow-500',  soft: 'bg-yellow-50 border-yellow-200',   tip: 'Atractivo medio: consulta al jefe de ventas.' },
  MEDIO_BAJO: { label: 'MEDIO BAJO', cls: 'bg-orange-500',  soft: 'bg-orange-50 border-orange-200',   tip: 'Poco atractivo o servicio: consulta al jefe de ventas.' },
  BAJO:       { label: 'BAJO',       cls: 'bg-red-500',     soft: 'bg-red-50 border-red-200',         tip: 'Poco atractivo: suelta el proyecto.' },
  EXCLUIDO:   { label: 'EXCLUIDO',   cls: 'bg-red-700',     soft: 'bg-red-50 border-red-300',         tip: 'Un filtro duro deja el proyecto fuera.' },
};
export const PERIODO: Record<string, string> = { DIA_HABIL: 'día hábil', DIA_CORRIDO: 'día corrido' };
// "0,1 %", "2 UF", "$50.000": la multa tal cual las bases, con su unidad legible.
export function valorMulta(a: any): string {
  const u = String(a?.unidad || '').toUpperCase();
  const v = String(a?.valor ?? '').replace(/\s*%$/, '');
  // El modelo a veces ya escribe la unidad en el valor ("1 UTM"): no se repite.
  if (u && u !== 'PORCENTAJE' && u !== 'PESOS' && new RegExp(`\\b${u}\\b`, 'i').test(v)) return v.trim();
  return u === 'PORCENTAJE' ? `${v} %` : u === 'PESOS' ? `$${v}` : `${v} ${u}`.trim();
}
export const EVIDENCIA_TEXTO: Record<string, string> = {
  COTIZAR_TOTALIDAD: 'obliga a ofertar todas las líneas', ADJUDICA_GLOBAL: 'se adjudica todo a un solo oferente',
  ADJUDICA_POR_LINEA: 'se adjudica por línea', TOTAL_O_PARCIAL: 'puede adjudicar total o parcialmente',
  OFERTA_POR_BIEN: 'se puede ofertar uno o más bienes por separado', DESIERTA_POR_LINEA: 'una línea puede quedar desierta',
  PRESUPUESTO_POR_LINEA: 'cada línea tiene su propio presupuesto', SUMA_ALZADA: 'contrato a suma alzada (tipo de precio)',
  FORMULARIO_TOTAL: 'el formulario pide un total', FORMULARIO_POR_LINEA: 'el formulario pide precio por línea',
  FORMULARIOS_SEPARADOS: 'un formulario económico por línea', EVALUACION_POR_ITEM: 'se evalúa por línea',
  GARANTIA_O_PLAZO_POR_LINEA: 'garantía o plazo por línea',
};

// ─── Cita estructurada {documento, numeral, frase} + página calculada por el código ─────────
export function Cita({ cita, etiqueta }: { cita?: any; etiqueta?: string }) {
  const docs = useContext(FuenteDocsContext);
  const abrirVisor = useContext(VisorContext);
  if (!cita || typeof cita !== 'object') return null;
  const nombreDoc = String(cita.documento_real || cita.documento || '');
  const frase = String(cita.frase || '').trim();
  if (!nombreDoc && !frase) return null;
  const pagina: number | null = cita.pagina ?? cita.pagina_aprox ?? null;
  const doc = docs.find(d => d.nombre === nombreDoc)
    ?? docs.find(d => { const a = _norm(d.nombre), b = _norm(nombreDoc); return !!b && (a.includes(b) || b.includes(a)); });
  const noVerificada = cita.verificada === false || cita.semantica === 'NO' || cita.semantica === 'PARCIAL';
  const texto = [nombreDoc, cita.numeral, pagina ? `pág. ${pagina}${cita.pagina == null && cita.pagina_aprox ? ' aprox.' : ''}` : ''].filter(Boolean).join(' · ');
  return (
    <span className={`inline-flex max-w-full min-w-0 flex-wrap items-start gap-x-1 gap-y-0.5 text-[11px] leading-snug ${noVerificada ? 'text-amber-700' : 'text-indigo-600'}`}>
      {etiqueta && <span className="text-slate-400">{etiqueta}</span>}
      {doc
        ? <a href={pagina ? `${doc.url}#page=${pagina}` : doc.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-start gap-1 hover:underline [overflow-wrap:anywhere]"><FileSearch size={10} className="mt-[3px] flex-shrink-0" />{texto || 'ver documento'}</a>
        : <span className="inline-flex min-w-0 items-start gap-1 [overflow-wrap:anywhere]"><FileSearch size={10} className="mt-[3px] flex-shrink-0" />{texto}</span>}
      {doc && pagina && abrirVisor && (
        <button type="button" onClick={() => abrirVisor({ url: doc.url, pagina, paginas: [pagina], q: frase || undefined, titulo: texto })}
          title="Ver la página y resaltar la frase" className="inline-flex flex-shrink-0 items-center text-violet-500 hover:text-violet-700"><Eye size={13} /></button>
      )}
      {noVerificada && (
        <span className="text-[10px] font-bold px-1 py-px rounded bg-amber-100 text-amber-700 cursor-help"
          title={cita.verificada === false ? 'La frase citada no se encontró en las bases: confírmala antes de usar el dato.' : `La frase existe, pero no sostiene el dato${cita.motivo_semantica ? `: ${cita.motivo_semantica}` : ''}.`}>
          no verificado
        </span>
      )}
    </span>
  );
}

export function FraseCitada({ cita }: { cita?: any }) {
  const f = String(cita?.frase || '').trim();
  if (!f) return null;
  return <p className="text-[11.5px] text-slate-500 italic mt-0.5 leading-snug">“{f.length > 220 ? f.slice(0, 220) + '…' : f}”</p>;
}
