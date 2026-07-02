'use client';

// VIABILIDAD (PROMPT 2) — La IA es la fuente ÚNICA: lee todos los documentos (incl.
// escaneados vía Gemini visión) y entrega el SCORE 0-100, el veredicto y todo el
// análisis con su FUENTE. Front profesional: hero con score + veredicto + datos clave,
// y el detalle en secciones plegables (acordeón) para que no sea un muro de información.

import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, FileSearch, Loader2, AlertTriangle, ChevronDown, Ban, ShieldCheck, Package, Scale, Gavel, Target, ListChecks, ExternalLink, GraduationCap, Trash2, Send, Square, Eye, X, ZoomIn } from 'lucide-react';
import { useSession } from '@/app/lib/session-context';

interface Feedback {
  id: number;
  veredicto_ia?: string | null;
  veredicto_humano?: string | null;
  comentario: string;
  regla: string;
  created_at: string;
}

// Esquema PROMPT 2 v2.0 (sección 5A) + campos derivados (score/semaforo/area).
interface Criterio { nombre: string; ponderacion?: number; forma_aplicacion?: string; medio_verificacion?: string; fuente?: string }
interface Producto { linea: number; descripcion: string; modelo?: string; cantidad?: number | null; unidad_medida?: string; unidad_inferida?: boolean; presupuesto_linea?: number | null; tipo?: string; ruta?: string }
interface Palanca { palanca: string; estado: string; condicion?: string; fuente?: string }
interface Hito { hito: string; duracion_dias?: number | null; tipo_dias?: string; base_computo?: string; fuente?: string; inferido?: boolean }
interface InformeIA {
  score_0_100?: number; semaforo?: string; area_negocio?: string;
  meta?: { id?: string; nombre?: string; organismo?: string; region?: string; linea_negocio?: string };
  exclusion?: { excluido?: boolean; categoria?: string | null; motivo?: string; fuente?: string; destino?: string };
  presupuesto?: { bruto?: number | null; neto?: number | null; con_iva?: boolean; regimen_fora?: boolean; presupuesto_exento?: boolean; es_excluyente?: boolean; fuente?: string; gate?: string };
  modalidad?: { tipo?: string; estado?: string; evidencia?: string; fuente?: string; confianza?: number; libertad_de_pricing?: boolean };
  criterios_evaluacion?: { fuente_datos?: string; forma_aplicacion_completa?: boolean; criterios?: Criterio[]; alertas?: string[] };
  capa_a?: { presupuesto?: { pts?: number; fuente?: string; justificacion?: string }; cantidad_items?: { pts?: number; n_items?: number; fuente?: string; justificacion?: string }; complejidad?: { pts?: number; fuente?: string; justificacion?: string }; ejecucion?: { pts?: number; fuente?: string; justificacion?: string }; score_total?: number; nivel?: string };
  capa_b_palancas?: Palanca[];
  capa_c_admisibilidad?: { presupuesto_excluyente?: { aplica?: boolean; efecto?: string; fuente?: string }; bloqueantes?: Array<{ item: string; fuente?: string }>; barreras_a_favor?: Array<{ item: string; fuente?: string }>; boleta_aplica?: boolean; umbral_utm?: number; firma_puno_y_letra?: boolean; alertas?: string[] };
  multas?: { estructura?: string; costo_por_dia?: string; costo_maximo?: string; umbral_termino?: string; fuente?: string };
  linea_tiempo?: { hitos?: Hito[]; plazo_ofertable_puntaje?: string; plazo_operativo_real_dias_habiles?: number | null; colchon_dias_habiles?: number | null; alertas?: string[] };
  manifiesto_productos?: Producto[];
  pendientes_fase3?: string[];
  veredicto?: { nivel?: string; gana_probable?: string; estado_veredicto?: string; motivos_revision?: string[]; acciones_AC?: string[]; advertencias?: string[] };
  confianza_global?: number;
  documentos_leidos?: string[];
  documentos_no_leidos?: string[];
}

const fmt = (n?: number | null) => n != null ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const cap = (s?: string) => (s || '').replace(/_/g, ' ');

// ─── Explicabilidad: resolver una cita ("doc, art, pág N") al PDF en esa página ──
interface DocRef { nombre: string; url: string }
const FuenteDocsContext = createContext<DocRef[]>([]);

const _norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Número de página de una cita: "pág. 7", "pagina 3-4", "p. 12" → 7/3/12.
function paginaDeCita(fuente: string): number | null {
  const m = _norm(fuente).match(/\bp(?:ag|agina|g)?\.?\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// A qué documento apunta la cita: solape de palabras clave del nombre del archivo
// con el texto de la cita. Devuelve la URL con #page=N para el visor nativo del navegador.
function resolverCita(fuente: string, docs: DocRef[]): { href: string; pagina: number | null } | null {
  if (!fuente || !docs.length) return null;
  const f = _norm(fuente);
  let mejor: DocRef | null = null, mejorScore = 0;
  for (const d of docs) {
    const tokens = _norm(d.nombre.replace(/\.[a-z0-9]+$/i, '')).split(/[^a-z0-9]+/).filter(t => t.length >= 4);
    const score = tokens.reduce((s, t) => s + (f.includes(t) ? 1 : 0), 0);
    if (score > mejorScore) { mejorScore = score; mejor = d; }
  }
  if (!mejor || mejorScore === 0) return null;
  const pag = paginaDeCita(fuente);
  return { href: pag ? `${mejor.url}#page=${pag}` : mejor.url, pagina: pag };
}

const SEM: Record<string, { label: string; ring: string; text: string; bg: string; soft: string }> = {
  VERDE:     { label: 'Muy conveniente', ring: '#10b981', text: 'text-emerald-700', bg: 'bg-emerald-600', soft: 'bg-emerald-50 border-emerald-200' },
  AMARILLO:  { label: 'Conveniente',     ring: '#eab308', text: 'text-yellow-700',  bg: 'bg-yellow-500',  soft: 'bg-yellow-50 border-yellow-200' },
  NARANJA:   { label: 'Viabilidad media',ring: '#f97316', text: 'text-orange-700',  bg: 'bg-orange-500',  soft: 'bg-orange-50 border-orange-200' },
  ROJO:      { label: 'Baja',            ring: '#ef4444', text: 'text-red-700',     bg: 'bg-red-500',     soft: 'bg-red-50 border-red-200' },
  ROJO_DURO: { label: 'Descartar',       ring: '#b91c1c', text: 'text-red-800',     bg: 'bg-red-700',     soft: 'bg-red-100 border-red-300' },
};

function Gauge({ score, sem }: { score: number; sem: { ring: string } }) {
  const r = 34, c = 2 * Math.PI * r, off = c - (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <div className="relative flex-shrink-0" style={{ width: 88, height: 88 }}>
      <svg width="88" height="88" className="-rotate-90">
        <circle cx="44" cy="44" r={r} fill="none" stroke="#f1f5f9" strokeWidth="8" />
        <circle cx="44" cy="44" r={r} fill="none" stroke={sem.ring} strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black text-slate-800 leading-none">{score}</span>
        <span className="text-[10px] text-slate-400">/100</span>
      </div>
    </div>
  );
}

// Visor de fuente: al hacer clic en el ojo de una cita, abre un MODAL grande con la
// imagen de la página citada (renderizada por /api/pdf-pagina con mupdf) y, si se pasa
// `q`, RESALTA en amarillo el texto de donde sale el dato. Antes era un hover diminuto.
interface VisorOpts { url: string; pagina: number | null; q?: string; titulo?: string }
const VisorContext = createContext<((o: VisorOpts) => void) | null>(null);

function VisorPagina({ estado, onClose }: { estado: VisorOpts; onClose: () => void }) {
  const [cargada, setCargada] = useState(false);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const pagina = estado.pagina ?? 1;
  const src = `/api/pdf-pagina?url=${encodeURIComponent(estado.url)}&pagina=${pagina}${estado.q ? `&q=${encodeURIComponent(estado.q)}` : ''}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-800 truncate">{estado.titulo || 'Fuente del análisis'}</p>
            <p className="text-[11px] text-slate-400 truncate">{estado.pagina != null ? `Página ${estado.pagina}` : 'Documento'}{estado.q ? ` · resaltado: “${estado.q}”` : ''}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => setZoom(z => !z)} title="Ampliar / reducir" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ZoomIn size={16} /></button>
            <a href={`${estado.url}#page=${pagina}`} target="_blank" rel="noopener noreferrer" title="Abrir el PDF completo" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ExternalLink size={16} /></a>
            <button onClick={onClose} title="Cerrar (Esc)" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
          </div>
        </div>
        <div className="overflow-auto bg-slate-100 flex-1 flex justify-center items-start p-3">
          {!cargada && !error && <div className="flex items-center gap-2 text-slate-400 text-[13px] py-24"><Loader2 size={18} className="animate-spin" /> Renderizando página {pagina}…</div>}
          {error && <div className="text-slate-400 text-[13px] py-24">No se pudo renderizar la página. <a href={`${estado.url}#page=${pagina}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Abrir el PDF</a>.</div>}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={`Página ${pagina}`} onLoad={() => setCargada(true)} onError={() => setError(true)}
            className={`${cargada ? 'block' : 'hidden'} h-fit rounded shadow ${zoom ? 'max-w-none w-[1100px]' : 'max-w-full'}`} />
        </div>
      </div>
    </div>
  );
}

function Fuente({ children, destacar }: { children?: string; destacar?: string }) {
  const docs = useContext(FuenteDocsContext);
  const abrirVisor = useContext(VisorContext);
  if (!children) return null;
  const cita = resolverCita(children, docs);
  if (cita) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-indigo-600">
        <a href={cita.href} target="_blank" rel="noopener noreferrer" title="Abrir el PDF completo"
          className="inline-flex items-center gap-1 hover:text-indigo-800 hover:underline">
          <FileSearch size={10} />{children}
        </a>
        {abrirVisor && (
          <button type="button" onClick={() => abrirVisor({ url: cita.href.split('#')[0], pagina: cita.pagina, q: destacar, titulo: children })}
            title="Ver y resaltar en el documento"
            className="inline-flex items-center text-violet-500 hover:text-violet-700">
            <Eye size={13} />
          </button>
        )}
      </span>
    );
  }
  return <span className="inline-flex items-center gap-1 text-[11px] text-indigo-500"><FileSearch size={10} />{children}</span>;
}

function Seccion({ icon, titulo, badge, children, defaultOpen = false }: { icon: React.ReactNode; titulo: string; badge?: string; children: React.ReactNode; defaultOpen?: boolean }) {
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

const estadoColor = (e?: string) => e === 'VENTAJA' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : e === 'DESVENTAJA' ? 'text-red-700 bg-red-50 border-red-200' : 'text-slate-500 bg-slate-50 border-slate-200';

export function ViabilidadIAPanel({ codigo, onTambienAnalizar, onComplete }: { codigo: string; onTambienAnalizar?: () => void; onComplete?: () => void }) {
  const { usuario } = useSession();
  // Solo admin puede (re)analizar la viabilidad (operación cara y central; el servidor lo valida).
  const esAdmin = usuario?.rol === 'admin';
  // Solo admin o usuarios con permiso pueden comentar/corregir la viabilidad (el servidor también lo valida).
  const puedeComentar = usuario?.rol === 'admin' || !!usuario?.permisos?.comentar_viabilidad;
  const [informe, setInforme] = useState<InformeIA | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocRef[]>([]);
  const [visor, setVisor] = useState<VisorOpts | null>(null);   // modal de fuente (página + resaltado)
  const abortRef = useRef<AbortController | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/licitacion-viabilidad-ia/${encodeURIComponent(codigo)}`).then(x => x.json());
      if (r?.informeIA) setInforme(r.informeIA);
    } catch { /* silencioso */ }
  }, [codigo]);
  useEffect(() => { cargar(); }, [cargar]);

  // Documentos de la licitación (nombre + URL) para enlazar cada cita a su PDF.
  useEffect(() => {
    fetch(`/api/documentos/${encodeURIComponent(codigo)}`)
      .then(x => x.json())
      .then(r => {
        const lista: DocRef[] = (Array.isArray(r?.documentos) ? r.documentos : [])
          .map((d: any) => ({ nombre: d.nombre || d.documento_nombre || '', url: d.url || d.url_local || d.documento_url_local || '' }))
          .filter((d: DocRef) => d.url);
        setDocs(lista);
      })
      .catch(() => { /* silencioso: sin docs, las citas quedan como texto */ });
  }, [codigo]);

  // ── Feedback loop (enseñar a la IA) ───────────────────────────────────────────
  const [feedback, setFeedback]   = useState<Feedback[]>([]);
  const [fbComentario, setFbComentario] = useState('');
  const [fbVeredicto, setFbVeredicto]   = useState<string>('');
  const [fbEnviando, setFbEnviando]     = useState(false);
  const [fbOk, setFbOk]                 = useState<string | null>(null);

  const cargarFeedback = useCallback(async () => {
    try {
      const r = await fetch(`/api/viabilidad-feedback/${encodeURIComponent(codigo)}`).then(x => x.json());
      if (Array.isArray(r?.feedback)) setFeedback(r.feedback);
    } catch { /* silencioso */ }
  }, [codigo]);
  useEffect(() => { cargarFeedback(); }, [cargarFeedback]);

  const enviarFeedback = async () => {
    if (fbComentario.trim().length < 4) return;
    setFbEnviando(true); setFbOk(null);
    try {
      const r = await fetch(`/api/viabilidad-feedback/${encodeURIComponent(codigo)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comentario: fbComentario.trim(), veredicto_humano: fbVeredicto || null }),
      });
      const j = await r.json();
      if (!r.ok) { setFbOk(j.error || 'No se pudo guardar.'); return; }
      if (Array.isArray(j.feedback)) setFeedback(j.feedback);
      setFbComentario(''); setFbVeredicto('');
      setFbOk(`Aprendido. Regla: "${j.regla}". Se aplicará en los próximos análisis.`);
    } catch (e: any) { setFbOk(String(e?.message || e)); }
    finally { setFbEnviando(false); }
  };

  const borrarFeedback = async (id: number) => {
    try {
      const r = await fetch(`/api/viabilidad-feedback/${encodeURIComponent(codigo)}?id=${id}`, { method: 'DELETE' }).then(x => x.json());
      if (Array.isArray(r?.feedback)) setFeedback(r.feedback);
    } catch { /* silencioso */ }
  };

  const detener = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const analizar = async () => {
    setCargando(true); setError(null);
    abortRef.current = new AbortController();
    try { onTambienAnalizar?.(); } catch { /* noop */ }
    try {
      // Si ya hay informe, el botón es "Re-analizar": fuerza una corrida fresca
      // (ignora el cache por huella de documentos). El primer análisis sí usa cache.
      const qs = informe ? '?force=1' : '';
      const r = await fetch(`/api/licitacion-viabilidad-ia/${encodeURIComponent(codigo)}${qs}`, {
        method: 'POST',
        signal: abortRef.current.signal,
      });
      // Los análisis largos pueden superar el timeout del proxy/tunnel: este corta la
      // conexión y devuelve una página HTML (<!DOCTYPE…) en vez de JSON, pero el análisis
      // SIGUE corriendo en el servidor. Avisar en claro en vez del críptico
      // "Unexpected token '<' … is not valid JSON".
      const esJSON = (r.headers.get('content-type') || '').includes('application/json');
      if (!esJSON) {
        setError('El análisis tardó más que el tiempo máximo de la conexión y esta se cortó, pero sigue procesándose en el servidor. Espera unos minutos y vuelve a abrir esta licitación: el informe quedará guardado.');
        return;
      }
      const j = await r.json();
      if (!r.ok) { setError(j.error || 'Error al analizar.'); return; }
      setInforme(j.informeIA);
      // Refrescar documentos: el análisis puede haber generado el Excel de costeo
      try { onComplete?.(); } catch { /* noop */ }
    } catch (e: any) {
      if ((e as Error)?.name === 'AbortError') return; // cancelado por el usuario
      setError(String(e?.message || e));
    }
    finally { setCargando(false); abortRef.current = null; }
  };

  const v = informe?.veredicto;
  const score = Math.round(Number(informe?.score_0_100) || 0);
  const sem = SEM[informe?.semaforo || ''] || SEM.NARANJA;
  const gana = (v?.gana_probable || '').toLowerCase();
  const ganaLabel = gana === 'si' ? 'GANA' : gana === 'no' ? 'NO GANA' : 'CONDICIONAL';
  const cc = informe?.capa_c_admisibilidad;
  const crit = informe?.criterios_evaluacion;
  const criterios = crit?.criterios ?? [];
  const sumaCriterios = criterios.reduce((s, c) => s + (Number(c.ponderacion) || 0), 0);
  const nProd = informe?.manifiesto_productos?.length ?? 0;
  const lt = informe?.linea_tiempo;
  const enRevision = v?.estado_veredicto === 'REVISION_HUMANA';
  // Resumen del veredicto: el esquema v2.0 no trae "por_que"; lo componemos con los
  // motivos de revisión (si los hay) o las advertencias.
  const resumenVeredicto = (v?.motivos_revision?.length ? v.motivos_revision.join(' · ')
    : v?.advertencias?.length ? v.advertencias.join(' · ')
    : '');

  // Validador de coherencia: incoherencias del informe que merecen revisión humana.
  const avisos: string[] = [];
  if (informe) {
    const nCrit = criterios.length;
    const suma = Math.round(sumaCriterios);
    if (nCrit > 0 && suma !== 100) avisos.push(`Los criterios de evaluación suman ${suma}% (deberían sumar 100%).`);
    if (nCrit === 0) avisos.push('No se encontraron criterios de evaluación en las bases (situación anómala).');
    else if (crit?.forma_aplicacion_completa === false) avisos.push('Falta la FORMA DE APLICACIÓN de uno o más criterios: revisar las bases.');
    if (enRevision) avisos.push(`Veredicto en REVISIÓN HUMANA${v?.motivos_revision?.length ? ': ' + v.motivos_revision.join('; ') : '.'}`);
    if (informe.modalidad?.estado === 'REVISION_HUMANA') avisos.push('La modalidad de adjudicación no quedó fehacientemente determinada.');
    const conf = informe.confianza_global;
    if (conf != null && conf < 0.6) avisos.push(`Confianza del análisis baja (${Math.round(conf * 100)}%): conviene revisión humana.`);
    if ((informe.documentos_no_leidos?.length ?? 0) > 0) avisos.push(`${informe.documentos_no_leidos!.length} documento(s) no se pudieron leer: el análisis puede estar incompleto.`);
  }

  // Enlace al PDF para citas mostradas fuera del componente <Fuente> (chips).
  const hrefCita = (f?: string) => (f ? resolverCita(f, docs)?.href : undefined);

  return (
    <div className="space-y-3">
      {/* Cabecera + acción */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center flex-shrink-0"><Sparkles size={16} className="text-white" /></div>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-slate-800 leading-tight">Viabilidad por IA</h2>
            <p className="text-[11px] text-slate-400 truncate">Gemini lee todas las bases (incl. escaneadas) y emite el veredicto con su fuente</p>
          </div>
        </div>
        {/* Primer análisis: lo puede correr cualquiera. RE-analizar (ya hay informe): solo admin. */}
        {!(esAdmin || !informe) ? null : cargando ? (
          <button onClick={detener}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-[13px] font-semibold rounded-lg transition-colors flex-shrink-0">
            <Square size={14} /> Detener
          </button>
        ) : (
          <button onClick={analizar}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold rounded-lg transition-colors flex-shrink-0">
            <Sparkles size={14} /> {informe ? 'Re-analizar' : 'Analizar con IA'}
          </button>
        )}
      </div>

      {error && <div className="flex items-start gap-2 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-3"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /><div><p className="font-semibold">No se pudo completar</p><p className="text-red-600">{error.includes('saturad') || error.includes('429') || error.includes('503') ? 'Gemini está saturado en este momento (demanda alta de Google). Reintenta en unos minutos.' : error}</p></div></div>}

      {!informe && !cargando && !error && (
        <div className="flex flex-col items-center justify-center py-14 bg-white rounded-2xl border border-slate-200 text-center">
          <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center mb-3"><Sparkles size={22} className="text-violet-500" /></div>
          <p className="text-[14px] font-semibold text-slate-700">Aún sin análisis</p>
          <p className="text-[12px] text-slate-400 max-w-xs mt-1">Pulsa “Analizar con IA”: leerá todos los documentos y entregará el score, el veredicto y todo el detalle con su fuente.</p>
        </div>
      )}

      {cargando && !informe && (
        <div className="flex flex-col items-center justify-center py-14 bg-white rounded-2xl border border-slate-200 text-center">
          <Loader2 size={26} className="text-violet-500 animate-spin mb-3" />
          <p className="text-[14px] font-semibold text-slate-700">Leyendo los documentos…</p>
          <p className="text-[12px] text-slate-400 mt-1">Las bases escaneadas se leen con visión. Puede tardar 1–2 minutos la primera vez.</p>
        </div>
      )}

      {visor && <VisorPagina estado={visor} onClose={() => setVisor(null)} />}

      {informe && (
        <FuenteDocsContext.Provider value={docs}>
         <VisorContext.Provider value={setVisor}>
          {/* HERO: score + veredicto */}
          <div className={`rounded-2xl border p-4 ${sem.soft}`}>
            <div className="flex items-center gap-4">
              <Gauge score={score} sem={sem} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] font-black text-white px-2 py-0.5 rounded ${sem.bg}`}>{ganaLabel}</span>
                  <span className={`text-[13px] font-bold ${sem.text}`}>{SEM[informe.semaforo || '']?.label || cap(v?.nivel)}</span>
                  {informe.area_negocio && <span className="text-[11px] text-slate-500 bg-white/60 border border-slate-200 px-2 py-0.5 rounded-full">{cap(informe.area_negocio)}</span>}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${enRevision ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                    {enRevision ? 'REVISIÓN HUMANA' : 'DEFINITIVO'}
                  </span>
                </div>
                {resumenVeredicto && <p className="text-[13px] text-slate-600 mt-1.5 leading-snug">{resumenVeredicto}</p>}
              </div>
            </div>
          </div>

          {/* Exclusión */}
          {informe.exclusion?.excluido && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-700"><strong>Exclusión ({cap(informe.exclusion.categoria || '')}):</strong> {informe.exclusion.motivo} <Fuente>{informe.exclusion.fuente}</Fuente></div>
          )}

          {/* Avisos de coherencia / revisión humana */}
          {avisos.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-[12px] font-bold text-amber-800 mb-1"><AlertTriangle size={13} /> Avisos de revisión</p>
              <ul className="text-[12px] text-amber-700 space-y-0.5 list-disc pl-5">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}

          {/* Datos clave (chips) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Presupuesto</p>
              <p className="text-[15px] font-bold text-emerald-700 leading-tight">{fmt(informe.presupuesto?.neto ?? informe.presupuesto?.bruto)}</p>
              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                {informe.presupuesto?.es_excluyente
                  ? <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-700">EXCLUYENTE</span>
                  : <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-slate-100 text-slate-500">referencial</span>}
                {informe.presupuesto?.regimen_fora && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-violet-100 text-violet-700">FORA</span>}
              </div>
              {hrefCita(informe.presupuesto?.fuente)
                ? <a href={hrefCita(informe.presupuesto?.fuente)} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-indigo-600 hover:underline truncate" title={informe.presupuesto?.fuente}>{informe.presupuesto?.neto ? 'neto · ' : ''}{informe.presupuesto?.fuente}</a>
                : <p className="text-[10px] text-slate-400 truncate" title={informe.presupuesto?.fuente}>{informe.presupuesto?.neto ? 'neto · ' : ''}{informe.presupuesto?.fuente}</p>}
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Modalidad</p>
              <p className="text-[14px] font-semibold text-slate-800 leading-tight">{cap(informe.modalidad?.tipo) || '—'}{informe.modalidad?.estado === 'REVISION_HUMANA' ? ' ⚠' : ''}</p>
              {hrefCita(informe.modalidad?.fuente)
                ? <a href={hrefCita(informe.modalidad?.fuente)} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-indigo-600 hover:underline truncate" title={informe.modalidad?.fuente}>{informe.modalidad?.fuente}</a>
                : <p className="text-[10px] text-slate-400 truncate" title={informe.modalidad?.fuente}>{informe.modalidad?.fuente}</p>}
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Colchón operativo</p>
              <p className="text-[15px] font-bold text-slate-800 leading-tight">{lt?.colchon_dias_habiles != null ? `${lt.colchon_dias_habiles} días háb.` : '—'}</p>
              <p className="text-[10px] text-slate-400 truncate">{lt?.plazo_ofertable_puntaje ? `ofertable: ${lt.plazo_ofertable_puntaje}` : 'post-adjudicación'}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Líneas</p>
              <p className="text-[15px] font-bold text-slate-800 leading-tight">{nProd || informe.capa_a?.cantidad_items?.n_items || '—'}</p>
              <p className="text-[10px] text-slate-400">productos</p>
            </div>
          </div>

          {/* DETALLE — acordeón */}
          {criterios.length > 0 && (
            <Seccion icon={<Target size={14} className="text-violet-500" />} titulo="Criterios de evaluación y forma de aplicación" badge={`suma ${sumaCriterios}%${crit?.forma_aplicacion_completa === false ? ' · forma incompleta ⚠' : ''}`} defaultOpen>
              <div className="space-y-2.5">
                {criterios.map((c, i) => (
                  <div key={i} className="border-b border-slate-100 last:border-0 pb-2 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-slate-800">{c.nombre}</p>
                      <span className="text-[13px] font-bold text-slate-900 flex-shrink-0">{c.ponderacion ?? 0}%</span>
                    </div>
                    {c.forma_aplicacion
                      ? <p className="text-[12px] text-slate-600 mt-0.5 leading-snug whitespace-pre-line">{c.forma_aplicacion}</p>
                      : <p className="text-[12px] text-amber-600 mt-0.5">⚠ Sin forma de aplicación — revisar las bases.</p>}
                    {c.medio_verificacion && <p className="text-[11px] text-slate-400 mt-0.5">Verificación: {c.medio_verificacion}</p>}
                    <div className="mt-0.5"><Fuente destacar={c.nombre}>{c.fuente}</Fuente></div>
                  </div>
                ))}
                {(crit?.alertas?.length ?? 0) > 0 && (
                  <div className="text-[12px] text-amber-700 space-y-0.5 pt-1">{crit!.alertas!.map((a, i) => <p key={i}>⚠ {a}</p>)}</div>
                )}
              </div>
            </Seccion>
          )}

          {/* Línea de tiempo post-adjudicación */}
          {(lt?.hitos?.length ?? 0) > 0 && (
            <Seccion icon={<Gavel size={14} className="text-violet-500" />} titulo="Línea de tiempo post-adjudicación" badge={lt?.colchon_dias_habiles != null ? `colchón ${lt.colchon_dias_habiles} días háb.` : undefined} defaultOpen>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-[10px] text-slate-400 uppercase font-bold">Ofertable (puntaje)</p><p className="text-[13px] font-bold text-slate-800">{lt?.plazo_ofertable_puntaje || '—'}</p></div>
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-[10px] text-slate-400 uppercase font-bold">Operativo real</p><p className="text-[13px] font-bold text-slate-800">{lt?.plazo_operativo_real_dias_habiles != null ? `${lt.plazo_operativo_real_dias_habiles} háb.` : '—'}</p></div>
                <div className="bg-emerald-50 rounded-lg p-2"><p className="text-[10px] text-emerald-500 uppercase font-bold">Colchón</p><p className="text-[13px] font-bold text-emerald-700">{lt?.colchon_dias_habiles != null ? `${lt.colchon_dias_habiles} háb.` : '—'}</p></div>
              </div>
              <div className="space-y-1.5">
                {lt!.hitos!.map((h, i) => (
                  <div key={i} className="flex items-start gap-2 text-[13px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-700">{h.hito}{h.duracion_dias != null ? ` — ${h.duracion_dias} día(s) ${h.tipo_dias || ''}` : ''}{h.inferido ? ' (inferido ⚠)' : ''}</p>
                      {(h.base_computo || h.fuente) && <p className="text-[11px] text-slate-400">{h.base_computo ? `cómputo: ${cap(h.base_computo)} · ` : ''}<Fuente>{h.fuente}</Fuente></p>}
                    </div>
                  </div>
                ))}
                {(lt?.alertas?.length ?? 0) > 0 && lt!.alertas!.map((a, i) => <p key={'lta' + i} className="text-[12px] text-amber-700">⚠ {a}</p>)}
              </div>
            </Seccion>
          )}

          {informe.capa_a && (
            <Seccion icon={<Scale size={14} className="text-violet-500" />} titulo="Atractivo (Capa A)" badge={`${informe.capa_a.score_total ?? '?'}/15 · ${cap(informe.capa_a.nivel)}`}>
              <div className="space-y-1.5 text-[12px]">
                {[['Presupuesto', informe.capa_a.presupuesto], ['Cantidad', informe.capa_a.cantidad_items], ['Complejidad', informe.capa_a.complejidad], ['Ejecución', informe.capa_a.ejecucion]].map(([lbl, o]: any, i) => (
                  <div key={i} className="bg-slate-50 rounded-lg p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-700">{lbl}</p>
                      <span className="font-bold text-slate-900 flex-shrink-0">{o?.pts ?? '—'}/3</span>
                    </div>
                    {o?.justificacion && <p className="text-slate-600 mt-0.5 leading-snug">{o.justificacion}</p>}
                    {o?.fuente && <div className="mt-0.5"><Fuente>{o.fuente}</Fuente></div>}
                  </div>
                ))}
              </div>
            </Seccion>
          )}

          {(informe.capa_b_palancas?.length ?? 0) > 0 && (
            <Seccion icon={<ListChecks size={14} className="text-violet-500" />} titulo="Palancas (Capa B)">
              <div className="space-y-1.5 text-[12px]">
                {informe.capa_b_palancas!.map((p, i) => (
                  <div key={i} className="bg-slate-50 rounded-lg p-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-700">{cap(p.palanca)}</span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border font-bold ${estadoColor(p.estado)}`}>{cap(p.estado)}</span>
                    </div>
                    {p.condicion && <p className="text-slate-600 mt-0.5 leading-snug">{p.condicion}</p>}
                    {p.fuente && <div className="mt-0.5"><Fuente>{p.fuente}</Fuente></div>}
                  </div>
                ))}
              </div>
            </Seccion>
          )}

          {cc && (
            <Seccion icon={<ShieldCheck size={14} className="text-violet-500" />} titulo="Admisibilidad (Capa C)" badge={(cc.bloqueantes?.length ?? 0) > 0 ? `${cc.bloqueantes!.length} bloqueante(s)` : 'sin bloqueantes'}>
              <div className="space-y-1.5 text-[13px]">
                {cc.presupuesto_excluyente?.aplica && (
                  <p className="flex items-start gap-1.5 text-red-700 font-semibold"><Ban size={13} className="mt-0.5 flex-shrink-0" /> Presupuesto EXCLUYENTE — no superar el techo <Fuente>{cc.presupuesto_excluyente.fuente}</Fuente></p>
                )}
                {cc.bloqueantes?.map((b, i) => <p key={'bl' + i} className="flex items-start gap-1.5 text-red-700"><Ban size={13} className="mt-0.5 flex-shrink-0" /> {b.item} <Fuente>{b.fuente}</Fuente></p>)}
                {cc.barreras_a_favor?.map((b, i) => <p key={'bf' + i} className="flex items-start gap-1.5 text-emerald-700"><ShieldCheck size={13} className="mt-0.5 flex-shrink-0" /> {b.item} <Fuente>{b.fuente}</Fuente></p>)}
                <p className="text-slate-500 text-[12px]">Boleta: {cc.boleta_aplica ? `aplica (>${cc.umbral_utm ?? 1000} UTM)` : `no aplica (<${cc.umbral_utm ?? 1000} UTM)`} · Firma puño y letra: {cc.firma_puno_y_letra ? 'EXIGIDA ⚠' : 'no exigida'}</p>
                {cc.alertas?.map((a, i) => <p key={'al' + i} className="text-amber-700 text-[12px]">⚠ {a}</p>)}
              </div>
            </Seccion>
          )}

          {(informe.multas?.estructura || informe.multas?.costo_por_dia) && (
            <Seccion icon={<Gavel size={14} className="text-violet-500" />} titulo="Multas">
              <p className="text-[13px] text-slate-700">{informe.multas?.estructura}{informe.multas?.costo_por_dia ? ` · costo/día: ${informe.multas.costo_por_dia}` : ''}{informe.multas?.costo_maximo ? ` · tope: ${informe.multas.costo_maximo}` : ''}{informe.multas?.umbral_termino ? ` · término: ${informe.multas.umbral_termino}` : ''}</p>
              <div className="mt-1"><Fuente>{informe.multas?.fuente}</Fuente></div>
            </Seccion>
          )}

          {nProd > 0 && (
            <Seccion icon={<Package size={14} className="text-violet-500" />} titulo="Productos (manifiesto)" badge={`${nProd} líneas`}>
              <div className="space-y-1">
                {informe.manifiesto_productos!.map((p, i) => (
                  <div key={i} className="flex gap-2 text-[13px] border-b border-slate-100 last:border-0 py-1">
                    <span className="text-slate-400 w-6 flex-shrink-0">{p.linea ?? i + 1}.</span>
                    <span className="text-slate-700 flex-1">{p.descripcion}{p.modelo ? ` · ${p.modelo}` : ''}</span>
                    {p.cantidad != null && <span className="text-slate-500 flex-shrink-0">{p.cantidad}{p.unidad_medida ? ` ${p.unidad_medida}` : ''}{p.unidad_inferida ? '*' : ''}</span>}
                    {p.presupuesto_linea != null && <span className="text-[11px] text-emerald-600 flex-shrink-0">{fmt(p.presupuesto_linea)}</span>}
                    {p.tipo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 flex-shrink-0">{p.tipo}</span>}
                    {p.ruta && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 flex-shrink-0">Ruta {p.ruta}</span>}
                  </div>
                ))}
                {informe.manifiesto_productos!.some(p => p.unidad_inferida) && <p className="text-[10px] text-slate-400 pt-1">* unidad de medida inferida (no especificada en las bases)</p>}
              </div>
            </Seccion>
          )}

          {((v?.acciones_AC?.length ?? 0) > 0 || (v?.advertencias?.length ?? 0) > 0) && (
            <Seccion icon={<Target size={14} className="text-violet-500" />} titulo="Acciones y advertencias" defaultOpen>
              {(v?.acciones_AC?.length ?? 0) > 0 && <><p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Para postular</p><ul className="text-[12px] text-slate-700 space-y-1 list-disc pl-4 mb-2">{v!.acciones_AC!.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
              {(v?.advertencias?.length ?? 0) > 0 && <><p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Advertencias</p><ul className="text-[12px] text-amber-700 space-y-1 list-disc pl-4">{v!.advertencias!.map((a, i) => <li key={i}>{a}</li>)}</ul></>}
            </Seccion>
          )}

          <p className="text-[11px] text-slate-400 text-center pt-1">
            {(informe.pendientes_fase3?.length ?? 0) > 0 && <>Pendiente Fase 3: {informe.pendientes_fase3!.join(', ')} · </>}
            Leídos {informe.documentos_leidos?.length ?? 0} doc(s){(informe.documentos_no_leidos?.length ?? 0) > 0 ? ` · ${informe.documentos_no_leidos!.length} ilegibles` : ''} · confianza {Math.round((informe.confianza_global ?? 0) * 100)}%
          </p>
         </VisorContext.Provider>
        </FuenteDocsContext.Provider>
      )}

      {/* Feedback loop: enseñar a la IA — visible siempre, no requiere análisis previo */}
      {puedeComentar && (
      <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
        <div className="flex items-center gap-2 mb-1">
          <GraduationCap size={16} className="text-violet-600" />
          <h3 className="text-[13px] font-bold text-slate-800">Enséñale a la IA · Reglas de descarte y filtro</h3>
        </div>
        <p className="text-[11.5px] text-slate-500 mb-3">Tu corrección se convierte en una regla que la IA aplicará en <strong>todos los análisis futuros</strong>. Puedes agregar reglas aunque no hayas analizado esta licitación.</p>

        <div className="flex flex-wrap gap-1.5 mb-2">
          {([['viable', 'Sí es viable'], ['no_viable', 'No es viable'], ['parcial', 'Parcial']] as const).map(([v, lbl]) => (
            <button key={v} onClick={() => setFbVeredicto(fbVeredicto === v ? '' : v)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${fbVeredicto === v ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}>
              {lbl}
            </button>
          ))}
        </div>

        <textarea value={fbComentario} onChange={e => setFbComentario(e.target.value)}
          placeholder="Ej: No es viable porque exigen certificación ISO-9001 que no manejamos. / Descartar siempre que pidan fianza bancaria en UTM."
          rows={3}
          className="w-full text-[13px] rounded-lg border border-slate-200 p-2.5 focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 outline-none resize-y" />

        <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
          <p className={`text-[11.5px] ${fbOk?.startsWith('Aprendido') ? 'text-emerald-600' : 'text-amber-600'}`}>{fbOk}</p>
          <div className="flex items-center gap-2">
            {informe && fbOk?.startsWith('Aprendido') && esAdmin && (
              <button onClick={analizar} disabled={cargando} className="text-[12px] font-semibold text-violet-600 hover:underline">Re-analizar con lo aprendido</button>
            )}
            <button onClick={enviarFeedback} disabled={fbEnviando || fbComentario.trim().length < 4}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-[12px] font-semibold rounded-lg">
              {fbEnviando ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Guardar y enseñar
            </button>
          </div>
        </div>

        {feedback.length > 0 && (
          <div className="mt-3 pt-3 border-t border-violet-100 space-y-2">
            <p className="text-[11px] font-bold text-slate-400 uppercase">Lecciones registradas ({feedback.length})</p>
            {feedback.map(f => (
              <div key={f.id} className="flex items-start gap-2 text-[12px] bg-white rounded-lg border border-slate-200 p-2">
                <GraduationCap size={13} className="text-violet-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-slate-700"><strong>Regla:</strong> {f.regla}</p>
                  {f.comentario && f.comentario !== f.regla && <p className="text-slate-400 text-[11px] mt-0.5">{f.comentario}</p>}
                </div>
                <button onClick={() => borrarFeedback(f.id)} title="Eliminar lección" className="text-slate-300 hover:text-red-500 flex-shrink-0"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
