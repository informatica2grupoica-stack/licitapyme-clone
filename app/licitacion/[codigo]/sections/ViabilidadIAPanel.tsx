'use client';

// VIABILIDAD (PROMPT 2) — La IA es la fuente ÚNICA: lee todos los documentos (incl.
// escaneados vía Gemini visión) y entrega el SCORE 0-100, el veredicto y todo el
// análisis con su FUENTE. Front profesional: hero con score + veredicto + datos clave,
// y el detalle en secciones plegables (acordeón) para que no sea un muro de información.

import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, FileSearch, Loader2, AlertTriangle, ChevronDown, Ban, ShieldCheck, Package, Scale, Gavel, Target, ListChecks, ExternalLink, GraduationCap, Trash2, Send, Square, Eye, X, ClipboardCheck, Compass, Swords, Ship, Search } from 'lucide-react';
import { useSession } from '@/app/lib/session-context';
import { DocScanLoader } from '@/app/components/ui/DocScanLoader';

interface Feedback {
  id: number;
  veredicto_ia?: string | null;
  veredicto_humano?: string | null;
  comentario: string;
  regla: string;
  ambito?: string | null;
  created_at: string;
}

// Esquema PROMPT 2 v2.1 + campos derivados (score/semaforo/area).
interface Subfactor { nombre: string; ponderacion_efectiva?: number; abierto_o_topado?: string; forma_aplicacion?: string; medio_verificacion?: string; fuente?: string }
interface Criterio { nombre: string; ponderacion?: number; abierto_o_topado?: string; forma_aplicacion?: string; medio_verificacion?: string; fuente?: string; subfactores?: Subfactor[] }
interface Producto { linea: number; descripcion: string; modelo?: string; cantidad?: number | null; unidad_medida?: string; unidad_inferida?: boolean; presupuesto_linea?: number | null; tipo?: string; ruta?: string }
interface Palanca { palanca: string; estado: string; jugada?: string; condicion?: string; fuente?: string }
interface Hito { hito: string; duracion_dias?: number | null; tipo_dias?: string; base_computo?: string; fuente?: string; inferido?: boolean }
interface DocInfaltable { exige: string; fuente?: string; tipo?: string; cubre?: string; responsable?: string }
interface LineaAtacar { linea: number; decision?: string; motivo?: string }
interface InformeIA {
  score_0_100?: number; semaforo?: string; area_negocio?: string;
  meta?: { id?: string; nombre?: string; organismo?: string; region?: string; linea_negocio?: string };
  exclusion?: { excluido?: boolean; categoria?: string | null; motivo?: string; fuente?: string; destino?: string };
  presupuesto?: { bruto?: number | null; neto?: number | null; con_iva?: boolean; regimen_fora?: boolean; presupuesto_exento?: boolean; es_excluyente?: boolean; fuente?: string; gate?: string };
  modalidad?: { tipo?: string; estado?: string; evidencia?: string; fuente?: string; confianza?: number; libertad_de_pricing?: boolean; como_se_adjudica?: string; heterogeneidad?: string; cotizar_100_obligatorio?: boolean; evaluacion_puntaje?: string };
  criterios_evaluacion?: { fuente_datos?: string; forma_aplicacion_completa?: boolean; suma_ponderaciones_real?: number; suma_valida?: boolean; criterios?: Criterio[]; alertas?: string[] };
  capa_a?: { presupuesto?: { pts?: number; fuente?: string; justificacion?: string }; cantidad_items?: { pts?: number; n_items?: number; fuente?: string; justificacion?: string }; complejidad?: { pts?: number; fuente?: string; justificacion?: string }; ejecucion?: { pts?: number; fuente?: string; justificacion?: string }; modificadores?: { bonus_cantidad_presupuesto?: number; bonus_importabilidad_provisional?: number; modificador_adjudicacion?: number }; score_total?: number; nivel?: string };
  capa_b_palancas?: Palanca[];
  donde_se_decide?: { todos_secundarios_topados?: boolean; se_decide_en?: string; tenemos_ventaja_costo?: string; via?: string; criterios_abiertos_diferenciadores?: string[]; mensaje?: string };
  capa_c_admisibilidad?: { presupuesto_excluyente?: { aplica?: boolean; efecto?: string; fuente?: string }; cotizar_100_obligatorio?: { aplica?: boolean; efecto?: string; fuente?: string }; bloqueantes?: Array<{ item: string; fuente?: string }>; barreras_a_favor?: Array<{ item: string; fuente?: string }>; boleta_aplica?: boolean; umbral_utm?: number; firma_puno_y_letra?: boolean; alertas?: string[] };
  documentos_infaltables?: DocInfaltable[];
  multas?: { estructura?: string; costo_por_dia?: string; costo_maximo?: string; umbral_termino?: string; fuente?: string };
  linea_tiempo?: { hitos?: Hito[]; frontera_inicio_computo?: { descripcion?: string; base_computo?: string; fuente?: string }; caso_cadena?: string; plazo_ofertable_puntaje?: string; plazo_operativo_real_dias_habiles?: number | null; colchon_dias_habiles?: number | null; colchon_dias_corridos?: number | null; ventana_importacion?: boolean; alertas?: string[] };
  manifiesto_productos?: Producto[];
  lineas_a_atacar?: LineaAtacar[];
  pendientes_fase3?: string[];
  veredicto?: { nivel?: string; gana_probable?: string; estado_veredicto?: string; motivos_revision?: string[]; acciones_AC?: string[]; advertencias?: string[] };
  confianza_global?: number;
  documentos_leidos?: string[];
  documentos_no_leidos?: string[];
}

const fmt = (n?: number | null) => n != null ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const cap = (s?: string) => (s || '').replace(/_/g, ' ');

// ─── Explicabilidad: resolver una cita ("doc, art, pág N") al PDF en esa página ──
interface DocRef { nombre: string; url: string; categoria?: string }
const FuenteDocsContext = createContext<DocRef[]>([]);

const _norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Número de página de una cita: "pág. 7", "pagina 3-4", "p. 12" → 7/3/12.
// Exige la palabra "pag/pág/pg/p." (no un simple "p"+dígitos) para NO confundirse con un
// número dentro del nombre del archivo (ej. "anexo_p2.pdf" o "BAE_...-70-LE26.pdf").
function paginaDeCita(fuente: string): number | null {
  const m = _norm(fuente).match(/\bp(?:agina|ag|g|\.)\s*\.?\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// RANGO de páginas de una cita: cuando la fuente abarca DOS o más páginas ("pág. 13-14",
// "págs. 12 a 14", o el marcador aproximado "pág. 13 (aprox. rango 13-16)"), devolvemos TODAS
// las páginas del rango para mostrarlas juntas y no obligar a scrollear el PDF. Si es una sola
// página, devuelve [p]. Cap de 4 páginas para no renderizar el documento entero. Solo detecta el
// rango PEGADO al token de página o tras la palabra "rango", para no confundir "art. 4 a 6" ni el
// "35-2026" del nombre del archivo con un rango de páginas.
function rangoDeCita(fuente: string): number[] {
  const first = paginaDeCita(fuente);
  if (first == null) return [];
  const n = _norm(fuente);
  let a = first, b = first;
  const mRango = n.match(/rango\s*(\d+)\s*(?:-|–|a)\s*(\d+)/)
    || n.match(/p(?:agina|ags?|ag|g|\.)s?\s*\.?\s*(\d+)\s*(?:-|–|a)\s*(\d+)/);
  if (mRango) {
    const x = parseInt(mRango[1], 10), y = parseInt(mRango[2], 10);
    if (y > x && y - x <= 4) { a = x; b = y; }
  }
  const out: number[] = [];
  for (let p = a; p <= b; p++) out.push(p);
  return out;
}

// Ancla de RESALTADO derivada del texto de la cita cuando no se pasa `destacar`: busca una
// referencia distintiva que SÍ aparece literalmente en la página (artículo, numeral, punto,
// formulario, anexo…) para pintarla en color. Si no hay ninguna, devuelve undefined (sin
// resaltado forzado, pero la página sigue siendo la correcta).
function anclaDeFuente(fuente: string): string | undefined {
  const m = (fuente || '').match(/(?:art[íi]?culo|art\.?|numeral|n[°º]|punto|cl[aá]usula|formulario|anexo|letra)\s*[a-z]?\s*\d+(?:[.\-]\d+)*/i);
  return m ? m[0].trim() : undefined;
}

// A qué documento apunta la cita: solape de palabras clave del nombre del archivo
// con el texto de la cita. Devuelve la URL con #page=N para el visor nativo del navegador.
function resolverCita(fuente: string, docs: DocRef[]): { href: string; pagina: number | null; paginas: number[] } | null {
  if (!fuente || !docs.length) return null;
  const f = _norm(fuente);
  let mejor: DocRef | null = null, mejorScore = 0;
  for (const d of docs) {
    const base = _norm(d.nombre.replace(/\.[a-z0-9]+$/i, ''));
    const tokens = base.split(/[^a-z0-9]+/).filter(t => t.length >= 4);
    let score = tokens.reduce((s, t) => s + (f.includes(t) ? 1 : 0), 0);
    // BONUS FUERTE si el nombre base COMPLETO del archivo aparece TAL CUAL en la cita (regla nueva
    // del prompt: citar el nombre EXACTO del documento). Así una cita bien formada apunta sin duda
    // al PDF correcto, no al que casualmente comparte una palabra suelta.
    if (base.length >= 6 && f.includes(base)) score += 5;
    // MATCH POR CATEGORÍA (clave para que el ojo NO falle): el modelo a menudo cita por nombre
    // GENÉRICO ("BASES ADMINISTRATIVAS", "BASES TÉCNICAS") en vez del nombre real del archivo (que
    // puede llamarse "DECLARA_DESIERTA…pdf"). Si TODAS las palabras de la categoría del doc aparecen
    // en la cita, es un match fuerte → resuelve igual y muestra el ojo. Evita el "sin ojo" cuando el
    // archivo se llama distinto a como lo cita el análisis.
    const cat = _norm((d.categoria || '').replace(/_/g, ' '));
    const catWords = cat.split(/\s+/).filter(w => w.length >= 4);
    if (catWords.length && catWords.every(w => f.includes(w))) score += 4;
    if (score > mejorScore) { mejorScore = score; mejor = d; }
  }
  if (!mejor || mejorScore === 0) return null;
  const pag = paginaDeCita(fuente);
  return { href: pag ? `${mejor.url}#page=${pag}` : mejor.url, pagina: pag, paginas: rangoDeCita(fuente) };
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
interface VisorOpts { url: string; pagina: number | null; paginas?: number[]; q?: string; titulo?: string }
const VisorContext = createContext<((o: VisorOpts) => void) | null>(null);

// UNA página del documento renderizada a imagen (con resaltado amarillo del texto `q`). Maneja su
// propio estado de carga/error/zoom, así el visor puede apilar VARIAS páginas cuando la cita abarca
// un rango. Clic en la imagen = ampliar/reducir.
function PaginaImg({ url, pagina, q, esCitada = true }: { url: string; pagina: number; q?: string; esCitada?: boolean }) {
  const [cargada, setCargada] = useState(false);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(false);
  const src = `/api/pdf-pagina?url=${encodeURIComponent(url)}&pagina=${pagina}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  return (
    <div className="w-full flex flex-col items-center">
      <div className={`text-[11px] font-semibold rounded-full px-2 py-0.5 my-1 sticky top-0 z-10 ${esCitada ? 'text-amber-800 bg-amber-100 ring-1 ring-amber-300' : 'text-slate-400 bg-white/80'}`}>
        Página {pagina}{esCitada ? ' · citada' : ' · referencia'}
      </div>
      {!cargada && !error && <div className="flex items-center gap-2 text-slate-400 text-[13px] py-16"><Loader2 size={18} className="animate-spin" /> Renderizando página {pagina}…</div>}
      {error && <div className="text-slate-400 text-[13px] py-16">No se pudo renderizar la página {pagina}. <a href={`${url}#page=${pagina}`} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Abrir el PDF</a>.</div>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`Página ${pagina}`} onLoad={() => setCargada(true)} onError={() => setError(true)} onClick={() => setZoom(z => !z)}
        className={`${cargada ? 'block' : 'hidden'} h-fit rounded shadow ${zoom ? 'max-w-none w-[1100px] cursor-zoom-out' : 'max-w-full cursor-zoom-in'}`} />
    </div>
  );
}

function VisorPagina({ estado, onClose }: { estado: VisorOpts; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Páginas CITADAS por el análisis (una o varias) o, de respaldo, la página única.
  const citadas = (estado.paginas && estado.paginas.length ? estado.paginas : [estado.pagina ?? 1]);
  // Añadimos PÁGINAS DE CONTEXTO (una antes y una después del rango citado): la numeración de
  // página de una cita puede venir corrida ±1 (el nº impreso no siempre coincide con el índice del
  // PDF, y el OCR a veces cae en la página vecina). Mostrar las de al lado como REFERENCIA evita
  // que el usuario tenga que abrir el PDF y scrollear para encontrar el texto real.
  const citSet = new Set(citadas);
  const desde = Math.max(1, citadas[0] - 1);
  const hasta = citadas[citadas.length - 1] + 1;
  const paginas: number[] = [];
  for (let p = desde; p <= hasta; p++) paginas.push(p);
  const primera = citadas[0];
  const etiqueta = citadas.length > 1 ? `Páginas ${citadas[0]}–${citadas[citadas.length - 1]} (+contexto)` : `Página ${primera} (+contexto)`;

  // createPortal a body: los ancestros con animación (.fade-in, fill-mode both) dejan un
  // transform residual que crea un containing block y confina el `fixed` a la sección.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}
      role="dialog" aria-modal="true" aria-label={estado.titulo || 'Fuente del análisis'}>
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200 flex-shrink-0">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-800 truncate">{estado.titulo || 'Fuente del análisis'}</p>
            <p className="text-[11px] text-slate-400 truncate">{etiqueta}{estado.q ? ` · resaltado: “${estado.q}”` : ''}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <a href={`${estado.url}#page=${primera}`} target="_blank" rel="noopener noreferrer" title="Abrir el PDF completo" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ExternalLink size={16} /></a>
            <button onClick={onClose} title="Cerrar (Esc)" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
          </div>
        </div>
        <div className="overflow-auto bg-slate-100 flex-1 flex flex-col justify-start items-center gap-3 p-3">
          {paginas.map(p => <PaginaImg key={p} url={estado.url} pagina={p} q={estado.q} esCitada={citSet.has(p)} />)}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Fuente({ children, destacar }: { children?: string; destacar?: string }) {
  const docs = useContext(FuenteDocsContext);
  const abrirVisor = useContext(VisorContext);
  if (!children) return null;
  const cita = resolverCita(children, docs);
  // Texto a resaltar: el que se pasa explícito (ej. el nombre del criterio) o, si no, un ancla
  // derivada de la propia cita (Art./numeral/Formulario…). Así el ojo marca algo en color siempre.
  const aResaltar = destacar || anclaDeFuente(children);
  if (cita) {
    // Solo mostramos el "ojo" (visor de página con resaltado) cuando la cita trae PÁGINA real.
    // Sin página, abrir el visor mostraba SIEMPRE la página 1 como si fuera la fuente (cita falsa):
    // en su lugar dejamos solo el enlace al PDF completo + un aviso honesto "(sin pág.)".
    const tienePagina = cita.pagina != null;
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-indigo-600">
        <a href={cita.href} target="_blank" rel="noopener noreferrer" title="Abrir el PDF completo"
          className="inline-flex items-center gap-1 hover:text-indigo-800 hover:underline">
          <FileSearch size={10} />{children}
        </a>
        {tienePagina && abrirVisor ? (
          <button type="button" onClick={() => abrirVisor({ url: cita.href.split('#')[0], pagina: cita.pagina, paginas: cita.paginas, q: aResaltar, titulo: children })}
            title="Ver y resaltar en el documento"
            className="inline-flex items-center text-violet-500 hover:text-violet-700">
            <Eye size={13} />
          </button>
        ) : (
          <span className="text-[10px] text-amber-600" title="La cita no indica página: no se puede posicionar el resaltado. Abre el PDF y búscalo.">(sin pág.)</span>
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

// Botón "Buscar en IA": para un producto de MAQUINARIA/EQUIPO, pide al backend que filtre las specs
// reales y arme un prompt de búsqueda exhaustivo (3 homólogos/superiores en Chile o China), lo COPIA
// al portapapeles y abre Gemini en otra pestaña (Gemini no admite prellenar por URL). Si el copiado
// falla, deja el prompt visible para copiarlo a mano.
function BotonBuscarEquipo({ codigo, producto, region }: { codigo: string; producto: { descripcion: string; caracteristicas: string[]; cantidad?: any }; region?: string }) {
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
      window.open('https://gemini.google.com/app', '_blank', 'noopener,noreferrer');
      setEstado(copiado ? 'ok' : 'error');
    } catch { setEstado('error'); }
  };
  return (
    <div className="pl-10 mt-2">
      <button type="button" onClick={buscar} disabled={estado === 'cargando'}
        title="Genera un prompt con las specs limpias, lo copia y abre Gemini para buscar 3 proveedores chilenos"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60 px-3.5 py-2 rounded-lg shadow-sm shadow-violet-200 transition-all">
        {estado === 'cargando' ? <><Loader2 size={14} className="animate-spin" /> Generando prompt…</> : <><Search size={14} /> Buscar proveedor en IA</>}
      </button>
      {estado === 'ok' && <span className="text-[10px] text-emerald-600 ml-2">✓ Prompt copiado — pégalo en Gemini (se abrió en otra pestaña)</span>}
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

// ─── VISTA v3 (esquema modular: 9 módulos + Tarjeta de Decisión) ─────────────────
// Se renderiza cuando el informe trae `_schema:'v3'` (flag VIABILIDAD_V3). Reusa Fuente
// (citas con visor), Seccion (acordeón), Gauge y SEM. La vista v2 queda intacta.
const TIPO_BADGE: Record<string, { label: string; cls: string }> = {
  LEY_DEL_MINIMO: { label: '⭐ LEY DEL MÍNIMO', cls: 'bg-emerald-100 text-emerald-700' },
  LEY_DEL_MAXIMO: { label: '⭐ LEY DEL MÁXIMO', cls: 'bg-emerald-100 text-emerald-700' },
  POR_TRAMOS:     { label: 'POR TRAMOS',       cls: 'bg-slate-100 text-slate-500' }, // v3.3
  TRAMO_CERRADO:  { label: 'TRAMO CERRADO',    cls: 'bg-slate-100 text-slate-500' }, // v3.2 (informes guardados)
  BINARIO:        { label: 'BINARIO',          cls: 'bg-indigo-50 text-indigo-600' },
};
const VER_TARJETA: Record<string, { label: string; ring: string; text: string; bg: string; soft: string }> = {
  GANABLE:  { label: 'GANABLE',  ring: '#10b981', text: 'text-emerald-700', bg: 'bg-emerald-600', soft: 'bg-emerald-50 border-emerald-200' },
  PUEDE_SER:{ label: 'PUEDE SER',ring: '#eab308', text: 'text-yellow-700',  bg: 'bg-yellow-500',  soft: 'bg-yellow-50 border-yellow-200' },
  NO_VAMOS: { label: 'NO VAMOS', ring: '#ef4444', text: 'text-red-700',     bg: 'bg-red-600',     soft: 'bg-red-50 border-red-200' },
};
const JUGADA_ICON: Record<string, string> = { OPORTUNIDAD: '🟢', RESOLVER: '🟡', EMPATE: '⚪', EN_CONTRA: '🔴' };
const CRIT_ICON: Record<string, { ic: string; txt: string }> = {
  ADMISIBILIDAD_DURA:     { ic: '🔴', txt: 'Admisibilidad dura' },
  PUNTAJE_CONDICIONANTE:  { ic: '🟡', txt: 'Puntaje / condicionante' },
  COMPROMISO_EJECUCION:   { ic: '🟢', txt: 'Compromiso de ejecución' },
};

function VistaV3({ informe }: { informe: any }) {
  const t = informe.tarjeta_decision || {};
  const score = Math.round(Number(informe.score_0_100) || 0);
  const sem = SEM[informe.semaforo || ''] || SEM.NARANJA;
  const ver = VER_TARJETA[t.veredicto] || VER_TARJETA.PUEDE_SER;
  const esNoVamos = t.veredicto === 'NO_VAMOS';
  const crit = informe.criterios_evaluacion || {};
  const criterios: any[] = crit.criterios || [];
  const sumaReal = Number(crit.suma_ponderaciones_real) || criterios.reduce((s, c) => s + (Number(c.ponderacion_efectiva) || 0), 0);
  const adj = informe.adjudicacion || {};
  const atr = informe.atractivo || {};
  const est = informe.estrategia || {};
  const dsd = est.donde_se_decide || {};
  const adm = informe.requisitos_admisibilidad || {};
  const plz = informe.plazos || {};
  const mul = informe.multas || {};
  // v3.3: el bloque de ítems pasó de `costeo` a `productos`; caemos a `costeo` para informes guardados.
  const cost = informe.productos || informe.costeo || {};
  const hojasCosteo = cost.hojas_costeo_segun_adjudicacion || cost.hojas_segun_adjudicacion || '';
  // Lista de ítems a mostrar = la MISMA que alimenta el Excel de costeo. El puente al costeo pone
  // en `manifiesto_productos` la lista COMPLETA (del parser de la planilla cuando es más fiel que
  // la del LLM), así que se muestra esa; se cae a `productos.items`/`costeo.items` (LLM) si no hay
  // manifiesto. Se normalizan los nombres de campo entre shapes (nombre/descripcion/descripcion_exacta,
  // marca_modelo_referencia/modelo/marca_modelo).
  const _manif: any[] = Array.isArray(informe.manifiesto_productos) ? informe.manifiesto_productos : [];
  const _prod: any[] = Array.isArray(cost.items) ? cost.items : [];
  // Mostramos la lista MÁS COMPLETA (mirror del Excel de costeo). En empate preferimos la de
  // productos/costeo del informe, que en v3.3 trae la ficha técnica (caracteristicas[]) y la
  // clasificación genérico/específico; el manifiesto gana solo si es más largo (parser de planilla
  // o extracción dedicada "LÍNEA DE PRODUCTO" añadieron ítems que el LLM había resumido).
  const _fuenteItems: any[] = _manif.length > _prod.length ? _manif : (_prod.length ? _prod : _manif);
  const itemsCosteo = _fuenteItems.map((p: any, i: number) => ({
    linea: p.linea ?? i + 1,
    descripcion: p.descripcion ?? p.nombre ?? p.descripcion_exacta ?? '',
    modelo: p.modelo ?? p.marca_modelo_referencia ?? p.marca_modelo ?? '',
    cantidad: p.cantidad,
    unidad_medida: p.unidad_medida,
    unidad_inferida: p.unidad_inferida,
    ruta: p.ruta,
    marca_exclusiva: p.marca_exclusiva,
    // v3.3: riqueza del módulo PRODUCTOS (si la fuente es productos.items; el manifiesto no la trae).
    clasificacion: p.clasificacion ?? p.tipo ?? '',
    caracteristicas: Array.isArray(p.caracteristicas) ? p.caracteristicas : [],
    libertad_de_oferta: p.libertad_de_oferta ?? false,
    admite_equivalente: p.admite_equivalente,
  }));
  const entregablesWord: string[] = Array.isArray(cost.entregables_word) ? cost.entregables_word : [];
  const lin = informe.lineas_a_atacar || {};
  const acc = informe.acciones_y_advertencias || {};
  const enRevision = informe.veredicto?.estado_veredicto === 'REVISION_HUMANA';

  return (
    <div className="space-y-3">
      {/* TARJETA DE DECISIÓN (corona) */}
      <div className={`rounded-2xl border p-4 ${ver.soft}`}>
        <div className="flex items-center gap-4">
          <Gauge score={score} sem={sem} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[11px] font-black text-white px-2 py-0.5 rounded ${ver.bg}`}>{ver.label}</span>
              {informe.area_negocio && <span className="text-[11px] text-slate-500 bg-white/60 border border-slate-200 px-2 py-0.5 rounded-full">{cap(informe.area_negocio)}</span>}
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${enRevision ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{enRevision ? 'REVISIÓN HUMANA' : 'DEFINITIVO'}</span>
            </div>
            {t.titular && <p className="text-[14px] font-bold text-slate-800 mt-1.5 leading-snug">{t.titular}</p>}
          </div>
        </div>
        {esNoVamos ? (
          t.porque_no && <p className="text-[13px] text-red-700 mt-3"><strong>POR QUÉ NO:</strong> {t.porque_no}</p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {t.se_gana_en && <div className="text-[13px]"><span className="font-bold text-slate-700">SE GANA EN: </span><span className="text-slate-600">{t.se_gana_en}</span></div>}
            {(t.para_ganar?.length ?? 0) > 0 && (
              <div><p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Para ganar</p><ol className="text-[13px] text-slate-700 space-y-1 list-decimal pl-5">{t.para_ganar.map((x: string, i: number) => <li key={i}>{x}</li>)}</ol></div>
            )}
            {(t.no_quedes_fuera?.length ?? 0) > 0 && (
              <div><p className="text-[11px] font-bold text-red-500 uppercase mb-1">No quedes fuera</p><ul className="text-[13px] text-slate-700 space-y-1 list-disc pl-5">{t.no_quedes_fuera.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>
            )}
            {t.antes_de_ir && <div className="text-[12px] text-slate-500"><span className="font-bold">ANTES DE IR: </span>{t.antes_de_ir}</div>}
          </div>
        )}
      </div>

      {/* Datos clave */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase">Presupuesto</p>
          <p className="text-[15px] font-bold text-emerald-700 leading-tight">{atr.presupuesto_mostrar || fmt(informe.presupuesto?.neto ?? informe.presupuesto?.bruto)}</p>
          {adm.presupuesto?.tipo === 'excluyente'
            ? <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-700">EXCLUYENTE</span>
            : <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-slate-100 text-slate-500">referencial</span>}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase">Cómo se adjudica</p>
          <p className="text-[14px] font-semibold text-slate-800 leading-tight">{cap(adj.como_se_adjudica) || '—'}{adj.estado === 'REVISION_HUMANA' ? ' ⚠' : ''}</p>
          {adj.cotizar_100_obligatorio && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-700">COTIZAR 100%</span>}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase">Colchón</p>
          <p className="text-[15px] font-bold text-slate-800 leading-tight">{plz.colchon_dias_corridos != null ? `${plz.colchon_dias_corridos} días` : '—'}</p>
          {plz.ventana_importacion
            ? <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-sky-100 text-sky-700 inline-flex items-center gap-0.5"><Ship size={9} /> importar</span>
            : <span className="text-[10px] text-slate-400">sin ventana</span>}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase">Atractivo</p>
          <p className="text-[14px] font-semibold text-slate-800 leading-tight">{cap(atr.nivel || atr.veredicto) || '—'}</p>
        </div>
      </div>

      {/* Criterios */}
      {criterios.length > 0 && (
        <Seccion icon={<Target size={14} className="text-violet-500" />} titulo="Criterios de evaluación — dónde se gana el puntaje" badge={`suma ${Math.round(sumaReal)}%${crit.suma_valida ? ' ✓' : ' ⚠'}${crit.evaluacion_puntaje === 'por_linea' ? ' · por línea' : ' · al total'}`} defaultOpen>
          <div className="space-y-2.5">
            {[...criterios].sort((a, b) => (Number(b.ponderacion_efectiva) || 0) - (Number(a.ponderacion_efectiva) || 0)).map((c, i) => {
              const tb = TIPO_BADGE[c.clase ?? c.tipo_aplicacion]; // v3.3 clase; v3.2 tipo_aplicacion
              // v3.3: POR TRAMOS registra el borde cómodo del tramo de máximo puntaje. v3.2 usaba
              // piso_o_tope. Mostramos el que exista (borde cómodo prioriza).
              const bordeComodo = c.tramo_max_puntaje?.borde_comodo || c.piso_o_tope;
              return (
                <div key={i} className="border-b border-slate-100 last:border-0 pb-2 last:pb-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-slate-800 flex items-center gap-1.5 flex-wrap">
                      {c.nombre}
                      {tb && <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${tb.cls}`}>{tb.label}</span>}
                      {bordeComodo && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700" title="Borde cómodo del tramo de máximo puntaje / piso o tope">{bordeComodo}</span>}
                    </p>
                    <span className="text-[13px] font-bold text-slate-900 flex-shrink-0">{c.ponderacion_efectiva ?? 0}%</span>
                  </div>
                  {c.forma_aplicacion && <p className="text-[12px] text-slate-600 mt-0.5 leading-snug">{c.forma_aplicacion}</p>}
                  {c.medio_verificacion && <p className="text-[11px] text-slate-400 mt-0.5">Verificación: {c.medio_verificacion}</p>}
                  <div className="mt-0.5"><Fuente destacar={c.nombre}>{c.fuente}</Fuente></div>
                </div>
              );
            })}
            {(crit.alertas?.length ?? 0) > 0 && <div className="text-[12px] text-amber-700 space-y-0.5 pt-1">{crit.alertas.map((a: string, i: number) => <p key={i}>⚠ {a}</p>)}</div>}
          </div>
        </Seccion>
      )}

      {/* Atractivo */}
      {atr.lectura_comercial && (
        <Seccion icon={<Scale size={14} className="text-violet-500" />} titulo="Atractivo" badge={cap(atr.nivel || atr.veredicto)} defaultOpen>
          <p className="text-[13px] text-slate-700 leading-snug">{atr.lectura_comercial}</p>
        </Seccion>
      )}

      {/* Estrategia */}
      {((est.jugadas?.length ?? 0) > 0 || dsd.orden_final) && (
        <Seccion icon={<ListChecks size={14} className="text-violet-500" />} titulo="Estrategia — dónde se gana y qué hacer" defaultOpen>
          <div className="space-y-1.5 text-[12px]">
            {(est.jugadas || []).map((j: any, i: number) => (
              <div key={i} className="bg-slate-50 rounded-lg p-2">
                <p className="font-semibold text-slate-700">{JUGADA_ICON[j.etiqueta] || '•'} {j.criterio}{TIPO_BADGE[j.clase ?? j.tipo_aplicacion] ? ` · ${TIPO_BADGE[j.clase ?? j.tipo_aplicacion].label}` : ''}{j.exige_respaldo ? ' · ⚠ EXIGE STOCK/RESPALDO' : ''}</p>
                {j.lectura && <p className="text-slate-500 mt-0.5 leading-snug">{j.lectura}</p>}
                {j.orden && <p className="text-slate-800 mt-0.5 font-semibold uppercase text-[11.5px]">▸ {j.orden}{j.valor_a_ofertar ? ` (${j.valor_a_ofertar})` : ''}</p>}
                {j.fuente && <div className="mt-0.5"><Fuente destacar={j.criterio}>{j.fuente}</Fuente></div>}
              </div>
            ))}
            {dsd.orden_final && (
              <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-2.5 mt-1">
                <p className="flex items-center gap-1.5 text-[12px] font-bold text-violet-800 mb-1"><Compass size={13} /> Dónde se decide</p>
                <p className="text-[12px] text-slate-700 leading-snug">{dsd.orden_final}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                  {dsd.se_decide_en && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white border border-violet-200 text-violet-700">se decide en: {cap(dsd.se_decide_en)}</span>}
                  {dsd.tenemos_ventaja_costo === 'si' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">ventaja de costo</span>}
                  {dsd.tenemos_ventaja_costo === 'no' && dsd.se_decide_en === 'precio' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">⚠ guerra de precio</span>}
                </div>
              </div>
            )}
          </div>
        </Seccion>
      )}

      {/* Requisitos de admisibilidad */}
      <Seccion icon={<ShieldCheck size={14} className="text-violet-500" />} titulo="Requisitos de admisibilidad — qué nos deja fuera" badge={(adm.bloqueantes?.length ?? 0) > 0 ? `${adm.bloqueantes.length} bloqueante(s)` : 'sin bloqueantes'} defaultOpen>
        <div className="space-y-1.5 text-[13px]">
          <p className="flex items-start gap-1.5"><span className="flex-shrink-0">{adm.firma_puno_y_letra?.exigida ? '⚠' : '✓'}</span> Firma: {adm.firma_puno_y_letra?.exigida ? 'PUÑO Y LETRA exigida — requiere flujo físico' : 'electrónica válida — no se exige puño y letra'} <Fuente>{adm.firma_puno_y_letra?.fuente}</Fuente></p>
          {adm.presupuesto?.tipo && <p className="flex items-start gap-1.5"><span>{adm.presupuesto.tipo === 'excluyente' ? '🔴' : '•'}</span> Presupuesto: {adm.presupuesto.tipo === 'excluyente' ? 'EXCLUYENTE — no superar el techo' : 'referencial'} <Fuente>{adm.presupuesto.fuente}</Fuente></p>}
          {adm.cotizar_100?.aplica && <p className="flex items-start gap-1.5 text-red-700"><Ban size={13} className="mt-0.5 flex-shrink-0" /> Cotizar el 100% — falta 1 ítem = fuera <Fuente>{adm.cotizar_100.fuente}</Fuente></p>}
          {adm.boleta?.aplica && <p className="flex items-start gap-1.5"><span>•</span> Boleta: {adm.boleta.detalle || `sobre ${adm.boleta.umbral_utm ?? 1000} UTM`}{adm.boleta.exigida_bajo_umbral ? ' (exigida aun bajo el umbral)' : ''} <Fuente>{adm.boleta.fuente}</Fuente></p>}
          {adm.fiel_cumplimiento?.exige && <p className="flex items-start gap-1.5 text-amber-700"><span>⚠</span> Garantía de fiel cumplimiento{adm.fiel_cumplimiento.forma ? ` (${cap(adm.fiel_cumplimiento.forma)})` : ''}{adm.fiel_cumplimiento.plazo_entrega ? ` — entregar en ${adm.fiel_cumplimiento.plazo_entrega}` : ''} · fuerza cadena LARGA <Fuente>{adm.fiel_cumplimiento.fuente}</Fuente></p>}
          {adm.contrato?.exige && <p className="flex items-start gap-1.5"><span>•</span> Suscripción de contrato{adm.contrato.plazos ? ` — ${adm.contrato.plazos}` : ''} · fuerza cadena LARGA <Fuente>{adm.contrato.fuente}</Fuente></p>}
          {adm.seriedad_oferta?.exige && <p className="flex items-start gap-1.5"><span>•</span> Garantía de seriedad de la oferta exigida <Fuente>{adm.seriedad_oferta.fuente}</Fuente></p>}
          {(adm.plazo_entrega_rango?.min || adm.plazo_entrega_rango?.max) && <p className="flex items-start gap-1.5"><span>•</span> Plazo de entrega: {adm.plazo_entrega_rango.min ? `mín ${adm.plazo_entrega_rango.min}` : ''}{adm.plazo_entrega_rango.min && adm.plazo_entrega_rango.max ? ' · ' : ''}{adm.plazo_entrega_rango.max ? `máx ${adm.plazo_entrega_rango.max}` : ''}{adm.plazo_entrega_rango.fuera_de_rango_inadmisible ? ' — fuera de rango = inadmisible' : ''} <Fuente>{adm.plazo_entrega_rango.fuente}</Fuente></p>}
          {adm.marca_exclusiva?.es_exclusiva && <p className="flex items-start gap-1.5 text-amber-700"><span>⚠</span> MARCA EXCLUSIVA sin "o equivalente" — riesgo margen <Fuente>{adm.marca_exclusiva.fuente}</Fuente></p>}
          {adm.marca_exclusiva && !adm.marca_exclusiva.es_exclusiva && adm.marca_exclusiva.admite_equivalente && <p className="flex items-start gap-1.5 text-emerald-700"><span>✓</span> Admite "o equivalente" — puerta abierta <Fuente>{adm.marca_exclusiva.fuente}</Fuente></p>}
          {(adm.bloqueantes || []).map((b: any, i: number) => <p key={'bl' + i} className="flex items-start gap-1.5 text-red-700"><Ban size={13} className="mt-0.5 flex-shrink-0" /> {b.item} <Fuente>{b.fuente}</Fuente></p>)}
          {(adm.a_favor || []).map((b: any, i: number) => <p key={'af' + i} className="flex items-start gap-1.5 text-emerald-700"><ShieldCheck size={13} className="mt-0.5 flex-shrink-0" /> {b.item} <Fuente>{b.fuente}</Fuente></p>)}
        </div>
      </Seccion>

      {/* Documentos propios a crear */}
      {(adm.orden_anexos_propios?.length ?? 0) > 0 && (
        <Seccion icon={<ClipboardCheck size={14} className="text-violet-500" />} titulo="Documentos propios a crear — orden de trabajo" badge={`${adm.orden_anexos_propios.length}`} defaultOpen>
          <div className="space-y-1.5 text-[12px]">
            {[...adm.orden_anexos_propios].sort((a: any, b: any) => (a.criticidad === 'ADMISIBILIDAD_DURA' ? 0 : a.criticidad === 'PUNTAJE_CONDICIONANTE' ? 1 : 2) - (b.criticidad === 'ADMISIBILIDAD_DURA' ? 0 : b.criticidad === 'PUNTAJE_CONDICIONANTE' ? 1 : 2)).map((d: any, i: number) => {
              const cr = CRIT_ICON[d.criticidad] || CRIT_ICON.COMPROMISO_EJECUCION;
              return (
                <div key={i} className="bg-slate-50 rounded-lg p-2">
                  <div className="flex items-start gap-1.5">
                    <span className="flex-shrink-0" title={cr.txt}>{cr.ic}</span>
                    <p className="text-slate-800 font-semibold flex-1">{d.que_crear}</p>
                    {d.responsable && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 flex-shrink-0">{cap(d.responsable)}</span>}
                  </div>
                  {d.por_que && <p className="text-slate-500 mt-0.5 pl-5 leading-snug">POR QUÉ: {d.por_que}</p>}
                  {d.que_debe_contener && <p className="text-slate-500 pl-5 leading-snug">CONTENER: {d.que_debe_contener}</p>}
                  {d.que_cubre && <p className="text-slate-500 pl-5 leading-snug">CUBRE: {d.que_cubre}</p>}
                  {d.fuente && <div className="mt-0.5 pl-5"><Fuente>{d.fuente}</Fuente></div>}
                </div>
              );
            })}
          </div>
        </Seccion>
      )}

      {/* Plazos */}
      {(plz.colchon_dias_corridos != null || (plz.hitos?.length ?? 0) > 0) && (
        <Seccion icon={<Gavel size={14} className="text-violet-500" />} titulo="Plazos (colchón administrativo)" badge={plz.colchon_dias_corridos != null ? `colchón ${plz.colchon_dias_corridos} días` : undefined} defaultOpen>
          <p className="text-[13px] text-slate-700 mb-2"><strong>Colchón:</strong> ≈ {plz.colchon_dias_corridos ?? '—'} días corridos · cadena {cap(plz.cadena)}{plz.ventana_importacion ? ' · ✅ VENTANA PARA IMPORTAR' : ''}</p>
          {plz.cadena === 'larga' && (plz.gatillo_cadena_larga?.exige_fiel_cumplimiento || plz.gatillo_cadena_larga?.exige_contrato) && (
            <p className="text-[12px] text-amber-700 mb-2">⚠ Cadena LARGA por {[plz.gatillo_cadena_larga?.exige_fiel_cumplimiento ? 'garantía de fiel cumplimiento' : '', plz.gatillo_cadena_larga?.exige_contrato ? 'suscripción de contrato' : ''].filter(Boolean).join(' + ')} <Fuente>{plz.gatillo_cadena_larga?.fuente}</Fuente></p>
          )}
          {plz.frontera?.descripcion && <div className="text-[12px] text-slate-600 mb-2 bg-slate-50 rounded-lg p-2"><span className="font-semibold text-slate-700">Frontera (arranca la entrega):</span> {plz.frontera.descripcion}{plz.frontera.base_computo ? ` · ${cap(plz.frontera.base_computo)}` : ''} <Fuente>{plz.frontera.fuente}</Fuente></div>}
          <div className="space-y-1.5">
            {(plz.hitos || []).map((h: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-[13px]">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 flex-shrink-0" />
                <div className="flex-1 min-w-0"><p className="text-slate-700">{h.hito}{h.duracion != null ? ` — ${h.duracion} ${h.unidad || ''}` : ''}{h.duracion_corridos != null && h.duracion_corridos > 0 && h.unidad !== 'corridos' ? ` (≈ ${h.duracion_corridos} corridos)` : ''}{h.inferido ? ' (inferido ⚠)' : ''}</p>{h.fuente && <p className="text-[11px] text-slate-400"><Fuente>{h.fuente}</Fuente></p>}</div>
              </div>
            ))}
          </div>
        </Seccion>
      )}

      {/* Multas */}
      {(mul.detectadas || mul.estructura) && (
        <Seccion icon={<Gavel size={14} className="text-violet-500" />} titulo="Multas por atraso">
          {mul.detectadas === false
            ? <p className="text-[13px] text-slate-500">No se detectaron multas por atraso en las bases.</p>
            : <p className="text-[13px] text-slate-700">{mul.estructura}{mul.costo_por_dia_pesos ? ` · ${mul.costo_por_dia_pesos}/día` : ''}{mul.valor_utm_usado ? ` (UTM ${mul.valor_utm_usado})` : ''}{mul.tope ? ` · tope: ${mul.tope}` : ''}{mul.efecto_al_superar_tope ? ` · ${mul.efecto_al_superar_tope}` : ''}</p>}
          <div className="mt-1"><Fuente>{mul.fuente}</Fuente></div>
        </Seccion>
      )}

      {/* Costeo — TODOS los ítems que alimentan el Excel de costeo (manifiesto completo) */}
      {itemsCosteo.length > 0 && (
        <Seccion icon={<Package size={14} className="text-violet-500" />} titulo="Productos a costear (base del scraping)" badge={`${itemsCosteo.length} ítems · ${hojasCosteo}`}>
          {entregablesWord.length > 0 && (
            <p className="text-[11px] text-slate-400 mb-1.5">Entregables: {entregablesWord.map(w => cap(w)).join(' · ')} <span className="text-slate-300">(fichas en el JSON; Word pendiente de generar)</span></p>
          )}
          <div className="space-y-1">
            {itemsCosteo.map((p, i) => {
              // startsWith tolera typos del modelo (ej. "especificico") que un === exacto perdería.
              const clas = String(p.clasificacion).toLowerCase();
              const esGenerico = clas.startsWith('gener');
              const esEspecifico = clas.startsWith('espec');
              return (
              <div key={i} className="text-[13px] border-b border-slate-100 last:border-0 py-1">
                <div className="flex gap-2 items-start">
                  <span className="text-slate-400 w-8 flex-shrink-0">{typeof p.linea === 'string' ? p.linea : `L${p.linea ?? i + 1}`}</span>
                  <span className="text-slate-700 flex-1">{p.descripcion}{p.modelo ? ` · ${p.modelo}` : ''}</span>
                  {p.cantidad != null && <span className="text-slate-500 flex-shrink-0">{p.cantidad}{p.unidad_medida ? ` ${p.unidad_medida}` : ''}{p.unidad_inferida ? '*' : ''}</span>}
                </div>
                <div className="flex gap-1 flex-wrap pl-10 mt-0.5">
                  {esEspecifico && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">Específico</span>}
                  {esGenerico && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">Genérico</span>}
                  {p.libertad_de_oferta && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700" title="Sin specs en bases: podemos ofertar lo que queramos">🟢 Libertad de oferta</span>}
                  {p.admite_equivalente === false && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">marca exacta</span>}
                  {p.ruta && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600">Ruta {p.ruta}</span>}
                  {p.marca_exclusiva && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">⚠ marca exclusiva</span>}
                </div>
                {p.caracteristicas.length > 0 && (
                  <details className="pl-10 mt-0.5">
                    <summary className="text-[11px] text-violet-600 cursor-pointer select-none">Ficha técnica ({p.caracteristicas.length})</summary>
                    <ul className="text-[11px] text-slate-500 list-disc pl-4 mt-0.5 space-y-0.5">
                      {p.caracteristicas.map((c: string, k: number) => <li key={k}>{c}</li>)}
                    </ul>
                  </details>
                )}
                {/* Buscador de equipamiento: solo para ítems con ficha técnica (maquinaria/equipos). */}
                {p.caracteristicas.length >= 3 && (
                  <BotonBuscarEquipo codigo={String(informe.meta?.id || '')} region={informe.meta?.region}
                    producto={{ descripcion: p.descripcion, caracteristicas: p.caracteristicas, cantidad: p.cantidad }} />
                )}
              </div>
            );})}
          </div>
        </Seccion>
      )}

      {/* Líneas a atacar */}
      {(lin.modo === 'POR_LINEAS' ? (lin.lineas?.length ?? 0) > 0 : !!lin.mensaje_global_o_lote) && (
        <Seccion icon={<Swords size={14} className="text-violet-500" />} titulo="Líneas a atacar" badge={cap(lin.modo)}>
          {lin.modo === 'POR_LINEAS'
            ? <div className="space-y-1 text-[12px]">{(lin.lineas || []).map((l: any, i: number) => (
                <div key={i} className="flex items-start gap-2 border-b border-slate-100 last:border-0 py-1">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${l.decision === 'atacar' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{typeof l.linea === 'string' && /^L/i.test(l.linea) ? l.linea : `L${l.linea}`} · {cap(l.decision)}</span>
                  <span className="text-slate-600 flex-1">{l.motivo}</span>
                </div>))}</div>
            : <p className="text-[13px] text-slate-700">{lin.mensaje_global_o_lote}</p>}
        </Seccion>
      )}

      {/* Acciones y advertencias */}
      {((acc.acciones?.length ?? 0) > 0 || (acc.advertencias?.length ?? 0) > 0) && (
        <Seccion icon={<Target size={14} className="text-violet-500" />} titulo="Acciones y advertencias" defaultOpen>
          {(acc.acciones?.length ?? 0) > 0 && <><p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Para postular</p><ul className="text-[12px] text-slate-700 space-y-1 list-decimal pl-4 mb-2">{acc.acciones.map((a: any, i: number) => <li key={i}><span className="font-semibold">{a.orden}</span>{a.por_que ? ` — ${a.por_que}` : ''} <Fuente>{a.fuente}</Fuente></li>)}</ul></>}
          {(acc.advertencias?.length ?? 0) > 0 && <><p className="text-[11px] font-bold text-red-500 uppercase mb-1">Advertencias</p><ul className="text-[12px] text-amber-700 space-y-1 list-disc pl-4">{acc.advertencias.map((a: any, i: number) => <li key={i}>⚠ {a.riesgo}{a.consecuencia ? ` — ${a.consecuencia}` : ''} <Fuente>{a.fuente}</Fuente></li>)}</ul></>}
        </Seccion>
      )}

      <p className="text-[11px] text-slate-400 text-center pt-1">
        {(informe.pendientes_fase3?.length ?? 0) > 0 && <>Pendiente Fase 3: {informe.pendientes_fase3.join(', ')} · </>}
        Leídos {informe.documentos_leidos?.length ?? 0} doc(s) · confianza {Math.round((informe.confianza_global ?? 0) * 100)}% · <span className="text-violet-500 font-semibold">v3</span>
      </p>
    </div>
  );
}

export function ViabilidadIAPanel({ codigo, onTambienAnalizar, onComplete }: { codigo: string; onTambienAnalizar?: () => void; onComplete?: () => void }) {
  const { usuario } = useSession();
  // Solo admin puede (re)analizar la viabilidad (operación cara y central; el servidor lo valida).
  const esAdmin = usuario?.rol === 'admin';
  // Solo admin o usuarios con permiso pueden comentar/corregir la viabilidad (el servidor también lo valida).
  const puedeComentar = usuario?.rol === 'admin' || !!usuario?.permisos?.comentar_viabilidad;
  const [informe, setInforme] = useState<InformeIA | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisoProceso, setAvisoProceso] = useState<string | null>(null);  // "Analizando…" (info, NO error)
  const [docs, setDocs] = useState<DocRef[]>([]);
  const [visor, setVisor] = useState<VisorOpts | null>(null);   // modal de fuente (página + resaltado)
  const abortRef = useRef<AbortController | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);  // poll de resultado tras timeout del proxy
  // Huella liviana del informe para detectar cuándo el server terminó un re-análisis.
  const fpInforme = (inf: InformeIA | null) =>
    inf ? `${inf.score_0_100}|${inf.semaforo}|${(inf as any).docs_hash || ''}|${JSON.stringify(inf.veredicto || {})}` : '';
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const [cargandoInforme, setCargandoInforme] = useState(true);   // cargando el informe YA guardado (GET inicial)
  const [errorCarga, setErrorCarga] = useState(false);            // el GET del informe guardado falló tras reintentos
  const cargar = useCallback(async () => {
    setCargandoInforme(true); setErrorCarga(false);
    // REINTENTOS: durante una viabilidad larga el pool de conexiones (chico) se satura y este GET
    // puede fallar/timeout. Sin reintento el panel mostraba "Aún sin análisis" AUNQUE el informe SÍ
    // exista en BD (el catch silencioso se lo tragaba). Ahora reintenta y, si de verdad no puede,
    // muestra un aviso con botón "Reintentar" en vez de fingir que no hay análisis.
    for (let intento = 1; intento <= 3; intento++) {
      try {
        const res = await fetch(`/api/licitacion-viabilidad-ia/${encodeURIComponent(codigo)}`);
        if (!res.ok) throw new Error(String(res.status));
        const r = await res.json();
        if (r?.informeIA) setInforme(r.informeIA);
        setCargandoInforme(false);
        return;
      } catch {
        if (intento < 3) await new Promise(rr => setTimeout(rr, intento * 900));
      }
    }
    setCargandoInforme(false);
    setErrorCarga(true);
  }, [codigo]);
  useEffect(() => { cargar(); }, [cargar]);

  // Documentos de la licitación (nombre + URL) para enlazar cada cita a su PDF.
  useEffect(() => {
    fetch(`/api/documentos/${encodeURIComponent(codigo)}`)
      .then(x => x.json())
      .then(r => {
        const lista: DocRef[] = (Array.isArray(r?.documentos) ? r.documentos : [])
          .map((d: any) => ({ nombre: d.nombre || d.documento_nombre || '', url: d.url || d.url_local || d.documento_url_local || '', categoria: d.categoria }))
          .filter((d: DocRef) => d.url);
        setDocs(lista);
      })
      .catch(() => { /* silencioso: sin docs, las citas quedan como texto */ });
  }, [codigo]);

  // ── Feedback loop (enseñar a la IA) ───────────────────────────────────────────
  const [feedback, setFeedback]   = useState<Feedback[]>([]);
  const [fbComentario, setFbComentario] = useState('');
  const [fbVeredicto, setFbVeredicto]   = useState<string>('');
  const [fbAmbito, setFbAmbito]         = useState<'global' | 'lectura'>('global');
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
        body: JSON.stringify({
          comentario: fbComentario.trim(),
          veredicto_humano: fbAmbito === 'lectura' ? null : (fbVeredicto || null),
          ambito: fbAmbito,
        }),
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
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setCargando(false);
    setAvisoProceso(null);
  };

  // POLLING del resultado. El análisis corre en SEGUNDO PLANO en el server (dura 1-3 min, más que
  // el límite ~100s del túnel), así que no lo esperamos en la petición: refrescamos el GET hasta
  // que aparezca el informe nuevo, el server reporte un error de fondo, o se agote el tiempo.
  // `previo` = huella del informe antes de arrancar (para detectar el cambio en un re-análisis).
  const iniciarPolling = (previo: string) => {
    setAvisoProceso('Analizando las bases… puede tardar 1 a 3 minutos. Esta pantalla se actualizará sola cuando termine — puedes seguir navegando.');
    setError(null);
    setCargando(true);
    let intentos = 0;
    const parar = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } setCargando(false); };
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      intentos++;
      try {
        const rr = await fetch(`/api/licitacion-viabilidad-ia/${encodeURIComponent(codigo)}`).then(x => x.json());
        const nuevo = rr?.informeIA || null;
        // 1) Resultado nuevo listo → mostrarlo (y refrescar documentos: aparece el Excel de costeo).
        if (nuevo && fpInforme(nuevo) !== previo) {
          setInforme(nuevo); setError(null); setAvisoProceso(null);
          try { onComplete?.(); } catch { /* noop */ }
          parar(); return;
        }
        // 2) El server reportó un error de fondo → mostrarlo (rojo) y parar.
        if (rr?.error && !rr?.enProceso) { setAvisoProceso(null); setError(rr.error); parar(); return; }
        // 3) El job terminó sin cambiar la huella (resultado idéntico) → cerrar sin error.
        if (rr?.enProceso === false) {
          if (nuevo) setInforme(nuevo);
          setAvisoProceso(null);
          try { onComplete?.(); } catch { /* noop */ }
          parar(); return;
        }
        // 4) Sigue en proceso → esperar al próximo tick.
      } catch { /* reintenta en el próximo tick */ }
      if (intentos >= 72) { setAvisoProceso(null); parar(); }  // ~6 min máx (poll cada 5s)
    }, 5000);
  };

  const analizar = async () => {
    setCargando(true); setError(null); setAvisoProceso(null);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }  // corta un poll previo
    abortRef.current = new AbortController();
    const previo = fpInforme(informe);
    try { onTambienAnalizar?.(); } catch { /* noop */ }
    try {
      // Si ya hay informe, el botón es "Re-analizar": fuerza una corrida fresca (ignora el cache
      // por huella de documentos). El primer análisis sí usa cache.
      const qs = informe ? '?force=1' : '';
      const r = await fetch(`/api/licitacion-viabilidad-ia/${encodeURIComponent(codigo)}${qs}`, {
        method: 'POST',
        signal: abortRef.current.signal,
      });
      const esJSON = (r.headers.get('content-type') || '').includes('application/json');
      // El POST ahora ARRANCA el análisis en segundo plano y responde al instante (202), así que
      // no debería colgarse. Si aun así el proxy/túnel cortó y devolvió HTML, da igual: el análisis
      // ya arrancó en el server → pasamos directo al polling (sin banner de error).
      if (!esJSON) { iniciarPolling(previo); return; }
      const j = await r.json();
      if (!r.ok && r.status !== 202) { setError(j.error || 'Error al analizar.'); setCargando(false); return; }
      // Cache hit / resultado inmediato: úsalo directo.
      if (j.informeIA) {
        setInforme(j.informeIA); setCargando(false);
        try { onComplete?.(); } catch { /* noop */ }
        return;
      }
      // Análisis corriendo en segundo plano (status 202 "procesando") → polling con aviso amable.
      iniciarPolling(previo);
    } catch (e: any) {
      if ((e as Error)?.name === 'AbortError') { setCargando(false); return; } // cancelado por el usuario
      // Falló el propio POST (red caída, etc.): no arrancó nada → error real.
      setError(String(e?.message || e)); setCargando(false);
    } finally { abortRef.current = null; }
  };

  const v = informe?.veredicto;
  const score = Math.round(Number(informe?.score_0_100) || 0);
  const sem = SEM[informe?.semaforo || ''] || SEM.NARANJA;
  const gana = (v?.gana_probable || '').toLowerCase();
  const ganaLabel = gana === 'si' ? 'GANA' : gana === 'no' ? 'NO GANA' : 'CONDICIONAL';
  const cc = informe?.capa_c_admisibilidad;
  const crit = informe?.criterios_evaluacion;
  const criterios = crit?.criterios ?? [];
  // v2.1: la suma real la reporta el modelo (ponderaciones EFECTIVAS); si no, se calcula.
  const sumaCriterios = crit?.suma_ponderaciones_real != null && crit.suma_ponderaciones_real > 0
    ? crit.suma_ponderaciones_real
    : criterios.reduce((s, c) => s + (Number(c.ponderacion) || 0), 0);
  const sumaValida = crit?.suma_valida != null ? crit.suma_valida : (criterios.length === 0 || Math.round(sumaCriterios) === 100);
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
    if (nCrit > 0 && !sumaValida) avisos.push(`Los criterios de evaluación suman ${suma}% (deberían sumar 100%): posible criterio no capturado.`);
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
            <h2 className="text-[15px] font-bold text-slate-800 leading-tight">Análisis de viabilidad</h2>
            <p className="text-[11px] text-slate-400 truncate">El sistema lee todas las bases (incl. escaneadas) y emite el veredicto con su fuente</p>
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
            <Sparkles size={14} /> {informe ? 'Re-analizar' : 'Analizar'}
          </button>
        )}
      </div>

      {error && <div className="flex items-start gap-2 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-3"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /><div><p className="font-semibold">No se pudo completar</p><p className="text-red-600">{error.includes('saturad') || error.includes('429') || error.includes('503') ? 'El servicio de análisis está saturado en este momento. Reintenta en unos minutos.' : error}</p></div></div>}

      {/* Aviso "Analizando…" (segundo plano): NO es un error. El análisis dura más que el límite del
          túnel, así que corre en el server y esta pantalla se actualiza sola por polling. */}
      {avisoProceso && !error && (
        <div className="flex items-start gap-2 text-[13px] text-sky-800 bg-sky-50 border border-sky-200 rounded-lg p-3">
          <Loader2 size={15} className="flex-shrink-0 mt-0.5 animate-spin text-sky-600" />
          <div><p className="font-semibold">Analizando…</p><p className="text-sky-700">{avisoProceso}</p></div>
        </div>
      )}

      {/* Cargando el informe YA guardado (GET inicial): no confundir con "sin análisis". */}
      {!informe && !cargando && cargandoInforme && (
        <div className="flex flex-col items-center justify-center py-14 bg-white rounded-2xl border border-slate-200 text-center">
          <Loader2 size={22} className="animate-spin text-violet-500 mb-3" />
          <p className="text-[13px] text-slate-500">Cargando el análisis guardado…</p>
        </div>
      )}

      {/* El informe existe en BD pero el GET falló (pool saturado / red): NO decir "sin análisis". */}
      {!informe && !cargando && !cargandoInforme && errorCarga && (
        <div className="flex flex-col items-center justify-center py-14 bg-white rounded-2xl border border-amber-200 bg-amber-50/40 text-center">
          <AlertTriangle size={22} className="text-amber-500 mb-3" />
          <p className="text-[13px] font-semibold text-slate-700">No se pudo cargar el análisis guardado</p>
          <p className="text-[12px] text-slate-400 max-w-xs mt-1">El servidor puede estar ocupado (hay un análisis en curso). El informe sigue guardado.</p>
          <button onClick={cargar} className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-[12px] font-semibold rounded-lg">
            <Loader2 size={13} /> Reintentar
          </button>
        </div>
      )}

      {!informe && !cargando && !error && !cargandoInforme && !errorCarga && (
        <div className="flex flex-col items-center justify-center py-14 bg-white rounded-2xl border border-slate-200 text-center">
          <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center mb-3"><Sparkles size={22} className="text-violet-500" /></div>
          <p className="text-[14px] font-semibold text-slate-700">Aún sin análisis</p>
          <p className="text-[12px] text-slate-400 max-w-xs mt-1">Pulsa “Analizar”: se leerán todos los documentos y se entregará el score, el veredicto y todo el detalle con su fuente.</p>
        </div>
      )}

      {cargando && !informe && (
        <div className="flex flex-col items-center justify-center py-14 bg-white rounded-2xl border border-slate-200 text-center">
          <DocScanLoader
            titulo="Leyendo los documentos…"
            subtitulo="Las bases escaneadas también se procesan. Puede tardar 1–2 minutos la primera vez."
          />
        </div>
      )}

      {visor && <VisorPagina estado={visor} onClose={() => setVisor(null)} />}

      {informe && (
        <FuenteDocsContext.Provider value={docs}>
         <VisorContext.Provider value={setVisor}>
          {(informe as any)._schema === 'v3' ? <VistaV3 informe={informe as any} /> : (<>
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
              <p className="text-[10px] font-bold text-slate-400 uppercase">Cómo se adjudica</p>
              <p className="text-[14px] font-semibold text-slate-800 leading-tight">{cap(informe.modalidad?.como_se_adjudica) || cap(informe.modalidad?.tipo) || '—'}{informe.modalidad?.estado === 'REVISION_HUMANA' ? ' ⚠' : ''}</p>
              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                {informe.modalidad?.cotizar_100_obligatorio && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-red-100 text-red-700" title="Hay que cotizar el 100% o la oferta queda fuera">COTIZAR 100%</span>}
                {informe.modalidad?.heterogeneidad === 'alta' && <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-100 text-emerald-700">heterogénea</span>}
              </div>
              {hrefCita(informe.modalidad?.fuente)
                ? <a href={hrefCita(informe.modalidad?.fuente)} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-indigo-600 hover:underline truncate" title={informe.modalidad?.fuente}>{informe.modalidad?.fuente}</a>
                : <p className="text-[10px] text-slate-400 truncate" title={informe.modalidad?.fuente}>{informe.modalidad?.fuente}</p>}
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Colchón administrativo</p>
              <p className="text-[15px] font-bold text-slate-800 leading-tight">{lt?.colchon_dias_corridos != null ? `${lt.colchon_dias_corridos} días corr.` : lt?.colchon_dias_habiles != null ? `${lt.colchon_dias_habiles} días háb.` : '—'}</p>
              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                {lt?.ventana_importacion
                  ? <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-sky-100 text-sky-700 inline-flex items-center gap-0.5"><Ship size={9} /> ventana importación</span>
                  : <span className="text-[10px] text-slate-400 truncate">{lt?.plazo_ofertable_puntaje ? `ofertable: ${lt.plazo_ofertable_puntaje}` : 'previo al cómputo'}</span>}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Líneas</p>
              <p className="text-[15px] font-bold text-slate-800 leading-tight">{nProd || informe.capa_a?.cantidad_items?.n_items || '—'}</p>
              <p className="text-[10px] text-slate-400">productos</p>
            </div>
          </div>

          {/* DETALLE — acordeón */}
          {criterios.length > 0 && (
            <Seccion icon={<Target size={14} className="text-violet-500" />} titulo="Criterios de evaluación y forma de aplicación" badge={`suma ${Math.round(sumaCriterios)}%${sumaValida ? ' ✓' : ' ⚠ no cuadra'}${crit?.forma_aplicacion_completa === false ? ' · forma incompleta ⚠' : ''}${informe.modalidad?.evaluacion_puntaje === 'por_linea' ? ' · por línea' : ''}`} defaultOpen>
              <div className="space-y-2.5">
                {criterios.map((c, i) => (
                  <div key={i} className="border-b border-slate-100 last:border-0 pb-2 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-slate-800 flex items-center gap-1.5">
                        {c.nombre}
                        {c.abierto_o_topado && <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${c.abierto_o_topado === 'abierto' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{c.abierto_o_topado}</span>}
                      </p>
                      <span className="text-[13px] font-bold text-slate-900 flex-shrink-0">{c.ponderacion ?? 0}%</span>
                    </div>
                    {c.forma_aplicacion
                      ? <p className="text-[12px] text-slate-600 mt-0.5 leading-snug whitespace-pre-line">{c.forma_aplicacion}</p>
                      : <p className="text-[12px] text-amber-600 mt-0.5">⚠ Sin forma de aplicación — revisar las bases.</p>}
                    {c.medio_verificacion && <p className="text-[11px] text-slate-400 mt-0.5">Verificación: {c.medio_verificacion}</p>}
                    {/* v2.1: subfactores con su ponderación EFECTIVA (real) */}
                    {(c.subfactores?.length ?? 0) > 0 && (
                      <div className="mt-1 pl-3 border-l-2 border-slate-100 space-y-1">
                        {c.subfactores!.map((s, j) => (
                          <div key={j} className="text-[11.5px]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-600">↳ {s.nombre}{s.abierto_o_topado ? ` (${s.abierto_o_topado})` : ''}</span>
                              <span className="font-semibold text-slate-700 flex-shrink-0">{s.ponderacion_efectiva ?? 0}% real</span>
                            </div>
                            {s.forma_aplicacion && <p className="text-slate-500 leading-snug">{s.forma_aplicacion}</p>}
                          </div>
                        ))}
                      </div>
                    )}
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
            <Seccion icon={<Gavel size={14} className="text-violet-500" />} titulo="Módulo plazos (colchón + entrega)" badge={lt?.colchon_dias_corridos != null ? `colchón ${lt.colchon_dias_corridos} días corr.` : lt?.colchon_dias_habiles != null ? `colchón ${lt.colchon_dias_habiles} días háb.` : undefined} defaultOpen>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-emerald-50 rounded-lg p-2"><p className="text-[10px] text-emerald-500 uppercase font-bold">Colchón admin.</p><p className="text-[13px] font-bold text-emerald-700">{lt?.colchon_dias_corridos != null ? `${lt.colchon_dias_corridos} corr.` : lt?.colchon_dias_habiles != null ? `${lt.colchon_dias_habiles} háb.` : '—'}</p><p className="text-[9px] text-emerald-600">tiempo gratis pre-entrega</p></div>
                <div className="bg-slate-50 rounded-lg p-2"><p className="text-[10px] text-slate-400 uppercase font-bold">Ofertable (puntaje)</p><p className="text-[13px] font-bold text-slate-800">{lt?.plazo_ofertable_puntaje || '—'}</p><p className="text-[9px] text-slate-400">no es colchón</p></div>
                <div className={`rounded-lg p-2 ${lt?.ventana_importacion ? 'bg-sky-50' : 'bg-slate-50'}`}><p className={`text-[10px] uppercase font-bold ${lt?.ventana_importacion ? 'text-sky-500' : 'text-slate-400'}`}>Importación</p><p className={`text-[13px] font-bold ${lt?.ventana_importacion ? 'text-sky-700' : 'text-slate-500'}`}>{lt?.ventana_importacion ? 'ventana ✓' : 'sin ventana'}</p><p className="text-[9px] text-slate-400">{lt?.ventana_importacion ? 'hay margen' : '≤10d o no import.'}</p></div>
              </div>
              {lt?.frontera_inicio_computo?.descripcion && (
                <div className="text-[12px] text-slate-600 mb-2 bg-slate-50 rounded-lg p-2">
                  <span className="font-semibold text-slate-700">Frontera (arranca el plazo de entrega):</span> {lt.frontera_inicio_computo.descripcion}{lt.frontera_inicio_computo.base_computo ? ` · ${cap(lt.frontera_inicio_computo.base_computo)}` : ''} <Fuente>{lt.frontera_inicio_computo.fuente}</Fuente>
                </div>
              )}
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

          {((informe.capa_b_palancas?.length ?? 0) > 0 || informe.donde_se_decide?.mensaje) && (
            <Seccion icon={<ListChecks size={14} className="text-violet-500" />} titulo="Palancas y jugadas (Capa B)" defaultOpen={!!informe.donde_se_decide?.mensaje}>
              <div className="space-y-1.5 text-[12px]">
                {informe.capa_b_palancas!.map((p, i) => (
                  <div key={i} className="bg-slate-50 rounded-lg p-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-700">{cap(p.palanca)}</span>
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border font-bold ${estadoColor(p.estado)}`}>{cap(p.estado)}</span>
                    </div>
                    {p.jugada && <p className="text-slate-700 mt-0.5 leading-snug font-medium">▸ {p.jugada}</p>}
                    {p.condicion && <p className="text-slate-500 mt-0.5 leading-snug">{p.condicion}</p>}
                    {p.fuente && <div className="mt-0.5"><Fuente>{p.fuente}</Fuente></div>}
                  </div>
                ))}
                {/* v2.1: DÓNDE SE DECIDE — síntesis de la Capa B */}
                {informe.donde_se_decide?.mensaje && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-2.5 mt-1">
                    <p className="flex items-center gap-1.5 text-[12px] font-bold text-violet-800 mb-1"><Compass size={13} /> Dónde se decide</p>
                    <p className="text-[12px] text-slate-700 leading-snug">{informe.donde_se_decide.mensaje}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      {informe.donde_se_decide.se_decide_en && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white border border-violet-200 text-violet-700">se decide en: {cap(informe.donde_se_decide.se_decide_en)}</span>}
                      {informe.donde_se_decide.tenemos_ventaja_costo === 'si' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">ventaja de costo{informe.donde_se_decide.via && informe.donde_se_decide.via !== 'ninguna' ? ` · ${cap(informe.donde_se_decide.via)}` : ''}</span>}
                      {informe.donde_se_decide.tenemos_ventaja_costo === 'no' && informe.donde_se_decide.se_decide_en === 'precio' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">⚠ guerra de precio</span>}
                      {(informe.donde_se_decide.criterios_abiertos_diferenciadores ?? []).map((c, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700">diferenciar: {c}</span>)}
                    </div>
                  </div>
                )}
              </div>
            </Seccion>
          )}

          {cc && (
            <Seccion icon={<ShieldCheck size={14} className="text-violet-500" />} titulo="Admisibilidad (Capa C)" badge={(cc.bloqueantes?.length ?? 0) > 0 ? `${cc.bloqueantes!.length} bloqueante(s)` : 'sin bloqueantes'}>
              <div className="space-y-1.5 text-[13px]">
                {cc.presupuesto_excluyente?.aplica && (
                  <p className="flex items-start gap-1.5 text-red-700 font-semibold"><Ban size={13} className="mt-0.5 flex-shrink-0" /> Presupuesto EXCLUYENTE — no superar el techo <Fuente>{cc.presupuesto_excluyente.fuente}</Fuente></p>
                )}
                {cc.cotizar_100_obligatorio?.aplica && (
                  <p className="flex items-start gap-1.5 text-red-700 font-semibold"><Ban size={13} className="mt-0.5 flex-shrink-0" /> Cotizar el 100% (global/lote) — falta 1 ítem = oferta fuera <Fuente>{cc.cotizar_100_obligatorio.fuente}</Fuente></p>
                )}
                {cc.bloqueantes?.map((b, i) => <p key={'bl' + i} className="flex items-start gap-1.5 text-red-700"><Ban size={13} className="mt-0.5 flex-shrink-0" /> {b.item} <Fuente>{b.fuente}</Fuente></p>)}
                {cc.barreras_a_favor?.map((b, i) => <p key={'bf' + i} className="flex items-start gap-1.5 text-emerald-700"><ShieldCheck size={13} className="mt-0.5 flex-shrink-0" /> {b.item} <Fuente>{b.fuente}</Fuente></p>)}
                <p className="text-slate-500 text-[12px]">Boleta: {cc.boleta_aplica ? `aplica (>${cc.umbral_utm ?? 1000} UTM)` : `no aplica (<${cc.umbral_utm ?? 1000} UTM)`} · Firma puño y letra: {cc.firma_puno_y_letra ? 'EXIGIDA ⚠' : 'no exigida'}</p>
                {cc.alertas?.map((a, i) => <p key={'al' + i} className="text-amber-700 text-[12px]">⚠ {a}</p>)}
              </div>
            </Seccion>
          )}

          {(informe.documentos_infaltables?.length ?? 0) > 0 && (
            <Seccion icon={<ClipboardCheck size={14} className="text-violet-500" />} titulo="Documentos infaltables" badge={`${informe.documentos_infaltables!.length} · orden de trabajo`} defaultOpen>
              <div className="space-y-1.5 text-[12px]">
                {informe.documentos_infaltables!.map((d, i) => {
                  const dur = d.tipo === 'admisibilidad_dura' ? { ic: '🔴', txt: 'Admisibilidad dura' }
                    : d.tipo === 'puntaje_condicionante' ? { ic: '🟡', txt: 'Puntaje-condicionante' }
                    : { ic: '🟢', txt: 'Compromiso de ejecución' };
                  return (
                    <div key={i} className="bg-slate-50 rounded-lg p-2">
                      <div className="flex items-start gap-1.5">
                        <span className="flex-shrink-0" title={dur.txt}>{dur.ic}</span>
                        <p className="text-slate-700 font-medium flex-1">{d.exige}</p>
                        {d.responsable && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 flex-shrink-0">{cap(d.responsable)}</span>}
                      </div>
                      {d.cubre && <p className="text-slate-500 mt-0.5 pl-5 leading-snug">Lo cubre: {d.cubre}</p>}
                      {d.fuente && <div className="mt-0.5 pl-5"><Fuente>{d.fuente}</Fuente></div>}
                    </div>
                  );
                })}
                <p className="text-[10px] text-slate-400 pt-0.5">🔴 de fallar nos deja fuera · 🟡 condiciona puntaje · 🟢 compromiso post-adjudicación. Todos se preparan; el color solo prioriza.</p>
              </div>
            </Seccion>
          )}

          {(informe.multas?.estructura || informe.multas?.costo_por_dia) && (
            <Seccion icon={<Gavel size={14} className="text-violet-500" />} titulo="Multas">
              <p className="text-[13px] text-slate-700">{informe.multas?.estructura}{informe.multas?.costo_por_dia ? ` · costo/día: ${informe.multas.costo_por_dia}` : ''}{informe.multas?.costo_maximo ? ` · tope: ${informe.multas.costo_maximo}` : ''}{informe.multas?.umbral_termino ? ` · término: ${informe.multas.umbral_termino}` : ''}</p>
              <div className="mt-1"><Fuente>{informe.multas?.fuente}</Fuente></div>
            </Seccion>
          )}

          {nProd > 0 && (() => {
            // Numeración REAL de ítems: 1..N secuencial. El campo `linea` es el LOTE de
            // adjudicación (1 para todos en suma_alzada) — solo lo mostramos como badge
            // cuando hay ≥2 lotes distintos (por_linea), para no repetir "1." en cada fila.
            const lotes = new Set(informe.manifiesto_productos!.map(p => p.linea));
            const multiLote = lotes.size >= 2;
            return (
            <Seccion icon={<Package size={14} className="text-violet-500" />} titulo="Productos (manifiesto)" badge={`${nProd} ítems`}>
              <div className="space-y-1">
                {informe.manifiesto_productos!.map((p, i) => (
                  <div key={i} className="flex gap-2 text-[13px] border-b border-slate-100 last:border-0 py-1">
                    <span className="text-slate-400 w-6 flex-shrink-0">{i + 1}.</span>
                    {multiLote && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 flex-shrink-0">L{p.linea}</span>}
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
            );
          })()}

          {/* v2.1: líneas a atacar / soltar (solo POR LÍNEAS de mini-proyectos) */}
          {(informe.lineas_a_atacar?.length ?? 0) > 0 && (
            <Seccion icon={<Swords size={14} className="text-violet-500" />} titulo="Líneas a atacar / soltar" badge={`${informe.lineas_a_atacar!.filter(l => l.decision === 'atacar').length} atacar · ${informe.lineas_a_atacar!.filter(l => l.decision === 'soltar').length} soltar`}>
              <div className="space-y-1 text-[12px]">
                {informe.lineas_a_atacar!.map((l, i) => (
                  <div key={i} className="flex items-start gap-2 border-b border-slate-100 last:border-0 py-1">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${l.decision === 'atacar' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>L{l.linea} · {cap(l.decision)}</span>
                    <span className="text-slate-600 flex-1">{l.motivo}</span>
                  </div>
                ))}
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
          </>)}
         </VisorContext.Provider>
        </FuenteDocsContext.Provider>
      )}

      {/* Feedback loop: enseñar a la IA — visible siempre, no requiere análisis previo */}
      {puedeComentar && (
      <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
        <div className="flex items-center gap-2 mb-1">
          <GraduationCap size={16} className="text-violet-600" />
          <h3 className="text-[13px] font-bold text-slate-800">Enseñarle a la IA · Reglas que aprende</h3>
        </div>
        <p className="text-[11.5px] text-slate-500 mb-3">Tu corrección se convierte en una regla que el sistema aplicará en <strong>todos los análisis futuros</strong>. Puedes agregar reglas aunque no hayas analizado esta licitación.</p>

        {/* Ámbito de la regla: veredicto de negocio vs. cómo se leen los documentos (costeo) */}
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5 mb-3 w-fit">
          {([['global', 'Viabilidad / Descarte'], ['lectura', 'Lectura de documentos / Costeo']] as const).map(([a, lbl]) => (
            <button key={a} onClick={() => setFbAmbito(a)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-md transition-colors ${fbAmbito === a ? 'bg-white text-violet-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {lbl}
            </button>
          ))}
        </div>

        {fbAmbito === 'global' ? (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {([['viable', 'Sí es viable'], ['no_viable', 'No es viable'], ['parcial', 'Parcial']] as const).map(([v, lbl]) => (
              <button key={v} onClick={() => setFbVeredicto(fbVeredicto === v ? '' : v)}
                className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${fbVeredicto === v ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}>
                {lbl}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11.5px] text-violet-700 bg-violet-50 border border-violet-100 rounded-lg px-2.5 py-2 mb-2">
            Explica <strong>cómo debe leerse el documento</strong> para que la extracción de ítems y el costeo salgan bien. Se aplica al leer las planillas y anexos de futuras licitaciones.
          </p>
        )}

        <textarea value={fbComentario} onChange={e => setFbComentario(e.target.value)}
          placeholder={fbAmbito === 'lectura'
            ? 'Ej: En listados con encabezado "Cantidad solicitada", esa columna es la cantidad. / Si la descripción trae "MARCA SUGERIDA:", esa es referencial, no obligatoria. / Ignorar las filas de "Solped" y "Material" como si fueran ítems.'
            : 'Ej: No es viable porque exigen certificación ISO-9001 que no manejamos. / Descartar siempre que pidan fianza bancaria en UTM.'}
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
                  <p className="text-slate-700">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded mr-1.5 align-middle ${f.ambito === 'lectura' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}`}>
                      {f.ambito === 'lectura' ? 'Lectura' : 'Viabilidad'}
                    </span>
                    <strong>Regla:</strong> {f.regla}
                  </p>
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
