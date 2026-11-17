'use client';

// Gestionar documentos (solo empresas con plantillas, hoy Comercial MP): certificados, actas y otros documentos hechos desde plantillas.
// Arriba, un botón por plantilla (abre un modal con el formulario). Abajo, los documentos generados como tarjetas verticales con la miniatura del PDF.
// Los datos de la licitación y la empresa se llenan solos; se escribe lo propio de cada documento y, si corresponde, las personas (una página c/u).
import { useEffect, useState, useCallback, useRef } from 'react';
import { armarHtml } from '@/app/lib/compras-documentos-render';
import { useToast } from '@/app/components/ui/toast';
import { useConfirm } from '@/app/components/ui/confirm';
import { Modal } from '@/app/components/ui/Modal';
import { GuiaDespachoObumaCard } from './GuiaDespachoObumaCard';
import { EditorPlantillaDocumento } from './EditorPlantillaDocumento';
import { IconLoader2 as Loader2, IconPlus as Plus, IconTrash as Trash2, IconDownload as Download, IconFilePlus as FilePlus, IconUsers as Users, IconFileText as FileText, IconPhoto as Photo, IconPencil as Pencil, IconLayoutDashboard as Diseno, IconUpload as Upload } from '@tabler/icons-react';

interface Campo { clave: string; etiqueta: string; tipo: 'texto' | 'lista' | 'fecha' | 'tabla' | 'logo'; valorPorDefecto?: string; ayuda?: string; donde?: string }
interface Plantilla { id: number; nombre: string; descripcion: string | null; porPersona: boolean; campos: Campo[]; cuerpoHtml: string; layout?: any; editable?: boolean }
interface Contexto { logos?: Record<string, string>; logosOpciones?: { clave: string; nombre: string }[]; empresa: string; rutEmpresa: string; licitacionCodigo: string; licitacionNombre: string; organismo: string; hoy: string; representante?: string; representanteCargo?: string; logoUri?: string | null; firmaUri?: string | null; timbreUri?: string | null }
interface Generado { id: number; titulo: string; plantillaNombre: string; personas: number; creadoPor: string | null; createdAt: string }
interface Persona { nombre: string; rut: string }

const entrada = 'w-full text-[13px] px-3 py-2 rounded-lg border border-zinc-300 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500';
const fmtFecha = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? `${m[3]}-${m[2]}-${m[1]}` : s; };

export function GestionDocumentosCard({ negocioId }: { negocioId: number }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [cargando, setCargando] = useState(true);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [historial, setHistorial] = useState<Generado[]>([]);
  const [elegida, setElegida] = useState<Plantilla | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [personas, setPersonas] = useState<Persona[]>([{ nombre: '', rut: '' }]);
  const [generando, setGenerando] = useState(false);
  const [visor, setVisor] = useState<{ url: string; titulo: string } | null>(null);
  const [editor, setEditor] = useState<{ plantilla: Plantilla | null } | null>(null);
  const [bancoAbierto, setBancoAbierto] = useState(false);
  const [logoNombre, setLogoNombre] = useState('');
  const [logoArchivo, setLogoArchivo] = useState<File | null>(null);
  const [subiendoLogo, setSubiendoLogo] = useState(false);

  const urlPdf = (id: number) => `/api/compras/${negocioId}/documentos-generados?pdf=${id}`;

  const cargar = useCallback(async () => {
    try {
      const d = await fetch(`/api/compras/${negocioId}/documentos-generados`).then(r => r.json());
      if (d?.success && d.habilitado) { setPlantillas(d.plantillas); setCtx(d.contexto); setHistorial(d.historial || []); }
    } finally { setCargando(false); }
  }, [negocioId]);
  useEffect(() => { cargar(); }, [cargar]);

  const abrir = (p: Plantilla) => {
    const v: Record<string, string> = {};
    for (const c of p.campos) v[c.clave] = c.tipo === 'fecha' ? (ctx?.hoy || '') : (c.valorPorDefecto || '');
    // Lo que ya sabemos de la licitación entra escrito (editable), para que no se vea todo vacío.
    if (ctx) { if ('nombre_licitacion' in v) v.nombre_licitacion = ctx.licitacionNombre; if ('unidad' in v) v.unidad = ctx.organismo; }
    setValores(v); setPersonas([{ nombre: '', rut: '' }]); setElegida(p);
  };

  const generar = async () => {
    if (!elegida) return;
    setGenerando(true);
    try {
      const res = await fetch(`/api/compras/${negocioId}/documentos-generados`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plantillaId: elegida.id, valores, personas }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo generar.');
      toast.success('Documento generado', 'Quedó en el historial de este negocio.');
      setElegida(null); await cargar();
      setVisor({ url: urlPdf(d.id), titulo: elegida.nombre });
    } catch (e: any) { toast.error('No se pudo generar el documento', e.message); }
    finally { setGenerando(false); }
  };

  const subirLogo = async () => {
    if (!logoArchivo) return;
    setSubiendoLogo(true);
    try {
      const fd = new FormData(); fd.append('nombre', logoNombre); fd.append('file', logoArchivo);
      const res = await fetch(`/api/compras/${negocioId}/documentos-logos`, { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo subir el logo.');
      toast.success('Logo guardado en el banco');
      setLogoNombre(''); setLogoArchivo(null); await cargar();
    } catch (e: any) { toast.error('No se pudo subir el logo', e.message); }
    finally { setSubiendoLogo(false); }
  };

  const quitarLogo = async (clave: string, nombre: string) => {
    const ok = await confirmar({ titulo: '¿Quitar este logo del banco?', mensaje: `${nombre} dejará de estar disponible para documentos nuevos. Los documentos que ya lo usan quedan guardados, pero al volver a abrirlos saldrán sin ese logo.`, confirmarLabel: 'Quitar', peligro: true });
    if (!ok) return;
    try {
      const res = await fetch(`/api/compras/${negocioId}/documentos-logos?id=${clave.slice(1)}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo quitar.');
      await cargar();
    } catch (e: any) { toast.error('No se pudo quitar el logo', e.message); }
  };

  const quitarPlantilla = async (p: Plantilla) => {
    const ok = await confirmar({ titulo: '¿Quitar esta plantilla?', mensaje: `«${p.nombre}» dejará de aparecer en «Nuevo:». Los documentos que ya hiciste con ella siguen guardados.`, confirmarLabel: 'Quitar', peligro: true });
    if (!ok) return;
    try {
      const res = await fetch(`/api/compras/${negocioId}/documentos-plantillas?id=${p.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo quitar.');
      await cargar();
    } catch (e: any) { toast.error('No se pudo quitar la plantilla', e.message); }
  };

  const eliminar = async (h: Generado) => {
    const ok = await confirmar({ titulo: '¿Eliminar este documento?', mensaje: `${h.titulo} dejará de estar en este negocio. Se puede volver a generar, pero esta acción no se puede deshacer.`, confirmarLabel: 'Eliminar', peligro: true });
    if (!ok) return;
    try {
      const res = await fetch(`/api/compras/${negocioId}/documentos-generados?id=${h.id}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'No se pudo eliminar.');
      toast.success('Documento eliminado');
      await cargar();
    } catch (e: any) { toast.error('No se pudo eliminar el documento', e.message); }
  };

  if (cargando) return <div className="flex items-center gap-2 text-[13px] text-zinc-500 py-6"><Loader2 size={16} className="animate-spin" /> Cargando documentos…</div>;
  if (!plantillas.length) return null;

  return (
    <div className="space-y-4">
      {/* Guías de despacho: solo Inversiones Claro (RUT 76.902.659-2), la única empresa con Obuma. La ruta también lo exige. */}
      {ctx?.rutEmpresa.replace(/[^0-9kK]/g, '') === '769026592' && <GuiaDespachoObumaCard negocioId={negocioId} />}
      <div className="flex flex-wrap items-center gap-2">
        {plantillas.map(p => (
          <span key={p.id} className="inline-flex items-stretch rounded-lg overflow-hidden bg-teal-600">
            <button onClick={() => abrir(p)} title={p.descripcion || undefined}
              className="inline-flex items-center gap-2 text-[13px] font-semibold px-3.5 py-2 text-white hover:bg-teal-700 transition-colors">
              <FilePlus size={16} /> Nuevo: {p.nombre}
            </button>
            {p.editable && <>
              <button onClick={() => setEditor({ plantilla: p })} title="Editar el diseño de esta plantilla" aria-label="Editar plantilla" className="px-2 text-white/90 border-l border-white/25 hover:bg-teal-700"><Pencil size={14} /></button>
              <button onClick={() => quitarPlantilla(p)} title="Quitar esta plantilla" aria-label="Quitar plantilla" className="px-2 text-white/90 border-l border-white/25 hover:bg-teal-700"><Trash2 size={14} /></button>
            </>}
          </span>
        ))}
        <button onClick={() => setEditor({ plantilla: null })} className="inline-flex items-center gap-2 text-[13px] font-semibold px-3.5 py-2 rounded-lg border border-teal-300 text-teal-800 bg-teal-50 hover:bg-teal-100 transition-colors">
          <Diseno size={16} /> Diseñar plantilla
        </button>
        <button onClick={() => setBancoAbierto(true)} className="inline-flex items-center gap-2 text-[13px] font-semibold px-3.5 py-2 rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-50 transition-colors">
          <Photo size={16} /> Banco de logos
        </button>
      </div>

      {historial.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 px-4 py-10 text-center">
          <FileText size={28} className="mx-auto text-zinc-300" />
          <p className="mt-2 text-[13px] text-zinc-500">Todavía no hay documentos en este negocio. Crea el primero con el botón de arriba.</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {historial.map(h => (
            <div key={h.id} className="group flex flex-col rounded-xl border border-zinc-200 bg-white overflow-hidden hover:border-teal-300 hover:shadow-sm transition">
              <button type="button" onClick={() => setVisor({ url: urlPdf(h.id), titulo: h.titulo })} title="Ver el documento"
                className="relative block w-full bg-zinc-100 overflow-hidden" style={{ aspectRatio: '210 / 270' }}>
                {/* Primera página del PDF, reducida: se carga a medida que aparece en pantalla. */}
                <iframe src={`${urlPdf(h.id)}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`} title={h.titulo} tabIndex={-1} loading="lazy"
                  className="absolute top-0 left-0 border-0 pointer-events-none" style={{ width: '320%', height: '300%', transform: 'scale(0.3125, 0.3333)', transformOrigin: 'top left' }} />
                <span className="absolute inset-0 bg-teal-600/0 group-hover:bg-teal-600/10 transition-colors" />
              </button>
              <div className="p-3 flex-1 flex flex-col gap-1.5">
                <p className="text-[13px] font-semibold text-zinc-900 leading-snug">{h.plantillaNombre || h.titulo}</p>
                <p className="text-[12px] text-zinc-500 flex items-center gap-1.5">
                  {h.personas > 0 && <><Users size={13} className="text-zinc-400" /> {h.personas} {h.personas === 1 ? 'persona' : 'personas'} · </>}{fmtFecha(h.createdAt.slice(0, 10))}
                </p>
                {h.creadoPor && <p className="text-[11.5px] text-zinc-400 truncate">{h.creadoPor}</p>}
                <div className="mt-auto pt-1 flex items-center justify-between">
                  <a href={urlPdf(h.id)} download className="inline-flex items-center gap-1 text-[12px] font-semibold text-teal-700 hover:text-teal-800"><Download size={13} /> Descargar PDF</a>
                  <button onClick={() => eliminar(h)} aria-label="Eliminar documento" title="Eliminar" className="p-1 rounded text-zinc-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!elegida} onClose={() => !generando && setElegida(null)} title={elegida?.nombre} subtitle="Completa los datos de la izquierda: a la derecha ves cómo va quedando el documento." size="xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setElegida(null)} disabled={generando} className="text-[13px] font-semibold px-4 py-2 rounded-lg border border-zinc-300 text-zinc-700 hover:bg-zinc-50 disabled:opacity-60">Cancelar</button>
            <button onClick={generar} disabled={generando} className="inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60">
              {generando && <Loader2 size={14} className="animate-spin" />} Generar PDF
            </button>
          </div>
        }>
        {elegida && ctx && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,430px)]">
            <div className="space-y-5 min-w-0">
              <p className="text-[12.5px] text-zinc-600 rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2">
                <b>Ya viene llenado solo:</b> empresa, logo, firma, timbre y representante ({ctx.empresa}) y el código de la licitación ({ctx.licitacionCodigo}).
              </p>
              <div className="space-y-4">
                {elegida.campos.map((c, i) => (
                  <label key={c.clave} className="block">
                    <span className="flex items-baseline gap-2 mb-1">
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold flex-shrink-0">{i + 1}</span>
                      <span className="text-[13px] font-semibold text-zinc-800">{c.etiqueta}</span>
                    </span>
                    {c.donde && <span className="block text-[12px] text-zinc-500 mb-1.5 ml-7">{c.donde}</span>}
                    <span className="block ml-7">
                      {c.tipo === 'logo'
                        ? <span className="flex items-center gap-2"><select className={entrada} value={valores[c.clave] || ''} onChange={e => setValores(v => ({ ...v, [c.clave]: e.target.value }))}>{(ctx.logosOpciones || []).map(o => <option key={o.clave} value={o.clave}>{o.nombre}</option>)}</select><button type="button" onClick={() => setBancoAbierto(true)} className="text-[12px] font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap">Subir logo</button></span>
                        : c.tipo === 'lista' || c.tipo === 'tabla'
                        ? <textarea rows={6} className={entrada} placeholder={c.tipo === 'tabla' ? c.ayuda : undefined} value={valores[c.clave] || ''} onChange={e => setValores(v => ({ ...v, [c.clave]: e.target.value }))} />
                        : <input type={c.tipo === 'fecha' ? 'date' : 'text'} className={entrada} placeholder={c.ayuda} value={valores[c.clave] || ''} onChange={e => setValores(v => ({ ...v, [c.clave]: e.target.value }))} />}
                    </span>
                  </label>
                ))}
              </div>
              {elegida.porPersona && (
                <div className="space-y-2">
                  <span className="flex items-baseline gap-2">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold flex-shrink-0">{elegida.campos.length + 1}</span>
                    <span className="text-[13px] font-semibold text-zinc-800">Personas que reciben el certificado</span>
                  </span>
                  <span className="block text-[12px] text-zinc-500 ml-7">Sale una hoja por cada persona, con su nombre y RUT en grande.</span>
                  <div className="ml-7 space-y-2">
                    {personas.map((p, i) => (
                      <div key={i} className="flex gap-2">
                        <input className={entrada} placeholder="Nombre completo" value={p.nombre} onChange={e => setPersonas(l => l.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))} />
                        <input className={`${entrada} max-w-[150px]`} placeholder="RUT" value={p.rut} onChange={e => setPersonas(l => l.map((x, j) => j === i ? { ...x, rut: e.target.value } : x))} />
                        <button onClick={() => setPersonas(l => l.length > 1 ? l.filter((_, j) => j !== i) : l)} aria-label="Quitar persona" className="px-2 text-zinc-400 hover:text-rose-600"><Trash2 size={16} /></button>
                      </div>
                    ))}
                    <button onClick={() => setPersonas(l => [...l, { nombre: '', rut: '' }])} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-teal-700 hover:text-teal-800"><Plus size={14} /> Agregar persona</button>
                  </div>
                </div>
              )}
            </div>
            <div className="min-w-0 lg:sticky lg:top-0 self-start">
              <p className="text-[12px] font-semibold text-zinc-600 mb-2">Así va quedando <span className="font-normal text-zinc-400">· <span className="px-1 rounded bg-amber-100 text-amber-800">amarillo</span> = lo que escribes tú</span></p>
              <VistaPrevia plantilla={elegida} valores={valores} ctx={ctx} personas={personas} />
            </div>
          </div>
        )}
      </Modal>

      <Modal open={bancoAbierto} onClose={() => !subiendoLogo && setBancoAbierto(false)} title="Banco de logos" subtitle="Sube aquí los logos (empresas, marcas, mandantes). Después los eliges en cada certificado o acta." size="lg">
        <div className="space-y-5">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-2">
            <p className="text-[13px] font-semibold text-zinc-800">Agregar un logo</p>
            <input className={entrada} placeholder="Nombre (ej.: Tecnomaq, Grupo ICA)" value={logoNombre} onChange={e => setLogoNombre(e.target.value)} />
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setLogoArchivo(e.target.files?.[0] || null)} className="block w-full text-[12.5px] text-zinc-600" />
            <p className="text-[11.5px] text-zinc-500">PNG, JPG o WEBP, hasta 5 MB. Mejor con fondo transparente o blanco y de buena calidad.</p>
            <button onClick={subirLogo} disabled={!logoArchivo || !logoNombre.trim() || subiendoLogo} className="inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
              {subiendoLogo ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Guardar en el banco
            </button>
          </div>
          {(() => {
            const delBanco = (ctx?.logosOpciones || []).filter(o => /^b\d+$/.test(o.clave));
            return delBanco.length === 0
              ? <p className="text-[13px] text-zinc-500 text-center py-4">Todavía no hay logos en el banco.</p>
              : <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{delBanco.map(o => (
                  <div key={o.clave} className="rounded-lg border border-zinc-200 bg-white p-2 flex flex-col gap-2">
                    <div className="h-20 flex items-center justify-center bg-zinc-50 rounded"><img src={ctx?.logos?.[o.clave]} alt={o.nombre} className="max-h-16 max-w-full object-contain" /></div>
                    <div className="flex items-center justify-between gap-2"><span className="text-[12.5px] font-semibold text-zinc-800 truncate">{o.nombre}</span>
                      <button onClick={() => quitarLogo(o.clave, o.nombre)} aria-label="Quitar logo" title="Quitar" className="p-1 rounded text-zinc-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={15} /></button></div>
                  </div>))}</div>;
          })()}
        </div>
      </Modal>

      {editor && ctx && (
        <EditorPlantillaDocumento negocioId={negocioId} ctx={ctx as any} plantilla={editor.plantilla as any} onCerrar={() => setEditor(null)} onGuardado={async () => { setEditor(null); await cargar(); }} />
      )}

      {/* Visor propio: el PDF sale de nuestra ruta (no de una URL externa), así que va directo a un iframe. */}
      <Modal open={!!visor} onClose={() => setVisor(null)} title={visor?.titulo} size="xl">
        {visor && <iframe src={`${visor.url}#view=FitH`} title={visor.titulo} className="w-full border-0 rounded-lg bg-zinc-100" style={{ height: '78vh' }} />}
      </Modal>
    </div>
  );
}

/** Primera hoja del documento, a escala, con lo escrito marcado de color. Se rehace en cada tecla (es solo HTML, no genera PDF). */
function VistaPrevia({ plantilla, valores, ctx, personas }: { plantilla: Plantilla; valores: Record<string, string>; ctx: Contexto; personas: Persona[] }) {
  const caja = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(0.5);
  useEffect(() => {
    const el = caja.current; if (!el) return;
    const medir = () => setEscala(el.clientWidth / 794);
    medir(); const ro = new ResizeObserver(medir); ro.observe(el); return () => ro.disconnect();
  }, []);
  const html = armarHtml(plantilla as any, valores, ctx as any, [personas[0] || { nombre: '', rut: '' }], true);
  return (
    <div ref={caja} className="w-full rounded-lg border border-zinc-200 bg-white shadow-sm overflow-hidden" style={{ height: 1013 * escala }}>
      <iframe srcDoc={html} title="Vista previa" tabIndex={-1} sandbox="" className="border-0 pointer-events-none bg-white" style={{ width: 794, height: 1013, transform: `scale(${escala})`, transformOrigin: 'top left' }} />
    </div>
  );
}
