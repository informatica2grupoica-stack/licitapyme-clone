'use client';

// Apartado "Descartadas" (solo admin): todas las licitaciones descartadas con quién las
// descartó, el motivo, la fecha y acceso al detalle. Se nutre de /api/negocios/descartadas.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Ban, Loader2, ExternalLink, Building2, Calendar, User, RefreshCw, RotateCcw } from 'lucide-react';
import { AppLayout } from '@/app/components/AppLayout';
import { useSession } from '@/app/lib/session-context';
import { useToast } from '@/app/components/ui/toast';

interface UsuarioLite { id: number; nombre: string | null; email: string; }

interface Descartada {
  id: number;
  licitacion_codigo: string;
  licitacion_nombre: string | null;
  licitacion_organismo: string | null;
  licitacion_monto: number | null;
  licitacion_cierre: string | null;
  licitacion_tipo: string | null;
  asignado_a: number;
  descarte_motivo: string | null;
  descarte_at: string | null;
  asignado_nombre: string | null;
  asignado_email: string | null;
  descarte_por_nombre: string | null;
  descarte_por_email: string | null;
}

const fmtMonto = (n: number | null) =>
  n ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n) : '—';
const fmtFecha = (s: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function DescartadasPage() {
  const { usuario, cargando: cargandoSesion } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState<Descartada[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioLite[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Usuario elegido para reasignar al reactivar (por negocio) + fila en proceso.
  const [reasignarSel, setReasignarSel] = useState<Record<number, number>>({});
  const [procesando, setProcesando] = useState<number | null>(null);

  const esAdmin = usuario?.rol === 'admin';

  useEffect(() => {
    if (!cargandoSesion && usuario && !esAdmin) router.replace('/negocios');
  }, [cargandoSesion, usuario, esAdmin, router]);

  const cargar = async () => {
    setCargando(true); setError(null);
    try {
      const res = await fetch('/api/negocios/descartadas');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al cargar');
      setItems(data.descartadas || []);
      setUsuarios(data.usuarios || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  };

  // Reactivar: vuelve a estado 1ASIGNADO (limpia el descarte) y, si se eligió otro usuario,
  // reasigna. Al revisarla puede volver a trabajarse.
  const reactivar = async (d: Descartada) => {
    setProcesando(d.id);
    try {
      const destino = reasignarSel[d.id] ?? d.asignado_a;
      const res = await fetch(`/api/negocios/${d.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado_pipeline: '1ASIGNADO', asignado_a: destino }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al reactivar');
      setItems(prev => prev.filter(x => x.id !== d.id));
      toast.success('Licitación reactivada', 'Volvió a Negocios como asignada');
    } catch (e: any) {
      toast.error('No se pudo reactivar', e?.message);
    } finally {
      setProcesando(null);
    }
  };

  useEffect(() => { if (esAdmin) cargar(); }, [esAdmin]);

  if (!cargandoSesion && usuario && !esAdmin) {
    return <AppLayout breadcrumb={[{ label: 'Descartadas' }]}><div className="p-10 text-center text-sm text-slate-500">Redirigiendo…</div></AppLayout>;
  }

  return (
    <AppLayout breadcrumb={[{ label: 'Descartadas' }]}>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center text-red-600">
              <Ban size={18} />
            </div>
            <div>
              <h1 className="text-[16px] font-bold text-slate-900">Licitaciones descartadas</h1>
              <p className="text-xs text-slate-500">Quién la descartó, el motivo y el detalle de cada una</p>
            </div>
          </div>
          <button onClick={cargar} disabled={cargando}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <RefreshCw size={15} className={cargando ? 'animate-spin' : ''} />
          </button>
        </div>

        {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>}

        {cargando ? (
          <div className="flex items-center justify-center py-16 gap-2 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin text-red-500" /> Cargando descartadas…
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Ban size={20} className="text-slate-300" />
            </div>
            <p className="text-sm font-semibold text-slate-600">No hay licitaciones descartadas</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            <p className="text-xs text-slate-400 font-medium">{items.length} descartada{items.length !== 1 ? 's' : ''}</p>
            {items.map(d => (
              <div key={d.id} className="bg-white rounded-xl border border-slate-200 border-l-4 border-l-red-500 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-mono font-semibold text-red-700 bg-red-50 px-1.5 py-0.5 rounded">{d.licitacion_codigo}</span>
                      {d.licitacion_tipo && <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{d.licitacion_tipo}</span>}
                    </div>
                    <p className="text-[13.5px] font-semibold text-slate-800 mt-1 leading-snug">{d.licitacion_nombre || '(sin nombre)'}</p>
                    {d.licitacion_organismo && (
                      <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1"><Building2 size={11} /> {d.licitacion_organismo}</p>
                    )}
                  </div>
                  <Link href={`/licitacion/${encodeURIComponent(d.licitacion_codigo)}`}
                    className="flex-shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition-colors">
                    <ExternalLink size={13} /> Ver detalle
                  </Link>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                  <div>
                    <p className="text-slate-400">Monto</p>
                    <p className="font-semibold text-slate-700">{fmtMonto(d.licitacion_monto)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 flex items-center gap-1"><Calendar size={10} /> Cierre</p>
                    <p className="font-semibold text-slate-700">{fmtFecha(d.licitacion_cierre)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 flex items-center gap-1"><User size={10} /> Asignada a</p>
                    <p className="font-semibold text-slate-700 truncate">{d.asignado_nombre || d.asignado_email || '—'}</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Descartó</p>
                    <p className="font-semibold text-slate-700 truncate">{d.descarte_por_nombre || d.descarte_por_email || '—'} · {fmtFecha(d.descarte_at)}</p>
                  </div>
                </div>

                <div className="mt-2.5 px-3 py-2 bg-red-50/70 border border-red-100 rounded-lg">
                  <p className="text-[11px] font-semibold text-red-700 mb-0.5">Motivo del descarte</p>
                  <p className="text-[12.5px] text-slate-700">{d.descarte_motivo || '(sin motivo registrado)'}</p>
                </div>

                {/* Recuperar: reactivar (a 1ASIGNADO) y opcionalmente reasignar a otro usuario. */}
                <div className="mt-2.5 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-400 font-medium">Volver a trabajar:</span>
                  <select
                    value={reasignarSel[d.id] ?? d.asignado_a}
                    onChange={e => setReasignarSel(prev => ({ ...prev, [d.id]: Number(e.target.value) }))}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:ring-1 focus:ring-emerald-500 outline-none"
                  >
                    {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre || u.email}</option>)}
                  </select>
                  <button
                    onClick={() => reactivar(d)}
                    disabled={procesando === d.id}
                    className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {procesando === d.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    Reactivar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
