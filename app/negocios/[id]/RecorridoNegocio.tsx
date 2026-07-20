'use client';

// ── Recorrido del negocio ──────────────────────────────────────────────────────
// Línea de tiempo de HITOS (no de clics): cuenta la historia completa de la licitación
// dentro de la empresa — detectada en el radar → prefiltro IA → asignación → viabilidad →
// cambios de etapa → postulación → resultado (o descarte) — con fechas, quién y cuánto
// tardó cada tramo. Es distinta de la bitácora lateral (esa registra cada acción de cada
// perfil); aquí solo van los momentos que cambian el rumbo del negocio.
import { useEffect, useState } from 'react';
import { Route, Radar, Filter, UserPlus, Sparkles, GitCommitHorizontal, Send, Trophy, Ban, ExternalLink, Loader2 } from 'lucide-react';
import { ESTADOS_PIPELINE, normalizarEstado, getEstadoPipeline } from '@/app/lib/pipeline';

interface Recorrido {
  codigo: string;
  radar: { primera: string; n_perfiles: number; palabras: string | null } | null;
  prefiltro: { decision: string; categoria: string | null; confianza: number | null; motivo: string | null; created_at: string } | null;
  asignacion: { fecha: string; a_nombre: string | null; por_nombre: string | null };
  viabilidad: { score_total: number | null; semaforo: string | null; created_at: string; updated_at: string; veredicto_v3?: string | null; score_v3?: string | null } | null;
  eventos: Array<{ accion: string; descripcion: string | null; created_at: string; actor_nombre: string | null; actor_email: string | null }>;
  estado_actual: string;
  activo: boolean;
  monto_ofertado: number | null;
  empresa: string | null;
  adjudicacion: { es_adjudicada: any; estado: string | null; fecha_adjudicacion: string | null; monto_adjudicado_total: number | null; numero_oferentes: number | null; url_acta: string | null } | null;
  descarte: { fecha: string; motivo: string | null; por_nombre: string | null } | null;
}

interface Hito {
  key: string;
  fecha: string | null;
  titulo: string;
  detalle?: React.ReactNode;
  actor?: string | null;
  color: string;
  icon: React.ReactNode;
  ghost?: boolean;   // paso futuro (aún no ocurre)
  alFinal?: boolean; // desenlace: se ancla al final aunque su fecha registrada sea anterior
}

const fmtCLP = (n?: number | null) => n != null ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : null;

function fechaCorta(f: string): string {
  return new Date(f).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Duración humana entre dos fechas ("+3 d", "+5 h", "+20 min").
function tramo(a: string, b: string): string | null {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!isFinite(ms) || ms < 60000) return null;
  const min = Math.floor(ms / 60000);
  if (min < 60) return `+${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `+${h} h`;
  return `+${Math.floor(h / 24)} d`;
}

// Flujo "feliz" del pipeline, para calcular el PRÓXIMO paso esperado.
const FLUJO = ['ASIGNADO', 'EN_PROCESO', 'ANEXOS', 'ANEXO_LISTO', 'VISADO', 'POSTULADA'];

// La bitácora puede traer el MISMO cambio repetido (doble clic / doble submit): los
// consecutivos con la misma clave se colapsan conservando el PRIMERO (cuándo ocurrió
// de verdad). Un ida-y-vuelta legítimo (A → B → A) no se pierde: no son consecutivos.
function sinRepetidosConsecutivos<T>(lista: T[], clave: (x: T) => string): T[] {
  const out: T[] = [];
  let prev: string | null = null;
  for (const x of lista) {
    const k = clave(x);
    if (k !== prev) out.push(x);
    prev = k;
  }
  return out;
}

const SEM_COLOR: Record<string, string> = { VERDE: '#059669', AMARILLO: '#ca8a04', NARANJA: '#ea580c', ROJO: '#dc2626', ROJO_DURO: '#b91c1c' };

export function RecorridoNegocio({ negocioId }: { negocioId: number | string }) {
  const [rec, setRec] = useState<Recorrido | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/negocios/${negocioId}/recorrido`)
      .then(r => r.json())
      .then(d => { if (vivo && d?.recorrido) setRec(d.recorrido); })
      .catch(() => { /* sin recorrido, la tarjeta no se muestra */ })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [negocioId]);

  if (cargando) {
    return (
      <div className="bg-white border border-zinc-200/60 rounded-xl p-5 flex items-center gap-2 text-[12px] text-zinc-400">
        <Loader2 size={14} className="animate-spin" /> Cargando el recorrido…
      </div>
    );
  }
  if (!rec) return null;

  // ── Armar los hitos en orden cronológico ─────────────────────────────────────
  const hitos: Hito[] = [];

  if (rec.radar?.primera) {
    const palabras = (rec.radar.palabras || '').split('||').filter(Boolean);
    hitos.push({
      key: 'radar', fecha: rec.radar.primera, color: '#7c3aed', icon: <Radar size={13} />,
      titulo: 'Detectada en el radar',
      detalle: <>{palabras.length > 0 && <>Palabra clave: <span className="font-semibold">{palabras.join(' · ')}</span> · </>}llegó a {rec.radar.n_perfiles} perfil{rec.radar.n_perfiles === 1 ? '' : 'es'}</>,
    });
  }

  if (rec.prefiltro) {
    const pasa = String(rec.prefiltro.decision).toUpperCase() === 'PASA';
    hitos.push({
      key: 'prefiltro', fecha: rec.prefiltro.created_at, color: pasa ? '#059669' : '#dc2626', icon: <Filter size={13} />,
      titulo: `Prefiltro IA: ${pasa ? 'PASA' : String(rec.prefiltro.decision).toUpperCase()}${rec.prefiltro.categoria ? ` · ${String(rec.prefiltro.categoria).replace(/_/g, ' ')}` : ''}`,
      detalle: rec.prefiltro.motivo ? <span className="line-clamp-2">{rec.prefiltro.motivo}</span> : undefined,
    });
  }

  // Asignaciones/reasignaciones desde la bitácora; si no hay eventos, cae al dato del negocio.
  // El código de la licitación sobra en el texto (estamos DENTRO del negocio) y los eventos
  // duplicados consecutivos se colapsan.
  const evAsign = sinRepetidosConsecutivos(
    rec.eventos.filter(e => e.accion === 'asignacion')
      .map(e => ({ ...e, descripcion: (e.descripcion || '').replace(/\s+la\s+licitaci[oó]n\s+\S+\s+a\s+/i, ' a ') })),
    e => e.descripcion.trim().toUpperCase(),
  );
  if (evAsign.length > 0) {
    for (const [i, e] of evAsign.entries()) {
      hitos.push({
        key: `asig-${i}`, fecha: e.created_at, color: '#4F63D2', icon: <UserPlus size={13} />,
        titulo: e.descripcion || (i === 0 ? `Asignada a ${rec.asignacion.a_nombre || '—'}` : 'Reasignada'),
        actor: e.actor_nombre || e.actor_email,
      });
    }
  } else {
    hitos.push({
      key: 'asig', fecha: rec.asignacion.fecha, color: '#4F63D2', icon: <UserPlus size={13} />,
      titulo: `Asignada a ${rec.asignacion.a_nombre || '—'}`,
      actor: rec.asignacion.por_nombre,
    });
  }

  if (rec.viabilidad) {
    const score = Math.round(Number(rec.viabilidad.score_v3 ?? rec.viabilidad.score_total) || 0);
    const ver = (rec.viabilidad.veredicto_v3 || '').replace(/_/g, ' ');
    const reanalisis = rec.viabilidad.updated_at && rec.viabilidad.updated_at !== rec.viabilidad.created_at;
    hitos.push({
      key: 'viab', fecha: rec.viabilidad.created_at, color: SEM_COLOR[rec.viabilidad.semaforo || ''] || '#d97706', icon: <Sparkles size={13} />,
      titulo: `Viabilidad IA: ${score}/100${ver ? ` · ${ver}` : ''}`,
      detalle: reanalisis ? <>último re-análisis: {fechaCorta(rec.viabilidad.updated_at)}</> : undefined,
    });
  }

  // Cambios de etapa. El que llegó a POSTULADA se enriquece con empresa y monto ofertado.
  // La bitácora guarda 'Cambió el estado de "TÍTULO COMPLETO…" a POSTULADA'; aquí el título
  // sobra (estamos DENTRO del negocio) — se recorta — y los repetidos consecutivos (doble
  // clic sobre el mismo estado) se colapsan al primero.
  const evEstado = sinRepetidosConsecutivos(
    rec.eventos.filter(e => e.accion === 'cambio_pipeline')
      .map(e => ({ ...e, descripcion: (e.descripcion || 'Cambio de etapa').replace(/\s+de\s+["“].*?["”]\s+a\s+/i, ' a ') })),
    e => e.descripcion.trim().toUpperCase(),
  );
  let postuladaAnotada = false;
  for (const [i, e] of evEstado.entries()) {
    const desc = e.descripcion;
    // Color del estado destino si se reconoce en el texto.
    const destino = ESTADOS_PIPELINE.find(s => desc.toUpperCase().includes(s.label)) || null;
    const esPostulada = destino?.id === 'POSTULADA';
    hitos.push({
      key: `est-${i}`, fecha: e.created_at, color: destino?.color || '#0891b2',
      icon: esPostulada ? <Send size={13} /> : <GitCommitHorizontal size={13} />,
      titulo: desc,
      actor: e.actor_nombre || e.actor_email,
      detalle: esPostulada && !postuladaAnotada && (rec.empresa || rec.monto_ofertado)
        ? <>{rec.empresa ? <>con <span className="font-semibold">{rec.empresa}</span></> : null}{rec.empresa && rec.monto_ofertado ? ' · ' : ''}{rec.monto_ofertado ? <>ofertado {fmtCLP(rec.monto_ofertado)}</> : null}</>
        : undefined,
    });
    if (esPostulada) postuladaAnotada = true;
  }

  if (rec.descarte) {
    hitos.push({
      key: 'descarte', fecha: rec.descarte.fecha, color: '#dc2626', icon: <Ban size={13} />,
      titulo: 'Descartada',
      detalle: rec.descarte.motivo ? <span className="line-clamp-2">{rec.descarte.motivo}</span> : undefined,
      actor: rec.descarte.por_nombre,
    });
  }

  const estadoNorm = normalizarEstado(rec.estado_actual);
  if (rec.adjudicacion && (rec.adjudicacion.es_adjudicada || ['ADJUDICADA', 'PERDIDA'].includes(estadoNorm))) {
    const gano = estadoNorm === 'ADJUDICADA';
    const perdio = estadoNorm === 'PERDIDA';
    hitos.push({
      // `alFinal`: el resultado es el DESENLACE del recorrido. La fecha del cache de MP puede
      // ser anterior a la asignación (la licitación ya estaba adjudicada cuando se detectó) y
      // ordenarlo por fecha lo metía en medio de la historia, confundiendo la lectura.
      key: 'adj', alFinal: true, fecha: rec.adjudicacion.fecha_adjudicacion, color: gano ? '#16A34A' : perdio ? '#9F1239' : '#6366F1', icon: <Trophy size={13} />,
      titulo: gano ? 'Resultado: GANADA' : perdio ? 'Resultado: PERDIDA' : 'Adjudicada por el organismo',
      detalle: <>
        {rec.adjudicacion.monto_adjudicado_total ? <>monto adjudicado {fmtCLP(rec.adjudicacion.monto_adjudicado_total)} · </> : null}
        {rec.adjudicacion.numero_oferentes ? <>{rec.adjudicacion.numero_oferentes} oferente{rec.adjudicacion.numero_oferentes === 1 ? '' : 's'} · </> : null}
        {rec.adjudicacion.url_acta ? <a href={rec.adjudicacion.url_acta} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline inline-flex items-center gap-0.5">ver acta <ExternalLink size={10} /></a> : null}
      </>,
    });
  }

  // Orden cronológico. Los desenlaces (alFinal) y los hitos sin fecha van al final.
  hitos.sort((a, b) => {
    const ra = a.alFinal ? 2 : a.fecha ? 0 : 1;
    const rb = b.alFinal ? 2 : b.fecha ? 0 : 1;
    if (ra !== rb) return ra - rb;
    if (!a.fecha || !b.fecha) return 0;
    return new Date(a.fecha).getTime() - new Date(b.fecha).getTime();
  });

  // Próximo paso esperado (fantasma) si el negocio sigue vivo y aún no se postula.
  if (rec.activo && !rec.descarte && FLUJO.includes(estadoNorm) && estadoNorm !== 'POSTULADA') {
    const sig = FLUJO[FLUJO.indexOf(estadoNorm) + 1];
    const meta = getEstadoPipeline(sig);
    if (meta) {
      hitos.push({
        key: 'siguiente', fecha: null, ghost: true, color: '#a1a1aa', icon: <GitCommitHorizontal size={13} />,
        titulo: `Siguiente paso: ${meta.label}`,
      });
    }
  }

  if (hitos.length === 0) return null;

  // Resumen del header: cuánto abarca el recorrido (entre la fecha más antigua y la más nueva).
  const fechas = hitos.filter(h => h.fecha).map(h => new Date(h.fecha!).getTime());
  const total = fechas.length >= 2 ? tramo(new Date(Math.min(...fechas)).toISOString(), new Date(Math.max(...fechas)).toISOString()) : null;

  return (
    <div className="bg-white border border-zinc-200/60 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[12px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
          <Route size={13} /> Recorrido del negocio
        </h3>
        {total && <span className="text-[11px] text-zinc-400" title="Del primer hito al último">{total.replace('+', '')} en total</span>}
      </div>
      <div className="space-y-0">
        {hitos.map((h, i) => {
          const ultimo = i === hitos.length - 1;
          const anterior = i > 0 ? hitos[i - 1] : null;
          const salto = h.fecha && anterior?.fecha ? tramo(anterior.fecha, h.fecha) : null;
          return (
            <div key={h.key} className="flex gap-3">
              {/* Rail: icono del hito + línea */}
              <div className="flex flex-col items-center flex-shrink-0">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${h.ghost ? 'border-2 border-dashed border-zinc-300 !text-zinc-300 bg-white' : ''}`}
                  style={h.ghost ? undefined : { background: h.color }}>
                  {h.icon}
                </span>
                {!ultimo && <span className="w-px flex-1 bg-zinc-200 my-0.5" />}
              </div>
              <div className={`min-w-0 flex-1 ${ultimo ? '' : 'pb-4'}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-[13px] font-semibold leading-snug ${h.ghost ? 'text-zinc-400' : 'text-zinc-800'}`}>{h.titulo}</p>
                  {salto && <span className="text-[10px] font-bold text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-full" title="Tiempo desde el hito anterior">{salto}</span>}
                </div>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  {h.fecha ? fechaCorta(h.fecha) : h.ghost ? 'pendiente' : 'sin fecha registrada'}
                  {h.actor ? <> · por {h.actor}</> : null}
                </p>
                {h.detalle && <p className="text-[12px] text-zinc-500 mt-0.5 leading-snug">{h.detalle}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
