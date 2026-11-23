'use client';

// "Mis reportes de error": los reportes que el usuario hizo con el botón rojo flotante
// (components/ReportarErrorBoton) y en qué quedó cada uno — sobre todo CÓMO se solucionó, que el
// admin escribe en /admin/errores. Visible para todo perfil, incluido externo (proxy.ts).
import { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/app/components/AppLayout';
import { IconBug as Bug, IconExternalLink as ExternalLink, IconCircleCheck as CheckCircle, IconChevronDown as ChevronDown } from '@tabler/icons-react';
import { suscribirRealtime } from '@/app/lib/use-realtime';
import { AdjuntosReporte, type AdjuntoReporte } from '@/app/components/AdjuntosReporte';
import { Encabezado, Esqueleto, Vacio } from '@/app/components/ui/kit/Estructura';
import { Estado as EstadoPunto } from '@/app/components/ui/kit/Tarjeta';

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
  adjuntos: AdjuntoReporte[];
  resuelto_por_nombre: string | null;
  resuelto_at: string | null;
  created_at: string;
}

// El color va en el punto; el texto siempre dice el estado.
const ESTADO: Record<Estado, { label: string; color: string }> = {
  abierto:     { label: 'Recibido',    color: '#dc2626' },
  en_revision: { label: 'En revisión', color: '#d97706' },
  resuelto:    { label: 'Resuelto',    color: '#16a34a' },
  descartado:  { label: 'Descartado',  color: '#64748b' },
};
const fecha = (s: string | null) => s ? new Date(s).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '';
const SUPERFICIE = 'rounded-xl border border-linea bg-white shadow-tarjeta dark:bg-slate-900 dark:border-slate-800';

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
      <div className="@container p-4 sm:p-6 lg:p-8 max-w-4xl">
        <Encabezado
          titulo="Mis reportes de error"
          descripcion="Los errores que reportaste con el botón rojo de abajo a la derecha, y cómo se solucionó cada uno."
        />

        {cargando ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <Esqueleto key={i} className="h-16 rounded-xl" />)}</div>
        ) : reportes.length === 0 ? (
          <Vacio icono={<Bug size={28} stroke={1.75} />} titulo="Aún no has reportado errores"
            texto="Si encuentras uno, aprieta el botón rojo de abajo a la derecha." />
        ) : (
          <div className="space-y-3">
            {reportes.map(r => {
              const cerrado = r.estado === 'resuelto' || r.estado === 'descartado';
              const expandido = abierto === r.id;
              return (
                <div key={r.id} className={`${SUPERFICIE} overflow-hidden`}>
                  <button onClick={() => setAbierto(expandido ? null : r.id)} aria-expanded={expandido}
                    className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-marca/60">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1 text-xs">
                        <span className="font-medium text-tinta dark:text-slate-200"><EstadoPunto color={ESTADO[r.estado].color}>{ESTADO[r.estado].label}</EstadoPunto></span>
                        <span className="text-tinta-2 dark:text-slate-400 tabular-nums">#{r.id} · {fecha(r.created_at)}</span>
                      </div>
                      <p className="text-[15px] font-semibold text-tinta dark:text-slate-100">{r.titulo}</p>
                    </div>
                    <ChevronDown size={18} stroke={1.75} className={`text-slate-400 mt-1 transition-transform ${expandido ? 'rotate-180' : ''}`} />
                  </button>

                  {/* La respuesta del admin va siempre a la vista, sin tener que expandir. */}
                  {(r.solucion || r.adjuntos.length > 0) && (
                    <div className="mx-4 mb-3 border-t border-linea pt-3 dark:border-slate-800">
                      <p className="text-xs font-medium text-tinta-2 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                        {r.estado === 'resuelto' && <CheckCircle size={16} stroke={1.75} className="text-exito" />}
                        {r.estado === 'resuelto' ? 'Cómo se solucionó' : r.estado === 'descartado' ? 'Por qué se descartó' : 'Nota del administrador'}
                      </p>
                      {r.solucion && <p className="text-[13px] text-tinta dark:text-slate-200 whitespace-pre-wrap">{r.solucion}</p>}
                      {r.adjuntos.length > 0 && <div className="mt-2"><AdjuntosReporte adjuntos={r.adjuntos} /></div>}
                      {cerrado && r.resuelto_por_nombre && (
                        <p className="text-xs text-tinta-2 dark:text-slate-400 mt-2">— {r.resuelto_por_nombre}, {fecha(r.resuelto_at)}</p>
                      )}
                    </div>
                  )}

                  {/* Solución marcada "solo administradores": el perfil sabe que se atendió, sin el texto. */}
                  {!r.solucion && !!r.solucion_privada && (
                    <p className="mx-4 mb-3 text-xs text-tinta-2 dark:text-slate-400">
                      {r.estado === 'resuelto' ? 'Solucionado' : r.estado === 'descartado' ? 'Descartado' : r.estado === 'en_revision' ? 'En revisión' : 'Recibido'} por el equipo de administración
                      {cerrado && r.resuelto_por_nombre ? ` (${r.resuelto_por_nombre}, ${fecha(r.resuelto_at)})` : ''}.
                    </p>
                  )}

                  {expandido && (
                    <div className="px-4 pb-4 space-y-3 border-t border-linea dark:border-slate-800 pt-3">
                      <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-marca hover:underline inline-flex items-center gap-1 break-all">
                        {r.url} <ExternalLink size={14} stroke={1.75} className="flex-shrink-0" />
                      </a>
                      <div className="grid gap-3 @2xl:grid-cols-2 text-[13px] text-tinta dark:text-slate-200">
                        <div><p className="text-xs font-medium text-tinta-2 dark:text-slate-400 mb-1">Qué pasó</p><p className="whitespace-pre-wrap">{r.que_paso}</p></div>
                        <div><p className="text-xs font-medium text-tinta-2 dark:text-slate-400 mb-1">Qué esperabas</p><p className="whitespace-pre-wrap">{r.que_esperaba}</p></div>
                        {r.pasos && <div className="@2xl:col-span-2"><p className="text-xs font-medium text-tinta-2 dark:text-slate-400 mb-1">Qué estabas haciendo</p><p className="whitespace-pre-wrap">{r.pasos}</p></div>}
                      </div>
                      {r.imagen_url && (
                        <a href={r.imagen_url} target="_blank" rel="noreferrer" title="Abrir captura en tamaño completo">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.imagen_url} alt={`Captura del reporte #${r.id}`} className="w-full rounded-lg border border-linea dark:border-slate-700" />
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
