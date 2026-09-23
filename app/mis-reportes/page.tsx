'use client';

// "Mis reportes de error": los reportes que el usuario hizo con el botón rojo flotante
// (components/ReportarErrorBoton) y en qué quedó cada uno — sobre todo CÓMO se solucionó, que el
// admin escribe en /admin/errores. Visible para todo perfil, incluido externo (proxy.ts).
import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { IconBug as Bug, IconLoader2 as Loader2, IconExternalLink as ExternalLink, IconCircleCheck as CheckCircle, IconChevronDown as ChevronDown } from '@tabler/icons-react';
import { suscribirRealtime } from '@/app/lib/use-realtime';

type Estado = 'abierto' | 'en_revision' | 'resuelto' | 'descartado';
interface Reporte {
  id: number;
  url: string;
  titulo: string;
  que_paso: string;
  que_esperaba: string;
  pasos: string | null;
  gravedad: string;
  imagen_url: string | null;
  estado: Estado;
  solucion: string | null;
  solucion_privada?: number | boolean;
  resuelto_por_nombre: string | null;
  resuelto_at: string | null;
  created_at: string;
}

const ESTADO: Record<Estado, { label: string; cls: string }> = {
  abierto:     { label: 'Recibido',    cls: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
  en_revision: { label: 'En revisión', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  resuelto:    { label: 'Resuelto',    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  descartado:  { label: 'Descartado',  cls: 'bg-slate-100 text-slate-600 dark:bg-white/[0.06] dark:text-slate-400' },
};
const fecha = (s: string | null) => s ? new Date(s).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '';

export default function MisReportesPage() {
  const [reportes, setReportes] = useState<Reporte[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      const d = await fetch('/api/reportes-error').then(r => r.json());
      if (d.success) setReportes(d.reportes || []);
    } catch { /* silencioso */ } finally { setCargando(false); }
  }, []);

  useEffect(() => {
    cargar();
    return suscribirRealtime(ev => {
      if (ev.tipo === 'cambio' || (ev.tipo === 'notificacion' && (ev.datos as { tipo?: string })?.tipo?.startsWith('REPORTE_ERROR_'))) cargar();
    });
  }, [cargar]);

  return (
    <AppLayout breadcrumb={[{ label: 'Mis reportes de error' }]}>
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Bug size={24} className="text-red-600" /> Mis reportes de error
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Los errores que reportaste con el botón rojo de abajo a la derecha, y cómo se solucionó cada uno.
          </p>
        </div>

        {cargando ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : reportes.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm bg-white dark:bg-white/[0.03] rounded-xl border border-slate-200 dark:border-white/[0.07]">
            <Bug size={32} className="mx-auto mb-2 text-slate-300" />
            Aún no has reportado errores. Si encuentras uno, aprieta el botón rojo de abajo a la derecha.
          </div>
        ) : (
          <div className="space-y-3">
            {reportes.map(r => {
              const cerrado = r.estado === 'resuelto' || r.estado === 'descartado';
              const expandido = abierto === r.id;
              return (
                <div key={r.id} className="bg-white dark:bg-white/[0.03] rounded-xl border border-slate-200 dark:border-white/[0.07] overflow-hidden">
                  <button onClick={() => setAbierto(expandido ? null : r.id)} className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded ${ESTADO[r.estado].cls}`}>{ESTADO[r.estado].label}</span>
                        <span className="text-[10.5px] text-slate-400">#{r.id} · {fecha(r.created_at)}</span>
                      </div>
                      <p className="text-[14px] font-semibold text-slate-800 dark:text-slate-100">{r.titulo}</p>
                    </div>
                    <ChevronDown size={18} className={`text-slate-400 mt-1 transition-transform ${expandido ? 'rotate-180' : ''}`} />
                  </button>

                  {/* La respuesta del admin va siempre a la vista, sin tener que expandir. */}
                  {r.solucion && (
                    <div className={`mx-4 mb-3 rounded-lg p-3 ${r.estado === 'resuelto'
                      ? 'bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30'
                      : 'bg-slate-50 border border-slate-200 dark:bg-white/[0.04] dark:border-white/10'}`}>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1 flex items-center gap-1">
                        {r.estado === 'resuelto' && <CheckCircle size={14} className="text-emerald-600" />}
                        {r.estado === 'resuelto' ? 'Cómo se solucionó' : r.estado === 'descartado' ? 'Por qué se descartó' : 'Nota del administrador'}
                      </p>
                      <p className="text-[13px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{r.solucion}</p>
                      {cerrado && r.resuelto_por_nombre && (
                        <p className="text-[11px] text-slate-500 mt-2">— {r.resuelto_por_nombre}, {fecha(r.resuelto_at)}</p>
                      )}
                    </div>
                  )}

                  {/* Solución marcada "solo administradores": el perfil sabe que se atendió, sin el texto. */}
                  {!r.solucion && !!r.solucion_privada && (
                    <p className="mx-4 mb-3 text-[12px] text-slate-500 italic">
                      {r.estado === 'resuelto' ? 'Solucionado' : r.estado === 'descartado' ? 'Descartado' : r.estado === 'en_revision' ? 'En revisión' : 'Recibido'} por el equipo de administración
                      {cerrado && r.resuelto_por_nombre ? ` (${r.resuelto_por_nombre}, ${fecha(r.resuelto_at)})` : ''}.
                    </p>
                  )}

                  {expandido && (
                    <div className="px-4 pb-4 space-y-3 border-t border-slate-100 dark:border-white/[0.06] pt-3">
                      <a href={r.url} target="_blank" rel="noreferrer" className="text-[12px] text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 break-all">
                        {r.url} <ExternalLink size={12} className="flex-shrink-0" />
                      </a>
                      <div className="grid gap-3 md:grid-cols-2 text-[13px] text-slate-700 dark:text-slate-200">
                        <div><p className="text-[11px] font-bold uppercase text-slate-400 mb-1">Qué pasó</p><p className="whitespace-pre-wrap">{r.que_paso}</p></div>
                        <div><p className="text-[11px] font-bold uppercase text-slate-400 mb-1">Qué esperabas</p><p className="whitespace-pre-wrap">{r.que_esperaba}</p></div>
                        {r.pasos && <div className="md:col-span-2"><p className="text-[11px] font-bold uppercase text-slate-400 mb-1">Qué estabas haciendo</p><p className="whitespace-pre-wrap">{r.pasos}</p></div>}
                      </div>
                      {r.imagen_url && (
                        <a href={r.imagen_url} target="_blank" rel="noreferrer" title="Abrir captura en tamaño completo">
                          <img src={r.imagen_url} alt={`Captura del reporte #${r.id}`} className="w-full rounded-lg border border-slate-200 dark:border-white/[0.07]" />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
