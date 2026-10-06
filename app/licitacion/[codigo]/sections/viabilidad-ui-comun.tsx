'use client';

// Componentes y contextos COMPARTIDOS por las vistas del análisis de viabilidad (v3 guardados y v4).
// Viven aparte para que VistaViabilidadV4 los use sin importar ViabilidadIAPanel (evita la
// dependencia circular). Se movieron tal cual desde ViabilidadIAPanel.tsx (02-oct-2026).

import { createContext, useEffect, useState } from 'react';
import { useSession } from '@/app/lib/session-context';
import { IconAlertTriangle as AlertTriangle, IconChevronDown as ChevronDown, IconEye as Eye, IconX as X, IconLoader2 as Loader2, IconSearch as Search } from '@tabler/icons-react';

// ─── Explicabilidad: documentos de la licitación para resolver citas ──
export interface DocRef { nombre: string; url: string; categoria?: string }
export const FuenteDocsContext = createContext<DocRef[]>([]);

// Visor de fuente: al hacer clic en el ojo de una cita, abre un MODAL grande con la
// imagen de la página citada (renderizada por /api/pdf-pagina con mupdf) y, si se pasa
// `q`, RESALTA en amarillo el texto de donde sale el dato.
export interface VisorOpts { url: string; pagina: number | null; paginas?: number[]; q?: string; titulo?: string }
export const VisorContext = createContext<((o: VisorOpts) => void) | null>(null);

export function Seccion({ icon, titulo, badge, children, defaultOpen = false }: { icon: React.ReactNode; titulo: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
        <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">{icon}{titulo}{badge ? <span className="text-[11px] font-normal text-slate-400">· {badge}</span> : null}</span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}


export interface HallazgoValidador { regla: string; severidad: 'error' | 'aviso'; mensaje: string }
export function PanelValidador({ validador }: { validador?: { ok?: boolean; hallazgos?: HallazgoValidador[] } | null }) {
  const hallazgos = validador?.hallazgos || [];
  const errores = hallazgos.filter(h => h.severidad === 'error');
  const avisos = hallazgos.filter(h => h.severidad !== 'error');
  // Hooks SIEMPRE antes de cualquier return temprano (si no, React #310 cuando llegan hallazgos después).
  const [abierto, setAbierto] = useState(false);
  const { usuario } = useSession();
  // Alertas del validador (V-1, V-2…): solo las ve el admin, y siempre desplegables.
  if (usuario?.rol !== 'admin' || hallazgos.length === 0) return null;
  const hayErrores = errores.length > 0;
  return (
    <div className={`rounded-xl border ${hayErrores ? 'border-red-200 bg-red-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
      <button onClick={() => setAbierto(o => !o)} className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left">
        <AlertTriangle size={16} className={hayErrores ? 'text-red-600' : 'text-amber-600'} />
        <p className="flex-1 text-[13px] text-slate-700 leading-snug">
          <span className="font-bold">Validador automático:</span> {hallazgos.length} {hallazgos.length === 1 ? 'inconsistencia' : 'inconsistencias'}
          {errores.length > 0 && <span className="ml-2 text-[11.5px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">{errores.length} por revisar antes de confiar en el informe</span>}
        </p>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>
      {abierto && (
        <div className="px-3 pb-3 space-y-1.5">
          {[...errores, ...avisos].map((h, i) => (
            <div key={i} className={`flex items-start gap-2 text-[12px] rounded-lg px-2.5 py-1.5 ${h.severidad === 'error' ? 'bg-red-100/60 text-red-800' : 'bg-amber-100/50 text-amber-800'}`}>
              <span className="font-mono font-bold flex-shrink-0">{h.regla}</span>
              <span className="flex-1 leading-snug">{h.mensaje}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


export function HintOjo() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try { if (!localStorage.getItem('licitank_hint_ojo_visto')) setVisible(true); } catch { /* sin storage */ }
  }, []);
  if (!visible) return null;
  const cerrar = () => { setVisible(false); try { localStorage.setItem('licitank_hint_ojo_visto', '1'); } catch { /* noop */ } };
  return (
    <div className="flex items-center gap-2.5 text-[12.5px] text-violet-800 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
      <Eye size={15} className="flex-shrink-0 text-violet-500" />
      <p className="flex-1 leading-snug">Cada dato de este análisis trae su fuente: haz clic en el ojo <Eye size={12} className="inline align-[-1px] text-violet-500" /> de cualquier cita para ver la página exacta de las bases donde aparece, con el texto resaltado.</p>
      <button onClick={cerrar} className="text-violet-400 hover:text-violet-700 flex-shrink-0" title="Entendido, no volver a mostrar"><X size={15} /></button>
    </div>
  );
}

// Botón "Buscar en IA": para un producto de MAQUINARIA/EQUIPO, pide al backend que filtre las specs
// reales y arme un prompt de búsqueda exhaustivo (3 homólogos/superiores en Chile o China), lo COPIA
// al portapapeles y abre AI Studio en otra pestaña (no admite prellenar por URL). Si el copiado
// falla, deja el prompt visible para copiarlo a mano.
export function BotonBuscarEquipo({ codigo, producto, region }: { codigo: string; producto: { descripcion: string; caracteristicas: string[]; cantidad?: any }; region?: string }) {
  const [estado, setEstado] = useState<'idle' | 'cargando' | 'ok' | 'error'>('idle');
  const [prompt, setPrompt] = useState('');
  const buscar = async () => {
    setEstado('cargando'); setPrompt('');
    try {
      const r = await fetch(`/api/viabilidad/buscar-equipamiento/${encodeURIComponent(codigo)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: producto.descripcion, caracteristicas: producto.caracteristicas, cantidad: producto.cantidad, region }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.prompt_busqueda) { setEstado('error'); return; }
      setPrompt(j.prompt_busqueda);
      let copiado = false;
      try { await navigator.clipboard.writeText(j.prompt_busqueda); copiado = true; } catch { /* sin permiso de clipboard */ }
      window.open('https://aistudio.google.com/prompts/new_chat', '_blank', 'noopener,noreferrer');
      setEstado(copiado ? 'ok' : 'error');
    } catch { setEstado('error'); }
  };
  return (
    <div className="mt-2">
      <button type="button" onClick={buscar} disabled={estado === 'cargando'}
        title="Genera un prompt con las specs limpias, lo copia y abre AI Studio para buscar 3 proveedores chilenos"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60 px-3.5 py-2 rounded-lg shadow-sm shadow-violet-200 transition-all">
        {estado === 'cargando' ? <><Loader2 size={14} className="animate-spin" /> Generando prompt…</> : <><Search size={14} /> Buscar proveedor en IA</>}
      </button>
      {estado === 'ok' && <span className="text-[10px] text-emerald-600 ml-2">✓ Prompt copiado — pégalo en AI Studio (se abrió en otra pestaña)</span>}
      {estado === 'error' && !prompt && <span className="text-[10px] text-red-600 ml-2">No se pudo generar. Reintenta.</span>}
      {prompt && (
        <details className="mt-1" open={estado === 'error'}>
          <summary className="text-[10px] text-violet-600 cursor-pointer select-none">{estado === 'error' ? 'Copia el prompt manualmente (no se pudo copiar solo)' : 'Ver / copiar el prompt'}</summary>
          <textarea readOnly value={prompt} onClick={e => (e.target as HTMLTextAreaElement).select()}
            className="w-full mt-1 text-[10px] p-1.5 border border-slate-200 rounded bg-slate-50 h-28 font-mono" />
        </details>
      )}
    </div>
  );
}
