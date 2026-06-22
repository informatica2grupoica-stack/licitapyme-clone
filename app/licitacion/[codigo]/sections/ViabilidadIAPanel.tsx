'use client';

// Panel de VIABILIDAD v2 (PROMPT 2 COMPLETO) — análisis IA que LEE todos los documentos
// (incl. escaneados vía Gemini visión) y muestra el Informe de Viabilidad completo con
// FUENTE en cada dato: exclusión, presupuesto+gate, modalidad, criterios %, capa A/B/C,
// multas, manifiesto de productos y veredicto GANA / NO GANA.

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, FileSearch, Loader2, AlertTriangle, CheckCircle2, XCircle, Ban, ShieldCheck } from 'lucide-react';

interface Criterio { nombre: string; ponderacion_pct: number; tipo?: string; fuente?: string }
interface Producto { linea: number; descripcion: string; modelo?: string; cantidad?: number | null; tipo?: string; ruta?: string }
interface Palanca { palanca: string; estado: string; condicion?: string; fuente?: string }
interface InformeIA {
  exclusion?: { excluido?: boolean; categoria?: string | null; motivo?: string; fuente?: string; destino?: string };
  presupuesto?: { bruto?: number | null; neto?: number | null; con_iva?: boolean; fuente?: string; gate?: string };
  modalidad?: { tipo?: string; evidencia?: string; fuente?: string; libertad_de_pricing?: boolean };
  criterios_evaluacion?: Criterio[];
  capa_a?: {
    presupuesto?: { pts?: number; fuente?: string };
    cantidad_items?: { pts?: number; n_items?: number; fuente?: string };
    complejidad?: { pts?: number; fuente?: string };
    ejecucion?: { pts?: number; fuente?: string };
    modificadores?: { bonus_cantidad_presupuesto?: number; bonus_importabilidad_provisional?: number };
    score_total?: number; nivel?: string;
  };
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

function Fuente({ children }: { children?: string }) {
  if (!children) return null;
  return <span className="inline-flex items-center gap-1 text-[11px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100"><FileSearch size={10} />{children}</span>;
}
function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">{titulo}</p>
      {children}
    </div>
  );
}
const estadoColor = (e?: string) => e === 'VENTAJA' ? 'text-emerald-700 bg-emerald-50' : e === 'DESVENTAJA' ? 'text-red-700 bg-red-50' : 'text-slate-500 bg-slate-50';

export function ViabilidadIAPanel({ codigo }: { codigo: string }) {
  const [informe, setInforme] = useState<InformeIA | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/licitacion-viabilidad-ia/${encodeURIComponent(codigo)}`).then(x => x.json());
      if (r?.informeIA) setInforme(r.informeIA);
    } catch { /* silencioso */ }
  }, [codigo]);
  useEffect(() => { cargar(); }, [cargar]);

  const analizar = async () => {
    setCargando(true); setError(null);
    try {
      const r = await fetch(`/api/licitacion-viabilidad-ia/${encodeURIComponent(codigo)}`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) { setError(j.error || 'Error al analizar.'); return; }
      setInforme(j.informeIA);
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setCargando(false); }
  };

  const v = informe?.veredicto;
  const gana = (v?.gana_probable || '').toLowerCase();
  const ganaColor = gana === 'si' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : gana === 'no' ? 'text-red-700 bg-red-50 border-red-200' : 'text-amber-700 bg-amber-50 border-amber-200';
  const ganaLabel = gana === 'si' ? 'GANA' : gana === 'no' ? 'NO GANA' : 'CONDICIONAL';
  const ca = informe?.capa_a;
  const cc = informe?.capa_c_admisibilidad;
  const sumaCriterios = (informe?.criterios_evaluacion || []).reduce((s, c) => s + (Number(c.ponderacion_pct) || 0), 0);

  return (
    <div className="bg-white rounded-xl border border-violet-200 shadow-sm overflow-hidden mt-4">
      <div className="px-4 py-3 bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-violet-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles size={16} className="text-violet-600 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-violet-900">Análisis IA de los documentos (PROMPT 2)</p>
            <p className="text-[11px] text-violet-500 truncate">Gemini lee TODAS las bases (incl. escaneadas) y extrae datos reales con su fuente</p>
          </div>
        </div>
        <button onClick={analizar} disabled={cargando}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors flex-shrink-0">
          {cargando ? <><Loader2 size={14} className="animate-spin" /> Leyendo…</> : <><Sparkles size={14} /> {informe ? 'Re-analizar' : 'Analizar con IA'}</>}
        </button>
      </div>

      <div className="p-4">
        {error && <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-3"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5" /><span>{error}</span></div>}
        {!informe && !cargando && !error && <p className="text-sm text-slate-500 text-center py-6">Pulsa <strong>“Analizar con IA”</strong>: Gemini leerá todos los documentos y emitirá el informe de viabilidad completo (presupuesto con fuente, criterios %, capas A/B/C, multas, manifiesto y veredicto).</p>}
        {cargando && !informe && <p className="text-sm text-slate-500 text-center py-6">Leyendo y analizando los documentos… 1–2 minutos.</p>}

        {informe && (
          <div className="space-y-4">
            {/* Veredicto */}
            {v && (
              <div className={`rounded-lg border p-3 ${ganaColor}`}>
                <div className="flex items-center gap-2 font-bold text-sm">
                  {gana === 'si' ? <CheckCircle2 size={16} /> : gana === 'no' ? <XCircle size={16} /> : <AlertTriangle size={16} />}
                  VEREDICTO: {ganaLabel}{v.nivel ? ` · ${cap(v.nivel)}` : ''}{ca?.score_total != null ? ` · Atractivo ${ca.score_total}/15` : ''}
                </div>
                {v.por_que && <p className="text-[13px] mt-1.5 leading-snug">{v.por_que}</p>}
              </div>
            )}

            {/* Exclusión (si aplica) */}
            {informe.exclusion?.excluido && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-[13px] text-red-700">
                <strong>Exclusión ({cap(informe.exclusion.categoria || '')}):</strong> {informe.exclusion.motivo} <Fuente>{informe.exclusion.fuente}</Fuente>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Presupuesto */}
              <Bloque titulo="Presupuesto">
                <p className="text-lg font-bold text-emerald-700">{fmt(informe.presupuesto?.neto ?? informe.presupuesto?.bruto)} {informe.presupuesto?.neto ? 'neto' : ''}</p>
                {informe.presupuesto?.gate && <span className="text-[11px] text-slate-500">gate: {cap(informe.presupuesto.gate)}</span>}
                <div><Fuente>{informe.presupuesto?.fuente}</Fuente></div>
              </Bloque>
              {/* Modalidad */}
              <Bloque titulo="Modalidad de adjudicación">
                <p className="text-sm font-semibold text-slate-800">{cap(informe.modalidad?.tipo) || 'desconocida'}{informe.modalidad?.libertad_de_pricing ? ' · libertad de pricing' : ''}</p>
                {informe.modalidad?.evidencia && <p className="text-[12px] text-slate-500 italic">“{informe.modalidad.evidencia}”</p>}
                <div><Fuente>{informe.modalidad?.fuente}</Fuente></div>
              </Bloque>
            </div>

            {/* Criterios % */}
            {(informe.criterios_evaluacion?.length ?? 0) > 0 && (
              <Bloque titulo={`Criterios de evaluación (suma ${sumaCriterios}%)`}>
                <table className="w-full text-[13px]"><tbody>
                  {informe.criterios_evaluacion!.map((c, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="py-1.5 text-slate-700">{c.nombre}</td>
                      <td className="py-1.5 text-right font-bold text-slate-900 w-14">{c.ponderacion_pct}%</td>
                      <td className="py-1.5 pl-3 text-[11px] text-slate-400">{c.fuente}</td>
                    </tr>
                  ))}
                </tbody></table>
              </Bloque>
            )}

            {/* Capa A — atractivo puntuado */}
            {ca && (
              <Bloque titulo={`Capa A · Atractivo ${ca.score_total ?? '?'}/15 — ${cap(ca.nivel)}`}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
                  {[['Presupuesto', ca.presupuesto], ['Cantidad', ca.cantidad_items], ['Complejidad', ca.complejidad], ['Ejecución', ca.ejecucion]].map(([lbl, o]: any, i) => (
                    <div key={i} className="bg-slate-50 rounded-lg p-2">
                      <p className="text-slate-500">{lbl}</p>
                      <p className="font-bold text-slate-800">{o?.pts ?? '—'}/3</p>
                      {o?.fuente && <p className="text-[10px] text-slate-400 truncate" title={o.fuente}>{o.fuente}</p>}
                    </div>
                  ))}
                </div>
                {(!!ca.modificadores?.bonus_cantidad_presupuesto || !!ca.modificadores?.bonus_importabilidad_provisional) && (
                  <p className="text-[11px] text-slate-500 mt-1">Bonos: cantidad+presupuesto {ca.modificadores?.bonus_cantidad_presupuesto || 0}, importabilidad (prov.) {ca.modificadores?.bonus_importabilidad_provisional || 0}</p>
                )}
              </Bloque>
            )}

            {/* Capa B — palancas */}
            {(informe.capa_b_palancas?.length ?? 0) > 0 && (
              <Bloque titulo="Capa B · Palancas">
                <div className="flex flex-wrap gap-1.5">
                  {informe.capa_b_palancas!.map((p, i) => (
                    <span key={i} title={`${p.condicion || ''} ${p.fuente ? '· ' + p.fuente : ''}`} className={`text-[12px] px-2 py-1 rounded-lg ${estadoColor(p.estado)}`}>
                      {cap(p.palanca)}: <strong>{cap(p.estado)}</strong>
                    </span>
                  ))}
                </div>
              </Bloque>
            )}

            {/* Capa C — admisibilidad */}
            {cc && (
              <Bloque titulo="Capa C · Admisibilidad">
                <div className="space-y-1 text-[13px]">
                  {(cc.bloqueantes?.length ?? 0) > 0 && cc.bloqueantes!.map((b, i) => (
                    <p key={'bl' + i} className="flex items-start gap-1.5 text-red-700"><Ban size={13} className="mt-0.5 flex-shrink-0" /> Bloqueante: {b.item} {b.fuente ? <Fuente>{b.fuente}</Fuente> : null}</p>
                  ))}
                  {(cc.barreras_a_favor?.length ?? 0) > 0 && cc.barreras_a_favor!.map((b, i) => (
                    <p key={'bf' + i} className="flex items-start gap-1.5 text-emerald-700"><ShieldCheck size={13} className="mt-0.5 flex-shrink-0" /> A favor: {b.item} {b.fuente ? <Fuente>{b.fuente}</Fuente> : null}</p>
                  ))}
                  <p className="text-slate-500 text-[12px]">Boleta: {cc.boleta_aplica ? `aplica (>${cc.umbral_utm ?? 1000} UTM)` : `no aplica (<${cc.umbral_utm ?? 1000} UTM)`} · Firma puño y letra: {cc.firma_puno_y_letra ? 'EXIGIDA ⚠' : 'no exigida'}</p>
                  {cc.alertas?.map((a, i) => <p key={'al' + i} className="text-amber-700 text-[12px]">⚠ {a}</p>)}
                </div>
              </Bloque>
            )}

            {/* Multas */}
            {(informe.multas?.estructura || informe.multas?.costo_por_dia) && (
              <Bloque titulo="Multas">
                <p className="text-[13px] text-slate-700">{informe.multas?.estructura}{informe.multas?.costo_por_dia ? ` · costo/día: ${informe.multas.costo_por_dia}` : ''}{informe.multas?.costo_maximo ? ` · tope: ${informe.multas.costo_maximo}` : ''}{informe.multas?.umbral_termino ? ` · término: ${informe.multas.umbral_termino}` : ''}</p>
                <Fuente>{informe.multas?.fuente}</Fuente>
              </Bloque>
            )}

            {/* Plazo + garantías */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {informe.plazo_entrega?.detalle && (
                <Bloque titulo="Plazo de entrega">
                  <p className="text-[13px] text-slate-700">{informe.plazo_entrega.detalle}</p>
                  <Fuente>{informe.plazo_entrega.fuente}</Fuente>
                </Bloque>
              )}
              {(informe.garantias?.length ?? 0) > 0 && (
                <Bloque titulo="Garantías">
                  {informe.garantias!.map((g, i) => <p key={i} className="text-[13px] text-slate-700">{g.tipo}: {g.detalle}</p>)}
                </Bloque>
              )}
            </div>

            {/* Manifiesto de productos */}
            {(informe.manifiesto_productos?.length ?? 0) > 0 && (
              <Bloque titulo={`Manifiesto de productos (${informe.manifiesto_productos!.length})`}>
                <div className="space-y-1">
                  {informe.manifiesto_productos!.map((p, i) => (
                    <div key={i} className="flex gap-2 text-[13px] border-b border-slate-100 last:border-0 py-1">
                      <span className="text-slate-400 w-5 flex-shrink-0">{p.linea ?? i + 1}.</span>
                      <span className="text-slate-700 flex-1">{p.descripcion}{p.modelo ? ` · ${p.modelo}` : ''}</span>
                      {p.cantidad != null && <span className="text-slate-500 flex-shrink-0">{p.cantidad}</span>}
                      {p.tipo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 flex-shrink-0">{p.tipo}</span>}
                      {p.ruta && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600 flex-shrink-0">Ruta {p.ruta}</span>}
                    </div>
                  ))}
                </div>
              </Bloque>
            )}

            {/* Acciones AC + advertencias */}
            {((v?.acciones_AC?.length ?? 0) > 0 || (v?.advertencias?.length ?? 0) > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(v?.acciones_AC?.length ?? 0) > 0 && (
                  <Bloque titulo="Acciones para el AC">
                    <ul className="text-[12px] text-slate-700 space-y-1 list-disc pl-4">{v!.acciones_AC!.map((a, i) => <li key={i}>{a}</li>)}</ul>
                  </Bloque>
                )}
                {(v?.advertencias?.length ?? 0) > 0 && (
                  <Bloque titulo="Advertencias">
                    <ul className="text-[12px] text-amber-700 space-y-1 list-disc pl-4">{v!.advertencias!.map((a, i) => <li key={i}>{a}</li>)}</ul>
                  </Bloque>
                )}
              </div>
            )}

            {/* Pie */}
            <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-400">
              {(informe.pendientes_fase3?.length ?? 0) > 0 && <span>Pendiente Fase 3: {informe.pendientes_fase3!.join(', ')} · </span>}
              Leídos {informe.documentos_leidos?.length ?? 0} doc(s){(informe.documentos_no_leidos?.length ?? 0) > 0 ? ` · ${informe.documentos_no_leidos!.length} ilegibles` : ''} · confianza {Math.round((informe.confianza_global ?? 0) * 100)}%
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
