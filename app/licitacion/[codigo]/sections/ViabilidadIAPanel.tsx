'use client';

// VIABILIDAD (PROMPT 2) — La IA es la fuente ÚNICA: lee todos los documentos (incl.
// escaneados vía Gemini visión) y entrega el SCORE 0-100, el veredicto y todo el
// análisis con su FUENTE. Front profesional: hero con score + veredicto + datos clave,
// y el detalle en secciones plegables (acordeón) para que no sea un muro de información.

import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { Sparkles, FileSearch, Loader2, AlertTriangle, ChevronDown, Ban, ShieldCheck, Package, Scale, Gavel, Target, ListChecks, ExternalLink } from 'lucide-react';

interface Criterio { nombre: string; ponderacion_pct: number; tipo?: string; fuente?: string }
interface Producto { linea: number; descripcion: string; modelo?: string; cantidad?: number | null; tipo?: string; ruta?: string }
interface Palanca { palanca: string; estado: string; condicion?: string; fuente?: string }
interface InformeIA {
  score_0_100?: number; semaforo?: string; area_negocio?: string;
  exclusion?: { excluido?: boolean; categoria?: string | null; motivo?: string; fuente?: string };
  presupuesto?: { bruto?: number | null; neto?: number | null; con_iva?: boolean; fuente?: string; gate?: string };
  modalidad?: { general?: string; tipo?: string; nivel_lineas?: string; nivel_intra_linea?: string; evidencia?: string; fuente?: string; libertad_de_pricing?: boolean; revision_humana?: boolean };
  criterios_evaluacion?: Criterio[];
  criterios_no_encontrados?: boolean;
  capa_a?: { presupuesto?: { pts?: number; fuente?: string }; cantidad_items?: { pts?: number; n_items?: number; fuente?: string }; complejidad?: { pts?: number; fuente?: string }; ejecucion?: { pts?: number; fuente?: string }; score_total?: number; nivel?: string };
  capa_b_palancas?: Palanca[];
  capa_c_admisibilidad?: { bloqueantes?: Array<{ item: string; fuente?: string }>; barreras_a_favor?: Array<{ item: string; fuente?: string }>; boleta_aplica?: boolean; umbral_utm?: number; firma_puno_y_letra?: boolean; alertas?: string[] };
  multas?: { estructura?: string; costo_por_dia?: string; costo_maximo?: string; umbral_termino?: string; fuente?: string };
  plazo_entrega?: { detalle?: string; fuente?: string };
  garantias?: Array<{ tipo?: string; detalle?: string; fuente?: string }>;
  manifiesto_productos?: Producto[];
  pendientes_fase3?: string[];
  veredicto?: { nivel?: string; gana_probable?: string; por_que?: string; acciones_AC?: string[]; advertencias?: string[] };
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

function Fuente({ children }: { children?: string }) {
  const docs = useContext(FuenteDocsContext);
  if (!children) return null;
  const cita = resolverCita(children, docs);
  if (cita) {
    return (
      <a href={cita.href} target="_blank" rel="noopener noreferrer"
        title={cita.pagina ? `Abrir el documento en la página ${cita.pagina}` : 'Abrir el documento'}
        className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-800 hover:underline">
        <FileSearch size={10} />{children}<ExternalLink size={9} className="opacity-70" />
      </a>
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

export function ViabilidadIAPanel({ codigo, onTambienAnalizar }: { codigo: string; onTambienAnalizar?: () => void }) {
  const [informe, setInforme] = useState<InformeIA | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocRef[]>([]);

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

  const analizar = async () => {
    setCargando(true); setError(null);
    try { onTambienAnalizar?.(); } catch { /* noop */ }
    try {
      // Si ya hay informe, el botón es "Re-analizar": fuerza una corrida fresca
      // (ignora el cache por huella de documentos). El primer análisis sí usa cache.
      const qs = informe ? '?force=1' : '';
      const r = await fetch(`/api/licitacion-viabilidad-ia/${encodeURIComponent(codigo)}${qs}`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) { setError(j.error || 'Error al analizar.'); return; }
      setInforme(j.informeIA);
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setCargando(false); }
  };

  const v = informe?.veredicto;
  const score = Math.round(Number(informe?.score_0_100) || 0);
  const sem = SEM[informe?.semaforo || ''] || SEM.NARANJA;
  const gana = (v?.gana_probable || '').toLowerCase();
  const ganaLabel = gana === 'si' ? 'GANA' : gana === 'no' ? 'NO GANA' : 'CONDICIONAL';
  const cc = informe?.capa_c_admisibilidad;
  const sumaCriterios = (informe?.criterios_evaluacion || []).reduce((s, c) => s + (Number(c.ponderacion_pct) || 0), 0);
  const nProd = informe?.manifiesto_productos?.length ?? 0;

  // Validador de coherencia: incoherencias del informe que merecen revisión humana.
  const avisos: string[] = [];
  if (informe) {
    const nCrit = informe.criterios_evaluacion?.length ?? 0;
    const suma = Math.round(sumaCriterios);
    if (nCrit > 0 && suma !== 100) avisos.push(`Los criterios de evaluación suman ${suma}% (deberían sumar 100%).`);
    if (informe.criterios_no_encontrados) avisos.push('No se encontraron criterios de evaluación en las bases (situación anómala).');
    const conf = informe.confianza_global;
    if (conf != null && conf < 0.6) avisos.push(`Confianza del análisis baja (${Math.round(conf * 100)}%): conviene revisión humana.`);
    if (informe.modalidad?.revision_humana) avisos.push('La modalidad de adjudicación quedó marcada para revisión humana.');
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
        <button onClick={analizar} disabled={cargando}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-[13px] font-semibold rounded-lg transition-colors flex-shrink-0">
          {cargando ? <><Loader2 size={14} className="animate-spin" /> Analizando…</> : <><Sparkles size={14} /> {informe ? 'Re-analizar' : 'Analizar con IA'}</>}
        </button>
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

      {informe && (
        <FuenteDocsContext.Provider value={docs}>
          {/* HERO: score + veredicto */}
          <div className={`rounded-2xl border p-4 ${sem.soft}`}>
            <div className="flex items-center gap-4">
              <Gauge score={score} sem={sem} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] font-black text-white px-2 py-0.5 rounded ${sem.bg}`}>{ganaLabel}</span>
                  <span className={`text-[13px] font-bold ${sem.text}`}>{SEM[informe.semaforo || '']?.label || cap(v?.nivel)}</span>
                  {informe.area_negocio && <span className="text-[11px] text-slate-500 bg-white/60 border border-slate-200 px-2 py-0.5 rounded-full">{cap(informe.area_negocio)}</span>}
                </div>
                {v?.por_que && <p className="text-[13px] text-slate-600 mt-1.5 leading-snug">{v.por_que}</p>}
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
              {hrefCita(informe.presupuesto?.fuente)
                ? <a href={hrefCita(informe.presupuesto?.fuente)} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-indigo-600 hover:underline truncate" title={informe.presupuesto?.fuente}>{informe.presupuesto?.neto ? 'neto · ' : ''}{informe.presupuesto?.fuente}</a>
                : <p className="text-[10px] text-slate-400 truncate" title={informe.presupuesto?.fuente}>{informe.presupuesto?.neto ? 'neto · ' : ''}{informe.presupuesto?.fuente}</p>}
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Modalidad</p>
              <p className="text-[14px] font-semibold text-slate-800 leading-tight">{cap(informe.modalidad?.general || informe.modalidad?.tipo) || '—'}</p>
              {hrefCita(informe.modalidad?.fuente)
                ? <a href={hrefCita(informe.modalidad?.fuente)} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-indigo-600 hover:underline truncate" title={informe.modalidad?.fuente}>{informe.modalidad?.fuente}</a>
                : <p className="text-[10px] text-slate-400 truncate" title={informe.modalidad?.fuente}>{informe.modalidad?.fuente}</p>}
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Plazo entrega</p>
              <p className="text-[13px] font-semibold text-slate-800 leading-tight line-clamp-2">{informe.plazo_entrega?.detalle || '—'}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Líneas</p>
              <p className="text-[15px] font-bold text-slate-800 leading-tight">{nProd || informe.capa_a?.cantidad_items?.n_items || '—'}</p>
              <p className="text-[10px] text-slate-400">productos</p>
            </div>
          </div>

          {/* DETALLE — acordeón */}
          {(informe.criterios_evaluacion?.length ?? 0) > 0 && (
            <Seccion icon={<Target size={14} className="text-violet-500" />} titulo="Criterios de evaluación" badge={`suma ${sumaCriterios}%`} defaultOpen>
              <table className="w-full text-[13px]"><tbody>
                {informe.criterios_evaluacion!.map((c, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 text-slate-700">{c.nombre}</td>
                    <td className="py-1.5 text-right font-bold text-slate-900 w-14">{c.ponderacion_pct}%</td>
                    <td className="py-1.5 pl-3 text-[11px] hidden sm:table-cell"><Fuente>{c.fuente}</Fuente></td>
                  </tr>
                ))}
              </tbody></table>
            </Seccion>
          )}

          {informe.capa_a && (
            <Seccion icon={<Scale size={14} className="text-violet-500" />} titulo="Atractivo (Capa A)" badge={`${informe.capa_a.score_total ?? '?'}/15 · ${cap(informe.capa_a.nivel)}`}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
                {[['Presupuesto', informe.capa_a.presupuesto], ['Cantidad', informe.capa_a.cantidad_items], ['Complejidad', informe.capa_a.complejidad], ['Ejecución', informe.capa_a.ejecucion]].map(([lbl, o]: any, i) => (
                  <div key={i} className="bg-slate-50 rounded-lg p-2"><p className="text-slate-500">{lbl}</p><p className="font-bold text-slate-800">{o?.pts ?? '—'}/3</p><p className="text-[10px] text-slate-400 truncate" title={o?.fuente}>{o?.fuente}</p></div>
                ))}
              </div>
            </Seccion>
          )}

          {(informe.capa_b_palancas?.length ?? 0) > 0 && (
            <Seccion icon={<ListChecks size={14} className="text-violet-500" />} titulo="Palancas (Capa B)">
              <div className="flex flex-wrap gap-1.5">
                {informe.capa_b_palancas!.map((p, i) => (
                  <span key={i} title={`${p.condicion || ''} ${p.fuente ? '· ' + p.fuente : ''}`} className={`text-[12px] px-2 py-1 rounded-lg border ${estadoColor(p.estado)}`}>{cap(p.palanca)}: <strong>{cap(p.estado)}</strong></span>
                ))}
              </div>
            </Seccion>
          )}

          {cc && (
            <Seccion icon={<ShieldCheck size={14} className="text-violet-500" />} titulo="Admisibilidad (Capa C)" badge={(cc.bloqueantes?.length ?? 0) > 0 ? `${cc.bloqueantes!.length} bloqueante(s)` : 'sin bloqueantes'}>
              <div className="space-y-1.5 text-[13px]">
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
                    {p.cantidad != null && <span className="text-slate-500 flex-shrink-0">{p.cantidad}</span>}
                    {p.tipo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 flex-shrink-0">{p.tipo}</span>}
                    {p.ruta && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 flex-shrink-0">Ruta {p.ruta}</span>}
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
        </FuenteDocsContext.Provider>
      )}
    </div>
  );
}
