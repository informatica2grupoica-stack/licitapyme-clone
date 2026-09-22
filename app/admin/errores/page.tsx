'use client';

// Bandeja de errores reportados por los perfiles con el botón flotante "Reportar error"
// (components/ReportarErrorBoton). Solo admin (proxy.ts bloquea /admin/*). Cada reporte trae la
// captura marcada, la observación del usuario y el contexto técnico (navegador, errores de
// consola). El admin lo pasa a "En revisión" y lo cierra como Resuelto (escribiendo cómo se
// solucionó) o Descartado (escribiendo por qué); al cerrarlo, al que lo reportó le llega aviso.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { IconBug as Bug, IconLoader2 as Loader2, IconExternalLink as ExternalLink, IconCircleCheck as CheckCircle, IconDeviceFloppy as Save } from '@tabler/icons-react';
import { useToast } from '@/app/components/ui/toast';
import { suscribirRealtime } from '@/app/lib/use-realtime';

type Estado = 'abierto' | 'en_revision' | 'resuelto' | 'descartado';
interface Reporte {
  id: number;
  usuario_nombre: string | null;
  usuario_email: string | null;
  url: string;
  titulo: string;
  que_paso: string;
  que_esperaba: string;
  pasos: string | null;
  gravedad: 'bloqueante' | 'alta' | 'media' | 'baja';
  imagen_url: string | null;
  contexto: { tituloPagina?: string; navegador?: string; pantalla?: string; tema?: string; erroresConsola?: string[] } | string | null;
  estado: Estado;
  solucion: string | null;
  resuelto_por_nombre: string | null;
  resuelto_at: string | null;
  created_at: string;
}

const ESTADOS: { key: Estado; label: string; cls: string }[] = [
  { key: 'abierto',     label: 'Abierto',     cls: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
  { key: 'en_revision', label: 'En revisión', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  { key: 'resuelto',    label: 'Resuelto',    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  { key: 'descartado',  label: 'Descartado',  cls: 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-400' },
];
const GRAVEDAD_CLS: Record<Reporte['gravedad'], string> = {
  bloqueante: 'bg-red-600 text-white',
  alta: 'bg-orange-500 text-white',
  media: 'bg-amber-400 text-amber-950',
  baja: 'bg-slate-300 text-slate-800',
};
const estadoInfo = (e: Estado) => ESTADOS.find(x => x.key === e)!;
const fecha = (s: string | null) => s ? new Date(s).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '';
const ctx = (r: Reporte) => (typeof r.contexto === 'string' ? (() => { try { return JSON.parse(r.contexto as string); } catch { return null; } })() : r.contexto) || {};

export default function ErroresReportadosPage() {
  const toast = useToast();
  const [reportes, setReportes] = useState<Reporte[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<'pendientes' | Estado | 'todos'>('pendientes');
  const [selId, setSelId] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      const d = await fetch('/api/admin/reportes-error').then(r => r.json());
      if (d.success) setReportes(d.reportes || []);
    } catch { /* silencioso */ } finally { setCargando(false); }
  }, []);

  useEffect(() => {
    cargar();
    return suscribirRealtime(ev => {
      if (ev.tipo === 'cambio' || (ev.tipo === 'notificacion' && (ev.datos as { tipo?: string })?.tipo === 'REPORTE_ERROR')) cargar();
    });
  }, [cargar]);

  const visibles = useMemo(() => reportes.filter(r =>
    filtro === 'todos' ? true : filtro === 'pendientes' ? r.estado === 'abierto' || r.estado === 'en_revision' : r.estado === filtro,
  ), [reportes, filtro]);
  const sel = reportes.find(r => r.id === selId) ?? visibles[0] ?? null;
  const cuenta = (f: typeof filtro) => reportes.filter(r =>
    f === 'todos' ? true : f === 'pendientes' ? r.estado === 'abierto' || r.estado === 'en_revision' : r.estado === f).length;

  return (
    <AppLayout breadcrumb={[{ label: 'Admin', href: '/admin/usuarios' }, { label: 'Errores reportados' }]}>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Bug size={24} className="text-red-600" /> Errores reportados
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Lo que los perfiles reportan con el botón rojo flotante: captura marcada + observación. Resuélvelos dejando escrito cómo se solucionó.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {(['pendientes', 'abierto', 'en_revision', 'resuelto', 'descartado', 'todos'] as const).map(f => (
            <button key={f} onClick={() => { setFiltro(f); setSelId(null); }}
              className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-colors ${filtro === f
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 dark:bg-white/[0.04] dark:text-slate-300 dark:border-white/10'}`}>
              {f === 'pendientes' ? 'Pendientes' : f === 'todos' ? 'Todos' : estadoInfo(f).label} <span className="opacity-60">({cuenta(f)})</span>
            </button>
          ))}
        </div>

        {cargando ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : visibles.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm bg-white dark:bg-white/[0.03] rounded-xl border border-slate-200 dark:border-white/[0.07]">
            <CheckCircle size={32} className="mx-auto mb-2 text-emerald-500" /> No hay reportes en esta vista.
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4 items-start">
            <div className="bg-white dark:bg-white/[0.03] rounded-xl border border-slate-200 dark:border-white/[0.07] divide-y divide-slate-100 dark:divide-white/[0.06] overflow-hidden">
              {visibles.map(r => (
                <button key={r.id} onClick={() => setSelId(r.id)}
                  className={`w-full text-left px-4 py-3 transition-colors ${sel?.id === r.id ? 'bg-indigo-50 dark:bg-indigo-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${GRAVEDAD_CLS[r.gravedad]}`}>{r.gravedad}</span>
                    <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded ${estadoInfo(r.estado).cls}`}>{estadoInfo(r.estado).label}</span>
                    <span className="ml-auto text-[10.5px] text-slate-400">#{r.id} · {fecha(r.created_at)}</span>
                  </div>
                  <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100 line-clamp-1">{r.titulo}</p>
                  <p className="text-[11.5px] text-slate-500 truncate">{r.usuario_nombre || r.usuario_email} · {new URL(r.url, 'http://x').pathname}</p>
                </button>
              ))}
            </div>
            {sel && <DetalleReporte key={sel.id} r={sel} onGuardado={cargar} toast={toast} />}
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function DetalleReporte({ r, onGuardado, toast }: { r: Reporte; onGuardado: () => void; toast: ReturnType<typeof useToast> }) {
  const [estado, setEstado] = useState<Estado>(r.estado);
  const [solucion, setSolucion] = useState(r.solucion || '');
  const [guardando, setGuardando] = useState(false);
  const c = ctx(r);
  const cierra = estado === 'resuelto' || estado === 'descartado';
  const faltaSolucion = cierra && solucion.trim().length < 10;

  const guardar = async () => {
    setGuardando(true);
    try {
      const res = await fetch(`/api/admin/reportes-error/${r.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado, solucion }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.success) throw new Error(d.error || `Error ${res.status}`);
      toast.success('Reporte actualizado', d.avisado ? 'Se le avisó a quien lo reportó.' : undefined);
      onGuardado();
    } catch (e) {
      toast.error('No se pudo guardar', String((e as Error).message || e));
    } finally { setGuardando(false); }
  };

  const bloque = 'bg-white dark:bg-white/[0.03] rounded-xl border border-slate-200 dark:border-white/[0.07] p-4';
  const titulo = 'text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1';
  const texto = 'text-[13px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap';

  return (
    <div className="space-y-4 min-w-0">
      <div className={bloque}>
        <div className="flex items-start gap-2 mb-2">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex-1">{r.titulo}</h2>
          <span className={`text-[10.5px] font-bold uppercase px-2 py-1 rounded ${GRAVEDAD_CLS[r.gravedad]}`}>{r.gravedad}</span>
        </div>
        <p className="text-[12px] text-slate-500">
          Reportado por <b className="text-slate-700 dark:text-slate-300">{r.usuario_nombre || r.usuario_email}</b> ({r.usuario_email}) · {fecha(r.created_at)}
        </p>
        <a href={r.url} target="_blank" rel="noreferrer" className="text-[12px] text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 break-all mt-1">
          {r.url} <ExternalLink size={12} className="flex-shrink-0" />
        </a>
      </div>

      {r.imagen_url && (
        <a href={r.imagen_url} target="_blank" rel="noreferrer" className="block" title="Abrir captura en tamaño completo">
          <img src={r.imagen_url} alt={`Captura del reporte #${r.id}`} className="w-full rounded-xl border border-slate-200 dark:border-white/[0.07] shadow-sm" />
        </a>
      )}

      <div className={`${bloque} grid gap-4 md:grid-cols-2`}>
        <div><p className={titulo}>Qué pasó</p><p className={texto}>{r.que_paso}</p></div>
        <div><p className={titulo}>Qué esperaba</p><p className={texto}>{r.que_esperaba}</p></div>
        {r.pasos && <div className="md:col-span-2"><p className={titulo}>Qué estaba haciendo</p><p className={texto}>{r.pasos}</p></div>}
      </div>

      <details className={bloque}>
        <summary className="text-[12.5px] font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
          Contexto técnico {c.erroresConsola?.length ? `· ${c.erroresConsola.length} error(es) de consola` : ''}
        </summary>
        <div className="mt-3 space-y-1 text-[12px] text-slate-600 dark:text-slate-400">
          {c.tituloPagina && <p><b>Página:</b> {c.tituloPagina}</p>}
          {c.pantalla && <p><b>Pantalla:</b> {c.pantalla} · tema {c.tema}</p>}
          {c.navegador && <p className="break-all"><b>Navegador:</b> {c.navegador}</p>}
          {c.erroresConsola?.length ? (
            <pre className="mt-2 p-2 rounded-lg bg-slate-900 text-red-300 text-[11px] overflow-x-auto whitespace-pre-wrap">{c.erroresConsola.join('\n')}</pre>
          ) : <p className="text-slate-400">Sin errores de JavaScript registrados en la pestaña.</p>}
        </div>
      </details>

      <div className={bloque}>
        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-100 mb-3">Gestión</p>
        {r.resuelto_at && (
          <p className="text-[12px] text-slate-500 mb-3">
            {estadoInfo(r.estado).label} por <b>{r.resuelto_por_nombre}</b> el {fecha(r.resuelto_at)}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {ESTADOS.map(e => (
            <button key={e.key} onClick={() => setEstado(e.key)}
              className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition-colors ${estado === e.key
                ? `${e.cls} border-current` : 'border-slate-200 dark:border-white/10 text-slate-500 hover:bg-slate-50 dark:hover:bg-white/[0.04]'}`}>
              {e.label}
            </button>
          ))}
        </div>
        <label className="block text-[12px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
          {estado === 'descartado' ? 'Por qué se descarta *' : estado === 'resuelto' ? 'Cómo se solucionó *' : 'Notas / cómo se está solucionando'}
        </label>
        <textarea value={solucion} onChange={e => setSolucion(e.target.value)} rows={4}
          placeholder="Ej: El guardado fallaba porque el precio venía con puntos de miles; se corrigió el parser y se re-guardaron los 3 costeos afectados."
          className="w-full rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.04] px-3 py-2 text-[13px] text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40" />
        {faltaSolucion && <p className="text-[11.5px] text-amber-600 mt-1">Escribe al menos 10 caracteres para cerrarlo.</p>}
        <button onClick={guardar} disabled={guardando || faltaSolucion || (estado === r.estado && solucion === (r.solucion || ''))}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[13px] font-semibold px-4 py-2">
          {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar
        </button>
      </div>
    </div>
  );
}
